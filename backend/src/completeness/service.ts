import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { createSystemEvent, type SystemEvent } from '../events.js';
import { transition, type SessionState } from '../lifecycle.js';
import { extractSnapshot } from '../intake/extraction-store.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import type { DetectionEventSink, ConfirmedDetectionContext } from '../detection/service.js';
import { scanCompleteness, type CompletenessScanOptions, type CompletenessScanResult } from './scanner.js';
import {
  completenessPolicyVersion,
  type CompletenessResult,
  type CompletenessRunStatus,
  type ScopeMode,
} from './types.js';
import type { DurableRunStore } from '../workflow/run-store.js';

export interface CompletenessEngine {
  extract(
    snapshot: SnapshotRecord,
    policy: {
      maxExtractedBytes: number;
      maxFiles: number;
      maxDirectories: number;
      maxSingleFileBytes: number;
      maxPathLength: number;
      timeoutMs: number;
    },
    onProgress: (stage: string, counters: { files: number; bytes: number }) => void,
    signal: AbortSignal,
  ): Promise<ExtractionRecord>;
  scan(extraction: ExtractionRecord, options: CompletenessScanOptions): Promise<CompletenessScanResult>;
}

export class CompletenessServiceError extends Error {
  public constructor(
    public readonly code: 'COMPLETENESS_NOT_FOUND' | 'COMPLETENESS_STATE_INVALID',
    message: string,
    public readonly status: 404 | 409,
  ) {
    super(message);
    this.name = 'CompletenessServiceError';
  }
}

export interface SelectedCompletenessContext {
  completenessRunId: string;
  scopeMode: ScopeMode;
  context: ConfirmedDetectionContext;
}

interface StoredRun {
  ownerUserId: string;
  sessionId: string;
  context: ConfirmedDetectionContext;
  controller: AbortController;
  lifecycleState: SessionState;
  result: CompletenessResult;
}

const terminalStatuses = new Set<CompletenessRunStatus>(['scope_selected', 'failed', 'cancelled']);

function isCancelled(stored: StoredRun): boolean {
  return stored.result.status === 'cancelled' || stored.controller.signal.aborted;
}

function publicResult(result: CompletenessResult): CompletenessResult {
  return {
    ...result,
    areas: result.areas.map((area) => ({ ...area, findingIds: [...area.findingIds], affectedPaths: [...area.affectedPaths] })),
    findings: result.findings.map((finding) => ({
      ...finding,
      evidenceRefs: finding.evidenceRefs.map((ref) => ({ ...ref })),
      affectedPaths: [...finding.affectedPaths],
    })),
    progress: { ...result.progress },
    error: result.error ? { ...result.error } : undefined,
  };
}

function safeErrorMessage(reason: unknown): string {
  if (reason instanceof Error && /timed out|cancel/i.test(reason.message)) return 'Completeness review stopped before it could be finalized.';
  return 'Completeness review could not be completed. The immutable snapshot remains unchanged.';
}

export class CompletenessService {
  private readonly runs = new Map<string, StoredRun>();
  private readonly events: SystemEvent[] = [];
  private readonly engine: CompletenessEngine;

  public constructor(
    private readonly config: AppConfig,
    engine?: Partial<CompletenessEngine>,
    private readonly eventSink?: DetectionEventSink,
    private readonly runStore?: DurableRunStore,
  ) {
    this.engine = {
      extract: (snapshot, policy, onProgress, signal) => extractSnapshot(snapshot, policy, onProgress, signal),
      scan: (extraction, options) => scanCompleteness(extraction, options),
      ...engine,
    } as CompletenessEngine;
  }

  public start(ownerUserId: string, context: ConfirmedDetectionContext, sessionId = context.sessionId): CompletenessResult {
    if (context.ownerUserId !== ownerUserId) throw new CompletenessServiceError('COMPLETENESS_STATE_INVALID', 'The detection run is not owned by this user.', 409);
    const stored: StoredRun = {
      ownerUserId,
      sessionId,
      context,
      controller: new AbortController(),
      lifecycleState: 'completeness_review',
      result: this.initialResult(context),
    };
    this.runs.set(stored.result.runId, stored);
    void this.persist(stored);
    this.recordEvent(stored, 'COMPLETENESS_SCAN_STARTED', 'Completeness review was queued for the confirmed immutable snapshot.');
    void this.execute(stored);
    return publicResult(stored.result);
  }

  public get(ownerUserId: string, runId: string): CompletenessResult {
    return publicResult(this.ownedRun(ownerUserId, runId).result);
  }

