import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { createSystemEvent, type SystemEvent } from '../events.js';
import { isSessionState, transition, type SessionState } from '../lifecycle.js';
import { extractSnapshot } from '../intake/extraction-store.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import { SnapshotHandleStore } from '../intake/handle-store.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import { scanWorkspace, type ScanOptions, type ScanResult } from './scanner.js';
import { type DetectionResult, type DetectionStatus } from './types.js';
import { detectionPolicyVersion } from './adapters.js';
import type { DurableRunStore } from '../workflow/run-store.js';
import { createRunContext, isPersistedRunContext } from '../workflow/run-context.js';
import type { DurableRunEnvelope } from '../workflow/run-store.js';

export interface DetectionEngine {
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
  scan(extraction: ExtractionRecord, options: ScanOptions): Promise<ScanResult>;
}

export interface DetectionEventSink {
  (event: SystemEvent): void | Promise<void>;
}

export interface ConfirmedDetectionContext {
  detectionRunId: string;
  ownerUserId: string;
  sessionId: string;
  snapshot: SnapshotRecord;
  baseCommit: string;
  archiveSha256: string;
  languageCandidates: string[];
}

export class DetectionServiceError extends Error {
  public constructor(
    public readonly code: 'SNAPSHOT_NOT_FOUND' | 'DETECTION_NOT_FOUND' | 'DETECTION_STATE_INVALID',
    message: string,
    public readonly status: 404 | 409,
  ) {
    super(message);
    this.name = 'DetectionServiceError';
  }
}

interface StoredRun {
  ownerUserId: string;
  sessionId: string;
  snapshot: SnapshotRecord;
  controller: AbortController;
  lifecycleState: SessionState;
  result: DetectionResult;
}

const terminalStatuses = new Set<DetectionStatus>(['awaiting_confirmation', 'confirmed', 'failed', 'cancelled']);
const rescanStatuses = new Set<DetectionStatus>(['awaiting_confirmation', 'failed', 'cancelled']);

function isCancelled(stored: StoredRun): boolean {
  return stored.result.status === 'cancelled' || stored.controller.signal.aborted;
}

function publicResult(result: DetectionResult): DetectionResult {
  return {
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      frameworks: [...candidate.frameworks],
      evidenceRefs: candidate.evidenceRefs.map((ref) => ({ ...ref })),
    })),
    progress: { ...result.progress },
    confirmedCandidateIds: result.confirmedCandidateIds ? [...result.confirmedCandidateIds] : undefined,
    error: result.error ? { ...result.error } : undefined,
  };
}

function statusEvent(status: DetectionStatus): 'passed' | 'failed' | 'skipped' {
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'skipped';
  return 'passed';
}

function safeErrorMessage(reason: unknown): string {
  if (reason instanceof Error && /timed out|cancel/i.test(reason.message)) return 'Detection stopped before evidence could be finalized.';
  return 'Detection could not be completed. The immutable snapshot remains unchanged.';
}

export class DetectionService {
  private readonly runs = new Map<string, StoredRun>();
  private readonly events: SystemEvent[] = [];
  private readonly engine: DetectionEngine;

  public constructor(
    private readonly config: AppConfig,
    private readonly handleStore: SnapshotHandleStore,
    engine?: Partial<DetectionEngine>,
    private readonly eventSink?: DetectionEventSink,
    private readonly runStore?: DurableRunStore,
  ) {
    this.engine = {
      extract: (snapshot, policy, onProgress, signal) => extractSnapshot(snapshot, policy, onProgress, signal),
      scan: (extraction, options) => scanWorkspace(extraction, options),
      ...engine,
    } as DetectionEngine;
  }

  public start(ownerUserId: string, snapshotHandle: string, sessionId = ownerUserId): DetectionResult {
    this.runStore?.assertWritable();
    const snapshot = this.handleStore.get(ownerUserId, snapshotHandle);
    if (!snapshot) throw new DetectionServiceError('SNAPSHOT_NOT_FOUND', 'The snapshot handle is invalid or expired.', 404);

    return this.startWithSnapshot(ownerUserId, snapshot, sessionId);
  }

  public async startDurable(ownerUserId: string, snapshotHandle: string, sessionId = ownerUserId): Promise<DetectionResult> {
    this.runStore?.assertWritable();
    const snapshot = await this.handleStore.getDurable(ownerUserId, snapshotHandle, sessionId);
    if (!snapshot) throw new DetectionServiceError('SNAPSHOT_NOT_FOUND', 'The snapshot handle is invalid or expired.', 404);

    const stored = this.createRun(ownerUserId, snapshot, sessionId);
    await this.persist(stored);
    this.recordEvent(stored, 'DETECTION_STARTED', 'Detection queued for the immutable snapshot.', 'detection');
    void this.execute(stored);
    return publicResult(stored.result);
  }

