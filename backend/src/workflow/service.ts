import { createHash, randomUUID } from 'node:crypto';

import type { CompletenessService } from '../completeness/service.js';
import type { DetectionEventSink } from '../detection/service.js';
import { createSystemEvent, type SystemEvent } from '../events.js';
import type { BaselineService } from '../baseline/service.js';
import type {
  ApprovalState,
  ApprovalReceipt,
  ChangeManifest,
  ChangeOperation,
  EnhancementRun,
  PullRequestReceipt,
  Recommendation,
  RepairItem,
  RepairPlan,
  RepairCheckpoint,
  ValidationReceipt,
  Version2Status,
  WorkflowAggregate,
  Version2State,
  DeliveryStepName,
  DeliveryStepReceipt,
  RecommendationReviewReceipt,
} from './types.js';
import { publicEnhancementRun, publicOperation, publicRepairPlan } from './types.js';
import type { DurableWorkflowStore } from './store.js';
import { GithubApiClient } from '../github/client.js';
import type { AppConfig } from '../config.js';
import { ChangeWorker, type AppliedWorkspace } from './change-worker.js';
import type { RepositoryCommandExecutor } from '../workers/executor.js';
import { normalizeOperations as policyNormalizeOperations, operationHash, assertOperationsWithinEvidence, OperationPolicyError } from './operation-policy.js';
import { currentRevision, nextRevision, assertRevision, RevisionConflictError } from './revision.js';
import { IdempotencyLedger } from './idempotency.js';
import { buildDiffEntries, diffHash } from './diff-service.js';
import { assertWorkflowTransition, assertWorkflowTransitionForPhase, type WorkflowPhase } from './state-machine.js';
import { createRepairCheckpoint } from './repair-checkpoint.js';
import { reconcileRepairCheckpoint } from './repair-reconciler.js';
import { mergeManifestOperations } from './manifest-builder.js';
import { buildRecommendationCatalog } from './recommendation-catalog.js';
import { pageRecommendations } from './recommendation-page.js';
import { ApprovalLedger } from './approval-ledger.js';
import { deliveryBranchName, deliveryCommitMessage, gitBlobSha, responseHash } from './delivery-service.js';
import { deliveryReceiptFor, deliveryIdentityMatches, markDeliveryRecovery, upsertDeliveryReceipt, type DeliveryIdentity } from './delivery-reconciler.js';

export interface ChangeOperationInput {
  kind: 'add' | 'modify' | 'delete';
  path: string;
  content?: string;
}

export interface WorkflowMutationOptions {
  expectedRevision?: number;
  sessionId?: string;
  idempotencyKey?: string;
  previewHash?: string;
  highRiskConfirmed?: boolean;
}

export class WorkflowServiceError extends Error {
  public constructor(
    public readonly code: 'WORKFLOW_NOT_FOUND' | 'WORKFLOW_STATE_INVALID' | 'WORKFLOW_INPUT_INVALID',
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = 'WorkflowServiceError';
  }
}

function now(): string { return new Date().toISOString(); }

