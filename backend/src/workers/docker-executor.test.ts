
import { describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DockerExecutor } from './docker-executor.js';
import { listManagedSmokeContainers } from './container-inventory.js';

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

const npmBuildCommand = {
  ...versionCommand,
  id: 'npm-build',
  category: 'build' as const,
  label: 'Build',
  commandLabel: 'npm run build',
  executable: 'npm',
  args: ['run', 'build'],
  network: 'blocked' as const,
};

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

  it('rejects unsafe image references before Docker is invoked', () => {
    expect(() => new DockerExecutor({ image: 'registry.example/worker image' })).toThrow(/image reference/);
  });

  it('rejects registry-dependent commands even when a Docker binary is configured', async () => {
    const executor = new DockerExecutor({ dockerBinary: 'docker-that-is-not-installed' });
    const result = await executor.run({ ...npmBuildCommand, network: 'registry_only' }, options(process.cwd()));
    expect(result.status).toBe('not_available');
    expect(result.summary).toMatch(/Registry-dependent/);
  });

  it('reports Docker-unavailable as not_available after validating the snapshot boundary', async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'obsidian-docker-negative-'));
    const trustedRoot = path.join(temporaryRoot, 'snapshots');
    const workspace = path.join(trustedRoot, 'snapshot-1', 'workspace');
    try {
      await mkdir(workspace, { recursive: true });
      await writeFile(path.join(workspace, 'package.json'), '{"scripts":{"build":"node -e \\"process.exit(0)\\"}}');
      const executor = new DockerExecutor({ trustedSnapshotRoot: trustedRoot, dockerBinary: 'docker-that-is-not-installed' });
      const result = await executor.run(npmBuildCommand, options(workspace));
      expect(result.status).toBe('not_available');
      expect(result.summary).toMatch(/Docker worker is unavailable|container cleanup/);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('rejects a workspace outside the configured trusted root', async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'obsidian-docker-boundary-'));
    const trustedRoot = path.join(temporaryRoot, 'snapshots');
    const outside = path.join(temporaryRoot, 'outside');
    try {
      await mkdir(trustedRoot, { recursive: true });
      await mkdir(outside, { recursive: true });
      const executor = new DockerExecutor({ trustedSnapshotRoot: trustedRoot, dockerBinary: 'docker-that-is-not-installed' });
      const result = await executor.run(npmBuildCommand, options(outside));
      expect(result.status).toBe('not_available');
      expect(result.summary).toMatch(/Snapshot workspace/);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('fails closed on invalid resource limits', async () => {
    const executor = new DockerExecutor({ dockerBinary: 'docker-that-is-not-installed' });
    const result = await executor.run(versionCommand, { ...options(process.cwd()), maxMemoryBytes: 1 });
    expect(result.status).toBe('not_available');
    expect(result.summary).toMatch(/resource limits/);
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

  dockerTest(
    'executes supported npm scripts in scratch space and preserves the read-only snapshot',
    async () => {
      const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'obsidian-docker-scripts-'));
      const trustedRoot = path.join(temporaryRoot, 'snapshots');
      const workspace = path.join(trustedRoot, 'snapshot-1', 'workspace');
      const command = { ...npmBuildCommand, network: 'blocked' as const };
      try {
        await mkdir(workspace, { recursive: true });
        const packagePath = path.join(workspace, 'package.json');
        const originalPackage = JSON.stringify({ scripts: { build: "node -e \"require('fs').writeFileSync('scratch.txt','safe'); process.exit(0)\"" } });
        await writeFile(packagePath, originalPackage);
        const executor = new DockerExecutor(trustedRoot);
        const passed = await executor.run(command, options(workspace));
        expect(passed.status).toBe('passed');
        expect(passed.exitCode).toBe(0);
        await expect(access(path.join(workspace, 'scratch.txt'))).rejects.toBeDefined();
        expect(await readFile(packagePath, 'utf8')).toBe(originalPackage);

        await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "process.exit(7)"' } }));
        const failed = await executor.run(command, options(workspace));
        expect(failed.status).toBe('failed');
        expect(failed.exitCode).toBe(7);
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );

  dockerTest(
    'classifies timeout, cancellation, missing dependencies, and output limits safely',
    async () => {
      const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'obsidian-docker-negative-'));
      const trustedRoot = path.join(temporaryRoot, 'snapshots');
      const workspace = path.join(trustedRoot, 'snapshot-1', 'workspace');
      const command = { ...npmBuildCommand, network: 'blocked' as const };
      try {
        await mkdir(workspace, { recursive: true });
        const executor = new DockerExecutor(trustedRoot);

        await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "setTimeout(() => {}, 5000)"' } }));
        const timedOut = await executor.run(command, { ...options(workspace), timeoutMs: 500 });
        expect(timedOut.status).toBe('timed_out');

        await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "setTimeout(() => {}, 5000)"' } }));
        const controller = new AbortController();
        const cancelledPromise = executor.run(command, { ...options(workspace), timeoutMs: 10_000, signal: controller.signal });
        setTimeout(() => controller.abort(), 250);
        expect((await cancelledPromise).status).toBe('cancelled');

        await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "require(\\\"missing-package\\\")"' } }));
        const missing = await executor.run(command, options(workspace));
        expect(missing.status).toBe('failed');
        expect(missing.exitCode).not.toBe(0);

        await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "fetch(\\\"http://example.com\\\").then(() => process.exit(0)).catch(() => process.exit(9))"' } }));
        const networkAttempt = await executor.run(command, { ...options(workspace), timeoutMs: 5_000 });
        expect(networkAttempt.status).toBe('failed');
        expect(networkAttempt.exitCode).not.toBe(0);

        await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "process.stdout.write(\\\"x\\\".repeat(1000000))"' } }));
        const excessiveOutput = await executor.run(command, { ...options(workspace), maxOutputBytes: 1024 });
        expect(excessiveOutput.status).toBe('failed');
        expect(excessiveOutput.outputTruncated).toBe(true);
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );

  dockerTest(
    'supports concurrent jobs and leaves no managed containers behind',
    async () => {
      const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'obsidian-docker-concurrency-'));
      const trustedRoot = path.join(temporaryRoot, 'snapshots');
      const workspace = path.join(trustedRoot, 'snapshot-1', 'workspace');
      try {
        await mkdir(workspace, { recursive: true });
        await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "setTimeout(() => process.exit(0), 150)"' } }));
        const executor = new DockerExecutor(trustedRoot);
        const results = await Promise.all([executor.run(npmBuildCommand, options(workspace)), executor.run(npmBuildCommand, options(workspace))]);
        expect(results.every((item) => item.status === 'passed' && item.exitCode === 0)).toBe(true);
        const containers = await listManagedSmokeContainers();
        expect(containers).toEqual([]);
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
