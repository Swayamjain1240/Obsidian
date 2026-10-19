import { createHash } from 'node:crypto';

import type { ChangeOperation, ChangeOperationKind } from './types.js';

export interface OperationPolicyInput {
  kind: ChangeOperationKind;
  path: string;
  content?: string;
}

export class OperationPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OperationPolicyError';
  }
}

export function safeOperationPath(value: string): boolean {
  return value.length > 0
    && value.length <= 1024
    && !value.includes('\0')
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function normalizeOperations(input: readonly OperationPolicyInput[] | undefined, maximum = 100): ChangeOperation[] {
  if (!input) return [];
  if (input.length > maximum) throw new OperationPolicyError(`A workflow approval can contain at most ${maximum} file operations.`);
  const seen = new Set<string>();
  return input.map((operation) => {
    if (!safeOperationPath(operation.path)) throw new OperationPolicyError('A workflow operation contains an unsafe path.');
    const folded = operation.path.normalize('NFKC').toLowerCase();
    if (seen.has(folded)) throw new OperationPolicyError('A workflow approval contains duplicate or colliding paths.');
    seen.add(folded);
    if (operation.kind !== 'delete' && (typeof operation.content !== 'string' || Buffer.byteLength(operation.content, 'utf8') > 1_048_576)) throw new OperationPolicyError('Added or modified files must include at most 1 MiB of text content.');
    if (operation.kind === 'delete' && operation.content !== undefined) throw new OperationPolicyError('Delete operations cannot include file content.');
    const contentHash = operation.content === undefined ? null : createHash('sha256').update(operation.content).digest('hex');
    return { kind: operation.kind, path: operation.path, contentHash, contentBytes: operation.content === undefined ? null : Buffer.byteLength(operation.content, 'utf8'), content: operation.content };
  });
}

export function operationHash(operations: readonly ChangeOperation[]): string {
  return createHash('sha256').update(JSON.stringify(operations.map(({ kind, path, contentHash, contentBytes }) => ({ kind, path, contentHash, contentBytes })))).digest('hex');
}

export function assertOperationsWithinEvidence(operations: readonly ChangeOperation[], affectedPaths: readonly string[]): void {
  if (operations.length > 0 && affectedPaths.length === 0) throw new OperationPolicyError('Approved operations require source evidence paths.');
  const roots = affectedPaths.map((value) => value.replace(/\\/g, '/')).map((value) => {
    const isDirectory = value.endsWith('/') || !value.split('/').at(-1)?.includes('.');
    if (isDirectory) return value.replace(/\/$/, '');
    const separator = value.lastIndexOf('/');
    return separator >= 0 ? value.slice(0, separator) : '';
  }).filter(Boolean);
  for (const operation of operations) {
    if (!affectedPaths.includes(operation.path) && !roots.some((root) => operation.path === root || operation.path.startsWith(`${root}/`))) throw new OperationPolicyError(`Operation path ${operation.path} is outside the approved evidence scope.`);
  }
}
