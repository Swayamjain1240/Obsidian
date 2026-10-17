
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DockerExecutor } from './docker-executor.js';

const versionCommand = {
  id: 'version-test',
  category: 'build' as const,
  label: 'Node version',
  commandLabel: 'node --version',
  executable: 'node',
  args: ['--version'],
  evidenceRefs: [],
};

const syntaxCommand = {
  ...versionCommand,
  id: 'syntax-test',
  label: 'JavaScript syntax validation',
  commandLabel: 'node --check /input/probe.js',
  args: ['--check', '/input/probe.js'],
};

function options(cwd: string) {
  return {
    cwd,
    timeoutMs: 25_000,
    maxOutputBytes: 4096,
    signal: new AbortController().signal,
  };
}

describe('DockerExecutor security', () => {
  it('rejects unauthorized commands', async () => {
    const executor = new DockerExecutor();

    const result = await executor.run(
      {
        ...versionCommand,
        args: ['-e', 'console.log("unsafe")'],
      },
      options(process.cwd()),
    );

    expect(result.status).toBe('not_available');
    expect(result.exitCode).toBeNull();
  });

  it('rejects syntax checks without a trusted root', async () => {
    const executor = new DockerExecutor();

    const result = await executor.run(
      syntaxCommand,
      options(process.cwd()),
    );

    expect(result.status).toBe('not_available');
  });

  it('rejects already-cancelled execution', async () => {
    const executor = new DockerExecutor();
    const controller = new AbortController();

    controller.abort();

    const result = await executor.run(versionCommand, {
      ...options(process.cwd()),
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
  });

  // Docker integration tests require an available local
  // Docker Engine and the obsidian-sandbox:dev image.
  //
  // They are opt-in so normal CI does not depend on Docker.
  const dockerTest =
    process.env.OBSIDIAN_DOCKER_TESTS === '1'
      ? it
      : it.skip;

  dockerTest(
    'validates real JavaScript files in Docker',
    async () => {
      const temporaryRoot = await mkdtemp(
        path.join(tmpdir(), 'obsidian-docker-test-'),
      );

      const trustedRoot = path.join(
        temporaryRoot,
        'snapshots',
      );

      const workspace = path.join(
        trustedRoot,
        'snapshot-1',
        'workspace',
      );

      try {
        await mkdir(workspace, { recursive: true });

        const file = path.join(workspace, 'probe.js');
        const executor = new DockerExecutor(trustedRoot);

        await writeFile(file, 'const answer = 42;');

        const valid = await executor.run(
          syntaxCommand,
          options(workspace),
        );

        expect(valid.status).toBe('passed');
        expect(valid.exitCode).toBe(0);

        await writeFile(file, 'const answer = ;');

        const invalid = await executor.run(
          syntaxCommand,
          options(workspace),
        );

        expect(invalid.status).toBe('failed');
        expect(invalid.exitCode).not.toBeNull();
        expect(invalid.exitCode).not.toBe(0);
      } finally {
        await rm(temporaryRoot, {
          recursive: true,
          force: true,
        });
      }
    },
    90_000,
  );
});
