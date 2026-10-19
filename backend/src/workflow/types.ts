export const workflowPolicyVersion = 'part7-10-v1';

export type ApprovalState = 'awaiting_approval' | 'approved' | 'rejected';
export type ChangeOperationKind = 'add' | 'modify' | 'delete';
export type RepairPlanStatus = 'awaiting_approval' | 'approved' | 'running' | 'blocked' | 'validated' | 'failed' | 'cancelled';
export type EnhancementRunStatus = 'analyzing' | 'awaiting_review' | 'approved' | 'running' | 'blocked' | 'validated' | 'failed' | 'cancelled';
export type Version2Status = 'queued' | 'building' | 'validating' | 'ready_for_pr' | 'failed' | 'cancelled' | 'recovery_required';
export type ValidationStatus = 'queued' | 'running' | 'passed' | 'failed' | 'not_available';
export type DeliveryStepName = 'branch' | 'commit' | 'ref' | 'pull_request';
export type DeliveryStepStatus = 'pending' | 'completed' | 'failed' | 'recovery_required';

export interface ApprovalReceipt {
  approvalId: string;
  ownerUserId: string;
  sessionId: string;
  actor: string;
  sourceId: string;
  decision: 'approved' | 'rejected';
  operationHash: string;
  previewHash: string | null;
  risk: 'low' | 'medium' | 'high';
  revision: number;
  baseSnapshot: { snapshotId: string; baseCommit: string };
  createdAt: string;
}

export interface RecommendationReviewReceipt {
  reviewId: string;
  ownerUserId: string;
  sessionId: string;
  enhancementRunId: string;
  recommendationId: string;
  action: 'viewed' | 'approved' | 'rejected' | 'excluded';
  revision: number;
  createdAt: string;
}

export interface RepairCheckpoint {
  checkpointId: string;
  planId: string;
  baselineRunId: string;
  snapshotId: string;
  baseCommit: string;
  operationHash: string;
  operations: ChangeOperation[];
  validationId: string;
  status: 'validated' | 'failed';
  createdAt: string;
  revision?: number;
  updatedAt?: string;
}

export interface WorkflowAggregate {
  workflowId: string;
  ownerUserId: string;
  sessionId?: string;
  repository?: { owner: string; name: string; branch: string };
  snapshotId?: string;
  baseCommit?: string;
  detectionRunId?: string;
  completenessRunId?: string;
  baselineRunId?: string;
  repairPlanId?: string;
  repairCheckpointId?: string | null;
  enhancementRunId?: string;
  version2RunId?: string;
  manifestId?: string | null;
  validationId?: string | null;
  deliveryId?: string | null;
  revision?: number;
  updatedAt?: string;
}

export interface ChangeOperation {
  kind: ChangeOperationKind;
  path: string;
  contentHash: string | null;
  contentBytes: number | null;
  /** Internal worker input. Public responses must remove this field. */
  content?: string;
}

export interface RepairItem {
  id: string;
  planId: string;
  sourceCheckId: string;
  category: string;
  title: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  affectedPaths: string[];
  expectedTests: string[];
  approvalState: ApprovalState;
  operations: ChangeOperation[];
  workerStatus: 'pending' | 'applied' | 'blocked';
  approvalReceipt?: ApprovalReceipt;
}

export interface RepairPlan {
  planId: string;
  baselineRunId: string;
  completenessRunId: string;
  snapshotId: string;
  baseCommit: string;
  ownerUserId: string;
  status: RepairPlanStatus;
  branchName: string | null;
  items: RepairItem[];
  validationId: string | null;
  warning: string | null;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  sessionId?: string;
  repairCheckpointId?: string | null;
}

export interface Recommendation {
  id: string;
  enhancementRunId: string;
  category: 'ui_ux' | 'architecture' | 'security' | 'performance' | 'testing' | 'documentation';
  title: string;
  currentProblem: string;
  suggestedSolution: string;
  risk: 'low' | 'medium' | 'high';
  affectedPaths: string[];
  affectedAreas: string[];
  expectedTests: string[];
  approvalState: ApprovalState;
  operations: ChangeOperation[];
  evidenceRefs?: Array<{ path: string; reason: string }>;
  affectedSymbols?: string[];
  impact?: { ui?: string; behavior?: string; api?: string; database?: string; security?: string };
  approvalReceipt?: ApprovalReceipt;
}

