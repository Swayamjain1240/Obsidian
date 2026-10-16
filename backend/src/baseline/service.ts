import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import { createSystemEvent, type SystemEvent } from '../events.js';
import { transition, type SessionState } from '../lifecycle.js';
import { extractSnapshot } from '../intake/extraction-store.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { DetectionEventSink, ConfirmedDetectionContext } from '../detection/service.js';
import {
  discoverBaselinePlan,
  workingDirectory,
  type BaselineCommandSpec,
  type BaselinePlan,
  type BaselinePlannedCheck,
} from './adapters.js';
import { runBaselineCommand, type BaselineCommandResult } from './runner.js';
import {
  baselinePolicyVersion,
  type BaselineCheckResult,
  type BaselineCheckStatus,
  type BaselineResult,
  type BaselineRunStatus,
} from './types.js';
import type { DurableRunStore } from '../workflow/run-store.js';

export interface BaselineScopeProvider {
  selectedContext(ownerUserId: string, completenessRunId: string): {
    completenessRunId: string;
    scopeMode: 'FULL' | 'EXISTING_ONLY';
    context: ConfirmedDetectionContext;
  };
}

export interface SelectedBaselineContext {
  baselineRunId: string;
  completenessRunId: string;
  scopeMode: 'FULL' | 'EXISTING_ONLY';
  context: ConfirmedDetectionContext;
}

export interface BaselineEngine {
  extract(
    snapshot: ConfirmedDetectionContext['snapshot'],
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
  discover(options: {
    extraction: ExtractionRecord;
    languageCandidates: readonly string[];
    maxChecks: number;
    maxFileBytes: number;
    signal: AbortSignal;
    onProgress?: (stage: string, checks: number) => void;
  }): Promise<BaselinePlan>;
  run(command: BaselineCommandSpec, options: { cwd: string; workspaceRoot?: string; timeoutMs: number; maxOutputBytes: number; maxMemoryBytes?: number; maxProcesses?: number; requireIsolation?: boolean; signal: AbortSignal }): Promise<BaselineCommandResult>;
}

export class BaselineServiceError extends Error {
  public constructor(
    public readonly code: 'BASELINE_NOT_FOUND' | 'BASELINE_STATE_INVALID',
    message: string,
    public readonly status: 404 | 409,
  ) {
    super(message);
    this.name = 'BaselineServiceError';
  }
}

interface StoredRun {
  ownerUserId: string;
  sessionId: string;
  completenessRunId: string;
  context: ConfirmedDetectionContext;
  scopeMode: 'FULL' | 'EXISTING_ONLY';
  controller: AbortController;
  lifecycleState: SessionState;
  result: BaselineResult;
}

const terminalStatuses = new Set<BaselineRunStatus>(['passed', 'failed', 'partial', 'cancelled']);

function publicCheck(check: BaselineCheckResult): BaselineCheckResult {
  return { ...check, evidenceRefs: check.evidenceRefs.map((ref) => ({ ...ref })) };
}

function publicResult(result: BaselineResult): BaselineResult {
  return {
    ...result,
    checks: result.checks.map(publicCheck),
    progress: { ...result.progress },
    error: result.error ? { ...result.error } : undefined,
  };
}

function isCancelled(stored: StoredRun): boolean {
  return stored.result.status === 'cancelled' || stored.controller.signal.aborted;
}

function safeErrorMessage(reason: unknown): string {
  if (reason instanceof Error && /timed out|cancel/i.test(reason.message)) return 'Baseline checks stopped before they could be finalized.';
  return 'Baseline checks could not be completed. The immutable snapshot remains unchanged.';
}

function checkFromPlan(plan: BaselinePlannedCheck): BaselineCheckResult {
  return {
    id: plan.id,
    category: plan.category,
    label: plan.label,
    status: plan.initialStatus,
    summary: plan.summary,
    commandLabel: plan.commandLabel,
    exitCode: null,
    durationMs: null,
    evidenceRefs: plan.evidenceRefs.map((ref) => ({ ...ref })),
  };
}

export class BaselineService {
  private readonly runs = new Map<string, StoredRun>();
  private readonly events: SystemEvent[] = [];
  private readonly engine: BaselineEngine;

