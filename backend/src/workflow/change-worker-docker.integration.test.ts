import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { createArchiveFixture } from '../intake/archive-fixture.js';
import { sha256 } from '../intake/snapshot.js';
import { ChangeWorker } from './change-worker.js';

const dockerTest = process.env.OBSIDIAN_DOCKER_TESTS === '1' ? it : it.skip;

describe('ChangeWorker Docker validation', () => {
  dockerTest('validates an applied repair in the same isolated worker boundary', async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'obsidian-change-worker-docker-'));
    const archivePath = path.join(temporaryRoot, 'archive.tar.gz');
    const snapshotRoot = path.join(temporaryRoot, 'snapshots');
    try {
      await mkdir(snapshotRoot, { recursive: true });
      const archive = await createArchiveFixture([
        { name: 'repo/package.json', content: JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }) },
      ]);
      await writeFile(archivePath, archive);
      const snapshot = {
        snapshotId: 'change-worker-docker-snapshot',
        repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'e'.repeat(40) },
        archivePath,
        manifestPath: path.join(temporaryRoot, 'snapshot.json'),
        archiveSha256: sha256(archive),
        byteLength: archive.byteLength,
        capturedAt: new Date(0).toISOString(),
        immutable: true as const,
      };
      const config = loadConfig({
        NODE_ENV: 'test',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test',
        FRONTEND_ORIGIN: 'http://localhost:5173',
        SNAPSHOT_ROOT: snapshotRoot,
        BASELINE_WORKER_IMAGE: 'obsidian-sandbox:dev',
        BASELINE_CHECK_TIMEOUT_MS: '30000',
      });
      const worker = new ChangeWorker(config);
      const applied = await worker.apply({
        detectionRunId: 'change-detection',
        ownerUserId: '7',
        sessionId: 'change-session',
        snapshot,
        baseCommit: snapshot.repository.commitSha!,
        archiveSha256: snapshot.archiveSha256,
        languageCandidates: ['TypeScript'],
      }, 'ai/repair/change-worker', [{ kind: 'modify', path: 'package.json', content: JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }) }]);
      const validation = await worker.validate({
        detectionRunId: 'change-detection',
        ownerUserId: '7',
        sessionId: 'change-session',
        snapshot,
        baseCommit: snapshot.repository.commitSha!,
        archiveSha256: snapshot.archiveSha256,
        languageCandidates: ['TypeScript'],
      }, applied);
      expect(validation.status).toBe('not_available');
      const nodeBuild = validation.checks.find((check) => check.id === 'node-build');
      expect(nodeBuild, JSON.stringify(validation)).toMatchObject({ status: 'passed' });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
