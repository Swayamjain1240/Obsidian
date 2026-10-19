export interface IntakeStatus {
  github: 'implemented';
  repositoryDiscovery: 'implemented';
  repositorySnapshot: 'implemented';
  stackDetection: 'implemented';
  completeness: 'implemented';
  baselineChecks: 'implemented';
  aiAnalysis: 'not_available';
}

export interface AuthUser {
  id: number;
  login: string;
}

export interface AuthMeResponse {
  user: AuthUser | null;
  configured: boolean;
  requestId: string;
}

export interface RepositorySummary {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  updated_at: string;
}

export interface SnapshotResult {
  intakeId: string;
  snapshot: {
    snapshotId: string;
    archiveSha256: string;
    byteLength: number;
    capturedAt: string;
    immutable: true;
    repository: {
      owner: string;
      name: string;
      branch: string;
      commitSha: string;
    };
  };
  snapshotHandle: string;
  analysisStatus: 'not_started';
  requestId?: string;
}

export type DetectionStatus =
  | 'queued'
  | 'archive_verified'
  | 'extracting'
  | 'manifest_indexed'
  | 'stack_rules_applied'
  | 'evidence_finalized'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export type EvidenceStrength = 'strong' | 'mixed' | 'weak' | 'none';

export interface EvidenceRef {
  path: string;
  reason: string;
  kind: 'manifest' | 'configuration' | 'source-extension' | 'dependency-marker';
}

export interface DetectionCandidate {
  id: string;
  language: string | null;
  frameworks: string[];
  packageManager: string | null;
  evidenceStrength: EvidenceStrength;
  evidenceRefs: EvidenceRef[];
  adapterAvailable: boolean;
}

export interface DetectionProgress {
  stage: string;
  files: number;
  bytes: number;
}

