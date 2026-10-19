import { describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '../config.js';
import type { SystemEvent } from '../events.js';
import { SnapshotHandleStore } from '../intake/handle-store.js';
import { DurableRunStore } from '../workflow/run-store.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import { DetectionService, DetectionServiceError, type DetectionEngine } from './service.js';

const config: AppConfig = {
  ...loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' }),
  NODE_ENV: 'test',
  PORT: 4000,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  RATE_LIMIT_WINDOW_MS: 900_000,
  RATE_LIMIT_MAX_REQUESTS: 100,
  AI_PROVIDER: 'disabled',
  AI_PROVIDER_TIMEOUT_MS: 10_000,
  GITHUB_OAUTH_SCOPES: 'read:user,repo',
  SNAPSHOT_MAX_BYTES: 52_428_800,
  SNAPSHOT_ROOT: '.obsidian-workspaces',
  AUTH_SESSION_SECRET: 'a'.repeat(32),
};

const snapshot: SnapshotRecord = {
  snapshotId: 'snapshot-1',
  repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'c'.repeat(40) },
  archivePath: 'archive.tar.gz',
  manifestPath: 'snapshot.json',
  archiveSha256: 'a'.repeat(64),
  byteLength: 4,
  capturedAt: new Date(0).toISOString(),
  immutable: true,
};

const extraction: ExtractionRecord = {
  snapshotId: snapshot.snapshotId,
  archiveSha256: snapshot.archiveSha256,
  extractionPolicyVersion: 'part4-v1',
  extractedFileCount: 2,
  extractedDirectoryCount: 1,
  extractedBytes: 12,
  fileManifestSha256: 'b'.repeat(64),
  status: 'completed',
  capturedAt: new Date(0).toISOString(),
  workspacePath: 'workspace',
  manifestPath: 'files.json',
};

const engine: DetectionEngine = {
  extract: async (_snapshot, _policy, onProgress) => {
    onProgress('extracting', { files: 2, bytes: 12 });
    return extraction;
  },
  scan: async () => ({
    candidates: [{
      id: 'typescript-react',
      language: 'TypeScript',
      frameworks: ['React'],
      packageManager: 'npm',
      evidenceStrength: 'strong' as const,
      evidenceRefs: [{ path: 'package.json', reason: 'dependency marker: react', kind: 'dependency-marker' as const }],
      adapterAvailable: true,
    }],
    primaryCandidateId: 'typescript-react',
    unknownReason: null,
    fileCount: 2,
    evidenceFileCount: 1,
    policyVersion: 'part4-v1',
  }),
};

async function waitFor(service: DetectionService, owner: string, runId: string, status: string): Promise<ReturnType<DetectionService['get']>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = service.get(owner, runId);
    if (result.status === status) return result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`run did not reach ${status}`);
}

function setup(customEngine: DetectionEngine = engine, sink?: (event: SystemEvent) => void) {
  const handles = new SnapshotHandleStore();
  const handle = handles.create('7', snapshot);
  return { service: new DetectionService(config, handles, customEngine, sink), handle };
}

describe('detection service', () => {
  it('runs a verified snapshot through evidence finalization and exposes only bounded results', async () => {
    const { service, handle } = setup();
    const queued = service.start('7', handle, 'session-7');
    expect(['queued', 'archive_verified', 'extracting', 'manifest_indexed', 'stack_rules_applied', 'evidence_finalized', 'awaiting_confirmation']).toContain(queued.status);
    expect(queued.baseCommit).toBe('c'.repeat(40));

    const result = await waitFor(service, '7', queued.runId, 'awaiting_confirmation');
    expect(result.candidates[0].evidenceRefs).toEqual([{ path: 'package.json', reason: 'dependency marker: react', kind: 'dependency-marker' }]);
    expect(result.progress.stage).toBe('awaiting_confirmation');
    expect(result.error).toBeUndefined();
    expect(service.listEvents('7', queued.runId).map((event) => event.eventType)).toContain('STACK_CONFIRMATION_REQUIRED');
    expect(service.listEvents('7', queued.runId).every((event) => event.baseCommit === 'c'.repeat(40))).toBe(true);
    expect(service.listEvents('7', queued.runId).every((event) => event.sessionId === 'session-7')).toBe(true);
  });

  it('enforces snapshot and run ownership', () => {
    const { service, handle } = setup();
    expect(() => service.start('8', handle)).toThrowError(DetectionServiceError);
    const run = service.start('7', handle);
    expect(() => service.get('8', run.runId)).toThrowError(DetectionServiceError);
  });

  it('forwards append-only lifecycle events to the configured sink without blocking the run', async () => {
    const events: SystemEvent[] = [];
    const { service, handle } = setup(engine, (event) => { events.push(event); });
    const run = service.start('7', handle, 'session-sink');
    await waitFor(service, '7', run.runId, 'awaiting_confirmation');
    expect(events.some((event) => event.eventType === 'STACK_DETECTED')).toBe(true);
    expect(events.every((event) => event.runId === run.runId && event.baseCommit === 'c'.repeat(40))).toBe(true);
  });

  it('requires a valid confirmation and records analysis-only confirmation', async () => {
    const { service, handle } = setup();
    const run = service.start('7', handle);
    await waitFor(service, '7', run.runId, 'awaiting_confirmation');
    expect(() => service.confirm('7', run.runId, [], false)).toThrowError(DetectionServiceError);

    const confirmed = service.confirm('7', run.runId, ['typescript-react'], false);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.analysisOnly).toBe(true);
    expect(confirmed.confirmedCandidateIds).toEqual(['typescript-react']);
  });

  it('cancels an in-flight run and never turns it into a confirmation', async () => {
    let release!: () => void;
    const slowEngine: DetectionEngine = {
      ...engine,
      extract: (_snapshot, _policy, _onProgress, signal) => new Promise<ExtractionRecord>((resolve) => {
        release = () => resolve(extraction);
        signal.addEventListener('abort', () => undefined, { once: true });
      }),
    };
    const { service, handle } = setup(slowEngine);
    const run = service.start('7', handle);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelled = service.cancel('7', run.runId);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error?.code).toBe('DETECTION_CANCELLED');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.get('7', run.runId).status).toBe('cancelled');
  });

  it('starts a new run for a permitted rescan', async () => {
    const { service, handle } = setup();
    const run = service.start('7', handle);
    await waitFor(service, '7', run.runId, 'awaiting_confirmation');
    const next = service.rescan('7', run.runId);
    expect(next.runId).not.toBe(run.runId);
    expect(next.snapshotId).toBe(snapshot.snapshotId);
  });

  it('rehydrates a confirmed detection context in a fresh service instance', async () => {
    const handles = new SnapshotHandleStore();
    const runStore = new DurableRunStore();
    const handle = handles.create('7', snapshot, Date.now(), 'session-restart');
    const first = new DetectionService(config, handles, engine, undefined, runStore);
    const queued = await first.startDurable('7', handle, 'session-restart');
    await waitFor(first, '7', queued.runId, 'awaiting_confirmation');

    const second = new DetectionService(config, handles, engine, undefined, runStore);
    const confirmed = await second.confirmDurable('7', queued.runId, ['typescript-react'], false, 'session-restart');
    expect(confirmed.status).toBe('confirmed');
    expect((await second.confirmedContextDurable('7', queued.runId, 'session-restart')).snapshot.snapshotId).toBe(snapshot.snapshotId);
  });
});
