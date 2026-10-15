export const baselinePolicyVersion = 'part6-v1';

export type BaselineCheckCategory =
  | 'dependencies'
  | 'build'
  | 'lint'
  | 'typecheck'
  | 'unit'
  | 'integration'
  | 'functional'
  | 'runtime'
  | 'security';

export type BaselineCheckStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'not_available'
  | 'skipped'
  | 'timed_out'
  | 'cancelled';

export type BaselineRunStatus = 'queued' | 'planning' | 'running' | 'passed' | 'failed' | 'partial' | 'cancelled';
export type BaselineNextPhase = 'repair_review' | 'enhancement_analysis';

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

export interface BaselineProgress {
  stage: string;
  checksCompleted: number;
  checksTotal: number;
  passed: number;
  failed: number;
  notAvailable: number;
}

export interface BaselineResult {
  runId: string;
  completenessRunId: string;
  snapshotId: string;
  baseCommit: string;
  archiveSha256: string;
  scopeMode: 'FULL' | 'EXISTING_ONLY';
  status: BaselineRunStatus;
  checks: BaselineCheckResult[];
  passedCount: number;
  failedCount: number;
  notAvailableCount: number;
  warning: string | null;
  policyVersion: string;
  progress: BaselineProgress;
  createdAt: string;
  nextPhase?: BaselineNextPhase;
  error?: { code: string; message: string };
}

export function isTerminalBaselineStatus(status: BaselineRunStatus): boolean {
  return status === 'passed' || status === 'failed' || status === 'partial' || status === 'cancelled';
}

export function isTerminalBaselineCheckStatus(status: BaselineCheckStatus): boolean {
  return status === 'passed'
    || status === 'failed'
    || status === 'not_available'
    || status === 'skipped'
    || status === 'timed_out'
    || status === 'cancelled';
}