  private startWithSnapshot(ownerUserId: string, snapshot: SnapshotRecord, sessionId: string): DetectionResult {
    const stored = this.createRun(ownerUserId, snapshot, sessionId);
    void this.persist(stored);
    this.recordEvent(stored, 'DETECTION_STARTED', 'Detection queued for the immutable snapshot.', 'detection');
    void this.execute(stored);
    return publicResult(stored.result);
  }

  public get(ownerUserId: string, runId: string): DetectionResult {
    return publicResult(this.ownedRun(ownerUserId, runId).result);
  }

  public async getDurable(ownerUserId: string, runId: string, sessionId?: string): Promise<DetectionResult> {
    const stored = this.runs.get(runId);
    if (stored) {
      if (stored.ownerUserId !== ownerUserId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
      if (sessionId && stored.sessionId !== sessionId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
      return publicResult(stored.result);
    }
    const persisted = await this.runStore?.getEnvelope<DetectionResult, ReturnType<typeof createRunContext>>(ownerUserId, runId);
    if (persisted?.result && (!sessionId || persisted.context?.sessionId === sessionId)) return publicResult(persisted.result);
    const legacy = await this.runStore?.get<DetectionResult>(ownerUserId, runId);
    if (legacy && !sessionId) return publicResult(legacy);
    throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
  }

  public async confirmedContextDurable(ownerUserId: string, runId: string, sessionId?: string): Promise<ConfirmedDetectionContext> {
    const stored = this.runs.get(runId);
    if (stored) {
      if (sessionId && stored.sessionId !== sessionId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
      return this.confirmedContext(ownerUserId, runId);
    }
    const envelope = await this.runStore?.getEnvelope<DetectionResult, ReturnType<typeof createRunContext>>(ownerUserId, runId);
    if (!envelope || !envelope.context || !isPersistedRunContext(envelope.context) || envelope.context.ownerUserId !== ownerUserId || (sessionId && envelope.context.sessionId !== sessionId)) {
      throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
    }
    if (envelope.result.status !== 'confirmed' || envelope.context.lifecycleState !== 'stack_confirmed') {
      throw new DetectionServiceError('DETECTION_STATE_INVALID', 'Confirm the detected stack before starting completeness review.', 409);
    }
    return {
      ...envelope.context.context,
      snapshot: { ...envelope.context.context.snapshot, repository: { ...envelope.context.context.snapshot.repository } },
      languageCandidates: [...envelope.context.context.languageCandidates],
    };
  }

  public confirmedContext(ownerUserId: string, runId: string): ConfirmedDetectionContext {
    const stored = this.ownedRun(ownerUserId, runId);
    if (stored.result.status !== 'confirmed' || stored.lifecycleState !== 'stack_confirmed') {
      throw new DetectionServiceError('DETECTION_STATE_INVALID', 'Confirm the detected stack before starting completeness review.', 409);
    }
    return {
      detectionRunId: stored.result.runId,
      ownerUserId: stored.ownerUserId,
      sessionId: stored.sessionId,
      snapshot: stored.snapshot,
      baseCommit: stored.result.baseCommit,
      archiveSha256: stored.result.archiveSha256,
      languageCandidates: [...new Set(stored.result.candidates.map((candidate) => candidate.language).filter((language): language is string => language !== null))],
    };
  }

  public confirm(ownerUserId: string, runId: string, candidateIds: string[], notDetected: boolean): DetectionResult {
    const stored = this.ownedRun(ownerUserId, runId);
    const result = this.applyConfirmation(stored, candidateIds, notDetected);
    void this.persist(stored);
    return result;
  }

  private applyConfirmation(stored: StoredRun, candidateIds: string[], notDetected: boolean): DetectionResult {
    if (stored.result.status !== 'awaiting_confirmation') {
      throw new DetectionServiceError('DETECTION_STATE_INVALID', 'This detection run is not awaiting confirmation.', 409);
    }

    const uniqueIds = [...new Set(candidateIds)];
    const knownIds = new Set(stored.result.candidates.map((candidate) => candidate.id));
    if (stored.result.candidates.length === 0 ? !notDetected || uniqueIds.length > 0 : notDetected || uniqueIds.some((id) => !knownIds.has(id)) || uniqueIds.length === 0) {
      throw new DetectionServiceError('DETECTION_STATE_INVALID', 'Choose one or more detected candidates, or confirm Not detected.', 409);
    }

    stored.result.confirmedCandidateIds = uniqueIds;
    stored.result.analysisOnly = true;
    stored.lifecycleState = transition(stored.lifecycleState, 'stack_confirmed');
    stored.result.status = 'confirmed';
    stored.result.progress = { ...stored.result.progress, stage: 'confirmed' };
    this.recordEvent(stored, 'STACK_CONFIRMED', 'Stack confirmation was saved for analysis only.', 'detection');
    return publicResult(stored.result);
  }

  public async confirmDurable(ownerUserId: string, runId: string, candidateIds: string[], notDetected: boolean, sessionId?: string): Promise<DetectionResult> {
    const stored = this.runs.get(runId);
    if (stored) {
      if (stored.ownerUserId !== ownerUserId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
      if (sessionId && stored.sessionId !== sessionId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
      const result = this.applyConfirmation(stored, candidateIds, notDetected);
      await this.persist(stored);
      return result;
    }
    const envelope = await this.runStore?.getEnvelope<DetectionResult, ReturnType<typeof createRunContext>>(ownerUserId, runId);
    if (!envelope || !envelope.context || !isPersistedRunContext(envelope.context) || envelope.context.ownerUserId !== ownerUserId || (sessionId && envelope.context.sessionId !== sessionId)) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
    if (envelope.result.status !== 'awaiting_confirmation') throw new DetectionServiceError('DETECTION_STATE_INVALID', 'This detection run is not awaiting confirmation.', 409);
    if (!isSessionState(envelope.context.lifecycleState)) throw new DetectionServiceError('DETECTION_STATE_INVALID', 'The persisted detection lifecycle is invalid and requires recovery.', 409);
    const restored: StoredRun = {
      ownerUserId,
      sessionId: envelope.context.sessionId,
      snapshot: envelope.context.context.snapshot,
      controller: new AbortController(),
      lifecycleState: envelope.context.lifecycleState,
      result: envelope.result,
    };
    this.runs.set(runId, restored);
     const result = this.applyConfirmation(restored, candidateIds, notDetected);
     await this.persist(restored);
     return result;
  }

  public rescan(ownerUserId: string, runId: string): DetectionResult {
    this.runStore?.assertWritable();
    const source = this.ownedRun(ownerUserId, runId);
    if (!rescanStatuses.has(source.result.status)) {
      throw new DetectionServiceError('DETECTION_STATE_INVALID', 'This detection run cannot be rescanned yet.', 409);
    }
     const next = this.createRun(ownerUserId, source.snapshot, source.sessionId);
     void this.persist(next);
    this.recordEvent(source, 'STACK_RESCAN_REQUESTED', 'A fresh evidence scan was requested for the same immutable snapshot.', 'detection');
    void this.execute(next);
    return publicResult(next.result);
  }

  public async rescanDurable(ownerUserId: string, runId: string, sessionId?: string): Promise<DetectionResult> {
    this.runStore?.assertWritable();
    const source = this.runs.get(runId);
    if (source) {
      if (sessionId && source.sessionId !== sessionId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
      const result = this.rescan(ownerUserId, runId);
      const next = this.runs.get(result.runId);
      if (next) await this.persist(next);
      return result;
    }
    const envelope = await this.runStore?.getEnvelope<DetectionResult, ReturnType<typeof createRunContext>>(ownerUserId, runId);
    if (!envelope || !envelope.context || !isPersistedRunContext(envelope.context) || envelope.context.ownerUserId !== ownerUserId || (sessionId && envelope.context.sessionId !== sessionId)) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
    if (!rescanStatuses.has(envelope.result.status)) throw new DetectionServiceError('DETECTION_STATE_INVALID', 'This detection run cannot be rescanned yet.', 409);
    const next = this.createRun(ownerUserId, envelope.context.context.snapshot, envelope.context.sessionId);
    await this.persist(next);
    this.recordEvent(next, 'STACK_RESCAN_REQUESTED', 'A fresh evidence scan was requested for the same immutable snapshot.', 'detection');
    void this.execute(next);
    return publicResult(next.result);
  }

  public async cancelDurable(ownerUserId: string, runId: string, sessionId?: string): Promise<DetectionResult> {
    const stored = this.runs.get(runId);
    if (stored) {
      if (sessionId && stored.sessionId !== sessionId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
       const result = this.cancel(ownerUserId, runId);
       await this.persist(stored);
       return result;
     }
    const envelope = await this.runStore?.getEnvelope<DetectionResult, ReturnType<typeof createRunContext>>(ownerUserId, runId);
    if (!envelope || !envelope.context || envelope.context.ownerUserId !== ownerUserId || (sessionId && envelope.context.sessionId !== sessionId)) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
    if (terminalStatuses.has(envelope.result.status)) return publicResult(envelope.result);
    const result = { ...envelope.result, status: 'cancelled' as const, progress: { ...envelope.result.progress, stage: 'cancelled' }, error: { code: 'DETECTION_CANCELLED', message: 'Detection was cancelled. The immutable snapshot remains available.' } };
    const context = { ...envelope.context, lifecycleState: 'cancelled', recovery: 'cancelled' as const, savedAt: new Date().toISOString() };
    await this.runStore?.saveEnvelope(ownerUserId, runId, 'detection', { ...envelope, result, context, lifecycleState: 'cancelled', recovery: 'cancelled', updatedAt: new Date().toISOString() });
    return publicResult(result);
  }

  public cancel(ownerUserId: string, runId: string): DetectionResult {
    const stored = this.ownedRun(ownerUserId, runId);
    const result = this.applyCancellation(stored);
    void this.persist(stored);
    return result;
  }

  private applyCancellation(stored: StoredRun): DetectionResult {
    if (terminalStatuses.has(stored.result.status)) return publicResult(stored.result);
    stored.controller.abort(new Error('Detection cancelled by the user.'));
    stored.lifecycleState = transition(stored.lifecycleState, 'cancelled');
    stored.result.status = 'cancelled';
    stored.result.progress = { ...stored.result.progress, stage: 'cancelled' };
    stored.result.error = { code: 'DETECTION_CANCELLED', message: 'Detection was cancelled. The immutable snapshot remains available.' };
    this.recordEvent(stored, 'RUN_CANCELLED', 'Detection was cancelled before confirmation.', 'detection');
    return publicResult(stored.result);
  }

  public listEvents(ownerUserId: string, runId: string): SystemEvent[] {
    const stored = this.ownedRun(ownerUserId, runId);
    return this.events.filter((event) => event.runId === stored.result.runId).map((event) => ({ ...event, affectedPaths: [...event.affectedPaths] }));
  }

  private async persist(stored: StoredRun): Promise<void> {
    const context = createRunContext({ ownerUserId: stored.ownerUserId, sessionId: stored.sessionId, context: {
      detectionRunId: stored.result.runId,
      ownerUserId: stored.ownerUserId,
      sessionId: stored.sessionId,
      snapshot: { ...stored.snapshot, repository: { ...stored.snapshot.repository } },
      baseCommit: stored.result.baseCommit,
      archiveSha256: stored.result.archiveSha256,
      languageCandidates: [...new Set(stored.result.candidates.map((candidate) => candidate.language).filter((language): language is string => language !== null))],
    }, lifecycleState: stored.lifecycleState, recovery: stored.result.status === 'cancelled' ? 'cancelled' : stored.result.status === 'failed' ? 'failed' : stored.result.status === 'awaiting_confirmation' || stored.result.status === 'confirmed' ? 'awaiting_user_action' : 'resumable' });
    await this.runStore?.saveEnvelope(stored.ownerUserId, stored.result.runId, 'detection', { version: 1, ownerUserId: stored.ownerUserId, runId: stored.result.runId, phase: 'detection', result: publicResult(stored.result), context, lifecycleState: stored.lifecycleState, recovery: context.recovery, updatedAt: new Date().toISOString() });
  }

  private createRun(ownerUserId: string, snapshot: SnapshotRecord, sessionId = ownerUserId): StoredRun {
    const stored: StoredRun = {
      ownerUserId,
      sessionId,
      snapshot,
      controller: new AbortController(),
      lifecycleState: 'detecting',
      result: {
        runId: randomUUID(),
        snapshotId: snapshot.snapshotId,
        baseCommit: snapshot.repository.commitSha ?? 'Not detected',
        archiveSha256: snapshot.archiveSha256,
        status: 'queued',
        candidates: [],
        primaryCandidateId: null,
        unknownReason: null,
        fileCount: 0,
        evidenceFileCount: 0,
        policyVersion: detectionPolicyVersion,
        progress: { stage: 'queued', files: 0, bytes: 0 },
        createdAt: new Date().toISOString(),
      },
    };
    this.runs.set(stored.result.runId, stored);
    return stored;
  }

  private ownedRun(ownerUserId: string, runId: string): StoredRun {
    const stored = this.runs.get(runId);
    if (!stored || stored.ownerUserId !== ownerUserId) throw new DetectionServiceError('DETECTION_NOT_FOUND', 'Detection run was not found.', 404);
    return stored;
  }

  private async execute(stored: StoredRun): Promise<void> {
    try {
      stored.result.status = 'archive_verified';
      stored.result.progress = { stage: 'archive_verified', files: 0, bytes: 0 };
      this.recordEvent(stored, 'DETECTION_STEP_COMPLETED', 'The immutable archive was verified before extraction.', 'detection');
      const extraction = await this.engine.extract(
        stored.snapshot,
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
          stored.result.status = stage === 'verifying' || stage === 'reused' || stage === 'publishing' || stage === 'completed' ? 'manifest_indexed' : 'extracting';
          stored.result.progress = { stage, files: counters.files, bytes: counters.bytes };
        },
        stored.controller.signal,
      );
      if (isCancelled(stored)) return;
      stored.result.status = 'manifest_indexed';
      stored.result.progress = { stage: 'manifest_indexed', files: extraction.extractedFileCount, bytes: extraction.extractedBytes };
      this.recordEvent(stored, 'DETECTION_STEP_COMPLETED', 'The extracted file manifest was verified.', 'detection');
      stored.result.status = 'stack_rules_applied';
      stored.result.progress = { ...stored.result.progress, stage: 'stack_rules_applied' };
      const result = await this.engine.scan(extraction, {
        maxEvidenceFileBytes: this.config.DETECTION_MAX_EVIDENCE_FILE_BYTES,
        maxEvidencePaths: this.config.DETECTION_MAX_EVIDENCE_PATHS,
        timeoutMs: this.config.SNAPSHOT_EXTRACTION_TIMEOUT_MS,
        signal: stored.controller.signal,
      });
      if (isCancelled(stored)) return;
      stored.result.status = 'evidence_finalized';
      stored.result.candidates = result.candidates;
      stored.result.primaryCandidateId = result.primaryCandidateId;
      stored.result.unknownReason = result.unknownReason;
      stored.result.fileCount = result.fileCount;
      stored.result.evidenceFileCount = result.evidenceFileCount;
      stored.result.policyVersion = result.policyVersion;
      stored.result.progress = { stage: 'evidence_finalized', files: result.fileCount, bytes: extraction.extractedBytes };
      this.recordEvent(stored, 'STACK_DETECTED', result.candidates.length ? 'Supported stack evidence was detected.' : 'No supported stack evidence was detected.', 'detection');
      stored.lifecycleState = transition(stored.lifecycleState, 'awaiting_stack_confirmation');
      stored.result.status = 'awaiting_confirmation';
      stored.result.progress = { ...stored.result.progress, stage: 'awaiting_confirmation' };
      void this.persist(stored);
      this.recordEvent(stored, 'STACK_CONFIRMATION_REQUIRED', 'Evidence was finalized and is ready for user confirmation.', 'detection');
    } catch (reason: unknown) {
      if (stored.result.status === 'cancelled' || stored.controller.signal.aborted) {
        if (stored.result.status !== 'cancelled') {
          stored.lifecycleState = transition(stored.lifecycleState, 'cancelled');
          stored.result.status = 'cancelled';
          stored.result.progress = { ...stored.result.progress, stage: 'cancelled' };
          stored.result.error = { code: 'DETECTION_CANCELLED', message: 'Detection was cancelled. The immutable snapshot remains available.' };
          this.recordEvent(stored, 'RUN_CANCELLED', 'Detection was cancelled before confirmation.', 'detection');
        }
        return;
      }
      stored.result.status = 'failed';
      stored.result.progress = { ...stored.result.progress, stage: 'failed' };
      stored.result.error = { code: 'DETECTION_FAILED', message: safeErrorMessage(reason) };
      void this.persist(stored);
      this.recordEvent(stored, 'DETECTION_FAILED', stored.result.error.message, 'detection');
    }
  }

  private recordEvent(stored: StoredRun, eventType: string, summary: string, phase: string): void {
    const event = createSystemEvent({
      eventType,
      sessionId: stored.sessionId,
      projectId: stored.snapshot.snapshotId,
      runId: stored.result.runId,
      baseCommit: stored.result.baseCommit,
      phase,
      status: statusEvent(stored.result.status),
      safeSummary: summary,
      affectedPaths: [],
      userActionRequired: stored.result.status === 'awaiting_confirmation',
    });
    this.events.push(event);
    void Promise.resolve(this.eventSink?.(event)).catch(() => undefined);
  }
}
