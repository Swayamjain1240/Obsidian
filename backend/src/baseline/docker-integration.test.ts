import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadConfig } from '../config.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import type { ConfirmedDetectionContext } from '../detection/service.js';
import type { BaselinePlan } from './adapters.js';
import { BaselineService, type BaselineEngine, type BaselineScopeProvider } from './service.js';

const dockerTest = process.env.OBSIDIAN_DOCKER_TESTS === '1' ? it : it.skip;

describe('BaselineService Docker integration', () => {
  dockerTest('routes a supported Node baseline command through the isolated worker', async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'obsidian-baseline-docker-'));
    const workspace = path.join(temporaryRoot, 'snapshot-1', 'workspace');
    const snapshot: SnapshotRecord = {
      snapshotId: 'docker-baseline-snapshot',
      repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'd'.repeat(40) },
      archivePath: path.join(temporaryRoot, 'archive.tar.gz'),
      manifestPath: path.join(temporaryRoot, 'snapshot.json'),
      archiveSha256: 'a'.repeat(64),
      byteLength: 1,
      capturedAt: new Date(0).toISOString(),
      immutable: true,
    };
    const extraction: ExtractionRecord = {
      snapshotId: snapshot.snapshotId,
      archiveSha256: snapshot.archiveSha256,
      extractionPolicyVersion: 'part4-v1',
      extractedFileCount: 1,
      extractedDirectoryCount: 0,
      extractedBytes: 100,
      fileManifestSha256: 'b'.repeat(64),
      status: 'completed',
      capturedAt: new Date(0).toISOString(),
      workspacePath: workspace,
      manifestPath: path.join(temporaryRoot, 'files.json'),
    };
    const context: ConfirmedDetectionContext = {
      detectionRunId: 'docker-detection',
      ownerUserId: '7',
      sessionId: 'docker-session',
      snapshot,
      baseCommit: 'd'.repeat(40),
      archiveSha256: snapshot.archiveSha256,
      languageCandidates: ['TypeScript'],
    };
    const provider: BaselineScopeProvider = {
      selectedContext: () => ({ completenessRunId: 'docker-completeness', scopeMode: 'EXISTING_ONLY', context }),
    };
    const plan: BaselinePlan = {
      checks: [{
        id: 'node-build',
        category: 'build',
        label: 'Build',
        commandLabel: 'npm run build',
        command: { id: 'node-build', category: 'build', label: 'Build', commandLabel: 'npm run build', executable: 'npm', args: ['run', 'build'], network: 'blocked', evidenceRefs: [] },
        initialStatus: 'queued',
        summary: 'Available.',
        evidenceRefs: [],
      }],
      fileCount: 1,
      limited: false,
      warning: null,
    };
    const engine: Partial<BaselineEngine> = {
      extract: async () => extraction,
      discover: async () => plan,
    };
    const config = loadConfig({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test',
      FRONTEND_ORIGIN: 'http://localhost:5173',
      SNAPSHOT_ROOT: temporaryRoot,
      BASELINE_WORKER_IMAGE: 'obsidian-sandbox:dev',
      BASELINE_CHECK_TIMEOUT_MS: '30000',
      BASELINE_MAX_TOTAL_TIMEOUT_MS: '60000',
    });

    try {
      await mkdir(workspace, { recursive: true });
      await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"' } }));
      const service = new BaselineService(config, provider, engine);
      const queued = service.start('7', 'docker-completeness');
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const current = service.get('7', queued.runId);
        if (current.status === 'passed' || current.status === 'failed' || current.status === 'partial') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const result = service.get('7', queued.runId);
      expect(result.status).toBe('passed');
      expect(result.checks[0]?.status).toBe('passed');
      expect(result.checks[0]?.exitCode).toBe(0);
      expect(result.nextPhase).toBe('enhancement_analysis');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
