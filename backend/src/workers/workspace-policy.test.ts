
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

import { validateSnapshotWorkspace } from './workspace-policy.js';

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
});