export interface EnhancementRun {
  enhancementRunId: string;
  baselineRunId: string;
  completenessRunId: string;
  snapshotId: string;
  baseCommit: string;
  ownerUserId: string;
  scopeMode: 'FULL' | 'EXISTING_ONLY';
  status: EnhancementRunStatus;
  recommendations: Recommendation[];
  warning: string | null;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  sessionId?: string;
  repairCheckpointId?: string | null;
}

export interface Version2State {
  version2RunId: string;
  ownerUserId: string;
  status: Version2Status;
  enhancementRunId: string;
  sessionId?: string;
  manifest: ChangeManifest | null;
  receipt: PullRequestReceipt | null;
  operations?: ChangeOperation[];
  snapshotId?: string;
  branchName?: string;
  revision?: number;
  warning?: string;
  deliveryStep?: 'prepared' | 'branch_created' | 'commit_created' | 'pr_created' | 'recovery_required';
  commitSha?: string | null;
  deliveryReceipts?: DeliveryStepReceipt[];
  previewAcknowledgedAt?: string;
  previewAcknowledgedHash?: string;
}

export interface ChangeManifest {
  manifestId: string;
  version2RunId: string;
  baseCommit: string;
  targetBranch: string;
  added: string[];
  modified: string[];
  deleted: string[];
  approvedRepairIds: string[];
  approvedRecommendationIds: string[];
  rollbackRef: string | null;
  diffHash: string;
  diffSummary: string[];
  generatedAt: string;
  snapshotId?: string;
  revision?: number;
  operationHash?: string;
  diffEntries?: Array<{
    path: string;
    kind: ChangeOperationKind;
    beforeSha256: string | null;
    afterSha256: string | null;
    beforeBytes: number;
    afterBytes: number;
    patch: string | null;
  }>;
}

export interface DeliveryStepReceipt {
  step: DeliveryStepName;
  status: DeliveryStepStatus;
  ownerUserId: string;
  version2RunId: string;
  baseCommit: string;
  manifestHash: string;
  branchName: string;
  remoteId?: string | null;
  responseHash?: string | null;
  commitSha?: string | null;
  errorCode?: string | null;
  createdAt: string;
  updatedAt: string;
  revision?: number;
}

export interface ValidationReceipt {
  validationId: string;
  phase: 'repair' | 'version_2';
  sourceRunId: string;
  status: ValidationStatus;
  checks: Array<{ id: string; label: string; status: ValidationStatus; summary: string }>;
  baseCommit: string;
  branchName: string | null;
  createdAt: string;
  manifestHash?: string;
  revision?: number;
}

export interface PullRequestReceipt {
  pullRequestId: string;
  version2RunId: string;
  owner: string;
  repository: string;
  branchName: string;
  title: string;
  body: string;
  url: string | null;
  status: 'prepared' | 'created' | 'failed' | 'recovery_required';
  createdAt: string;
  commitSha?: string | null;
  manifestHash?: string | null;
  revision?: number;
  deliveryStep?: 'prepared' | 'branch_created' | 'commit_created' | 'pr_created' | 'conflicted' | 'recovery_required';
}

export function publicOperation(operation: ChangeOperation): Omit<ChangeOperation, 'content'> {
  const { content: _content, ...safe } = operation;
  return safe;
}

export function publicRepairPlan(plan: RepairPlan): RepairPlan {
  return {
    ...plan,
    items: plan.items.map((item) => ({ ...item, affectedPaths: [...item.affectedPaths], expectedTests: [...item.expectedTests], operations: item.operations.map(publicOperation), approvalReceipt: item.approvalReceipt ? { ...item.approvalReceipt } : undefined })),
  };
}

export function publicEnhancementRun(run: EnhancementRun): EnhancementRun {
  return {
    ...run,
    recommendations: run.recommendations.map((recommendation) => ({ ...recommendation, affectedPaths: [...recommendation.affectedPaths], affectedAreas: [...recommendation.affectedAreas], expectedTests: [...recommendation.expectedTests], operations: recommendation.operations.map(publicOperation), evidenceRefs: recommendation.evidenceRefs ? recommendation.evidenceRefs.map((ref) => ({ ...ref })) : undefined, affectedSymbols: recommendation.affectedSymbols ? [...recommendation.affectedSymbols] : undefined, impact: recommendation.impact ? { ...recommendation.impact } : undefined, approvalReceipt: recommendation.approvalReceipt ? { ...recommendation.approvalReceipt } : undefined })),
  };
}
