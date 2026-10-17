
import { describe, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectSnapshotWorkspace, validateSnapshotWorkspace } from './workspace-policy.js';

interface Fixture {
  root: string;
  workspace: string;
  outside: string;
}

async function withFixture(
  test: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), 'obsidian-policy-test-'),
  );

  const root = path.join(temporaryRoot, 'snapshots');
  const workspace = path.join(root, 'snapshot-1', 'workspace');
  const outside = path.join(temporaryRoot, 'private');

  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(outside);

    await test({ root, workspace, outside });
  } finally {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

describe('Snapshot Workspace Security Policy', () => {
  it('accepts a valid workspace inside the trusted root', async () => {
    await withFixture(async ({ root, workspace }) => {
      await writeFile(
        path.join(workspace, 'README.md'),
        'Safe test fixture',
      );

      const result = await validateSnapshotWorkspace(
        workspace,
        root,
      );

      expect(result).toBe(await realpath(workspace));
    });
  });

  it('rejects paths outside the trusted root', async () => {
    await withFixture(async ({ root, outside }) => {
      await expect(
        validateSnapshotWorkspace(outside, root),
      ).rejects.toThrow(/outside the trusted snapshot root/);
    });
  });

  it('rejects the trusted root itself as a workspace', async () => {
    await withFixture(async ({ root }) => {
      await expect(
        validateSnapshotWorkspace(root, root),
      ).rejects.toThrow(/outside the trusted snapshot root/);
    });
  });

  it('rejects symbolic links inside a workspace', async () => {
    await withFixture(async ({ root, workspace, outside }) => {
      await symlink(
        outside,
        path.join(workspace, 'unsafe-link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await expect(
        validateSnapshotWorkspace(workspace, root),
      ).rejects.toThrow(/symbolic link/);
    });
  });

  it('enforces file, byte, and depth limits and returns a content fingerprint', async () => {
    await withFixture(async ({ root, workspace }) => {
      await mkdir(path.join(workspace, 'nested'));
      await writeFile(path.join(workspace, 'README.md'), '1234');
      await writeFile(path.join(workspace, 'nested', 'file.txt'), '5678');

      const inventory = await inspectSnapshotWorkspace(workspace, root, {
        maxFiles: 2,
        maxDirectories: 1,
        maxBytes: 8,
        maxSingleFileBytes: 4,
        maxDepth: 2,
      });
      expect(inventory.fileCount).toBe(2);
      expect(inventory.directoryCount).toBe(1);
      expect(inventory.totalBytes).toBe(8);
      expect(inventory.fingerprint).toMatch(/^[a-f0-9]{64}$/);

      await expect(inspectSnapshotWorkspace(workspace, root, { maxFiles: 1 })).rejects.toThrow(/file limit|validation limits/);
      await expect(inspectSnapshotWorkspace(workspace, root, { maxBytes: 7, maxSingleFileBytes: 7 })).rejects.toThrow(/byte limit/);
      await expect(inspectSnapshotWorkspace(workspace, root, { maxDepth: 1 })).rejects.toThrow(/depth/);
    });
  });
});
