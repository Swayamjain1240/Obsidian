import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';

import { redactText } from './redaction.js';

export type CleanupStatus = 'completed' | 'not_found' | 'failed' | 'blocked_active';

export interface CleanupReceipt {
  resourceId: string;
  status: CleanupStatus;
  attemptedAt: string;
  completedAt?: string;
  errorCode?: string;
}

export interface CleanupTestHooks {
  beforeTargetResolution?: () => Promise<void> | void;
}

export function assertContained(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Cleanup target is outside the permitted privacy root.');
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.isDirectory() === right.isDirectory() && left.dev === right.dev && left.ino === right.ino;
}

async function assertNoSymlinkComponents(value: string): Promise<boolean> {
  const resolvedValue = path.resolve(value);
  const parsedRoot = path.parse(resolvedValue).root;
  const relativeValue = path.relative(parsedRoot, resolvedValue);
  let current = parsedRoot;
  for (const component of relativeValue.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (!metadata) return false;
    if (metadata.isSymbolicLink()) throw new Error('Cleanup refuses symbolic-link path components.');
  }
  return true;
}

async function resolveContainedTarget(root: string, target: string, hooks?: CleanupTestHooks): Promise<string | null> {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  assertContained(rootPath, targetPath);
  const rootBefore = await lstat(rootPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!rootBefore) return null;
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) throw new Error('Cleanup refuses an unsafe privacy root.');
  if (!(await assertNoSymlinkComponents(rootPath))) throw new Error('Cleanup privacy root disappeared during validation.');

  const resolvedRoot = await realpath(rootPath);
  const canonicalRoot = await lstat(resolvedRoot);
  const rootAfterCanonicalization = await lstat(rootPath);
  if (!sameIdentity(rootBefore, canonicalRoot) || !sameIdentity(rootBefore, rootAfterCanonicalization) || !(await assertNoSymlinkComponents(rootPath))) {
    throw new Error('Cleanup privacy root changed during validation.');
  }

  await hooks?.beforeTargetResolution?.();
  if (!(await assertNoSymlinkComponents(targetPath))) return null;
  const resolvedTarget = await realpath(targetPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!resolvedTarget) return null;
  const targetPathIdentity = await lstat(targetPath);
  const resolvedTargetIdentity = await lstat(resolvedTarget);
  const rootBeforeTargetCheck = await lstat(rootPath);
  const rootCanonicalBeforeTargetCheck = await lstat(resolvedRoot);
  if (!sameIdentity(targetPathIdentity, resolvedTargetIdentity) || !sameIdentity(rootBefore, rootBeforeTargetCheck) || !sameIdentity(rootBefore, rootCanonicalBeforeTargetCheck) || !(await assertNoSymlinkComponents(rootPath))) {
    throw new Error('Cleanup filesystem identity changed during validation.');
  }
  const relativeTarget = path.relative(resolvedRoot, resolvedTarget);
  if (!relativeTarget || relativeTarget.startsWith('..' + path.sep) || path.isAbsolute(relativeTarget)) {
    throw new Error('Cleanup target resolves outside the permitted privacy root.');
  }
  return resolvedTarget;
}

async function removeTreeWithoutFollowingSymlinks(target: string): Promise<void> {
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink()) throw new Error('Cleanup refuses symbolic links.');
  if (!metadata.isDirectory()) {
    await unlink(target);
    return;
  }

  const beforeRead = await lstat(target);
  if (beforeRead.isSymbolicLink() || !beforeRead.isDirectory()) throw new Error('Cleanup target changed during validation.');
  const entries = await readdir(target);
  const afterRead = await lstat(target);
  if (afterRead.isSymbolicLink() || !afterRead.isDirectory() || beforeRead.dev !== afterRead.dev || beforeRead.ino !== afterRead.ino) {
    throw new Error('Cleanup target changed during validation.');
  }
  for (const entry of entries) await removeTreeWithoutFollowingSymlinks(path.join(target, entry));
  await rmdir(target);
}

export async function removeContained(root: string, target: string, resourceId: string, now = new Date(), hooks?: CleanupTestHooks): Promise<CleanupReceipt> {
  const attemptedAt = now.toISOString();
  try {
    assertContained(root, target);
    const resolvedTarget = await resolveContainedTarget(root, target, hooks);
    if (!resolvedTarget) return { resourceId, status: 'not_found', attemptedAt, completedAt: attemptedAt };
    await removeTreeWithoutFollowingSymlinks(resolvedTarget);
    return { resourceId, status: 'completed', attemptedAt, completedAt: new Date().toISOString() };
  } catch (error: unknown) {
    const code = error instanceof Error && error.message.includes('outside') ? 'CLEANUP_PATH_REJECTED' : 'CLEANUP_FAILED';
    return { resourceId, status: 'failed', attemptedAt, errorCode: code };
  }
}

export function cleanupErrorSummary(error: unknown): string {
  return redactText(error instanceof Error ? error.message : 'Cleanup failed.', 512);
}