  public async getDurable(ownerUserId: string, runId: string): Promise<CompletenessResult> {
    const stored = this.runs.get(runId);
    if (stored) {
      if (stored.ownerUserId !== ownerUserId) throw new CompletenessServiceError('COMPLETENESS_NOT_FOUND', 'Completeness run was not found.', 404);
      return publicResult(stored.result);
    }
    const persisted = await this.runStore?.get<CompletenessResult>(ownerUserId, runId);
    if (persisted) return publicResult(persisted);
    throw new CompletenessServiceError('COMPLETENESS_NOT_FOUND', 'Completeness run was not found.', 404);
  }

  public selectScope(ownerUserId: string, runId: string, scopeMode: ScopeMode): CompletenessResult {
    const stored = this.ownedRun(ownerUserId, runId);
    if (stored.result.status !== 'awaiting_scope') {
      throw new CompletenessServiceError('COMPLETENESS_STATE_INVALID', 'This completeness review is not awaiting scope selection.', 409);
    }
    stored.lifecycleState = transition(stored.lifecycleState, 'scope_selected');
    stored.result.scopeMode = scopeMode;
    stored.result.status = 'scope_selected';
    stored.result.nextPhase = 'baseline_testing';
    stored.result.progress = { ...stored.result.progress, stage: 'scope_selected' };
    void this.persist(stored);
    this.recordEvent(stored, 'SCOPE_MODE_SELECTED', `Scope mode ${scopeMode} was selected. Baseline checks are the next phase.`, false);
    return publicResult(stored.result);
  }

  public selectedContext(ownerUserId: string, runId: string): SelectedCompletenessContext {
    const stored = this.ownedRun(ownerUserId, runId);
    if (stored.result.status !== 'scope_selected' || !stored.result.scopeMode) {
      throw new CompletenessServiceError('COMPLETENESS_STATE_INVALID', 'Select a baseline scope before starting baseline checks.', 409);
    }
    return {
      completenessRunId: stored.result.runId,
      scopeMode: stored.result.scopeMode,
      context: {
        ...stored.context,
        snapshot: {
          ...stored.context.snapshot,
          repository: { ...stored.context.snapshot.repository },
        },
        languageCandidates: [...stored.context.languageCandidates],
      },
    };
  }

  public cancel(ownerUserId: string, runId: string): CompletenessResult {
    const stored = this.ownedRun(ownerUserId, runId);
    if (terminalStatuses.has(stored.result.status)) return publicResult(stored.result);
    stored.controller.abort(new Error('Completeness review cancelled by the user.'));
    stored.lifecycleState = transition(stored.lifecycleState, 'cancelled');
    stored.result.status = 'cancelled';
    stored.result.progress = { ...stored.result.progress, stage: 'cancelled' };
    stored.result.error = { code: 'COMPLETENESS_CANCELLED', message: 'Completeness review was cancelled. The immutable snapshot remains available.' };
    void this.persist(stored);
    this.recordEvent(stored, 'RUN_CANCELLED', 'Completeness review was cancelled before scope selection.', false);
    return publicResult(stored.result);
  }

  public listEvents(ownerUserId: string, runId: string): SystemEvent[] {
    const stored = this.ownedRun(ownerUserId, runId);
    return this.events.filter((event) => event.runId === stored.result.runId).map((event) => ({ ...event, affectedPaths: [...event.affectedPaths] }));
  }

  private async persist(stored: StoredRun): Promise<void> {
    await this.runStore?.save(stored.ownerUserId, stored.result.runId, 'completeness', publicResult(stored.result));
  }

  private initialResult(context: ConfirmedDetectionContext): CompletenessResult {
    return {
      runId: randomUUID(),
      detectionRunId: context.detectionRunId,
      snapshotId: context.snapshot.snapshotId,
      baseCommit: context.baseCommit,
      archiveSha256: context.archiveSha256,
      status: 'queued',
      projectStatus: null,
      areas: [],
      findings: [],
      fileCount: 0,
      scannedFileCount: 0,
      scannedBytes: 0,
      limited: false,
      warning: null,
      policyVersion: completenessPolicyVersion,
      progress: { stage: 'queued', files: 0, bytes: 0, findings: 0 },
      createdAt: new Date().toISOString(),
    };
  }

  private ownedRun(ownerUserId: string, runId: string): StoredRun {
    const stored = this.runs.get(runId);
    if (!stored || stored.ownerUserId !== ownerUserId) throw new CompletenessServiceError('COMPLETENESS_NOT_FOUND', 'Completeness run was not found.', 404);
    return stored;
  }