  public constructor(
    private readonly config: AppConfig,
    private readonly scopeProvider: BaselineScopeProvider,
    engine?: Partial<BaselineEngine>,
    private readonly eventSink?: DetectionEventSink,
    private readonly runStore?: DurableRunStore,
  ) {
    this.engine = {
      extract: (snapshot, policy, onProgress, signal) => extractSnapshot(snapshot, policy, onProgress, signal),
      discover: (options) => discoverBaselinePlan(options),
      run: (command, options) => runBaselineCommand(command, options),
      ...engine,
    } as BaselineEngine;
  }

  public start(ownerUserId: string, completenessRunId: string, sessionId?: string): BaselineResult {
    const selected = this.scopeProvider.selectedContext(ownerUserId, completenessRunId);
    const stored: StoredRun = {
      ownerUserId,
      sessionId: sessionId ?? selected.context.sessionId,
      completenessRunId: selected.completenessRunId,
      context: selected.context,
      scopeMode: selected.scopeMode,
      controller: new AbortController(),
      lifecycleState: 'scope_selected',
      result: this.initialResult(selected.completenessRunId, selected.context, selected.scopeMode),
    };
    this.runs.set(stored.result.runId, stored);
    void this.persist(stored);
    this.recordEvent(stored, 'BASELINE_STARTED', 'Baseline checks were queued for the selected immutable snapshot.', 'passed');
    void this.execute(stored);
    return publicResult(stored.result);
  }

  public get(ownerUserId: string, runId: string): BaselineResult {
    return publicResult(this.ownedRun(ownerUserId, runId).result);
  }

  public async getDurable(ownerUserId: string, runId: string): Promise<BaselineResult> {
    const stored = this.runs.get(runId);
    if (stored) {
      if (stored.ownerUserId !== ownerUserId) throw new BaselineServiceError('BASELINE_NOT_FOUND', 'Baseline run was not found.', 404);
      return publicResult(stored.result);
    }
    const persisted = await this.runStore?.get<BaselineResult>(ownerUserId, runId);
    if (persisted) return publicResult(persisted);
    throw new BaselineServiceError('BASELINE_NOT_FOUND', 'Baseline run was not found.', 404);
  }

  public selectedContext(ownerUserId: string, runId: string): SelectedBaselineContext {
    const stored = this.ownedRun(ownerUserId, runId);
    if (!['passed', 'failed', 'partial'].includes(stored.result.status)) {
      throw new BaselineServiceError('BASELINE_STATE_INVALID', 'Complete baseline checks before starting the next workflow phase.', 409);
    }
    return {
      baselineRunId: stored.result.runId,
      completenessRunId: stored.completenessRunId,
      scopeMode: stored.scopeMode,
      context: {
        ...stored.context,
        snapshot: { ...stored.context.snapshot, repository: { ...stored.context.snapshot.repository } },
        languageCandidates: [...stored.context.languageCandidates],
      },
    };
  }

  public cancel(ownerUserId: string, runId: string): BaselineResult {
    const stored = this.ownedRun(ownerUserId, runId);
    if (terminalStatuses.has(stored.result.status)) return publicResult(stored.result);
    stored.controller.abort(new Error('Baseline checks cancelled by the user.'));
    stored.lifecycleState = transition(stored.lifecycleState, 'cancelled');
    stored.result.status = 'cancelled';
    stored.result.progress = { ...stored.result.progress, stage: 'cancelled' };
    stored.result.checks = stored.result.checks.map((check) => check.status === 'queued' || check.status === 'running' ? { ...check, status: 'cancelled', summary: 'The check was cancelled before completion.' } : check);
    stored.result.error = { code: 'BASELINE_CANCELLED', message: 'Baseline checks were cancelled. The immutable snapshot remains available.' };
    void this.persist(stored);
    this.recordEvent(stored, 'RUN_CANCELLED', stored.result.error.message, 'skipped');
    return publicResult(stored.result);
  }

  public listEvents(ownerUserId: string, runId: string): SystemEvent[] {
    const stored = this.ownedRun(ownerUserId, runId);
    return this.events.filter((event) => event.runId === stored.result.runId).map((event) => ({ ...event, affectedPaths: [...event.affectedPaths] }));
  }

  private async persist(stored: StoredRun): Promise<void> {
    await this.runStore?.save(stored.ownerUserId, stored.result.runId, 'baseline', publicResult(stored.result));
  }

