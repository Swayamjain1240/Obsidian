import { createHash, randomUUID } from 'node:crypto';

import type { CompletenessService } from '../completeness/service.js';
import type { DetectionEventSink } from '../detection/service.js';
import { createSystemEvent, type SystemEvent } from '../events.js';
import type { BaselineService } from '../baseline/service.js';
import type {
  ApprovalState,
  ChangeManifest,
  ChangeOperation,
  EnhancementRun,
  PullRequestReceipt,
  Recommendation,
  RepairItem,
  RepairPlan,
  ValidationReceipt,
  Version2Status,
} from './types.js';
import { publicEnhancementRun, publicOperation, publicRepairPlan } from './types.js';
import type { DurableWorkflowStore } from './store.js';
import { GithubApiClient } from '../github/client.js';
import type { AppConfig } from '../config.js';
import { ChangeWorker, type AppliedWorkspace } from './change-worker.js';
import type { RepositoryCommandExecutor } from '../workers/executor.js';

export interface ChangeOperationInput {
  kind: 'add' | 'modify' | 'delete';
  path: string;
  content?: string;
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

function safePath(value: string): boolean {
  return value.length > 0
    && value.length <= 1024
    && !value.includes('\0')
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.split('/').some((part) => part === '..');
}

function normalizeOperations(input: readonly ChangeOperationInput[] | undefined): ChangeOperation[] {
  if (!input) return [];
  if (input.length > 100) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'A workflow approval can contain at most 100 file operations.', 400);
  return input.map((operation) => {
    if (!safePath(operation.path)) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'A workflow operation contains an unsafe path.', 400);
    if (operation.kind !== 'delete' && (typeof operation.content !== 'string' || Buffer.byteLength(operation.content, 'utf8') > 1_048_576)) {
      throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'Added or modified files must include at most 1 MiB of text content.', 400);
    }
    if (operation.kind === 'delete' && operation.content !== undefined) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'Delete operations cannot include file content.', 400);
    const contentHash = operation.content === undefined ? null : createHash('sha256').update(operation.content).digest('hex');
    return { kind: operation.kind, path: operation.path, contentHash, contentBytes: operation.content === undefined ? null : Buffer.byteLength(operation.content, 'utf8'), content: operation.content };
  });
}

function cloneOperations(operations: readonly ChangeOperation[]): ChangeOperation[] {
  return operations.map((operation) => ({ ...operation }));
}

function approvedItems(items: readonly RepairItem[]): RepairItem[] {
  return items.filter((item) => item.approvalState === 'approved');
}

function approvedRecommendations(items: readonly Recommendation[]): Recommendation[] {
  return items.filter((item) => item.approvalState === 'approved');
}

function manifestFor(version2RunId: string, baseCommit: string, branchName: string, repairItems: readonly RepairItem[], recommendations: readonly Recommendation[]): ChangeManifest {
  const operations = [...repairItems.flatMap((item) => item.operations), ...recommendations.flatMap((item) => item.operations)];
  const unique = new Map(operations.map((operation) => [operation.path, operation]));
  return {
    manifestId: randomUUID(), version2RunId, baseCommit, targetBranch: branchName,
    added: [...unique.values()].filter((operation) => operation.kind === 'add').map((operation) => operation.path),
    modified: [...unique.values()].filter((operation) => operation.kind === 'modify').map((operation) => operation.path),
    deleted: [...unique.values()].filter((operation) => operation.kind === 'delete').map((operation) => operation.path),
    approvedRepairIds: repairItems.map((item) => item.id),
    approvedRecommendationIds: recommendations.map((item) => item.id),
    rollbackRef: baseCommit,
    diffHash: createHash('sha256').update(JSON.stringify([...unique.values()].map((operation) => ({ kind: operation.kind, path: operation.path, contentHash: operation.contentHash })))).digest('hex'),
    diffSummary: [...unique.values()].map((operation) => `${operation.kind}: ${operation.path}`),
    generatedAt: now(),
  };
}

export class WorkflowService {
  private readonly events: SystemEvent[] = [];
  private readonly versions = new Map<string, { ownerUserId: string; status: Version2Status; enhancementRunId: string; manifest: ChangeManifest | null; receipt: PullRequestReceipt | null; operations?: ChangeOperation[] }>();
  private readonly repairs = new Map<string, AppliedWorkspace>();
  private readonly versionWorkspaces = new Map<string, AppliedWorkspace>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly worker: ChangeWorker;

