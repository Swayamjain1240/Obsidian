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
  progress: {
    stage: string;
    files: number;
    bytes: number;
  };
  createdAt: string;
  confirmedCandidateIds?: string[];
  analysisOnly?: boolean;
  error?: {
    code: string;
    message: string;
  };
}
