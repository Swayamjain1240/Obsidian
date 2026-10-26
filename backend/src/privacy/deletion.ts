import { createHash } from 'node:crypto';
import path from 'node:path';

import type { SessionStore } from '../auth/session-store.js';
import type { SystemEvent } from '../events.js';
import { createSystemEvent } from '../events.js';
import { WorkflowRevisionConflictError, type WorkflowStateKind, type WorkflowStore } from '../workflow/store.js';
import type { DurableRunStore } from '../workflow/run-store.js';
import { cleanupErrorSummary, removeContained } from './cleanup.js';
import { isActiveWorkflowStatus, retentionPolicy, type RetentionPolicy } from './retention.js';
import type { AppConfig } from '../config.js';

export type DeletionStatus = 'requested' | 'blocked_active' | 'running' | 'partial' | 'completed' | 'failed';
export type DeletionScope = 'account' | 'workflow';

export interface DeletionRequest {
  requestId: string;
  ownerUserId: string;
  sessionId: string;
  scope: DeletionScope;
  targetId: string | null;
  status: DeletionStatus;
  protectedAudit: true;
  deletedStateCount: number;
  deletedFilesystemCount: number;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export type PublicDeletionRequest = Pick<DeletionRequest, 'requestId' | 'scope' | 'targetId' | 'status' | 'protectedAudit' | 'deletedStateCount' | 'deletedFilesystemCount' | 'failureCode' | 'createdAt' | 'updatedAt' | 'revision'>;

// Account-level privacy requests have no repository snapshot/base commit. Keep
// the required system-event field explicit rather than fabricating a SHA.
const PRIVACY_BASE_COMMIT = 'not_applicable';

const stateKinds: WorkflowStateKind[] = [
  'workflow_aggregate', 'repair_plan', 'enhancement_run', 'version_2_run', 'validation', 'pull_request',
  'repair_checkpoint', 'approval_receipt', 'recommendation_review', 'idempotency', 'diff', 'repository_selection',
  'snapshot_handle', 'delivery_step', 'privacy_cleanup',
];

function now(): string { return new Date().toISOString(); }

function containsTarget(value: unknown, targetId: string): boolean {
  if (typeof value === 'string') return value === targetId;
  if (Array.isArray(value)) return value.some((item) => containsTarget(item, targetId));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsTarget(item, targetId));
  return false;
}

function publicRequest(request: DeletionRequest): PublicDeletionRequest {
  const { ownerUserId: _ownerUserId, sessionId: _sessionId, ...publicFields } = request;
  return publicFields;
}

export class PrivacyDeletionService {
  private readonly policy: RetentionPolicy;
  private readonly processing = new Set<string>();

  public constructor(
    private readonly config: Pick<AppConfig, 'SNAPSHOT_ROOT' | 'PRIVACY_SNAPSHOT_RETENTION_MS' | 'PRIVACY_WORKSPACE_RETENTION_MS' | 'PRIVACY_RUN_RETENTION_MS' | 'PRIVACY_PREVIEW_RETENTION_MS' | 'PRIVACY_AI_CONTEXT_RETENTION_MS' | 'PRIVACY_AUDIT_RETENTION_MS' | 'PRIVACY_CLEANUP_BATCH_SIZE' | 'PRIVACY_DELETION_ACTIVE_POLICY'>,
    private readonly store: WorkflowStore,
    private readonly sessions: SessionStore,
    private readonly eventSink?: (event: SystemEvent) => void | Promise<void>,
    private readonly runStore?: DurableRunStore,
  ) {
    this.policy = retentionPolicy(config);
  }