  private async execute(stored: StoredRun): Promise<void> {
    try {
      stored.result.status = 'extracting';
      stored.result.progress = { ...stored.result.progress, stage: 'extracting' };
      const extraction = await this.engine.extract(
        stored.context.snapshot,
        {
          maxExtractedBytes: this.config.SNAPSHOT_MAX_EXTRACTED_BYTES,
          maxFiles: this.config.SNAPSHOT_MAX_FILES,
          maxDirectories: this.config.SNAPSHOT_MAX_DIRECTORIES,
          maxSingleFileBytes: this.config.SNAPSHOT_MAX_SINGLE_FILE_BYTES,
          maxPathLength: this.config.SNAPSHOT_MAX_PATH_LENGTH,
          timeoutMs: this.config.SNAPSHOT_EXTRACTION_TIMEOUT_MS,
        },
        (stage, counters) => {
          if (isCancelled(stored)) return;
          stored.result.progress = { ...stored.result.progress, stage, files: counters.files, bytes: counters.bytes };
        },
        stored.controller.signal,
      );
      if (isCancelled(stored)) return;
      stored.result.status = 'scanning';
      stored.result.progress = { stage: 'scanning', files: extraction.extractedFileCount, bytes: extraction.extractedBytes, findings: 0 };
      const result = await this.engine.scan(extraction, {
        maxFileBytes: this.config.COMPLETENESS_MAX_FILE_BYTES,
        maxFiles: this.config.COMPLETENESS_MAX_FILES,
        maxBytes: this.config.COMPLETENESS_MAX_BYTES,
        maxFindings: this.config.COMPLETENESS_MAX_FINDINGS,
        timeoutMs: this.config.COMPLETENESS_TIMEOUT_MS,
        languageCandidates: stored.context.languageCandidates,
        signal: stored.controller.signal,
        onProgress: (stage, counters) => {
          if (isCancelled(stored)) return;
          stored.result.progress = { stage, files: counters.files, bytes: counters.bytes, findings: counters.findings };
        },
      });
      if (isCancelled(stored)) return;
      stored.result.projectStatus = result.projectStatus;
      stored.result.areas = result.areas;
      stored.result.findings = result.findings;
      stored.result.fileCount = result.fileCount;
      stored.result.scannedFileCount = result.scannedFileCount;
      stored.result.scannedBytes = result.scannedBytes;
      stored.result.limited = result.limited;
      stored.result.warning = result.warning;
      stored.result.policyVersion = result.policyVersion;
      stored.lifecycleState = transition(stored.lifecycleState, 'awaiting_scope');
      stored.result.status = 'awaiting_scope';
      stored.result.progress = { stage: 'awaiting_scope', files: result.scannedFileCount, bytes: result.scannedBytes, findings: result.findings.length };
      void this.persist(stored);
      this.recordEvent(stored, 'COMPLETENESS_SCAN_COMPLETED', 'Completeness evidence was finalized and is ready for scope selection.');
      this.recordEvent(stored, result.projectStatus === 'working' ? 'PROJECT_MARKED_COMPLETE' : 'PROJECT_MARKED_PARTIAL', `Project completeness status: ${result.projectStatus}.`);
    } catch (reason: unknown) {
      if (stored.result.status === 'cancelled' || stored.controller.signal.aborted) {
        if (stored.result.status !== 'cancelled') {
          stored.lifecycleState = transition(stored.lifecycleState, 'cancelled');
          stored.result.status = 'cancelled';
          stored.result.progress = { ...stored.result.progress, stage: 'cancelled' };
          stored.result.error = { code: 'COMPLETENESS_CANCELLED', message: 'Completeness review was cancelled. The immutable snapshot remains available.' };
          this.recordEvent(stored, 'RUN_CANCELLED', 'Completeness review was cancelled before scope selection.', false);
        }
        return;
      }
      stored.result.status = 'failed';
      stored.result.progress = { ...stored.result.progress, stage: 'failed' };
      stored.result.error = { code: 'COMPLETENESS_FAILED', message: safeErrorMessage(reason) };
      void this.persist(stored);
      this.recordEvent(stored, 'COMPLETENESS_SCAN_FAILED', stored.result.error.message, false);
    }
  }

  private recordEvent(stored: StoredRun, eventType: string, summary: string, userActionRequired = stored.result.status === 'awaiting_scope'): void {
    const event = createSystemEvent({
      eventType,
      sessionId: stored.sessionId,
      projectId: stored.context.snapshot.snapshotId,
      runId: stored.result.runId,
      baseCommit: stored.result.baseCommit,
      phase: 'completeness',
      status: stored.result.status === 'failed' ? 'failed' : stored.result.status === 'cancelled' ? 'skipped' : 'passed',
      safeSummary: summary,
      affectedPaths: [],
      userActionRequired,
    });
    this.events.push(event);
    void Promise.resolve(this.eventSink?.(event)).catch(() => undefined);
  }
}
