import type { ChangeOperation, ChangeManifest, Recommendation, RepairItem } from './types.js';
import { operationHash } from './operation-policy.js';

export function mergeManifestOperations(repairItems: readonly RepairItem[], recommendations: readonly Recommendation[]): ChangeOperation[] {
  const output: ChangeOperation[] = [];
  const byPath = new Map<string, ChangeOperation>();
  for (const operation of [...repairItems.flatMap((item) => item.operations), ...recommendations.flatMap((item) => item.operations)]) {
    const normalizedPath = operation.path.normalize('NFKC').toLowerCase();
    const current = byPath.get(normalizedPath);
    if (current && (current.kind !== operation.kind || current.contentHash !== operation.contentHash)) throw new Error(`Conflicting approved operations target ${operation.path}.`);
    if (!current) { byPath.set(normalizedPath, operation); output.push(operation); }
  }
  return output;
}

export function manifestOperationHash(manifest: ChangeManifest, operations: readonly ChangeOperation[]): string {
  return operationHash(operations.map((operation) => ({ ...operation, content: undefined })));
}