  public async request(ownerUserId: string, sessionId: string, scope: DeletionScope, targetId?: string): Promise<PublicDeletionRequest> {
    const requestId = createHash('sha256').update(`${ownerUserId}:${scope}:${targetId ?? ''}`).digest('hex').slice(0, 32);
    const prior = await this.store.get<DeletionRequest>(ownerUserId, 'deletion_request', requestId);
    if (prior) {
      if (prior.status === 'requested' || prior.status === 'running') return this.process(prior);
      return publicRequest(prior);
    }
    const request: DeletionRequest = { requestId, ownerUserId, sessionId, scope, targetId: targetId ?? null, status: 'requested', protectedAudit: true, deletedStateCount: 0, deletedFilesystemCount: 0, failureCode: null, createdAt: now(), updatedAt: now(), revision: 1 };
    try {
      await this.store.saveVersioned(ownerUserId, 'deletion_request', request.requestId, request, 0);
    } catch (error: unknown) {
      if (error instanceof WorkflowRevisionConflictError) {
        const winner = await this.store.get<DeletionRequest>(ownerUserId, 'deletion_request', request.requestId);
        if (winner) return publicRequest(winner);
      }
      throw error;
    }
    await this.emit(request, 'PRIVACY_DELETION_REQUESTED', 'passed');
    return this.process(request);
  }

  public async get(ownerUserId: string, requestId: string): Promise<PublicDeletionRequest | null> {
    const value = await this.store.get<DeletionRequest>(ownerUserId, 'deletion_request', requestId);
    return value ? publicRequest(value) : null;
  }

  public async retry(ownerUserId: string, requestId: string): Promise<PublicDeletionRequest> {
    const request = await this.store.get<DeletionRequest>(ownerUserId, 'deletion_request', requestId);
    if (!request) throw new Error('Deletion request was not found.');
    if (!['requested', 'running', 'blocked_active', 'partial', 'failed'].includes(request.status)) return publicRequest(request);
    return this.process(request);
  }

  public async reconcilePending(): Promise<{ attempted: number; completed: number; failed: number }> {
    const pending = (await this.store.listAll?.<DeletionRequest>('deletion_request') ?? [])
      .filter((entry) => entry.value.status === 'requested' || entry.value.status === 'running');
    const results = await Promise.all(pending.map(async (entry) => {
      const result = await this.process(entry.value);
      return result.status === 'completed' ? 'completed' : result.status === 'failed' || result.status === 'partial' ? 'failed' : 'pending';
    }));
    return {
      attempted: results.length,
      completed: results.filter((result) => result === 'completed').length,
      failed: results.filter((result) => result === 'failed').length,
    };
  }

