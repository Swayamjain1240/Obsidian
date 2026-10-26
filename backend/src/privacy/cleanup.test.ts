import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { removeContained } from './cleanup.js';

describe('privacy cleanup', () => {
  it('removes only contained resources and is idempotent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-cleanup-'));
    const target = path.join(root, 'resource');
    await mkdir(target);
    await writeFile(path.join(target, 'private.txt'), 'private');
    const first = await removeContained(root, target, 'resource');
    const second = await removeContained(root, target, 'resource');
    expect(first.status).toBe('completed');
    expect(second.status).toBe('not_found');
    expect((await removeContained(root, path.dirname(root), 'escape')).status).toBe('failed');
  });

  it('rejects parent and target symlinks without touching outside-root sentinels', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-cleanup-links-'));
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const sentinel = path.join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'preserve');

    await symlink(outside, path.join(root, 'parent-link'), 'junction');
    const parentResult = await removeContained(root, path.join(root, 'parent-link', 'sentinel.txt'), 'parent-link');
    expect(parentResult.status).toBe('failed');
    expect(await readFile(sentinel, 'utf8')).toBe('preserve');

    const target = path.join(root, 'target');
    await symlink(outside, target, 'junction');
    const targetResult = await removeContained(root, target, 'target-link');
    expect(targetResult.status).toBe('failed');
    expect(await readFile(sentinel, 'utf8')).toBe('preserve');
  });

  it('rejects a real target replaced by a parent-link before cleanup', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-cleanup-swap-'));
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const target = path.join(root, 'resource');
    await mkdir(target);
    await writeFile(path.join(target, 'private.txt'), 'private');
    const sentinel = path.join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'preserve');
    await rename(target, path.join(root, 'resource-real'));
    await symlink(outside, target, 'junction');

    const result = await removeContained(root, target, 'swapped-resource');
    expect(result.status).toBe('failed');
    expect(await readFile(sentinel, 'utf8')).toBe('preserve');
  });

  it('fails closed when the permitted root is replaced before target resolution', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-cleanup-root-swap-'));
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    const originalRoot = path.join(base, 'root-original');
    await mkdir(root);
    await mkdir(outside);
    const target = path.join(root, 'resource');
    await mkdir(target);
    await writeFile(path.join(target, 'private.txt'), 'private');
    const sentinel = path.join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'preserve');

    const result = await removeContained(root, target, 'root-swapped', new Date(), {
      beforeTargetResolution: async () => {
        await rename(root, originalRoot);
        await symlink(outside, root, 'junction');
      },
    });

    expect(result.status).toBe('failed');
    expect(await readFile(sentinel, 'utf8')).toBe('preserve');
  });

  it('removes nested real directories and refuses child links', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-cleanup-nested-'));
    const root = path.join(base, 'root');
    const target = path.join(root, 'nested', 'resource');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'private.txt'), 'private');
    const normalResult = await removeContained(root, target, 'nested-resource');
    expect(normalResult.status).toBe('completed');

    const unsafeTarget = path.join(root, 'nested', 'unsafe-resource');
    await mkdir(unsafeTarget, { recursive: true });
    const outside = path.join(base, 'outside');
    await mkdir(outside);
    const sentinel = path.join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'preserve');
    await symlink(outside, path.join(unsafeTarget, 'child-link'), 'junction');
    const result = await removeContained(root, unsafeTarget, 'nested-unsafe-resource');
    expect(result.status).toBe('failed');
    expect(await readFile(sentinel, 'utf8')).toBe('preserve');
  });
});