  private initialResult(completenessRunId: string, context: ConfirmedDetectionContext, scopeMode: 'FULL' | 'EXISTING_ONLY'): BaselineResult {
    return {
      runId: randomUUID(),
      completenessRunId,
      snapshotId: context.snapshot.snapshotId,
      baseCommit: context.baseCommit,
      archiveSha256: context.archiveSha256,
      scopeMode,
      status: 'queued',
      checks: [],
      passedCount: 0,
      failedCount: 0,
      notAvailableCount: 0,
      warning: null,
      policyVersion: baselinePolicyVersion,
      progress: { stage: 'queued', checksCompleted: 0, checksTotal: 0, passed: 0, failed: 0, notAvailable: 0 },
      createdAt: new Date().toISOString(),
    };
  }

  private ownedRun(ownerUserId: string, runId: string): StoredRun {
    const stored = this.runs.get(runId);
    if (!stored || stored.ownerUserId !== ownerUserId) throw new BaselineServiceError('BASELINE_NOT_FOUND', 'Baseline run was not found.', 404);
    return stored;
  }

  private async execute(stored: StoredRun): Promise<void> {
    const totalDeadline = Date.now() + this.config.BASELINE_MAX_TOTAL_TIMEOUT_MS;
    try {
      stored.lifecycleState = transition(stored.lifecycleState, 'baseline_testing');
      stored.result.status = 'planning';
      stored.result.progress = { ...stored.result.progress, stage: 'extracting' };
      const extraction = await this.engine.extract(stored.context.snapshot, {
        maxExtractedBytes: this.config.SNAPSHOT_MAX_EXTRACTED_BYTES,
        maxFiles: this.config.SNAPSHOT_MAX_FILES,
        maxDirectories: this.config.SNAPSHOT_MAX_DIRECTORIES,
        maxSingleFileBytes: this.config.SNAPSHOT_MAX_SINGLE_FILE_BYTES,
        maxPathLength: this.config.SNAPSHOT_MAX_PATH_LENGTH,
        timeoutMs: this.config.SNAPSHOT_EXTRACTION_TIMEOUT_MS,
      }, (stage, counters) => {
        if (isCancelled(stored)) return;
        stored.result.progress = { ...stored.result.progress, stage, checksCompleted: 0, checksTotal: 0 };
      }, stored.controller.signal);
      if (isCancelled(stored)) return;
      const plan = await this.engine.discover({
        extraction,
        languageCandidates: stored.context.languageCandidates,
        maxChecks: this.config.BASELINE_MAX_CHECKS,
        maxFileBytes: this.config.COMPLETENESS_MAX_FILE_BYTES,
        signal: stored.controller.signal,
        onProgress: (stage, checks) => { stored.result.progress = { ...stored.result.progress, stage, checksTotal: checks }; },
      });
      if (isCancelled(stored)) return;
      stored.result.checks = plan.checks.map(checkFromPlan);
      stored.result.warning = plan.warning;
      stored.result.status = 'running';
      stored.result.progress = { stage: 'running', checksCompleted: 0, checksTotal: stored.result.checks.length, passed: 0, failed: 0, notAvailable: 0 };
      for (let index = 0; index < plan.checks.length; index += 1) {
        if (isCancelled(stored)) return;
        if (Date.now() >= totalDeadline) throw new Error('Baseline total timeout exceeded.');
        const planned = plan.checks[index];
        const check = stored.result.checks[index];
        if (planned.staticResult) {
          check.status = planned.staticResult.status;
          check.summary = planned.staticResult.summary;
          this.recordEvent(stored, 'CHECK_COMPLETED', `${check.label}: ${check.summary}`, planned.staticResult.status === 'passed' ? 'passed' : 'failed');
          this.updateProgress(stored, index + 1);
          continue;
        }
        if (!planned.command) {
          this.recordEvent(stored, 'CHECK_COMPLETED', `${check.label} is not available: ${check.summary}`, 'unavailable');
          this.updateProgress(stored, index + 1);
          continue;
        }
        check.status = 'running';
        this.recordEvent(stored, 'CHECK_STARTED', `${check.label} started.`, 'passed');
        const commandResult = await this.engine.run(planned.command, {
          cwd: workingDirectory(extraction),
          workspaceRoot: workingDirectory(extraction),
          timeoutMs: this.config.BASELINE_CHECK_TIMEOUT_MS,
          maxOutputBytes: this.config.BASELINE_MAX_OUTPUT_BYTES,
          maxMemoryBytes: this.config.BASELINE_MAX_MEMORY_BYTES,
          maxProcesses: this.config.BASELINE_MAX_PROCESSES,
          requireIsolation: this.config.BASELINE_REQUIRE_ISOLATION,
          signal: stored.controller.signal,
        });
        if (isCancelled(stored)) return;
        check.status = commandResult.status;
        check.summary = commandResult.summary;
        check.exitCode = commandResult.exitCode;
        check.durationMs = commandResult.durationMs;
        this.recordEvent(stored, 'CHECK_COMPLETED', `${check.label}: ${check.summary}`, commandResult.status === 'passed' ? 'passed' : commandResult.status === 'not_available' ? 'unavailable' : commandResult.status === 'cancelled' ? 'skipped' : 'failed');
        this.updateProgress(stored, index + 1);
      }
      if (isCancelled(stored)) return;
      const hasFailures = stored.result.checks.some((check) => ['failed', 'timed_out'].includes(check.status));
      const hasUnavailable = stored.result.checks.some((check) => check.status === 'not_available');
      stored.result.passedCount = stored.result.checks.filter((check) => check.status === 'passed').length;
      stored.result.failedCount = stored.result.checks.filter((check) => ['failed', 'timed_out'].includes(check.status)).length;
      stored.result.notAvailableCount = stored.result.checks.filter((check) => check.status === 'not_available').length;
      if (hasFailures) {
        stored.lifecycleState = transition(stored.lifecycleState, 'repair_required');
        stored.result.status = 'failed';
        stored.result.nextPhase = 'repair_review';
        stored.result.progress.stage = 'failed';
        this.recordEvent(stored, 'BASELINE_FAILED', 'Baseline evidence includes one or more failed or timed-out checks.', 'failed');
      } else if (hasUnavailable) {
        stored.lifecycleState = transition(stored.lifecycleState, 'repair_required');
        stored.result.status = 'partial';
        stored.result.nextPhase = 'repair_review';
        stored.result.progress.stage = 'partial';
        stored.result.warning = stored.result.warning ?? 'Some baseline checks were not available in the worker environment.';
        this.recordEvent(stored, 'BASELINE_FAILED', 'Baseline evidence is incomplete because one or more checks were not available.', 'failed');
      } else {
        stored.lifecycleState = transition(stored.lifecycleState, 'baseline_healthy');
        stored.result.status = 'passed';
        stored.result.nextPhase = 'enhancement_analysis';
        stored.result.progress.stage = 'passed';
        this.recordEvent(stored, 'BASELINE_HEALTHY', 'All discovered baseline checks passed.', 'passed');
      }
      void this.persist(stored);
    } catch (reason: unknown) {
      if (stored.result.status === 'cancelled' || stored.controller.signal.aborted) {
        if (stored.result.status !== 'cancelled') {
          stored.lifecycleState = transition(stored.lifecycleState, 'cancelled');
          stored.result.status = 'cancelled';
          stored.result.progress.stage = 'cancelled';
          stored.result.error = { code: 'BASELINE_CANCELLED', message: 'Baseline checks were cancelled. The immutable snapshot remains available.' };
          this.recordEvent(stored, 'RUN_CANCELLED', stored.result.error.message, 'skipped');
        }
        return;
      }
      stored.lifecycleState = stored.lifecycleState === 'baseline_testing' ? transition(stored.lifecycleState, 'repair_required') : stored.lifecycleState;
      stored.result.status = 'failed';
      stored.result.progress.stage = 'failed';
      stored.result.error = { code: 'BASELINE_FAILED', message: safeErrorMessage(reason) };
      void this.persist(stored);
      this.recordEvent(stored, 'BASELINE_FAILED', stored.result.error.message, 'failed');
    }
  }

  private updateProgress(stored: StoredRun, completed: number): void {
    stored.result.progress = {
      ...stored.result.progress,
      checksCompleted: completed,
      passed: stored.result.checks.filter((check) => check.status === 'passed').length,
      failed: stored.result.checks.filter((check) => ['failed', 'timed_out'].includes(check.status)).length,
      notAvailable: stored.result.checks.filter((check) => check.status === 'not_available').length,
    };
  }

  private recordEvent(stored: StoredRun, eventType: string, summary: string, status: 'passed' | 'failed' | 'skipped' | 'unavailable'): void {
    const event = createSystemEvent({
      eventType,
      sessionId: stored.sessionId,
      projectId: stored.context.snapshot.snapshotId,
      runId: stored.result.runId,
      baseCommit: stored.result.baseCommit,
      phase: 'baseline',
      status,
      safeSummary: summary,
      affectedPaths: [],
      userActionRequired: status === 'failed' || status === 'unavailable',
    });
    this.events.push(event);
    void Promise.resolve(this.eventSink?.(event)).catch(() => undefined);
  }
}
