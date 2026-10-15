export interface ExtractionPolicy {
  maxExtractedBytes: number;
  maxFiles: number;
  maxDirectories: number;
  maxSingleFileBytes: number;
  maxPathLength: number;
  timeoutMs: number;
}

export type ExtractionStatus = 'completed';

export interface ExtractionRecord {
  snapshotId: string;
  archiveSha256: string;
  extractionPolicyVersion: string;
  extractedFileCount: number;
  extractedDirectoryCount: number;
  extractedBytes: number;
  fileManifestSha256: string;
  status: ExtractionStatus;
  capturedAt: string;
  workspacePath: string;
  manifestPath: string;
}

export const extractionPolicyVersion = 'part4-v1';
