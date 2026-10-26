import { randomUUID } from 'node:crypto';

import type { WorkflowStore } from '../workflow/store.js';
import type { DurableRunStore } from '../workflow/run-store.js';
import { removeContained, type CleanupReceipt } from './cleanup.js';
import { expiresAt, type RetentionCategory, type RetentionPolicy } from './retention.js';
import { isActiveWorkflowStatus } from './retention.js';
import type { WorkflowStateKind } from '../workflow/store.js';

export interface CleanupTask {
  taskId: string;
  ownerUserId: string;
  category: RetentionCategory;
  resourceId: string;
  root: string;
  target: string;
  dueAt: number;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  lastErrorCode?: string;
  nextAttemptAt?: number;
  claimExpiresAt?: number;
  revision?: number;
  attempts?: number;
  createdAt: string;
  updatedAt: string;
}

export const CLEANUP_RETRY_DELAY_MS = 1_000;
export const CLEANUP_CLAIM_LEASE_MS = 5 * 60 * 1_000;

function iso(value = Date.now()): string { return new Date(value).toISOString(); }

function contains(value: unknown, target: string): boolean {
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) return value.some((item) => contains(item, target));
  if (value && typeof value === 'object') return Object.values(value).some((item) => contains(item, target));
  return false;
}

const protectedStateKinds: WorkflowStateKind[] = [
  'workflow_aggregate', 'repair_plan', 'enhancement_run', 'version_2_run', 'validation', 'pull_request',
  'repair_checkpoint', 'approval_receipt', 'recommendation_review', 'idempotency', 'diff', 'repository_selection',
  'snapshot_handle', 'delivery_step',
];

export class PrivacyRetentionService {
  private readonly activeOwners = new Set<string>();

  public constructor(private readonly store: WorkflowStore, private readonly policy: RetentionPolicy, private readonly runStore?: DurableRunStore) {}

  public async schedule(input: Omit<CleanupTask, 'taskId' | 'dueAt' | 'status' | 'createdAt' | 'updatedAt'> & { terminalAt: number }): Promise<CleanupTask> {
    const task: CleanupTask = { ...input, taskId: randomUUID(), dueAt: expiresAt(this.policy, input.category, input.terminalAt), status: 'scheduled', createdAt: iso(), updatedAt: iso(), revision: 0, attempts: 0 };
    return this.store.saveVersioned(input.ownerUserId, 'privacy_cleanup', task.taskId, task, 0);
  }

  public async runDue(ownerUserId: string, now = Date.now()): Promise<{ attempted: number; completed: number; failed: number; receipts: CleanupReceipt[] }> {
    if (this.activeOwners.has(ownerUserId)) return { attempted: 0, completed: 0, failed: 0, receipts: [] };
    this.activeOwners.add(ownerUserId);
    try {
      const page = await this.store.listCleanupTasksPage<CleanupTask>(ownerUserId, now, this.policy.cleanupBatchSize);
      const tasks = page.entries;
      const receipts: CleanupReceipt[] = [];
      for (const entry of tasks) {
        const task = entry.value;
        let claimed: CleanupTask;
        try {
          claimed = await this.store.saveVersioned(ownerUserId, 'privacy_cleanup', entry.id, {
            ...task,
            status: 'running',
            claimExpiresAt: Date.now() + CLEANUP_CLAIM_LEASE_MS,
            attempts: (task.attempts ?? 0) + 1,
            updatedAt: iso(),
          }, task.revision ?? 0);
        } catch {
          continue;
        }
        let receipt: CleanupReceipt;
        try {
          let protectedByActiveWorkflow = false;
          for (const kind of protectedStateKinds) {
            const activeStates = await this.store.list?.<unknown>(ownerUserId, kind) ?? [];
            if (activeStates.some((state) => isActiveWorkflowStatus((state.value as { status?: unknown })?.status) && contains(state.value, task.resourceId))) {
              protectedByActiveWorkflow = true;
              break;
            }
          }
          if (protectedByActiveWorkflow) {
            await this.store.saveVersioned(ownerUserId, 'privacy_cleanup', entry.id, {
              ...claimed,
              status: 'scheduled',
              claimExpiresAt: undefined,
              nextAttemptAt: Date.now() + CLEANUP_RETRY_DELAY_MS,
              updatedAt: iso(),
            }, claimed.revision ?? 0);
            continue;
          }
          receipt = await removeContained(task.root, task.target, task.resourceId);
        } catch {
          receipt = { resourceId: task.resourceId, status: 'failed', attemptedAt: new Date().toISOString(), errorCode: 'CLEANUP_FAILED' };
        }
        receipts.push(receipt);
        const success = receipt.status === 'completed' || receipt.status === 'not_found';
        const retryableFailure = receipt.status === 'failed' || receipt.status === 'blocked_active';
        try {
          await this.store.saveVersioned(ownerUserId, 'privacy_cleanup', entry.id, {
            ...claimed,
            status: success ? 'completed' : 'failed',
            claimExpiresAt: undefined,
            nextAttemptAt: retryableFailure ? Date.now() + CLEANUP_RETRY_DELAY_MS : undefined,
            lastErrorCode: receipt.errorCode,
            updatedAt: iso(),
          }, claimed.revision ?? 0);
        } catch {
          // Leave the durable running claim for lease-based recovery if final persistence fails.
        }
      }
      return { attempted: receipts.length, completed: receipts.filter((receipt) => receipt.status === 'completed' || receipt.status === 'not_found').length, failed: receipts.filter((receipt) => receipt.status === 'failed' || receipt.status === 'blocked_active').length, receipts };
    } finally {
      this.activeOwners.delete(ownerUserId);
    }
  }

  public async runDueAll(now = Date.now()): Promise<{ attempted: number; completed: number; failed: number }> {
    if (this.runStore) await this.runStore.deleteExpired(now - this.policy.runMs, this.policy.cleanupBatchSize);
    const owners = await this.store.listCleanupTaskOwners(now);
    const results = await Promise.all(owners.map((ownerUserId) => this.runDue(ownerUserId, now)));
    return { attempted: results.reduce((total, result) => total + result.attempted, 0), completed: results.reduce((total, result) => total + result.completed, 0), failed: results.reduce((total, result) => total + result.failed, 0) };
  }
}