export interface DetectionResult {
  runId: string;
  snapshotId: string;
  baseCommit: string;
  archiveSha256: string;
  status: DetectionStatus;
  candidates: DetectionCandidate[];
  primaryCandidateId: string | null;
  unknownReason: string | null;
  fileCount: number;
  evidenceFileCount: number;
  policyVersion: string;
  progress: DetectionProgress;
  createdAt: string;
  confirmedCandidateIds?: string[];
  analysisOnly?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface DetectionResponse {
  run: DetectionResult;
  requestId: string;
}

export type CompletenessRunStatus = 'queued' | 'extracting' | 'scanning' | 'awaiting_scope' | 'scope_selected' | 'failed' | 'cancelled';
export type CompletenessAreaStatus = 'working' | 'working_with_issues' | 'broken' | 'partial' | 'placeholder' | 'not_implemented' | 'not_available';
export type ScopeMode = 'FULL' | 'EXISTING_ONLY';

export interface CompletenessEvidenceRef {
  path: string;
  line?: number;
  reason: string;
  kind: 'marker' | 'empty-file' | 'configuration' | 'import' | 'route' | 'metadata';
}

export interface CompletenessFinding {
  id: string;
  kind: string;
  areaId: string;
  status: CompletenessAreaStatus;
  summary: string;
  evidenceRefs: CompletenessEvidenceRef[];
  affectedPaths: string[];
}

export interface CompletenessArea {
  id: string;
  name: string;
  status: CompletenessAreaStatus;
  summary: string;
  findingIds: string[];
  affectedPaths: string[];
}

export interface CompletenessResult {
  runId: string;
  detectionRunId: string;
  snapshotId: string;
  baseCommit: string;
  archiveSha256: string;
  status: CompletenessRunStatus;
  projectStatus: CompletenessAreaStatus | null;
  areas: CompletenessArea[];
  findings: CompletenessFinding[];
  fileCount: number;
  scannedFileCount: number;
  scannedBytes: number;
  limited: boolean;
  warning: string | null;
  policyVersion: string;
  progress: { stage: string; files: number; bytes: number; findings: number };
  createdAt: string;
  scopeMode?: ScopeMode;
  nextPhase?: 'baseline_testing';
  error?: { code: string; message: string };
}

export interface CompletenessResponse {
  run: CompletenessResult;
  requestId: string;
}

export type BaselineCheckCategory = 'dependencies' | 'build' | 'lint' | 'typecheck' | 'unit' | 'integration' | 'functional' | 'runtime' | 'security';
export type BaselineCheckStatus = 'queued' | 'running' | 'passed' | 'failed' | 'not_available' | 'skipped' | 'timed_out' | 'cancelled';
export type BaselineRunStatus = 'queued' | 'planning' | 'running' | 'passed' | 'failed' | 'partial' | 'cancelled';

export interface BaselineEvidenceRef {
  path?: string;
  reason: string;
  kind: 'manifest' | 'configuration' | 'command' | 'result';
}

export interface BaselineCheckResult {
  id: string;
  category: BaselineCheckCategory;
  label: string;
  status: BaselineCheckStatus;
  summary: string;
  commandLabel: string | null;
  exitCode: number | null;
  durationMs: number | null;
  evidenceRefs: BaselineEvidenceRef[];
}

export interface BaselineResult {
  runId: string;
  completenessRunId: string;
  snapshotId: string;
  baseCommit: string;
  archiveSha256: string;
  scopeMode: ScopeMode;
  status: BaselineRunStatus;
  checks: BaselineCheckResult[];
  passedCount: number;
  failedCount: number;
  notAvailableCount: number;
  warning: string | null;
  policyVersion: string;
  progress: { stage: string; checksCompleted: number; checksTotal: number; passed: number; failed: number; notAvailable: number };
  createdAt: string;
  nextPhase?: 'repair_review' | 'enhancement_analysis';
  error?: { code: string; message: string };
}

export interface BaselineResponse {
  run: BaselineResult;
  requestId: string;
}

export type WorkflowApprovalState = 'awaiting_approval' | 'approved' | 'rejected';
export type WorkflowPlanStatus = 'awaiting_approval' | 'approved' | 'running' | 'blocked' | 'validated' | 'failed' | 'cancelled';
export type EnhancementRunStatus = 'analyzing' | 'awaiting_review' | 'approved' | 'running' | 'blocked' | 'validated' | 'failed' | 'cancelled';

export interface WorkflowOperation {
  kind: 'add' | 'modify' | 'delete';
  path: string;
  contentHash: string | null;
  contentBytes: number | null;
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
  approvalState: WorkflowApprovalState;
  operations: WorkflowOperation[];
  workerStatus: 'pending' | 'applied' | 'blocked';
}

export interface RepairPlan {
  planId: string;
  baselineRunId: string;
  completenessRunId: string;
  snapshotId: string;
  baseCommit: string;
  ownerUserId: string;
  status: WorkflowPlanStatus;
  branchName: string | null;
  items: RepairItem[];
  validationId: string | null;
  warning: string | null;
  createdAt: string;
  updatedAt: string;
  revision?: number;
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
  approvalState: WorkflowApprovalState;
  operations: WorkflowOperation[];
  evidenceRefs?: Array<{ path: string; reason: string }>;
  affectedSymbols?: string[];
  impact?: { ui?: string; behavior?: string; api?: string; database?: string; security?: string };
}

export interface EnhancementRun {
  enhancementRunId: string;
  baselineRunId: string;
  completenessRunId: string;
  snapshotId: string;
  baseCommit: string;
  ownerUserId: string;
  scopeMode: ScopeMode;
  status: EnhancementRunStatus;
  recommendations: Recommendation[];
  warning: string | null;
  createdAt: string;
  updatedAt: string;
  revision?: number;
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
  revision?: number;
}

export interface Version2State {
  version2RunId: string;
  ownerUserId: string;
  status: 'queued' | 'building' | 'validating' | 'ready_for_pr' | 'failed' | 'cancelled' | 'recovery_required';
  enhancementRunId: string;
  manifest: ChangeManifest | null;
  receipt: PullRequestReceipt | null;
  revision?: number;
  warning?: string;
  deliveryStep?: 'prepared' | 'branch_created' | 'commit_created' | 'pr_created' | 'recovery_required';
  deliveryReceipts?: Array<{ step: 'branch' | 'commit' | 'ref' | 'pull_request'; status: 'pending' | 'completed' | 'failed' | 'recovery_required'; commitSha?: string | null; errorCode?: string | null; updatedAt: string }>;
  previewAcknowledgedAt?: string;
  previewAcknowledgedHash?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(message: string, status: number, code: string | null = null, requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
  requestId?: string;
}

export const SESSION_EXPIRED_EVENT = 'obsidian:session-expired';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');

function apiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!API_BASE_URL || typeof input !== 'string' || !input.startsWith('/')) return input;
  return `${API_BASE_URL}${input}`;
}

function checkAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function requestJson<T>(input: RequestInfo | URL, init: RequestInit = {}, allowEmpty = false): Promise<T> {
  checkAborted(init.signal);
  const response = await fetch(apiUrl(input), {
    credentials: API_BASE_URL ? 'include' : 'same-origin',
    ...init,
  });
  const payload = await readJson<T & ErrorPayload>(response);
  checkAborted(init.signal);

  if (!response.ok) {
    const errorPayload = payload as ErrorPayload | null;
    const error = errorPayload?.error;
    const fallback = response.status === 401 ? 'GitHub sign-in is required.' : 'The request could not be completed.';
    const failure = new ApiError(
      error?.message ?? fallback,
      response.status,
      error?.code ?? null,
      error?.requestId ?? errorPayload?.requestId ?? response.headers?.get?.('x-request-id') ?? null,
    );
    if (response.status === 401 && input !== '/auth/me') {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: failure.message }));
    }
    throw failure;
  }

  if (payload === null && !allowEmpty) {
    throw new ApiError('The backend returned an empty response.', response.status);
  }

  return payload as T;
}

export async function fetchAuthMe(signal?: AbortSignal): Promise<AuthMeResponse> {
  return requestJson<AuthMeResponse>('/auth/me', { signal });
}

export async function logout(signal?: AbortSignal): Promise<void> {
  await requestJson<unknown>('/auth/logout', { method: 'POST', signal }, true);
}

export async function fetchIntakeStatus(signal?: AbortSignal): Promise<IntakeStatus> {
  try {
    const payload = await requestJson<{ status: IntakeStatus }>('/api/v1/status', { signal });
    return payload.status;
  } catch (reason: unknown) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason;
    throw new Error('Backend status is unavailable.');
  }
}

export async function fetchRepositories(
  page = 1,
  perPage = 5,
  signal?: AbortSignal,
): Promise<{ repositories: RepositorySummary[]; page: number; perPage: number; requestId?: string }> {
  const payload = await requestJson<{
    repositories: RepositorySummary[];
    pagination: { page: number; perPage: number };
    requestId?: string;
  }>(`/api/v1/github/repositories?page=${page}&perPage=${perPage}`, { signal });

  return {
    repositories: payload.repositories,
    page: payload.pagination.page,
    perPage: payload.pagination.perPage,
    requestId: payload.requestId,
  };
}

export async function selectRepository(repository: RepositorySummary, signal?: AbortSignal, branch = repository.default_branch): Promise<{ repository: RepositorySummary; branch: string; selectedAt: string; requestId?: string }> {
  const [owner, ...nameParts] = repository.full_name.split('/');
  const name = nameParts.join('/');
  const payload = await requestJson<{ repository: RepositorySummary; branch?: string; selectedAt: string; requestId?: string }>('/api/v1/github/repositories/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositoryId: repository.id, owner, name, branch }),
    signal,
  });
  return { ...payload, branch: payload.branch ?? branch };
}