  public constructor(
    config: AppConfig,
    private readonly baseline: Pick<BaselineService, 'get' | 'selectedContext'>,
    private readonly completeness: Pick<CompletenessService, 'get'>,
    private readonly store: DurableWorkflowStore,
    private readonly eventSink?: DetectionEventSink,
    commandExecutor?: RepositoryCommandExecutor,
  ) { this.worker = new ChangeWorker(config, commandExecutor); }

  public async createRepairPlan(ownerUserId: string, baselineRunId: string): Promise<RepairPlan> {
    const baseline = this.baseline.get(ownerUserId, baselineRunId);
    if (!['failed', 'partial'].includes(baseline.status)) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Repair review requires failed or incomplete baseline evidence.', 409);
    const context = this.baseline.selectedContext(ownerUserId, baselineRunId);
    const planId = randomUUID();
    const items: RepairItem[] = baseline.checks.filter((check) => ['failed', 'timed_out', 'not_available'].includes(check.status)).map((check) => ({
      id: randomUUID(), planId, sourceCheckId: check.id, category: check.category, title: `Review ${check.label}`, reason: check.summary,
      risk: check.category === 'security' ? 'high' : check.status === 'not_available' ? 'medium' : 'low',
      affectedPaths: check.evidenceRefs.flatMap((ref) => ref.path ? [ref.path] : []),
      expectedTests: [check.label], approvalState: 'awaiting_approval', operations: [], workerStatus: 'pending',
    }));
    const plan: RepairPlan = {
      planId, baselineRunId, completenessRunId: context.completenessRunId, snapshotId: baseline.snapshotId, baseCommit: baseline.baseCommit,
      ownerUserId, status: items.length ? 'awaiting_approval' : 'blocked', branchName: null, items,
      validationId: null, warning: items.length ? null : 'No repair item could be generated from the baseline result.', createdAt: now(), updatedAt: now(),
    };
    await this.saveRepair(plan);
    this.recordEvent(context.context.sessionId, plan.snapshotId, plan.baseCommit, plan.planId, 'REPAIR_PLAN_CREATED', `Repair review contains ${items.length} item${items.length === 1 ? '' : 's'}.`, items.length === 0 ? 'unavailable' : 'passed', true);
    return publicRepairPlan(plan);
  }

  public async getRepairPlan(ownerUserId: string, planId: string): Promise<RepairPlan> {
    const plan = await this.store.get<RepairPlan>(ownerUserId, 'repair_plan', planId);
    if (!plan) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Repair plan was not found.', 404);
    return publicRepairPlan(plan);
  }

