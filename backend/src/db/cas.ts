export class DatabaseRevisionConflictError extends Error {
  public constructor(
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(`Database revision ${actualRevision} does not match expected revision ${expectedRevision}.`);
    this.name = 'DatabaseRevisionConflictError';
  }
}

export function revisionOf(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  const revision = (value as { revision?: unknown }).revision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : 0;
}

export function nextRevision(value: unknown): number {
  return revisionOf(value) + 1;
}

export function isDuplicateKeyError(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && (reason as { code?: unknown }).code === 11000;
}
