export interface IntakeStatus {
  github: 'implemented';
  repositoryDiscovery: 'implemented';
  repositorySnapshot: 'implemented';
  stackDetection: 'implemented';
  baselineChecks: 'not_implemented';
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
  const response = await fetch(input, {
    credentials: 'same-origin',
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

export function isTerminalDetectionStatus(status: DetectionStatus): boolean {
  return status === 'awaiting_confirmation' || status === 'confirmed' || status === 'failed' || status === 'cancelled';
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