  public async approveRepairItem(ownerUserId: string, planId: string, itemId: string, approved: boolean, operations?: readonly ChangeOperationInput[]): Promise<RepairPlan> {
    return this.withLock(`repair:${planId}`, async () => {
      const plan = await this.requireRepair(ownerUserId, planId);
      const item = plan.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Repair item was not found.', 404);
      if (plan.status !== 'awaiting_approval' || item.approvalState !== 'awaiting_approval') {
        throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'This repair item is no longer awaiting approval.', 409);
      }
      const normalized = approved ? normalizeOperations(operations) : [];
      item.approvalState = approved ? 'approved' : 'rejected';
      if (approved) item.operations = normalized;
      if (plan.items.every((candidate) => candidate.approvalState !== 'awaiting_approval')) plan.status = approvedItems(plan.items).length ? 'approved' : 'blocked';
      plan.updatedAt = now();
      await this.saveRepair(plan);
      return publicRepairPlan(plan);
    });
  }

  public async startRepair(ownerUserId: string, planId: string): Promise<RepairPlan> {
    return this.withLock(`repair:${planId}`, () => this.startRepairUnlocked(ownerUserId, planId));
  }

  private async startRepairUnlocked(ownerUserId: string, planId: string): Promise<RepairPlan> {
    const plan = await this.requireRepair(ownerUserId, planId);
    if (plan.status !== 'approved') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Approve at least one repair item before starting the repair worker.', 409);
    plan.branchName = `ai/repair/${plan.planId}`;
    plan.status = 'running';
    const approved = approvedItems(plan.items);
    const hasOperations = approved.some((item) => item.operations.length > 0);
    if (!hasOperations) {
      plan.status = 'blocked';
      plan.warning = 'Approved repair items require deterministic file operations before a repair branch can be changed.';
      approved.forEach((item) => { item.workerStatus = 'blocked'; });
    } else {
      try {
        const context = this.baseline.selectedContext(ownerUserId, plan.baselineRunId);
        const applied = await this.worker.apply(context.context, plan.branchName, approved.flatMap((item) => item.operations));
        this.repairs.set(plan.planId, applied);
        approved.forEach((item) => { item.workerStatus = 'applied'; });
      } catch (reason: unknown) {
        plan.status = 'blocked';
        plan.warning = reason instanceof Error ? reason.message : 'The isolated repair worker could not apply the approved operations.';
        approved.forEach((item) => { item.workerStatus = 'blocked'; });
      }
    }
    plan.updatedAt = now();
    await this.saveRepair(plan);
    return publicRepairPlan(plan);
  }

  public async validateRepair(ownerUserId: string, planId: string): Promise<{ plan: RepairPlan; receipt: ValidationReceipt }> {
    const plan = await this.requireRepair(ownerUserId, planId);
    if (plan.status !== 'running') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Start the repair worker before validation.', 409);
    const applied = this.repairs.get(plan.planId);
    const validation = applied ? await this.worker.validate(this.baseline.selectedContext(ownerUserId, plan.baselineRunId).context, applied) : { status: 'not_available' as const, checks: [{ id: 'repair-baseline', label: 'Repair baseline validation', status: 'not_available' as const, summary: 'No isolated repair workspace is available.' }] };
    const receipt: ValidationReceipt = { validationId: randomUUID(), phase: 'repair', sourceRunId: plan.planId, status: validation.status, checks: validation.checks, baseCommit: plan.baseCommit, branchName: plan.branchName, createdAt: now() };
    plan.validationId = receipt.validationId;
    plan.status = validation.status === 'passed' ? 'validated' : validation.status === 'failed' ? 'failed' : 'blocked';
    plan.warning = validation.status === 'passed' ? null : 'Repair validation did not establish a complete passing baseline.';
    plan.updatedAt = now();
    await this.saveRepair(plan);
    await this.store.save(ownerUserId, 'validation', receipt.validationId, receipt);
    return { plan: publicRepairPlan(plan), receipt };
  }

  public async publishRepairBranch(ownerUserId: string, planId: string, accessToken: string): Promise<RepairPlan> {
    const plan = await this.requireRepair(ownerUserId, planId);
    if (plan.status !== 'validated' || !plan.branchName) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Repair validation must pass before publishing the repair branch.', 409);
    const context = this.baseline.selectedContext(ownerUserId, plan.baselineRunId);
    const repository = context.context.snapshot.repository;
    const github = new GithubApiClient(accessToken);
    await github.createBranch({ owner: repository.owner, name: repository.name, branch: plan.branchName }, plan.baseCommit);
    const operations = approvedItems(plan.items).flatMap((item) => item.operations);
    await github.createCommitFromManifest({ owner: repository.owner, name: repository.name, branch: plan.branchName, baseCommit: plan.baseCommit, message: `Obsidian repair: ${plan.planId}`, files: operations.map((operation) => ({ path: operation.path, content: operation.content, delete: operation.kind === 'delete' })) });
    plan.warning = 'The validated repair branch was published for review. The original branch was not modified.';
    plan.updatedAt = now();
    await this.saveRepair(plan);
    return publicRepairPlan(plan);
  }

  public async createEnhancementRun(ownerUserId: string, baselineRunId: string): Promise<EnhancementRun> {
    const baseline = this.baseline.get(ownerUserId, baselineRunId);
    if (!['passed', 'partial'].includes(baseline.status)) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Enhancement analysis requires baseline evidence.', 409);
    const context = this.baseline.selectedContext(ownerUserId, baselineRunId);
    if (baseline.status === 'partial' && context.scopeMode !== 'EXISTING_ONLY') {
      throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'A partial baseline requires Enhance Existing Parts Only before enhancement analysis.', 409);
    }
    const completeness = await this.completeness.get(ownerUserId, context.completenessRunId);
    const enhancementRunId = randomUUID();
    const recommendations: Recommendation[] = completeness.areas.filter((area) => area.status !== 'not_available').map((area) => ({
      id: randomUUID(), enhancementRunId, category: area.id === 'tests' ? 'testing' : area.id === 'documentation' ? 'documentation' : 'architecture',
      title: `Review ${area.name}`, currentProblem: area.summary, suggestedSolution: 'Review and improve this existing area without inventing absent product features.',
      risk: area.status === 'working' ? 'low' : 'medium', affectedPaths: [...area.affectedPaths], affectedAreas: [area.id], expectedTests: ['Baseline and affected-area checks'], approvalState: 'awaiting_approval', operations: [],
    }));
    const run: EnhancementRun = { enhancementRunId, baselineRunId, completenessRunId: context.completenessRunId, snapshotId: baseline.snapshotId, baseCommit: baseline.baseCommit, ownerUserId, scopeMode: context.scopeMode, status: recommendations.length ? 'awaiting_review' : 'blocked', recommendations, warning: recommendations.length ? null : 'No existing area was available for enhancement analysis.', createdAt: now(), updatedAt: now() };
    await this.saveEnhancement(run);
    this.recordEvent(context.context.sessionId, run.snapshotId, run.baseCommit, run.enhancementRunId, 'RECOMMENDATIONS_CREATED', `Enhancement analysis produced ${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'}.`, recommendations.length ? 'passed' : 'unavailable', true);
    return publicEnhancementRun(run);
  }

  public async getEnhancementRun(ownerUserId: string, enhancementRunId: string): Promise<EnhancementRun> {
    const run = await this.store.get<EnhancementRun>(ownerUserId, 'enhancement_run', enhancementRunId);
    if (!run) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Enhancement run was not found.', 404);
    return publicEnhancementRun(run);
  }

  public async approveRecommendation(ownerUserId: string, enhancementRunId: string, recommendationId: string, approved: boolean, operations?: readonly ChangeOperationInput[]): Promise<EnhancementRun> {
    return this.withLock(`enhancement:${enhancementRunId}`, async () => {
      const run = await this.requireEnhancement(ownerUserId, enhancementRunId);
      const recommendation = run.recommendations.find((candidate) => candidate.id === recommendationId);
      if (!recommendation) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Recommendation was not found.', 404);
      if (run.status !== 'awaiting_review' || recommendation.approvalState !== 'awaiting_approval') {
        throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'This recommendation is no longer awaiting review.', 409);
      }
      const normalized = approved ? normalizeOperations(operations) : [];
      recommendation.approvalState = approved ? 'approved' : 'rejected';
      if (approved) recommendation.operations = normalized;
      if (run.recommendations.every((candidate) => candidate.approvalState !== 'awaiting_approval')) run.status = approvedRecommendations(run.recommendations).length ? 'approved' : 'blocked';
      run.updatedAt = now();
      await this.saveEnhancement(run);
      return publicEnhancementRun(run);
    });
  }

  public async startVersion2(ownerUserId: string, enhancementRunId: string): Promise<{ enhancement: EnhancementRun; version2RunId: string; status: Version2Status; manifest: ChangeManifest | null }> {
    return this.withLock(`enhancement:${enhancementRunId}`, () => this.startVersion2Unlocked(ownerUserId, enhancementRunId));
  }

  private async startVersion2Unlocked(ownerUserId: string, enhancementRunId: string): Promise<{ enhancement: EnhancementRun; version2RunId: string; status: Version2Status; manifest: ChangeManifest | null }> {
    const run = await this.requireEnhancement(ownerUserId, enhancementRunId);
    if (run.status !== 'approved') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Approve at least one recommendation before building Version 2.', 409);
    const version2RunId = randomUUID();
    const branchName = `ai/enhancement/${version2RunId}`;
    const repairItems: RepairItem[] = [];
    const recommendations = approvedRecommendations(run.recommendations);
    const manifest = manifestFor(version2RunId, run.baseCommit, branchName, repairItems, recommendations);
    const hasOperations = recommendations.some((recommendation) => recommendation.operations.length > 0);
    let status: Version2Status = hasOperations ? 'building' : 'failed';
    const operations = recommendations.flatMap((recommendation) => cloneOperations(recommendation.operations));
    if (hasOperations) {
      try {
        const context = this.baseline.selectedContext(ownerUserId, run.baselineRunId);
        const applied = await this.worker.apply(context.context, branchName, operations);
        this.versionWorkspaces.set(version2RunId, applied);
      } catch (reason: unknown) {
        status = 'failed';
      }
    }
    this.versions.set(version2RunId, { ownerUserId, status, enhancementRunId, manifest: hasOperations ? manifest : null, receipt: null, operations });
    await this.store.save(ownerUserId, 'version_2_run', version2RunId, { version2RunId, ownerUserId, enhancementRunId, status, branchName, manifest: hasOperations ? manifest : null, operations, warning: hasOperations ? null : 'Approved recommendations require deterministic file operations before Version 2 can be built.' });
    run.status = hasOperations ? 'running' : 'blocked';
    run.updatedAt = now();
    await this.saveEnhancement(run);
    return { enhancement: publicEnhancementRun(run), version2RunId, status, manifest };
  }

  public async preparePullRequest(ownerUserId: string, version2RunId: string): Promise<PullRequestReceipt> {
    return this.withLock(`version2:${version2RunId}`, () => this.preparePullRequestUnlocked(ownerUserId, version2RunId));
  }

  private async preparePullRequestUnlocked(ownerUserId: string, version2RunId: string): Promise<PullRequestReceipt> {
    const state = this.versions.get(version2RunId) ?? await this.store.get<{ ownerUserId: string; status: Version2Status; enhancementRunId: string; manifest: ChangeManifest | null; receipt: PullRequestReceipt | null; operations?: ChangeOperation[] }>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    if (state.receipt) return state.receipt;
    if (state.status !== 'ready_for_pr') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 must pass validation before pull-request preparation.', 409);
    const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId);
    const context = this.baseline.selectedContext(ownerUserId, enhancement.baselineRunId);
    const receipt: PullRequestReceipt = { pullRequestId: randomUUID(), version2RunId, owner: context.context.snapshot.repository.owner, repository: context.context.snapshot.repository.name, branchName: state.manifest?.targetBranch ?? `ai/enhancement/${version2RunId}`, title: `Obsidian Version 2: ${version2RunId}`, body: 'This pull request was prepared from an approved Obsidian change manifest. Review the exact diff and validation receipt before merging.', url: null, status: 'prepared', createdAt: now() };
    state.receipt = receipt;
    this.versions.set(version2RunId, state);
    await this.store.save(ownerUserId, 'pull_request', receipt.pullRequestId, receipt);
    await this.store.save(ownerUserId, 'version_2_run', version2RunId, state);
    return receipt;
  }

  public async validateVersion2(ownerUserId: string, version2RunId: string): Promise<{ status: Version2Status; manifest: ChangeManifest; receipt: ValidationReceipt }> {
    const state = this.versions.get(version2RunId) ?? await this.store.get<{ ownerUserId: string; status: Version2Status; enhancementRunId: string; manifest: ChangeManifest | null; receipt: PullRequestReceipt | null }>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    if (state.status !== 'building' || !state.manifest) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Build the Version 2 manifest before validation.', 409);
    const paths = [...state.manifest.added, ...state.manifest.modified, ...state.manifest.deleted];
    if (new Set(paths).size !== paths.length) throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'The Version 2 manifest contains duplicate paths.', 409);
    const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId);
    const applied = this.versionWorkspaces.get(version2RunId);
    const validation = applied ? await this.worker.validate(this.baseline.selectedContext(ownerUserId, enhancement.baselineRunId).context, applied) : { status: 'not_available' as const, checks: [{ id: 'version2-worker', label: 'Version 2 worker validation', status: 'not_available' as const, summary: 'No isolated Version 2 workspace is available.' }] };
    const receipt: ValidationReceipt = { validationId: randomUUID(), phase: 'version_2', sourceRunId: version2RunId, status: validation.status, checks: validation.checks, baseCommit: state.manifest.baseCommit, branchName: state.manifest.targetBranch, createdAt: now() };
    state.status = validation.status === 'passed' ? 'ready_for_pr' : 'failed';
    this.versions.set(version2RunId, state);
    await this.store.save(ownerUserId, 'version_2_run', version2RunId, state);
    await this.store.save(ownerUserId, 'validation', receipt.validationId, receipt);
    return { status: state.status, manifest: state.manifest, receipt };
  }

  public async createPullRequest(ownerUserId: string, version2RunId: string, accessToken: string): Promise<PullRequestReceipt> {
    return this.withLock(`version2:${version2RunId}`, () => this.createPullRequestUnlocked(ownerUserId, version2RunId, accessToken));
  }

  private async createPullRequestUnlocked(ownerUserId: string, version2RunId: string, accessToken: string): Promise<PullRequestReceipt> {
    const state = this.versions.get(version2RunId) ?? await this.store.get<{ ownerUserId: string; status: Version2Status; enhancementRunId: string; manifest: ChangeManifest | null; receipt: PullRequestReceipt | null; operations?: ChangeOperation[] }>(ownerUserId, 'version_2_run', version2RunId);
    if (!state || state.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Version 2 run was not found.', 404);
    if (state.receipt?.status === 'created') return state.receipt;
    if (state.status !== 'ready_for_pr' || !state.manifest || !state.operations?.length || state.receipt?.status !== 'prepared') throw new WorkflowServiceError('WORKFLOW_STATE_INVALID', 'Version 2 must pass validation, preparation, and contain approved file operations before pull-request creation.', 409);
    const enhancement = await this.requireEnhancement(ownerUserId, state.enhancementRunId);
    const context = this.baseline.selectedContext(ownerUserId, enhancement.baselineRunId);
    const github = new GithubApiClient(accessToken);
    const repository = context.context.snapshot.repository;
    await github.createBranch({ owner: repository.owner, name: repository.name, branch: state.manifest.targetBranch }, state.manifest.baseCommit);
    const commitSha = await github.createCommitFromManifest({ owner: repository.owner, name: repository.name, branch: state.manifest.targetBranch, baseCommit: state.manifest.baseCommit, message: `Obsidian Version 2: ${version2RunId}`, files: state.operations.map((operation) => ({ path: operation.path, content: operation.content, delete: operation.kind === 'delete' })) });
    const created = await github.createPullRequest({ owner: repository.owner, name: repository.name, title: `Obsidian Version 2: ${version2RunId}`, body: 'Created from an approved Obsidian change manifest and validation receipt.', head: state.manifest.targetBranch, base: repository.branch });
    const receipt: PullRequestReceipt = { pullRequestId: randomUUID(), version2RunId, owner: repository.owner, repository: repository.name, branchName: state.manifest.targetBranch, title: `Obsidian Version 2: ${version2RunId}`, body: `Commit ${commitSha} was created from the approved manifest.`, url: created.url, status: 'created', createdAt: now() };
    state.receipt = receipt;
    this.versions.set(version2RunId, state);
    await this.store.save(ownerUserId, 'pull_request', receipt.pullRequestId, receipt);
    await this.store.save(ownerUserId, 'version_2_run', version2RunId, state);
    return receipt;
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

  private async requireRepair(ownerUserId: string, planId: string): Promise<RepairPlan> {
    const plan = await this.store.get<RepairPlan>(ownerUserId, 'repair_plan', planId);
    if (!plan || plan.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Repair plan was not found.', 404);
    return plan;
  }

  private async requireEnhancement(ownerUserId: string, enhancementRunId: string): Promise<EnhancementRun> {
    const run = await this.store.get<EnhancementRun>(ownerUserId, 'enhancement_run', enhancementRunId);
    if (!run || run.ownerUserId !== ownerUserId) throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Enhancement run was not found.', 404);
    return run;
  }

  private async saveRepair(plan: RepairPlan): Promise<void> { await this.store.save(plan.ownerUserId, 'repair_plan', plan.planId, plan); }
  private async saveEnhancement(run: EnhancementRun): Promise<void> { await this.store.save(run.ownerUserId, 'enhancement_run', run.enhancementRunId, run); }

  private recordEvent(sessionId: string, projectId: string, baseCommit: string, runId: string, eventType: string, summary: string, status: 'passed' | 'failed' | 'skipped' | 'unavailable', userActionRequired: boolean): void {
    const event = createSystemEvent({ eventType, sessionId, projectId, runId, baseCommit, phase: 'workflow', status, safeSummary: summary, affectedPaths: [], userActionRequired });
    this.events.push(event);
    void Promise.resolve(this.eventSink?.(event)).catch(() => undefined);
  }

  public listEvents(ownerUserId: string, runId: string): SystemEvent[] {
    return this.events.filter((event) => event.runId === runId && event.sessionId === ownerUserId).map((event) => ({ ...event, affectedPaths: [...event.affectedPaths] }));
  }
}
