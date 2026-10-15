export const completenessPolicyVersion = 'part5-v1';

export type AreaStatus =
  | 'working'
  | 'working_with_issues'
  | 'broken'
  | 'partial'
  | 'placeholder'
  | 'not_implemented'
  | 'not_available';

export type FindingKind =
  | 'todo-marker'
  | 'empty-file'
  | 'placeholder-marker'
  | 'dummy-data'
  | 'unimplemented-marker'
  | 'missing-route'
  | 'broken-import'
  | 'missing-configuration'
  | 'missing-tests';

export type CompletenessRunStatus =
  | 'queued'
  | 'extracting'
  | 'scanning'
  | 'awaiting_scope'
  | 'scope_selected'
  | 'failed'
  | 'cancelled';

export type ScopeMode = 'FULL' | 'EXISTING_ONLY';

export interface CompletenessEvidenceRef {
  path: string;
  line?: number;
  reason: string;
  kind: 'marker' | 'empty-file' | 'configuration' | 'import' | 'route' | 'metadata';
}

export interface CompletenessFinding {
  id: string;
  kind: FindingKind;
  areaId: string;
  status: AreaStatus;
  summary: string;
  evidenceRefs: CompletenessEvidenceRef[];
  affectedPaths: string[];
}

export interface CompletenessArea {
  id: string;
  name: string;
  status: AreaStatus;
  summary: string;
  findingIds: string[];
  affectedPaths: string[];
}

export interface CompletenessProgress {
  stage: string;
  files: number;
  bytes: number;
  findings: number;
}

export interface CompletenessResult {
  runId: string;
  detectionRunId: string;
  snapshotId: string;
  baseCommit: string;
  archiveSha256: string;
  status: CompletenessRunStatus;
  projectStatus: AreaStatus | null;
  areas: CompletenessArea[];
  findings: CompletenessFinding[];
  fileCount: number;
  scannedFileCount: number;
  scannedBytes: number;
  limited: boolean;
  warning: string | null;
  policyVersion: string;
  progress: CompletenessProgress;
  createdAt: string;
  scopeMode?: ScopeMode;
  nextPhase?: 'baseline_testing';
  error?: { code: string; message: string };
}
