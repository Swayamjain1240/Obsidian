import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ChangeOperation } from './types.js';
import type { DiffEntry } from './diff-types.js';
import { safeOperationPath } from './operation-policy.js';

const MAX_PATCH_BYTES = 64 * 1024;
const MAX_ENTRIES = 500;

async function readOptional(root: string, relative: string): Promise<Buffer | null> {
  const filePath = path.join(root, ...relative.split('/'));
  try { await access(filePath); return await readFile(filePath); } catch { return null; }
}

function digest(value: Buffer | null): string | null {
  return value ? createHash('sha256').update(value).digest('hex') : null;
}

function patchFor(relative: string, before: Buffer | null, after: Buffer | null): string | null {
  if (before && after && before.equals(after)) return null;
  const beforeText = before?.toString('utf8') ?? '';
  const afterText = after?.toString('utf8') ?? '';
  if (beforeText.includes('\u0000') || afterText.includes('\u0000')) return null;
  const patch = [`--- a/${relative}`, `+++ b/${relative}`, ...beforeText.split(/\r?\n/).filter(Boolean).map((line) => `-${line}`), ...afterText.split(/\r?\n/).filter(Boolean).map((line) => `+${line}`)].join('\n');
  return Buffer.byteLength(patch, 'utf8') <= MAX_PATCH_BYTES ? patch : null;
}

export async function buildDiffEntries(originalRoot: string, changedRoot: string, operations: readonly ChangeOperation[], limits: { maxEntries?: number } = {}): Promise<DiffEntry[]> {
  if (operations.length > (limits.maxEntries ?? MAX_ENTRIES)) throw new Error('The Version 2 diff contains too many file operations.');
  const entries: DiffEntry[] = [];
  for (const operation of operations) {
    if (!safeOperationPath(operation.path)) throw new Error('The Version 2 diff contains an unsafe path.');
    const before = await readOptional(originalRoot, operation.path);
    const after = await readOptional(changedRoot, operation.path);
    entries.push({ path: operation.path, kind: operation.kind, beforeSha256: digest(before), afterSha256: digest(after), beforeBytes: before?.byteLength ?? 0, afterBytes: after?.byteLength ?? 0, patch: patchFor(operation.path, before, after) });
  }
  return entries;
}

export function diffHash(entries: readonly DiffEntry[]): string {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