function normalizeOperations(input: readonly ChangeOperationInput[] | undefined): ChangeOperation[] {
  try { return policyNormalizeOperations(input); } catch (reason: unknown) { throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', reason instanceof Error ? reason.message : 'Workflow operations are invalid.', 400); }
}

function approvedItems(items: readonly RepairItem[]): RepairItem[] {
  return items.filter((item) => item.approvalState === 'approved');
}

function approvedRecommendations(items: readonly Recommendation[]): Recommendation[] {
  return items.filter((item) => item.approvalState === 'approved');
}

function requireWorkflowTransition(from: string, to: string, phase?: WorkflowPhase): void {
  try {
    if (phase) assertWorkflowTransitionForPhase(phase, from as never, to as never);
    else assertWorkflowTransition(from as never, to as never);
  } catch (reason: unknown) {
    throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', reason instanceof Error ? reason.message : `Invalid workflow transition: ${from} -> ${to}`, 409);
  }
}

function requireExpectedRevision(value: { revision?: number }, expectedRevision: number | undefined): void {
  try {
    assertRevision(value, expectedRevision);
  } catch (reason: unknown) {
    if (reason instanceof RevisionConflictError) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', reason.message, 409);
    throw reason;
  }
}

function requireSessionBinding(expectedSessionId: string | undefined, actualSessionId: string | undefined): void {
  if (expectedSessionId && expectedSessionId !== actualSessionId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow state was not found.', 404);
}

function manifestFor(version2RunId: string, baseCommit: string, branchName: string, repairItems: readonly RepairItem[], recommendations: readonly Recommendation[], snapshotId?: string): ChangeManifest {
  let unique: ChangeOperation[];
  try { unique = mergeManifestOperations(repairItems, recommendations); } catch (reason: unknown) { throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', reason instanceof Error ? reason.message : 'Approved operations conflict.', 400); }
  return {
    manifestId: randomUUID(), version2RunId, baseCommit, targetBranch: branchName,
    added: unique.filter((operation) => operation.kind === 'add').map((operation) => operation.path),
    modified: unique.filter((operation) => operation.kind === 'modify').map((operation) => operation.path),
    deleted: unique.filter((operation) => operation.kind === 'delete').map((operation) => operation.path),
    approvedRepairIds: repairItems.map((item) => item.id),
    approvedRecommendationIds: recommendations.map((item) => item.id),
    rollbackRef: baseCommit,
    diffHash: operationHash(unique),
    diffSummary: unique.map((operation) => `${operation.kind}: ${operation.path}`),
    generatedAt: now(),
    snapshotId,
    operationHash: operationHash(unique),
  };
}

export class WorkflowService {
  private readonly events: SystemEvent[] = [];
  private readonly versions = new Map<string, Version2State>();
  private readonly repairs = new Map<string, AppliedWorkspace>();
  private readonly versionWorkspaces = new Map<string, AppliedWorkspace>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly idempotency: IdempotencyLedger;
  private readonly approvalLedger: ApprovalLedger;
  private readonly worker: ChangeWorker;

  public constructor(
    config: AppConfig,
    private readonly baseline: Pick<BaselineService, 'get' | 'selectedContext'> & { getDurable?: BaselineService['getDurable']; selectedContextDurable?: BaselineService['selectedContextDurable'] },
    private readonly completeness: Pick<CompletenessService, 'get'> & { getDurable?: CompletenessService['getDurable'] },
    private readonly store: DurableWorkflowStore,
    private readonly eventSink?: DetectionEventSink,
    commandExecutor?: RepositoryCommandExecutor,
  ) { this.worker = new ChangeWorker(config, commandExecutor); this.idempotency = new IdempotencyLedger(this.store); this.approvalLedger = new ApprovalLedger(this.store); }

  public async idempotent<T>(ownerUserId: string, key: string, operation: string, request: unknown, execute: () => Promise<T>): Promise<T> {
    const stateRevision = typeof request === 'object' && request !== null && 'revision' in request && typeof request.revision === 'number' ? request.revision : undefined;
    return this.idempotency.run({ ownerUserId, key, operation, request, execute, stateRevision });
  }

  public async createRepairPlan(ownerUserId: string, baselineRunId: string, options: WorkflowMutationOptions = {}): Promise<RepairPlan> {
    this.store.assertWritable?.();
    const baseline = await this.baselineResult(ownerUserId, baselineRunId);
    if (!['failed', 'partial'].includes(baseline.status)) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Repair review requires failed or incomplete baseline evidence.', 409);
    const context = await this.baselineContext(ownerUserId, baselineRunId);
    requireSessionBinding(options.sessionId, context.context.sessionId);
    const planId = randomUUID();
    const items: RepairItem[] = baseline.checks.filter((check) => ['failed', 'timed_out'].includes(check.status)).map((check) => ({
      id: randomUUID(), planId, sourceCheckId: check.id, category: check.category, title: `Review ${check.label}`, reason: check.summary,
      risk: check.category === 'security' ? 'high' : 'low',
      affectedPaths: check.evidenceRefs.flatMap((ref) => ref.path ? [ref.path] : []),
      expectedTests: [check.label], approvalState: 'awaiting_approval', operations: [], workerStatus: 'pending',
    }));
    const plan: RepairPlan = {
      planId, baselineRunId, completenessRunId: context.completenessRunId, snapshotId: baseline.snapshotId, baseCommit: baseline.baseCommit,
      ownerUserId, status: items.length ? 'awaiting_approval' : 'blocked', branchName: null, items,
      validationId: null, warning: items.length ? null : baseline.notAvailableCount > 0 ? 'Some baseline checks are not available in the worker; no repair item was created for unavailable tooling.' : 'No repair item could be generated from the baseline result.', createdAt: now(), updatedAt: now(), revision: 1, sessionId: context.context.sessionId, repairCheckpointId: null,
    };
    await this.saveRepair(plan);
    this.recordEvent(context.context.sessionId, plan.snapshotId, plan.baseCommit, plan.planId, 'REPAIR_PLAN_CREATED', `Repair review contains ${items.length} item${items.length === 1 ? '' : 's'}.`, items.length === 0 ? 'unavailable' : 'passed', true);
    return publicRepairPlan(plan);
  }

  public async getRepairPlan(ownerUserId: string, planId: string, sessionId?: string): Promise<RepairPlan> {
    const plan = await this.store.get<RepairPlan>(ownerUserId, 'repair_plan', planId);
    if (!plan) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Repair plan was not found.', 404);
    requireSessionBinding(sessionId, plan.sessionId);
    return publicRepairPlan(plan);
  }

  public async approveRepairItem(ownerUserId: string, planId: string, itemId: string, approved: boolean, operations?: readonly ChangeOperationInput[], options: WorkflowMutationOptions = {}): Promise<RepairPlan> {
    this.store.assertWritable?.();
    const execute = () => this.withLock(`repair:${planId}`, async () => {
      const plan = await this.requireRepair(ownerUserId, planId, options.sessionId);
      try { assertRevision(plan, options.expectedRevision); } catch (reason) { if (reason instanceof RevisionConflictError) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', reason.message, 409); throw reason; }
      const item = plan.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Repair item was not found.', 404);
      if (plan.status !== 'awaiting_approval' || item.approvalState !== 'awaiting_approval') {
        throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'This repair item is no longer awaiting approval.', 409);
      }
      const normalized = approved ? normalizeOperations(operations) : [];
       if (approved) {
        try { assertOperationsWithinEvidence(normalized, item.affectedPaths); } catch (reason: unknown) { throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', reason instanceof Error ? reason.message : 'Approved operations are outside the evidence scope.', 400); }
         if (normalized.length === 0) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'An approved repair item must contain at least one deterministic operation.', 400);
         if (item.risk !== 'low' && options.previewHash !== operationHash(normalized)) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'Review the exact operation preview before approving this item.', 400);
         if (item.risk === 'high' && !options.highRiskConfirmed) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'High-risk approval requires explicit confirmation after preview.', 400);
       }
      item.approvalState = approved ? 'approved' : 'rejected';
      if (approved) item.operations = normalized;
       item.approvalReceipt = { approvalId: randomUUID(), ownerUserId, sessionId: options.sessionId ?? plan.sessionId ?? ownerUserId, actor: ownerUserId, sourceId: item.id, decision: approved ? 'approved' : 'rejected', operationHash: operationHash(normalized), previewHash: options.previewHash ?? null, risk: item.risk, revision: currentRevision(plan), baseSnapshot: { snapshotId: plan.snapshotId, baseCommit: plan.baseCommit }, createdAt: now() };
       await this.approvalLedger.record(item.approvalReceipt);
       if (plan.items.every((candidate) => candidate.approvalState !== 'awaiting_approval')) {
         const nextStatus = approvedItems(plan.items).length ? 'approved' : 'blocked';
         requireWorkflowTransition(plan.status, nextStatus);
         plan.status = nextStatus;
       }
      plan.revision = nextRevision(plan);
      plan.updatedAt = now();
      await this.saveRepair(plan);
      return publicRepairPlan(plan);
    });
    return execute();
  }

  public async startRepair(ownerUserId: string, planId: string, options: WorkflowMutationOptions = {}): Promise<RepairPlan> {
    this.store.assertWritable?.();
    return this.withLock(`repair:${planId}`, () => this.startRepairUnlocked(ownerUserId, planId, options));
  }

  private async startRepairUnlocked(ownerUserId: string, planId: string, options: WorkflowMutationOptions): Promise<RepairPlan> {
    const plan = await this.requireRepair(ownerUserId, planId, options.sessionId);
    requireExpectedRevision(plan, options.expectedRevision);
    if (plan.status !== 'approved') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Approve at least one repair item before starting the repair worker.', 409);
    requireWorkflowTransition(plan.status, 'running');
    plan.branchName = `ai/repair/${plan.planId}`;
    plan.status = 'running';
    const approved = approvedItems(plan.items);
    const hasOperations = approved.some((item) => item.operations.length > 0);
    if (!hasOperations) {
      requireWorkflowTransition(plan.status, 'blocked');
      plan.status = 'blocked';
      plan.warning = 'Approved repair items require deterministic file operations before a repair branch can be changed.';
      approved.forEach((item) => { item.workerStatus = 'blocked'; });
    } else {
      try {
        const context = await this.baselineContext(ownerUserId, plan.baselineRunId);
        const applied = await this.worker.apply(context.context, plan.branchName, approved.flatMap((item) => item.operations));
        this.repairs.set(plan.planId, applied);
        approved.forEach((item) => { item.workerStatus = 'applied'; });
      } catch (reason: unknown) {
        requireWorkflowTransition(plan.status, 'blocked');
        plan.status = 'blocked';
        plan.warning = reason instanceof Error ? reason.message : 'The isolated repair worker could not apply the approved operations.';
        approved.forEach((item) => { item.workerStatus = 'blocked'; });
      }
    }
    plan.updatedAt = now();
    plan.revision = nextRevision(plan);
    await this.saveRepair(plan);
    return publicRepairPlan(plan);
  }

  public async validateRepair(ownerUserId: string, planId: string, options: WorkflowMutationOptions = {}): Promise<{ plan: RepairPlan; receipt: ValidationReceipt }> {
    this.store.assertWritable?.();
    const plan = await this.requireRepair(ownerUserId, planId, options.sessionId);
    requireExpectedRevision(plan, options.expectedRevision);
    if (plan.status !== 'running') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Start the repair worker before validation.', 409);
    let applied = this.repairs.get(plan.planId);
    if (!applied) {
      const approved = approvedItems(plan.items);
      if (approved.some((item) => !item.approvalReceipt || item.approvalReceipt.operationHash !== operationHash(item.operations))) {
        throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The repair approval receipt does not match the persisted operations.', 409);
      }
      try {
        const context = await this.baselineContext(ownerUserId, plan.baselineRunId);
        if (!plan.branchName || approved.length === 0) throw new Error('No approved repair workspace can be reconstructed.');
        applied = await this.worker.apply(context.context, plan.branchName, approved.flatMap((item) => item.operations));
        this.repairs.set(plan.planId, applied);
      } catch {
        applied = undefined;
      }
    }
    const validation = applied ? await this.worker.validate((await this.baselineContext(ownerUserId, plan.baselineRunId)).context, applied) : { status: 'not_available' as const, checks: [{ id: 'repair-baseline', label: 'Repair baseline validation', status: 'not_available' as const, summary: 'No isolated repair workspace is available.' }] };
    const receipt: ValidationReceipt = { validationId: randomUUID(), phase: 'repair', sourceRunId: plan.planId, status: validation.status, checks: validation.checks, baseCommit: plan.baseCommit, branchName: plan.branchName, createdAt: now() };
     plan.validationId = receipt.validationId;
     const nextStatus = validation.status === 'passed' ? 'validated' : validation.status === 'failed' ? 'failed' : 'blocked';
     requireWorkflowTransition(plan.status, nextStatus);
     plan.status = nextStatus;
     plan.warning = validation.status === 'passed' ? null : 'Repair validation did not establish a complete passing baseline.';
     const checkpoint = validation.status === 'passed' ? createRepairCheckpoint(plan, receipt) : null;
     if (checkpoint) plan.repairCheckpointId = checkpoint.checkpointId;
     plan.revision = nextRevision(plan);
     plan.updatedAt = now();
     await this.saveRepair(plan);
     await this.store.saveVersioned(ownerUserId, 'validation', receipt.validationId, { ...receipt, revision: 1 });
     if (checkpoint) await this.store.saveVersioned(ownerUserId, 'repair_checkpoint', plan.baselineRunId, { ...checkpoint, revision: 1 });
    return { plan: publicRepairPlan(plan), receipt };
  }

  public async publishRepairBranch(ownerUserId: string, planId: string, accessToken: string, options: WorkflowMutationOptions = {}): Promise<RepairPlan> {
    this.store.assertWritable?.();
    const plan = await this.requireRepair(ownerUserId, planId, options.sessionId);
    requireExpectedRevision(plan, options.expectedRevision);
    if (plan.status !== 'validated' || !plan.branchName) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Repair validation must pass before publishing the repair branch.', 409);
    const context = await this.baselineContext(ownerUserId, plan.baselineRunId);
    const repository = context.context.snapshot.repository;
    const github = new GithubApiClient(accessToken);
    await github.createBranch({ owner: repository.owner, name: repository.name, branch: plan.branchName }, plan.baseCommit);
    const operations = approvedItems(plan.items).flatMap((item) => item.operations);
     await github.createCommitFromManifest({ owner: repository.owner, name: repository.name, branch: plan.branchName, baseCommit: plan.baseCommit, message: `Obsidian repair: ${plan.planId}`, files: operations.map((operation) => ({ path: operation.path, content: operation.content, delete: operation.kind === 'delete' })) });
     plan.warning = 'The validated repair branch was published for review. The original branch was not modified.';
     plan.revision = nextRevision(plan);
     plan.updatedAt = now();
    await this.saveRepair(plan);
    return publicRepairPlan(plan);
  }

  public async createEnhancementRun(ownerUserId: string, baselineRunId: string, options: WorkflowMutationOptions = {}): Promise<EnhancementRun> {
    this.store.assertWritable?.();
    const baseline = await this.baselineResult(ownerUserId, baselineRunId);
    const checkpoint = await this.store.get<RepairCheckpoint>(ownerUserId, 'repair_checkpoint', baselineRunId);
    const hasValidatedCheckpoint = checkpoint?.status === 'validated';
    if (!['passed', 'partial', 'failed'].includes(baseline.status)) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Enhancement analysis requires baseline evidence.', 409);
    const context = await this.baselineContext(ownerUserId, baselineRunId);
    requireSessionBinding(options.sessionId, context.context.sessionId);
    if ((baseline.status === 'failed' || baseline.status === 'partial') && !hasValidatedCheckpoint && context.scopeMode !== 'EXISTING_ONLY') {
      throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Enhancement analysis requires a validated repair checkpoint for failed baseline evidence.', 409);
    }
    const completeness = await this.completenessResult(ownerUserId, context.completenessRunId);
    const enhancementRunId = randomUUID();
    const recommendations = buildRecommendationCatalog(enhancementRunId, completeness.areas, context.scopeMode);
    const run: EnhancementRun = { enhancementRunId, baselineRunId, completenessRunId: context.completenessRunId, snapshotId: baseline.snapshotId, baseCommit: baseline.baseCommit, ownerUserId, scopeMode: context.scopeMode, status: recommendations.length ? 'awaiting_review' : 'blocked', recommendations, warning: recommendations.length ? null : 'No existing area was available for enhancement analysis.', createdAt: now(), updatedAt: now(), revision: 1, sessionId: context.context.sessionId, repairCheckpointId: hasValidatedCheckpoint ? checkpoint?.checkpointId ?? null : null };
    await this.saveEnhancement(run);
    this.recordEvent(context.context.sessionId, run.snapshotId, run.baseCommit, run.enhancementRunId, 'RECOMMENDATIONS_CREATED', `Enhancement analysis produced ${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'}.`, recommendations.length ? 'passed' : 'unavailable', true);
    return publicEnhancementRun(run);
  }

  public async getEnhancementRun(ownerUserId: string, enhancementRunId: string, sessionId?: string): Promise<EnhancementRun> {
    const run = await this.store.get<EnhancementRun>(ownerUserId, 'enhancement_run', enhancementRunId);
    if (!run) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Enhancement run was not found.', 404);
    requireSessionBinding(sessionId, run.sessionId);
    return publicEnhancementRun(run);
  }

  public async listRecommendations(ownerUserId: string, enhancementRunId: string, page = 1, perPage = 5, sessionId?: string): Promise<{ recommendations: Recommendation[]; page: number; perPage: number; total: number; revision: number }> {
    const run = await this.requireEnhancement(ownerUserId, enhancementRunId, sessionId);
    const result = pageRecommendations(run.recommendations, page, perPage);
    return { ...result, recommendations: result.recommendations.map((item) => publicEnhancementRun({ ...run, recommendations: [item] }).recommendations[0]), revision: currentRevision(run) };
  }

  public async viewRecommendation(ownerUserId: string, enhancementRunId: string, recommendationId: string, sessionId?: string): Promise<Recommendation> {
    const run = await this.requireEnhancement(ownerUserId, enhancementRunId, sessionId);
    const recommendation = run.recommendations.find((candidate) => candidate.id === recommendationId);
    if (!recommendation) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Recommendation was not found.', 404);
    const context = await this.baselineContext(ownerUserId, run.baselineRunId);
    this.recordEvent(context.context.sessionId, run.snapshotId, run.baseCommit, run.enhancementRunId, 'RECOMMENDATION_VIEWED', `Recommendation ${recommendation.id} was viewed.`, 'passed', false);
    await this.saveRecommendationReview({ reviewId: randomUUID(), ownerUserId, sessionId: run.sessionId ?? context.context.sessionId, enhancementRunId, recommendationId, action: 'viewed', revision: currentRevision(run), createdAt: now() });
    return publicEnhancementRun({ ...run, recommendations: [recommendation] }).recommendations[0];
  }

  public async approveRecommendation(ownerUserId: string, enhancementRunId: string, recommendationId: string, approved: boolean, operations?: readonly ChangeOperationInput[], options: WorkflowMutationOptions = {}): Promise<EnhancementRun> {
    this.store.assertWritable?.();
    const execute = () => this.withLock(`enhancement:${enhancementRunId}`, async () => {
      const run = await this.requireEnhancement(ownerUserId, enhancementRunId, options.sessionId);
      try { assertRevision(run, options.expectedRevision); } catch (reason) { if (reason instanceof RevisionConflictError) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', reason.message, 409); throw reason; }
      const recommendation = run.recommendations.find((candidate) => candidate.id === recommendationId);
      if (!recommendation) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Recommendation was not found.', 404);
      if (run.status !== 'awaiting_review' || recommendation.approvalState !== 'awaiting_approval') {
        throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'This recommendation is no longer awaiting review.', 409);
      }
      const normalized = approved ? normalizeOperations(operations) : [];
      if (approved) {
        try { assertOperationsWithinEvidence(normalized, recommendation.affectedPaths); } catch (reason: unknown) { throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', reason instanceof Error ? reason.message : 'Approved operations are outside the recommendation scope.', 400); }
         if (normalized.length === 0) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'An approved recommendation must contain at least one deterministic operation.', 400);
         if (recommendation.risk !== 'low' && options.previewHash !== operationHash(normalized)) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'Review the exact operation preview before approving this recommendation.', 400);
         if (recommendation.risk === 'high' && !options.highRiskConfirmed) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'High-risk approval requires explicit confirmation after preview.', 400);
       }
      recommendation.approvalState = approved ? 'approved' : 'rejected';
      if (approved) recommendation.operations = normalized;
       recommendation.approvalReceipt = { approvalId: randomUUID(), ownerUserId, sessionId: options.sessionId ?? run.sessionId ?? ownerUserId, actor: ownerUserId, sourceId: recommendation.id, decision: approved ? 'approved' : 'rejected', operationHash: operationHash(normalized), previewHash: options.previewHash ?? null, risk: recommendation.risk, revision: currentRevision(run), baseSnapshot: { snapshotId: run.snapshotId, baseCommit: run.baseCommit }, createdAt: now() };
       await this.approvalLedger.record(recommendation.approvalReceipt);
       await this.saveRecommendationReview({ reviewId: randomUUID(), ownerUserId, sessionId: options.sessionId ?? run.sessionId ?? ownerUserId, enhancementRunId, recommendationId, action: approved ? 'approved' : 'rejected', revision: currentRevision(run), createdAt: now() });
       if (run.recommendations.every((candidate) => candidate.approvalState !== 'awaiting_approval')) {
         const nextStatus = approvedRecommendations(run.recommendations).length ? 'approved' : 'blocked';
         requireWorkflowTransition(run.status, nextStatus);
         run.status = nextStatus;
       }
      run.revision = nextRevision(run);
      run.updatedAt = now();
      await this.saveEnhancement(run);
      return publicEnhancementRun(run);
    });
    return execute();
  }

  public async startVersion2(ownerUserId: string, enhancementRunId: string, options: WorkflowMutationOptions = {}): Promise<{ enhancement: EnhancementRun; version2RunId: string; status: Version2Status; manifest: ChangeManifest | null }> {
    this.store.assertWritable?.();
    return this.withLock(`enhancement:${enhancementRunId}`, () => this.startVersion2Unlocked(ownerUserId, enhancementRunId, options));
  }

  private async startVersion2Unlocked(ownerUserId: string, enhancementRunId: string, options: WorkflowMutationOptions): Promise<{ enhancement: EnhancementRun; version2RunId: string; status: Version2Status; manifest: ChangeManifest | null }> {
    const run = await this.requireEnhancement(ownerUserId, enhancementRunId, options.sessionId);
    requireExpectedRevision(run, options.expectedRevision);
    if (run.status !== 'approved') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Approve at least one recommendation before building Version 2.', 409);
    const version2RunId = randomUUID();
    const checkpoint = run.repairCheckpointId ? await this.store.get<RepairCheckpoint>(ownerUserId, 'repair_checkpoint', run.baselineRunId) : null;
    const repairItems: RepairItem[] = checkpoint?.status === 'validated' ? [{ id: checkpoint.planId, planId: checkpoint.planId, sourceCheckId: 'repair-checkpoint', category: 'repair', title: 'Validated repair checkpoint', reason: 'Validated baseline repair checkpoint propagated into Version 2.', risk: 'low', affectedPaths: checkpoint.operations.map((operation) => operation.path), expectedTests: [], approvalState: 'approved', operations: checkpoint.operations, workerStatus: 'applied' }] : [];
    if (checkpoint?.status === 'validated') reconcileRepairCheckpoint({ checkpoint, snapshotId: run.snapshotId, baseCommit: run.baseCommit, operations: checkpoint.operations });
    const recommendations = approvedRecommendations(run.recommendations);
    const operations = mergeManifestOperations(repairItems, recommendations).map((operation) => ({ ...operation }));
    const branchName = deliveryBranchName(version2RunId, operationHash(operations));
    const manifest = manifestFor(version2RunId, run.baseCommit, branchName, repairItems, recommendations, run.snapshotId);
    const hasOperations = repairItems.some((item) => item.operations.length > 0) || recommendations.some((recommendation) => recommendation.operations.length > 0);
    let status: Version2Status = 'queued';
    const state: Version2State = { version2RunId, ownerUserId, status, enhancementRunId, sessionId: run.sessionId, branchName, snapshotId: run.snapshotId, revision: 1, manifest: hasOperations ? manifest : null, operations, receipt: null, deliveryReceipts: [], warning: hasOperations ? undefined : 'Approved recommendations require deterministic file operations before Version 2 can be built.' };
    this.versions.set(version2RunId, state);
    await this.saveVersion2(ownerUserId, version2RunId, state);

    const nextEnhancementStatus = hasOperations ? 'running' : 'blocked';
    requireWorkflowTransition(run.status, nextEnhancementStatus);
    run.status = nextEnhancementStatus;
    run.revision = nextRevision(run);
    run.updatedAt = now();
    await this.saveEnhancement(run);

    if (hasOperations) {
      requireWorkflowTransition(state.status, 'building');
      state.status = 'building';
      state.revision = nextRevision(state);
      await this.saveVersion2(ownerUserId, version2RunId, state);
      try {
        const context = await this.baselineContext(ownerUserId, run.baselineRunId);
        const applied = await this.worker.apply(context.context, branchName, operations);
        const entries = await buildDiffEntries(applied.baseExtraction.workspacePath, applied.workspacePath, operations);
        manifest.diffEntries = entries;
        manifest.diffHash = diffHash(entries);
        manifest.operationHash = operationHash(operations);
        manifest.targetBranch = deliveryBranchName(version2RunId, manifest.diffHash);
        state.branchName = manifest.targetBranch;
        state.manifest = manifest;
        this.versionWorkspaces.set(version2RunId, applied);
      } catch (reason: unknown) {
        status = 'failed';
        state.status = 'failed';
        state.warning = reason instanceof Error ? reason.message : 'Version 2 could not be built in the isolated worker.';
      }
      if (state.status === 'building') status = 'building';
      state.revision = nextRevision(state);
      await this.saveVersion2(ownerUserId, version2RunId, state);
      if (state.status === 'failed') {
        requireWorkflowTransition(run.status, 'failed', 'enhancement');
        run.status = 'failed';
        run.revision = nextRevision(run);
        run.updatedAt = now();
        await this.saveEnhancement(run);
      }
    } else {
      requireWorkflowTransition(state.status, 'failed');
      state.status = 'failed';
      state.revision = nextRevision(state);
      await this.saveVersion2(ownerUserId, version2RunId, state);
      status = 'failed';
    }
    return { enhancement: publicEnhancementRun(run), version2RunId, status: state.status, manifest: state.manifest };
  }

  public async retryVersion2(ownerUserId: string, version2RunId: string, options: WorkflowMutationOptions = {}): Promise<{ status: Version2Status; manifest: ChangeManifest | null; revision: number; warning?: string }> {
    this.store.assertWritable?.();
    return this.withLock(`version2:${version2RunId}`, async () => {
      const state = this.versions.get(version2RunId) ?? await this.store.get<Version2State>(ownerUserId, 'version_2_run', version2RunId);
      if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
      requireSessionBinding(options.sessionId, state.sessionId);
      requireExpectedRevision(state, options.expectedRevision);
      if (!['failed', 'recovery_required'].includes(state.status)) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Only a failed or recovery-required Version 2 run can be rebuilt.', 409);
      if (!state.operations?.length || !state.manifest) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 has no persisted approved operations to rebuild.', 409);
      const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId, options.sessionId);
      if (enhancement.status === 'failed') {
        requireWorkflowTransition(enhancement.status, 'running', 'enhancement');
        enhancement.status = 'running';
        enhancement.revision = nextRevision(enhancement);
        enhancement.updatedAt = now();
        await this.saveEnhancement(enhancement);
      } else if (enhancement.status !== 'running') {
        throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The parent enhancement run is no longer rebuildable.', 409);
      }

      requireWorkflowTransition(state.status, 'queued');
      state.status = 'queued';
      state.warning = undefined;
      state.revision = nextRevision(state);
      await this.saveVersion2(ownerUserId, version2RunId, state);

      requireWorkflowTransition(state.status, 'building');
      state.status = 'building';
      state.revision = nextRevision(state);
      await this.saveVersion2(ownerUserId, version2RunId, state);
      try {
        const context = await this.baselineContext(ownerUserId, enhancement.baselineRunId);
        const applied = await this.worker.apply(context.context, state.manifest.targetBranch, state.operations);
        const entries = await buildDiffEntries(applied.baseExtraction.workspacePath, applied.workspacePath, state.operations);
        const finalDiffHash = diffHash(entries);
        state.manifest = { ...state.manifest, diffEntries: entries, diffHash: finalDiffHash, operationHash: operationHash(state.operations), targetBranch: deliveryBranchName(version2RunId, finalDiffHash), generatedAt: now() };
        state.branchName = state.manifest.targetBranch;
        this.versionWorkspaces.set(version2RunId, applied);
      } catch (reason: unknown) {
        state.status = 'failed';
        state.warning = reason instanceof Error ? reason.message : 'Version 2 could not be rebuilt in the isolated worker.';
      }
      state.revision = nextRevision(state);
      await this.saveVersion2(ownerUserId, version2RunId, state);
      if (state.status === 'failed' && enhancement.status === 'running') {
        requireWorkflowTransition(enhancement.status, 'failed', 'enhancement');
        enhancement.status = 'failed';
        enhancement.revision = nextRevision(enhancement);
        enhancement.updatedAt = now();
        await this.saveEnhancement(enhancement);
      }
      return { status: state.status, manifest: state.manifest, revision: state.revision ?? 0, warning: state.warning };
    });
  }

  public async preparePullRequest(ownerUserId: string, version2RunId: string, options: WorkflowMutationOptions = {}): Promise<PullRequestReceipt> {
    this.store.assertWritable?.();
    return this.withLock(`version2:${version2RunId}`, () => this.preparePullRequestUnlocked(ownerUserId, version2RunId, options));
  }

  public async getVersion2State(ownerUserId: string, version2RunId: string, sessionId?: string): Promise<Version2State> {
    const state = this.versions.get(version2RunId) ?? await this.store.get<Version2State>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    requireSessionBinding(sessionId, state.sessionId);
    state.deliveryReceipts = await this.loadDeliveryReceipts(ownerUserId, state);
    return { ...state, version2RunId, operations: state.operations?.map(publicOperation), deliveryReceipts: state.deliveryReceipts?.map((receipt) => ({ ...receipt })) };
  }

  public async getVersion2Manifest(ownerUserId: string, version2RunId: string, sessionId?: string): Promise<ChangeManifest> {
    const state = await this.getVersion2State(ownerUserId, version2RunId, sessionId);
    if (!state.manifest) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 has no change manifest.', 409);
    return state.manifest;
  }

  public async getVersion2Diff(ownerUserId: string, version2RunId: string, sessionId?: string): Promise<{ version2RunId: string; manifestId: string; diffHash: string; entries: NonNullable<ChangeManifest['diffEntries']> }> {
    const manifest = await this.getVersion2Manifest(ownerUserId, version2RunId, sessionId);
    return { version2RunId, manifestId: manifest.manifestId, diffHash: manifest.diffHash, entries: manifest.diffEntries ?? [] };
  }

  public async acknowledgeVersion2Diff(ownerUserId: string, version2RunId: string, previewHash: string, options: WorkflowMutationOptions = {}): Promise<Version2State> {
    this.store.assertWritable?.();
    const state = this.versions.get(version2RunId) ?? await this.store.get<Version2State>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    requireSessionBinding(options.sessionId, state.sessionId);
    requireExpectedRevision(state, options.expectedRevision);
    if (!state.manifest?.diffEntries?.length || state.status !== 'building') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Build the bounded exact diff before acknowledging its preview.', 409);
    if (previewHash !== state.manifest.diffHash) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'The exact Version 2 preview hash no longer matches the server manifest.', 400);
    state.previewAcknowledgedAt = now();
    state.previewAcknowledgedHash = previewHash;
    state.revision = nextRevision(state);
    await this.saveVersion2(ownerUserId, version2RunId, state);
    return { ...state, operations: state.operations?.map(publicOperation), deliveryReceipts: state.deliveryReceipts?.map((receipt) => ({ ...receipt })) };
  }

  private async preparePullRequestUnlocked(ownerUserId: string, version2RunId: string, options: WorkflowMutationOptions): Promise<PullRequestReceipt> {
    const state = this.versions.get(version2RunId) ?? await this.store.get<Version2State>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    requireSessionBinding(options.sessionId, state.sessionId);
    requireExpectedRevision(state, options.expectedRevision);
    if (state.receipt) return state.receipt;
    if (state.status !== 'ready_for_pr') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 must pass validation before pull-request preparation.', 409);
    if (!state.manifest?.diffHash || state.previewAcknowledgedHash !== state.manifest.diffHash) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Acknowledge the exact Version 2 diff before pull-request preparation.', 409);
    const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId, options.sessionId);
    const context = await this.baselineContext(ownerUserId, enhancement.baselineRunId);
    const receipt: PullRequestReceipt = { pullRequestId: randomUUID(), version2RunId, owner: context.context.snapshot.repository.owner, repository: context.context.snapshot.repository.name, branchName: state.manifest?.targetBranch ?? `ai/enhancement/${version2RunId}`, title: `Obsidian Version 2: ${version2RunId}`, body: 'This pull request was prepared from an approved Obsidian change manifest. Review the exact diff and validation receipt before merging.', url: null, status: 'prepared', createdAt: now(), manifestHash: state.manifest?.diffHash ?? null, revision: (state.revision ?? 0) + 1, deliveryStep: 'prepared' };
    state.receipt = receipt;
    state.deliveryStep = 'prepared';
    state.revision = nextRevision(state);
    await this.saveVersion2(ownerUserId, version2RunId, state);
    await this.store.save(ownerUserId, 'pull_request', receipt.pullRequestId, receipt);
    return receipt;
  }

  public async validateVersion2(ownerUserId: string, version2RunId: string, options: WorkflowMutationOptions = {}): Promise<{ status: Version2Status; manifest: ChangeManifest; receipt: ValidationReceipt }> {
    this.store.assertWritable?.();
    const state = this.versions.get(version2RunId) ?? await this.store.get<Version2State>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    requireSessionBinding(options.sessionId, state.sessionId);
    requireExpectedRevision(state, options.expectedRevision);
    if (state.status !== 'building' || !state.manifest) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Build the Version 2 manifest before validation.', 409);
    if (!state.previewAcknowledgedHash || state.previewAcknowledgedHash !== state.manifest.diffHash) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Acknowledge the exact Version 2 diff before validation.', 409);
    const paths = [...state.manifest.added, ...state.manifest.modified, ...state.manifest.deleted];
    if (new Set(paths).size !== paths.length) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The Version 2 manifest contains duplicate paths.', 409);
    const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId, options.sessionId);
    let applied = this.versionWorkspaces.get(version2RunId);
    let validation: Awaited<ReturnType<ChangeWorker['validate']>>;
    try {
      if (!applied) {
        const context = await this.baselineContext(ownerUserId, enhancement.baselineRunId);
        if (!state.operations?.length) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 has no persisted operations to recover.', 409);
        applied = await this.worker.apply(context.context, state.manifest.targetBranch, state.operations);
        this.versionWorkspaces.set(version2RunId, applied);
      }
      validation = await this.worker.validate((await this.baselineContext(ownerUserId, enhancement.baselineRunId)).context, applied);
    } catch (reason: unknown) {
      validation = { status: 'not_available', checks: [{ id: 'version2-worker', label: 'Version 2 worker validation', status: 'not_available', summary: reason instanceof Error ? reason.message : 'No isolated Version 2 workspace is available.' }] };
    }
    const receipt: ValidationReceipt = { validationId: randomUUID(), phase: 'version_2', sourceRunId: version2RunId, status: validation.status, checks: validation.checks, baseCommit: state.manifest.baseCommit, branchName: state.manifest.targetBranch, createdAt: now(), manifestHash: state.manifest.diffHash, revision: (state.revision ?? 0) + 1 };
    requireWorkflowTransition(state.status, 'validating');
    state.status = 'validating';
    const nextStatus = validation.status === 'passed' ? 'ready_for_pr' : validation.status === 'not_available' ? 'recovery_required' : 'failed';
    requireWorkflowTransition(state.status, nextStatus);
    state.status = nextStatus;
    state.revision = (state.revision ?? 0) + 1;
    this.versions.set(version2RunId, state);
    await this.saveVersion2(ownerUserId, version2RunId, state);
    await this.store.save(ownerUserId, 'validation', receipt.validationId, receipt);
    if (validation.status === 'passed' || validation.status === 'failed') {
       const nextEnhancementStatus = validation.status === 'passed' ? 'validated' : 'failed';
       requireWorkflowTransition(enhancement.status, nextEnhancementStatus);
       enhancement.status = nextEnhancementStatus;
      enhancement.revision = nextRevision(enhancement);
      enhancement.updatedAt = now();
      await this.saveEnhancement(enhancement);
    }
    return { status: state.status, manifest: state.manifest, receipt };
  }

  public async cancelVersion2(ownerUserId: string, version2RunId: string, options: WorkflowMutationOptions = {}): Promise<{ status: Version2Status; revision: number }> {
    this.store.assertWritable?.();
    const state = this.versions.get(version2RunId) ?? await this.store.get<Version2State>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    requireSessionBinding(options.sessionId, state.sessionId);
    requireExpectedRevision(state, options.expectedRevision);
    if (state.status === 'cancelled') return { status: state.status, revision: state.revision ?? 0 };
    requireWorkflowTransition(state.status, 'cancelled');
    state.status = 'cancelled';
    state.revision = (state.revision ?? 0) + 1;
    this.versions.set(version2RunId, state);
    await this.saveVersion2(ownerUserId, version2RunId, state);
    const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId, options.sessionId);
    requireWorkflowTransition(enhancement.status, 'cancelled');
    enhancement.status = 'cancelled';
    enhancement.revision = nextRevision(enhancement);
    enhancement.updatedAt = now();
    await this.saveEnhancement(enhancement);
    return { status: state.status, revision: state.revision };
  }

  public async createPullRequest(ownerUserId: string, version2RunId: string, accessToken: string, options: WorkflowMutationOptions = {}): Promise<PullRequestReceipt> {
    this.store.assertWritable?.();
    return this.withLock(`version2:${version2RunId}`, () => this.createPullRequestUnlocked(ownerUserId, version2RunId, accessToken, options));
  }

  private async createPullRequestUnlocked(ownerUserId: string, version2RunId: string, accessToken: string, options: WorkflowMutationOptions): Promise<PullRequestReceipt> {
    const state = this.versions.get(version2RunId) ?? await this.store.get<Version2State>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    requireSessionBinding(options.sessionId, state.sessionId);
    requireExpectedRevision(state, options.expectedRevision);
    state.deliveryReceipts = await this.loadDeliveryReceipts(ownerUserId, state);
    if (state.receipt?.status === 'created') return state.receipt;
    if (state.status !== 'ready_for_pr' || !state.manifest || !state.operations?.length || state.receipt?.status !== 'prepared') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 must pass validation, preparation, and contain approved file operations before pull-request creation.', 409);
    if (state.previewAcknowledgedHash !== state.manifest.diffHash) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Acknowledge the exact Version 2 diff before pull-request creation.', 409);
    const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId, options.sessionId);
    const context = await this.baselineContext(ownerUserId, enhancement.baselineRunId);
    const github = new GithubApiClient(accessToken);
    const repository = context.context.snapshot.repository;
    const branch = { owner: repository.owner, name: repository.name, branch: state.manifest.targetBranch };
    const identity: DeliveryIdentity = { ownerUserId, version2RunId, baseCommit: state.manifest.baseCommit, manifestHash: state.manifest.diffHash, branchName: state.manifest.targetBranch };
    const files = state.operations.map((operation) => ({ path: operation.path, content: operation.content, delete: operation.kind === 'delete' }));
    const commitMessage = deliveryCommitMessage(version2RunId, state.manifest.diffHash);
    const markRecovery = async (step: DeliveryStepName, code: string): Promise<void> => {
      state.deliveryStep = 'recovery_required';
      state.deliveryReceipts = markDeliveryRecovery(state.deliveryReceipts, identity, step, code);
      await this.persistDeliveryStep(ownerUserId, state, step, 'recovery_required', { errorCode: code });
    };

    const branchReceipt = deliveryReceiptFor(state.deliveryReceipts, 'branch');
    if (!branchReceipt || branchReceipt.status !== 'completed' || !deliveryIdentityMatches(branchReceipt, identity)) {
      await this.persistDeliveryStep(ownerUserId, state, 'branch', 'pending');
      try {
        await github.createBranch(branch, state.manifest.baseCommit);
        state.deliveryStep = 'branch_created';
        await this.persistDeliveryStep(ownerUserId, state, 'branch', 'completed', { remoteId: branch.branch, responseHash: responseHash({ branch: branch.branch, baseCommit: state.manifest.baseCommit }) });
      } catch (reason: unknown) {
        const existingHead = await github.getBranchCommitSha(branch).catch(() => null);
        if (existingHead !== state.manifest.baseCommit) {
          await markRecovery('branch', 'GITHUB_BRANCH_RESPONSE_AMBIGUOUS');
          throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The Version 2 branch could not be reconciled to the immutable base commit.', 409);
        }
        state.deliveryStep = 'branch_created';
        await this.persistDeliveryStep(ownerUserId, state, 'branch', 'completed', { remoteId: branch.branch, responseHash: responseHash({ branch: branch.branch, baseCommit: state.manifest.baseCommit }) });
      }
    }

    let commitSha = state.commitSha ?? deliveryReceiptFor(state.deliveryReceipts, 'commit')?.commitSha ?? null;
    let commitReceipt = deliveryReceiptFor(state.deliveryReceipts, 'commit');
    if (!commitSha || !commitReceipt || commitReceipt.status !== 'completed' || !deliveryIdentityMatches(commitReceipt, identity)) {
      const currentHead = await github.getBranchCommitSha(branch).catch(() => null);
      if (currentHead && currentHead !== state.manifest.baseCommit) {
        const details = await github.getCommitDetails({ owner: repository.owner, name: repository.name, commitSha: currentHead }).catch(() => null);
        if (details && await this.matchesRemoteCommit(github, repository, details, state.manifest.baseCommit, commitMessage, state.operations)) {
          commitSha = currentHead;
          state.commitSha = commitSha;
          state.deliveryStep = 'commit_created';
          await this.persistDeliveryStep(ownerUserId, state, 'commit', 'completed', { remoteId: commitSha, commitSha, responseHash: responseHash(details) });
          commitReceipt = deliveryReceiptFor(state.deliveryReceipts, 'commit');
        } else {
          await markRecovery('commit', 'GITHUB_COMMIT_CONTENT_UNEXPECTED');
          throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The delivery branch contains an unexpected commit and requires reconciliation.', 409);
        }
      }
      if (!commitSha) {
        await this.persistDeliveryStep(ownerUserId, state, 'commit', 'pending');
        try {
          const created = await github.createCommitForManifest({ owner: repository.owner, name: repository.name, branch: state.manifest.targetBranch, baseCommit: state.manifest.baseCommit, message: commitMessage, files });
          commitSha = created.commitSha;
          state.commitSha = commitSha;
          state.deliveryStep = 'commit_created';
          await this.persistDeliveryStep(ownerUserId, state, 'commit', 'completed', { remoteId: commitSha, commitSha, responseHash: responseHash(created) });
        } catch (reason: unknown) {
          const reconciledHead = await github.getBranchCommitSha(branch).catch(() => null);
          if (reconciledHead && reconciledHead !== state.manifest.baseCommit) {
            const details = await github.getCommitDetails({ owner: repository.owner, name: repository.name, commitSha: reconciledHead }).catch(() => null);
            if (details && await this.matchesRemoteCommit(github, repository, details, state.manifest.baseCommit, commitMessage, state.operations)) {
              commitSha = reconciledHead;
              state.commitSha = commitSha;
              state.deliveryStep = 'commit_created';
              await this.persistDeliveryStep(ownerUserId, state, 'commit', 'completed', { remoteId: commitSha, commitSha, responseHash: responseHash(details) });
            } else {
              await markRecovery('commit', 'GITHUB_COMMIT_RESPONSE_AMBIGUOUS');
              throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The Version 2 commit response was ambiguous and requires reconciliation.', 409);
            }
          } else {
            await this.persistDeliveryStep(ownerUserId, state, 'commit', 'failed', { errorCode: 'GITHUB_COMMIT_FAILED' });
            throw reason;
          }
        }
      }
    }

    state.commitSha = commitSha;
    const refReceipt = deliveryReceiptFor(state.deliveryReceipts, 'ref');
    if (!refReceipt || refReceipt.status !== 'completed' || !deliveryIdentityMatches(refReceipt, identity) || refReceipt.commitSha !== commitSha) {
      await this.persistDeliveryStep(ownerUserId, state, 'ref', 'pending', { commitSha });
      try {
        await github.updateBranchRef(branch, commitSha!);
        state.deliveryStep = 'commit_created';
        await this.persistDeliveryStep(ownerUserId, state, 'ref', 'completed', { remoteId: branch.branch, commitSha, responseHash: responseHash({ branch: branch.branch, commitSha }) });
      } catch (reason: unknown) {
        const reconciledHead = await github.getBranchCommitSha(branch).catch(() => null);
        if (reconciledHead === commitSha) {
          await this.persistDeliveryStep(ownerUserId, state, 'ref', 'completed', { remoteId: branch.branch, commitSha, responseHash: responseHash({ branch: branch.branch, commitSha }) });
        } else {
          await markRecovery('ref', 'GITHUB_REF_RESPONSE_AMBIGUOUS');
          throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The Version 2 branch ref could not be reconciled after the GitHub response.', 409);
        }
      }
    }

    let existing: Array<{ number: number; url: string; headSha: string | null }>;
    try {
      existing = await github.listOpenPullRequests({ owner: repository.owner, name: repository.name, head: state.manifest.targetBranch, base: repository.branch });
    } catch (reason: unknown) {
      await markRecovery('pull_request', 'GITHUB_PR_LOOKUP_FAILED');
      throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'GitHub pull-request state could not be reconciled; retry delivery after reviewing the recovery receipt.', 409);
    }
    const matching = existing.find((pull) => pull.headSha === commitSha);
    if (existing.length > 0 && !matching) {
      await markRecovery('pull_request', 'GITHUB_PR_CONTENT_UNEXPECTED');
      throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'An existing pull request points to an unexpected commit.', 409);
    }
    await this.persistDeliveryStep(ownerUserId, state, 'pull_request', 'pending');
    let created: { number: number; url: string };
    if (matching) {
      created = { number: matching.number, url: matching.url };
    } else {
      try {
        created = await github.createPullRequest({ owner: repository.owner, name: repository.name, title: `Obsidian Version 2: ${version2RunId}`, body: 'Created from an approved Obsidian change manifest and validation receipt.', head: state.manifest.targetBranch, base: repository.branch });
      } catch (reason: unknown) {
        const reconciled = await github.listOpenPullRequests({ owner: repository.owner, name: repository.name, head: state.manifest.targetBranch, base: repository.branch }).catch(() => []);
        const reconciledMatch = reconciled.find((pull) => pull.headSha === commitSha);
        if (!reconciledMatch) {
          await markRecovery('pull_request', 'GITHUB_PR_RESPONSE_AMBIGUOUS');
          throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The pull-request response was ambiguous and requires reconciliation.', 409);
        }
        created = { number: reconciledMatch.number, url: reconciledMatch.url };
      }
    }
    const receipt: PullRequestReceipt = { pullRequestId: state.receipt?.pullRequestId ?? randomUUID(), version2RunId, owner: repository.owner, repository: repository.name, branchName: state.manifest.targetBranch, title: `Obsidian Version 2: ${version2RunId}`, body: `Commit ${commitSha ?? 'unknown'} was created from the approved manifest.`, url: created.url, status: 'created', createdAt: state.receipt?.createdAt ?? now(), commitSha, manifestHash: state.manifest.diffHash, revision: (state.revision ?? 0) + 1, deliveryStep: 'pr_created' };
    state.deliveryStep = 'pr_created';
    state.commitSha = commitSha;
    state.receipt = receipt;
    await this.persistDeliveryStep(ownerUserId, state, 'pull_request', 'completed', { remoteId: String(created.number), responseHash: responseHash(created), commitSha });
    await this.store.save(ownerUserId, 'pull_request', receipt.pullRequestId, receipt);
    return receipt;
  }

  private async persistDeliveryStep(
    ownerUserId: string,
    state: Version2State,
    step: DeliveryStepName,
    status: DeliveryStepReceipt['status'],
    fields: Pick<DeliveryStepReceipt, 'remoteId' | 'responseHash' | 'commitSha' | 'errorCode'> = {},
  ): Promise<DeliveryStepReceipt> {
    if (!state.manifest) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 has no manifest for delivery reconciliation.', 409);
    const identity: DeliveryIdentity = {
      ownerUserId,
      version2RunId: state.version2RunId,
      baseCommit: state.manifest.baseCommit,
      manifestHash: state.manifest.diffHash,
      branchName: state.manifest.targetBranch,
    };
    const candidate = deliveryReceiptFor(upsertDeliveryReceipt(state.deliveryReceipts, identity, step, status, fields), step)!;
    const recordId = `${state.version2RunId}:${step}`;
    const existing = await this.store.get<DeliveryStepReceipt>(ownerUserId, 'delivery_step', recordId);
    const persisted = await this.store.saveVersioned(ownerUserId, 'delivery_step', recordId, candidate, existing ? currentRevision(existing) : undefined);
    state.deliveryReceipts = [...(state.deliveryReceipts ?? []).filter((receipt) => receipt.step !== step), persisted];
    state.revision = nextRevision(state);
    await this.saveVersion2(ownerUserId, state.version2RunId, state);
    return persisted;
  }

  private async matchesRemoteCommit(
    github: GithubApiClient,
    repository: { owner: string; name: string },
    details: { parentShas: string[]; message: string; treeSha: string },
    baseCommit: string,
    commitMessage: string,
    operations: readonly ChangeOperation[],
  ): Promise<boolean> {
    if (!details.parentShas.includes(baseCommit) || details.message !== commitMessage) return false;
    const entries = await github.getTreeEntries({ owner: repository.owner, name: repository.name, treeSha: details.treeSha }).catch(() => null);
    if (!entries) return false;
    const byPath = new Map(entries.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.sha]));
    return operations.every((operation) => operation.kind === 'delete'
      ? !byPath.has(operation.path)
      : byPath.get(operation.path) === gitBlobSha(operation.content ?? ''));
  }

  private async loadDeliveryReceipts(ownerUserId: string, state: Version2State): Promise<DeliveryStepReceipt[]> {
    const steps: DeliveryStepName[] = ['branch', 'commit', 'ref', 'pull_request'];
    const loaded = await Promise.all(steps.map((step) => this.store.get<DeliveryStepReceipt>(ownerUserId, 'delivery_step', `${state.version2RunId}:${step}`)));
    const byStep = new Map((state.deliveryReceipts ?? []).map((receipt) => [receipt.step, receipt]));
    loaded.forEach((receipt) => { if (receipt) byStep.set(receipt.step, receipt); });
    return [...byStep.values()];
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.locks.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }

  private async requireRepair(ownerUserId: string, planId: string, sessionId?: string): Promise<RepairPlan> {
    const plan = await this.store.get<RepairPlan>(ownerUserId, 'repair_plan', planId);
    if (!plan || plan.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Repair plan was not found.', 404);
    requireSessionBinding(sessionId, plan.sessionId);
    return plan;
  }

  private async requireEnhancement(ownerUserId: string, enhancementRunId: string, sessionId?: string): Promise<EnhancementRun> {
    const run = await this.store.get<EnhancementRun>(ownerUserId, 'enhancement_run', enhancementRunId);
    if (!run || run.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Enhancement run was not found.', 404);
    requireSessionBinding(sessionId, run.sessionId);
    return run;
  }

  private async baselineContext(ownerUserId: string, baselineRunId: string): Promise<Awaited<ReturnType<BaselineService['selectedContextDurable']>>> {
    if (this.baseline.selectedContextDurable) return this.baseline.selectedContextDurable(ownerUserId, baselineRunId);
    return this.baseline.selectedContext(ownerUserId, baselineRunId);
  }

  private async baselineResult(ownerUserId: string, baselineRunId: string): Promise<Awaited<ReturnType<BaselineService['getDurable']>>> {
    if (this.baseline.getDurable) return this.baseline.getDurable(ownerUserId, baselineRunId);
    return this.baseline.get(ownerUserId, baselineRunId);
  }

  private async completenessResult(ownerUserId: string, completenessRunId: string): Promise<Awaited<ReturnType<CompletenessService['getDurable']>>> {
    if (this.completeness.getDurable) return this.completeness.getDurable(ownerUserId, completenessRunId);
    return this.completeness.get(ownerUserId, completenessRunId);
  }

  private async saveRepair(plan: RepairPlan): Promise<void> {
    const expectedRevision = currentRevision(plan) > 1 ? currentRevision(plan) - 1 : undefined;
    const saved = await this.store.saveVersioned(plan.ownerUserId, 'repair_plan', plan.planId, plan, expectedRevision);
    Object.assign(plan, saved);
    const context = await this.baselineContext(plan.ownerUserId, plan.baselineRunId).catch(() => null);
    await this.saveAggregate(plan.ownerUserId, plan.sessionId ?? plan.planId, { sessionId: plan.sessionId, repository: context?.context.snapshot.repository, snapshotId: plan.snapshotId, baseCommit: plan.baseCommit, detectionRunId: context?.context.detectionRunId, completenessRunId: plan.completenessRunId, baselineRunId: plan.baselineRunId, repairPlanId: plan.planId, repairCheckpointId: plan.repairCheckpointId });
  }

  private async saveEnhancement(run: EnhancementRun): Promise<void> {
    const expectedRevision = currentRevision(run) > 1 ? currentRevision(run) - 1 : undefined;
    const saved = await this.store.saveVersioned(run.ownerUserId, 'enhancement_run', run.enhancementRunId, run, expectedRevision);
    Object.assign(run, saved);
    const context = await this.baselineContext(run.ownerUserId, run.baselineRunId).catch(() => null);
    await this.saveAggregate(run.ownerUserId, run.sessionId ?? run.enhancementRunId, { sessionId: run.sessionId, repository: context?.context.snapshot.repository, snapshotId: run.snapshotId, baseCommit: run.baseCommit, detectionRunId: context?.context.detectionRunId, completenessRunId: run.completenessRunId, baselineRunId: run.baselineRunId, enhancementRunId: run.enhancementRunId, repairCheckpointId: run.repairCheckpointId });
  }

  private async saveVersion2(ownerUserId: string, version2RunId: string, state: Version2State): Promise<void> {
    const expectedRevision = currentRevision(state) > 1 ? currentRevision(state) - 1 : undefined;
    try {
      const saved = await this.store.saveVersioned(ownerUserId, 'version_2_run', version2RunId, state, expectedRevision);
      Object.assign(state, saved);
      this.versions.set(version2RunId, state);
      await this.saveAggregate(ownerUserId, state.sessionId ?? state.enhancementRunId, { sessionId: state.sessionId, snapshotId: state.snapshotId, version2RunId, enhancementRunId: state.enhancementRunId, manifestId: state.manifest?.manifestId ?? null, baseCommit: state.manifest?.baseCommit });
    } catch (reason) {
      this.versions.delete(version2RunId);
      throw reason;
    }
  }

  private async saveRecommendationReview(receipt: RecommendationReviewReceipt): Promise<void> {
    await this.store.save(receipt.ownerUserId, 'recommendation_review', receipt.reviewId, receipt);
  }

  private async saveAggregate(ownerUserId: string, workflowId: string, patch: Partial<WorkflowAggregate>): Promise<void> {
    const current = await this.store.get<WorkflowAggregate>(ownerUserId, 'workflow_aggregate', workflowId);
    const aggregate: WorkflowAggregate = { ...current, ...patch, workflowId, ownerUserId };
    const expectedRevision = current ? currentRevision(current) : undefined;
    await this.store.saveVersioned(ownerUserId, 'workflow_aggregate', workflowId, aggregate, expectedRevision);
  }

  private recordEvent(sessionId: string, projectId: string, baseCommit: string, runId: string, eventType: string, summary: string, status: 'passed' | 'failed' | 'skipped' | 'unavailable', userActionRequired: boolean): void {
    const event = createSystemEvent({ eventType, sessionId, projectId, runId, baseCommit, phase: 'workflow', status, safeSummary: summary, affectedPaths: [], userActionRequired });
    this.events.push(event);
    void Promise.resolve(this.eventSink?.(event)).catch(() => undefined);
  }

  public listEvents(ownerUserId: string, runId: string): SystemEvent[] {
    return this.events.filter((event) => event.runId === runId && event.sessionId === ownerUserId).map((event) => ({ ...event, affectedPaths: [...event.affectedPaths] }));
  }
}
