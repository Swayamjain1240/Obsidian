import { createHash } from 'node:crypto';

export interface Revisioned {
  revision?: number;
  updatedAt?: string;
}

export class RevisionConflictError extends Error {
  public constructor(public readonly expected: number, public readonly actual: number) {
    super(`Workflow state revision ${actual} does not match expected revision ${expected}.`);
    this.name = 'RevisionConflictError';
  }
}

export function currentRevision(value: Revisioned | null | undefined): number {
  return Number.isSafeInteger(value?.revision) && (value?.revision ?? 0) >= 0 ? value!.revision! : 0;
}

export function nextRevision(value: Revisioned): number {
  const revision = currentRevision(value);
  if (revision >= Number.MAX_SAFE_INTEGER) throw new Error('Workflow revision limit was exceeded.');
  return revision + 1;
}

export function assertRevision(value: Revisioned, expectedRevision?: number): number {
  const actual = currentRevision(value);
  if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError(expectedRevision, actual);
  return actual;
}

export function operationDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
