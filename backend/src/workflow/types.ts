export const workflowPolicyVersion = 'part7-10-v1';

export type ApprovalState = 'awaiting_approval' | 'approved' | 'rejected';
export type ChangeOperationKind = 'add' | 'modify' | 'delete';
export type RepairPlanStatus = 'awaiting_approval' | 'approved' | 'running' | 'blocked' | 'validated' | 'failed' | 'cancelled';
export type EnhancementRunStatus = 'analyzing' | 'awaiting_review' | 'approved' | 'running' | 'blocked' | 'validated' | 'failed' | 'cancelled';
export type Version2Status = 'queued' | 'building' | 'validating' | 'ready_for_pr' | 'failed' | 'cancelled';
export type ValidationStatus = 'queued' | 'running' | 'passed' | 'failed' | 'not_available';

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
  status: 'prepared' | 'created' | 'failed';
  createdAt: string;
}

export function publicOperation(operation: ChangeOperation): Omit<ChangeOperation, 'content'> {
  const { content: _content, ...safe } = operation;
  return safe;
}

export function publicRepairPlan(plan: RepairPlan): RepairPlan {
  return {
    ...plan,
    items: plan.items.map((item) => ({ ...item, affectedPaths: [...item.affectedPaths], expectedTests: [...item.expectedTests], operations: item.operations.map(publicOperation) })),
  };
}

export function publicEnhancementRun(run: EnhancementRun): EnhancementRun {
  return {
    ...run,
    recommendations: run.recommendations.map((recommendation) => ({ ...recommendation, affectedPaths: [...recommendation.affectedPaths], affectedAreas: [...recommendation.affectedAreas], expectedTests: [...recommendation.expectedTests], operations: recommendation.operations.map(publicOperation) })),
  };
}