  private async process(request: DeletionRequest): Promise<PublicDeletionRequest> {
    if (this.processing.has(request.requestId)) return publicRequest(request);
    this.processing.add(request.requestId);
    try {
      const activeEntries: Array<{ id: string; value: unknown }> = [];
      for (const kind of stateKinds) activeEntries.push(...(await this.store.list?.<unknown>(request.ownerUserId, kind) ?? []));
      const runEntries = await this.runStore?.list(request.ownerUserId) ?? [];
      const active = request.scope === 'account'
        ? activeEntries.some((entry) => isActiveWorkflowStatus((entry.value as { status?: unknown })?.status))
          || runEntries.some((entry) => isActiveWorkflowStatus(((entry.payload as { result?: { status?: unknown } })?.result?.status)))
        : activeEntries.some((entry) => (entry.id === request.targetId || containsTarget(entry.value, request.targetId ?? '')) && isActiveWorkflowStatus((entry.value as { status?: unknown })?.status))
          || runEntries.some((entry) => (entry.runId === request.targetId || containsTarget(entry.payload, request.targetId ?? '')) && isActiveWorkflowStatus(((entry.payload as { result?: { status?: unknown } })?.result?.status)));
      if (active) {
        request.status = 'blocked_active';
        request.failureCode = this.policy.deletionActivePolicy === 'cancel' ? 'PRIVACY_CANCELLATION_REQUIRES_WORKFLOW_COORDINATION' : null;
        request.updatedAt = now();
        request.revision += 1;
        await this.store.save(request.ownerUserId, 'deletion_request', request.requestId, request);
        await this.emit(request, 'PRIVACY_DELETION_BLOCKED_ACTIVE', 'failed');
        return publicRequest(request);
      }

      request.status = 'running';
      request.updatedAt = now();
      request.revision += 1;
      await this.store.save(request.ownerUserId, 'deletion_request', request.requestId, request);
      const failures: string[] = [];
      let deletedStateCount = 0;
      let deletedFilesystemCount = 0;

      for (const kind of stateKinds) {
        const records = await this.store.list?.<unknown>(request.ownerUserId, kind) ?? [];
        for (const record of records) {
          if (request.scope === 'workflow' && record.id !== request.targetId && !containsTarget(record.value, request.targetId ?? '')) continue;
          if (kind === 'snapshot_handle') {
            const snapshot = (record.value as { snapshot?: { archivePath?: string } }).snapshot;
            if (snapshot?.archivePath) {
              const receipt = await removeContained(this.config.SNAPSHOT_ROOT, path.dirname(snapshot.archivePath), record.id);
              if (receipt.status === 'failed') failures.push(receipt.errorCode ?? 'CLEANUP_FAILED');
              else deletedFilesystemCount += receipt.status === 'completed' || receipt.status === 'not_found' ? 1 : 0;
            }
          }
          if (kind === 'privacy_cleanup') {
            const target = (record.value as { root?: string; target?: string }).target;
            const root = (record.value as { root?: string }).root;
            if (!root || !target) {
              failures.push('PRIVACY_CLEANUP_METADATA_INVALID');
            } else {
              const receipt = await removeContained(root, target, record.id);
              if (receipt.status === 'failed') failures.push(receipt.errorCode ?? 'CLEANUP_FAILED');
              else {
                deletedFilesystemCount += receipt.status === 'completed' || receipt.status === 'not_found' ? 1 : 0;
                try { await this.store.delete?.(request.ownerUserId, kind, record.id); }
                catch (error: unknown) { failures.push(cleanupErrorSummary(error)); }
              }
            }
          }
          if (kind !== 'privacy_cleanup' && kind !== 'deletion_request') {
            try { await this.store.delete?.(request.ownerUserId, kind, record.id); deletedStateCount += 1; }
            catch (error: unknown) { failures.push(cleanupErrorSummary(error)); }
          }
        }
      }
      if (this.runStore) {
        for (const entry of runEntries) {
          if (request.scope === 'workflow' && entry.runId !== request.targetId && !containsTarget(entry.payload, request.targetId ?? '')) continue;
          try { await this.runStore.delete(request.ownerUserId, entry.runId); deletedStateCount += 1; }
          catch (error: unknown) { failures.push(cleanupErrorSummary(error)); }
        }
      }
      if (request.scope === 'account') {
        try { await this.sessions.deleteUserAsync(Number(request.ownerUserId)); }
        catch (error: unknown) { failures.push(cleanupErrorSummary(error)); }
      }
      request.deletedStateCount = deletedStateCount;
      request.deletedFilesystemCount = deletedFilesystemCount;
      request.failureCode = failures.length ? 'PRIVACY_PARTIAL_CLEANUP' : null;
      request.status = failures.length ? 'partial' : 'completed';
      request.updatedAt = now();
      request.revision += 1;
      await this.store.save(request.ownerUserId, 'deletion_request', request.requestId, request);
      await this.emit(request, failures.length ? 'PRIVACY_DELETION_PARTIAL' : 'PRIVACY_DELETION_COMPLETED', failures.length ? 'failed' : 'passed');
      return publicRequest(request);
    } catch (error: unknown) {
      request.status = 'failed';
      request.failureCode = 'PRIVACY_RECOVERY_REQUIRED';
      request.updatedAt = now();
      request.revision += 1;
      try {
        await this.store.save(request.ownerUserId, 'deletion_request', request.requestId, request);
        await this.emit(request, 'PRIVACY_DELETION_FAILED', 'failed');
        return publicRequest(request);
      } catch {
        throw error;
      }
    } finally {
      this.processing.delete(request.requestId);
    }
  }

  private async emit(request: DeletionRequest, eventType: string, status: 'passed' | 'failed'): Promise<void> {
    if (!this.eventSink) return;
    await this.eventSink(createSystemEvent({ eventType, sessionId: request.sessionId, projectId: 'privacy', runId: request.requestId, baseCommit: PRIVACY_BASE_COMMIT, phase: 'privacy', status, safeSummary: `${eventType} for ${request.scope}.`, affectedPaths: [], userActionRequired: status !== 'passed', correlationId: request.requestId }));
  }
}