export async function createRepositorySnapshot(
  repository: { owner: string; name: string; branch: string },
  signal?: AbortSignal,
): Promise<SnapshotResult> {
  const payload = await requestJson<{ intake: SnapshotResult; requestId: string }>('/api/v1/intake/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(repository),
    signal,
  });

  return { ...payload.intake, requestId: payload.requestId };
}

export async function startDetection(snapshotHandle: string, signal?: AbortSignal): Promise<DetectionResponse> {
  return requestJson<DetectionResponse>('/api/v1/intake/detections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotHandle }),
    signal,
  });
}

export async function getDetection(runId: string, signal?: AbortSignal): Promise<DetectionResponse> {
  return requestJson<DetectionResponse>(`/api/v1/intake/detections/${encodeURIComponent(runId)}`, { signal });
}

export async function confirmDetection(
  runId: string,
  candidateIds: string[],
  notDetected: boolean,
  signal?: AbortSignal,
): Promise<DetectionResponse> {
  return requestJson<DetectionResponse>(`/api/v1/intake/detections/${encodeURIComponent(runId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateIds, notDetected }),
    signal,
  });
}

export async function rescanDetection(runId: string, signal?: AbortSignal): Promise<DetectionResponse> {
  return requestJson<DetectionResponse>(`/api/v1/intake/detections/${encodeURIComponent(runId)}/rescan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal,
  });
}

export async function cancelDetection(runId: string, signal?: AbortSignal): Promise<DetectionResponse> {
  return requestJson<DetectionResponse>(`/api/v1/intake/detections/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal,
  });
}

export async function startCompleteness(detectionRunId: string, signal?: AbortSignal): Promise<CompletenessResponse> {
  return requestJson<CompletenessResponse>('/api/v1/intake/completeness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ detectionRunId }),
    signal,
  });
}

export async function getCompleteness(runId: string, signal?: AbortSignal): Promise<CompletenessResponse> {
  return requestJson<CompletenessResponse>(`/api/v1/intake/completeness/${encodeURIComponent(runId)}`, { signal });
}

export async function selectCompletenessScope(runId: string, mode: ScopeMode, signal?: AbortSignal): Promise<CompletenessResponse> {
  return requestJson<CompletenessResponse>(`/api/v1/intake/completeness/${encodeURIComponent(runId)}/scope`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    signal,
  });
}

export async function cancelCompleteness(runId: string, signal?: AbortSignal): Promise<CompletenessResponse> {
  return requestJson<CompletenessResponse>(`/api/v1/intake/completeness/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal,
  });
}

export async function startBaseline(completenessRunId: string, signal?: AbortSignal): Promise<BaselineResponse> {
  return requestJson<BaselineResponse>('/api/v1/intake/baseline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completenessRunId }),
    signal,
  });
}

export async function getBaseline(runId: string, signal?: AbortSignal): Promise<BaselineResponse> {
  return requestJson<BaselineResponse>(`/api/v1/intake/baseline/${encodeURIComponent(runId)}`, { signal });
}

