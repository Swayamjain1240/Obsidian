import { describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '../config.js';
import type { SystemEvent } from '../events.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import type { ConfirmedDetectionContext } from '../detection/service.js';
import type { BaselinePlan } from './adapters.js';
import { BaselineService, type BaselineEngine, type BaselineScopeProvider } from './service.js';
import { DurableRunStore } from '../workflow/run-store.js';

const config: AppConfig = {
  ...loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' }),
  NODE_ENV: 'test', PORT: 4000, MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173',
  RATE_LIMIT_WINDOW_MS: 900_000, RATE_LIMIT_MAX_REQUESTS: 100, AI_PROVIDER: 'disabled', AI_PROVIDER_TIMEOUT_MS: 10_000,
  GITHUB_OAUTH_SCOPES: 'read:user,repo', SNAPSHOT_MAX_BYTES: 52_428_800, SNAPSHOT_ROOT: '.obsidian-workspaces', AUTH_SESSION_SECRET: 'a'.repeat(32),
};

const snapshot: SnapshotRecord = {
  snapshotId: 'baseline-snapshot', repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'c'.repeat(40) }, archivePath: 'archive.tar.gz', manifestPath: 'snapshot.json', archiveSha256: 'a'.repeat(64), byteLength: 1, capturedAt: new Date(0).toISOString(), immutable: true,
};
const extraction: ExtractionRecord = {
  snapshotId: snapshot.snapshotId, archiveSha256: snapshot.archiveSha256, extractionPolicyVersion: 'part4-v1', extractedFileCount: 1, extractedDirectoryCount: 0, extractedBytes: 10, fileManifestSha256: 'b'.repeat(64), status: 'completed', capturedAt: new Date(0).toISOString(), workspacePath: 'workspace', manifestPath: 'files.json',
};
const context: ConfirmedDetectionContext = {
  detectionRunId: 'detection-1', ownerUserId: '7', sessionId: 'session-7', snapshot, baseCommit: 'c'.repeat(40), archiveSha256: snapshot.archiveSha256, languageCandidates: ['TypeScript'],
};

const plan: BaselinePlan = {
  checks: [{ id: 'unit', category: 'unit', label: 'Unit tests', commandLabel: 'node test', command: { id: 'unit', category: 'unit', label: 'Unit tests', commandLabel: 'node test', executable: 'node', args: ['--version'], evidenceRefs: [] }, initialStatus: 'queued', summary: 'Available.' , evidenceRefs: [] }],
  fileCount: 1, limited: false, warning: null,
};

const provider: BaselineScopeProvider = {
  selectedContext: () => ({ completenessRunId: 'completeness-1', scopeMode: 'FULL', context }),
};

function engine(resultStatus: 'passed' | 'failed'): BaselineEngine {
  return {
    extract: async () => extraction,
    discover: async () => plan,
    run: async () => ({ status: resultStatus, exitCode: resultStatus === 'passed' ? 0 : 2, durationMs: 5, outputBytes: 0, outputTruncated: false, summary: resultStatus === 'passed' ? 'Unit tests completed successfully.' : 'Unit tests exited with code 2.' }),
  };
}

async function waitFor(service: BaselineService, owner: string, runId: string, statuses: string[]): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (statuses.includes(service.get(owner, runId).status)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`baseline did not reach ${statuses.join(', ')}`);
}

describe('baseline service', () => {
  it('runs discovered checks and advances a passing baseline to enhancement analysis', async () => {
    const events: SystemEvent[] = [];
    const service = new BaselineService(config, provider, engine('passed'), (event) => { events.push(event); });
    const queued = service.start('7', 'completeness-1');
    await waitFor(service, '7', queued.runId, ['passed']);
    const result = service.get('7', queued.runId);
    expect(result.passedCount).toBe(1);
    expect(result.nextPhase).toBe('enhancement_analysis');
    expect(events.map((event) => event.eventType)).toContain('BASELINE_HEALTHY');
  });

  it('marks failed checks as repair-required and enforces ownership', async () => {
    const service = new BaselineService(config, provider, engine('failed'));
    const queued = service.start('7', 'completeness-1');
    await waitFor(service, '7', queued.runId, ['failed']);
    const result = service.get('7', queued.runId);
    expect(result.failedCount).toBe(1);
    expect(result.nextPhase).toBe('repair_review');
    expect(() => service.get('8', queued.runId)).toThrow(/not found/);
  });

  it('rehydrates a completed baseline result from a durable envelope', async () => {
    const runStore = new DurableRunStore();
    const first = new BaselineService(config, provider, engine('passed'), undefined, runStore);
    const queued = await first.startDurable('7', 'completeness-1');
    await waitFor(first, '7', queued.runId, ['passed']);
    const second = new BaselineService(config, provider, engine('passed'), undefined, runStore);
    expect((await second.getDurable('7', queued.runId)).status).toBe('passed');
  });
});
