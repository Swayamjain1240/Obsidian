import type { ChangeOperationKind } from './types.js';

export interface DiffEntry {
  path: string;
  kind: ChangeOperationKind;
  beforeSha256: string | null;
  afterSha256: string | null;
  beforeBytes: number;
  afterBytes: number;
  patch: string | null;
}