export async function cancelBaseline(runId: string, signal?: AbortSignal): Promise<BaselineResponse> {
  return requestJson<BaselineResponse>(`/api/v1/intake/baseline/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal,
  });
}

export type WorkflowOperationInput = { kind: 'add' | 'modify' | 'delete'; path: string; content?: string };

export interface WorkflowMutationContext {
  revision: number;
  idempotencyKey?: string;
  previewHash?: string;
  highRiskConfirmed?: boolean;
}

function workflowHeaders(mutation: WorkflowMutationContext): Record<string, string> {
  const key = mutation.idempotencyKey ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Workflow-Revision': String(mutation.revision), 'Idempotency-Key': key };
  if (mutation.previewHash) headers['X-Workflow-Preview-Hash'] = mutation.previewHash;
  return headers;
}

export async function createRepairPlan(baselineRunId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 0 }): Promise<{ plan: RepairPlan; requestId: string }> {
  return requestJson('/api/v1/workflow/repairs', { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({ baselineRunId }), signal });
}

export async function getRepairPlan(planId: string, signal?: AbortSignal): Promise<{ plan: RepairPlan; requestId: string }> {
  return requestJson(`/api/v1/workflow/repairs/${encodeURIComponent(planId)}`, { signal });
}

export async function approveRepairItem(planId: string, itemId: string, approved: boolean, operations?: WorkflowOperationInput[], signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ plan: RepairPlan; requestId: string }> {
  return requestJson(`/api/v1/workflow/repairs/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/approval`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({ approved, operations, previewHash: mutation.previewHash, highRiskConfirmed: mutation.highRiskConfirmed }), signal });
}

export async function startRepair(planId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ plan: RepairPlan; requestId: string }> {
  return requestJson(`/api/v1/workflow/repairs/${encodeURIComponent(planId)}/start`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function validateRepair(planId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ plan: RepairPlan; receipt: { validationId: string; status: string; checks: Array<{ id: string; label: string; status: string; summary: string }> }; requestId: string }> {
  return requestJson(`/api/v1/workflow/repairs/${encodeURIComponent(planId)}/validate`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function publishRepairBranch(planId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ plan: RepairPlan; requestId: string }> {
  return requestJson(`/api/v1/workflow/repairs/${encodeURIComponent(planId)}/publish`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function createEnhancementRun(baselineRunId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 0 }): Promise<{ run: EnhancementRun; requestId: string }> {
  return requestJson('/api/v1/workflow/enhancements', { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({ baselineRunId }), signal });
}

export async function getEnhancementRun(runId: string, signal?: AbortSignal): Promise<{ run: EnhancementRun; requestId: string }> {
  return requestJson(`/api/v1/workflow/enhancements/${encodeURIComponent(runId)}`, { signal });
}

export async function listRecommendations(runId: string, page = 1, perPage = 5, signal?: AbortSignal): Promise<{ recommendations: Recommendation[]; page: number; perPage: number; total: number; revision: number; requestId: string }> {
  return requestJson(`/api/v1/workflow/enhancements/${encodeURIComponent(runId)}/recommendations?page=${page}&perPage=${perPage}`, { signal });
}

export async function getRecommendation(runId: string, recommendationId: string, signal?: AbortSignal): Promise<{ recommendation: Recommendation; requestId: string }> {
  return requestJson(`/api/v1/workflow/enhancements/${encodeURIComponent(runId)}/recommendations/${encodeURIComponent(recommendationId)}`, { signal });
}

export async function approveRecommendation(runId: string, recommendationId: string, approved: boolean, operations?: WorkflowOperationInput[], signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ run: EnhancementRun; requestId: string }> {
  return requestJson(`/api/v1/workflow/enhancements/${encodeURIComponent(runId)}/recommendations/${encodeURIComponent(recommendationId)}/approval`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({ approved, operations, previewHash: mutation.previewHash, highRiskConfirmed: mutation.highRiskConfirmed }), signal });
}

export async function startVersion2(runId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ enhancement: EnhancementRun; version2RunId: string; status: string; manifest: ChangeManifest | null; requestId: string }> {
  return requestJson(`/api/v1/workflow/enhancements/${encodeURIComponent(runId)}/version2`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function preparePullRequest(version2RunId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ pullRequest: PullRequestReceipt; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}/pull-request`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function createPullRequest(version2RunId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ pullRequest: PullRequestReceipt; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}/pull-request/create`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function validateVersion2(version2RunId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ status: string; manifest: ChangeManifest; receipt: { validationId: string; status: string; revision?: number }; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}/validate`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function retryVersion2(version2RunId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ version2: { status: Version2State['status']; manifest: ChangeManifest | null; revision: number; warning?: string }; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}/retry`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export async function getVersion2State(version2RunId: string, signal?: AbortSignal): Promise<{ version2: Version2State; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}`, { signal });
}

export async function getVersion2Diff(version2RunId: string, signal?: AbortSignal): Promise<{ diff: { version2RunId: string; manifestId: string; diffHash: string; entries: Array<{ path: string; kind: 'add' | 'modify' | 'delete'; beforeSha256: string | null; afterSha256: string | null; beforeBytes: number; afterBytes: number; patch: string | null }> }; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}/diff`, { signal });
}

export async function acknowledgeVersion2Diff(version2RunId: string, previewHash: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ version2: Version2State; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}/preview/acknowledge`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({ previewHash }), signal });
}

export async function cancelVersion2(version2RunId: string, signal?: AbortSignal, mutation: WorkflowMutationContext = { revision: 1 }): Promise<{ version2: { status: Version2State['status']; revision: number }; requestId: string }> {
  return requestJson(`/api/v1/workflow/version2/${encodeURIComponent(version2RunId)}/cancel`, { method: 'POST', headers: workflowHeaders(mutation), body: JSON.stringify({}), signal });
}

export function isTerminalDetectionStatus(status: DetectionStatus): boolean {
  return status === 'awaiting_confirmation' || status === 'confirmed' || status === 'failed' || status === 'cancelled';
}

export function isTerminalCompletenessStatus(status: CompletenessRunStatus): boolean {
  return status === 'scope_selected' || status === 'failed' || status === 'cancelled';
}

export function isTerminalBaselineStatus(status: BaselineRunStatus): boolean {
  return status === 'passed' || status === 'failed' || status === 'partial' || status === 'cancelled';
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The request was aborted.', 'AbortError'));
      return;
    }

    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollDetection(
  runId: string,
  options: {
    signal: AbortSignal;
    intervalMs?: number;
    onUpdate?: (run: DetectionResult) => void;
  },
): Promise<DetectionResponse> {
  const intervalMs = options.intervalMs ?? 750;
  let response = await getDetection(runId, options.signal);
  checkAborted(options.signal);
  if (response.run.runId !== runId) throw new Error('The backend returned a different detection run. Reload this run to continue.');
  options.onUpdate?.(response.run);

  while (!isTerminalDetectionStatus(response.run.status)) {
    await wait(intervalMs, options.signal);
    response = await getDetection(runId, options.signal);
    checkAborted(options.signal);
    if (response.run.runId !== runId) throw new Error('The backend returned a different detection run. Reload this run to continue.');
    options.onUpdate?.(response.run);
  }

  return response;
}

export async function pollCompleteness(
  runId: string,
  options: { signal: AbortSignal; intervalMs?: number; onUpdate?: (run: CompletenessResult) => void },
): Promise<CompletenessResponse> {
  const intervalMs = options.intervalMs ?? 750;
  let response = await getCompleteness(runId, options.signal);
  checkAborted(options.signal);
  if (response.run.runId !== runId) throw new Error('The backend returned a different completeness run. Reload this run to continue.');
  options.onUpdate?.(response.run);
  while (!isTerminalCompletenessStatus(response.run.status) && response.run.status !== 'awaiting_scope') {
    await wait(intervalMs, options.signal);
    response = await getCompleteness(runId, options.signal);
    checkAborted(options.signal);
    if (response.run.runId !== runId) throw new Error('The backend returned a different completeness run. Reload this run to continue.');
    options.onUpdate?.(response.run);
  }
  return response;
}

export async function pollBaseline(
  runId: string,
  options: { signal: AbortSignal; intervalMs?: number; onUpdate?: (run: BaselineResult) => void },
): Promise<BaselineResponse> {
  const intervalMs = options.intervalMs ?? 750;
  let response = await getBaseline(runId, options.signal);
  checkAborted(options.signal);
  if (response.run.runId !== runId) throw new Error('The backend returned a different baseline run. Reload this run to continue.');
  options.onUpdate?.(response.run);
  while (!isTerminalBaselineStatus(response.run.status)) {
    await wait(intervalMs, options.signal);
    response = await getBaseline(runId, options.signal);
    checkAborted(options.signal);
    if (response.run.runId !== runId) throw new Error('The backend returned a different baseline run. Reload this run to continue.');
    options.onUpdate?.(response.run);
  }
  return response;
}
