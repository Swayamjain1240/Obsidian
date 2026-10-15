import { describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '../config.js';
import type { SystemEvent } from '../events.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import { CompletenessService, type CompletenessEngine } from './service.js';
import type { ConfirmedDetectionContext } from '../detection/service.js';

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
  snapshotId: 'completeness-snapshot',
  repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'c'.repeat(40) },
  archivePath: 'archive.tar.gz',
  manifestPath: 'snapshot.json',
  archiveSha256: 'a'.repeat(64),
  byteLength: 1,
  capturedAt: new Date(0).toISOString(),
  immutable: true,
};

const extraction: ExtractionRecord = {
  snapshotId: snapshot.snapshotId,
  archiveSha256: snapshot.archiveSha256,
  extractionPolicyVersion: 'part4-v1',
  extractedFileCount: 3,
  extractedDirectoryCount: 1,
  extractedBytes: 120,
  fileManifestSha256: 'b'.repeat(64),
  status: 'completed',
  capturedAt: new Date(0).toISOString(),
  workspacePath: 'workspace',
  manifestPath: 'files.json',
};

const context: ConfirmedDetectionContext = {
  detectionRunId: 'detection-1',
  ownerUserId: '7',
  sessionId: 'session-7',
  snapshot,
  baseCommit: 'c'.repeat(40),
  archiveSha256: snapshot.archiveSha256,
  languageCandidates: ['TypeScript'],
};

const engine: CompletenessEngine = {
  extract: async (_snapshot, _policy, onProgress) => {
    onProgress('reused', { files: 3, bytes: 120 });
    return extraction;
  },
  scan: async () => ({
    projectStatus: 'partial' as const,
    areas: [{ id: 'implementation', name: 'Implementation', status: 'partial' as const, summary: '1 completeness finding reported.', findingIds: ['implementation-1'], affectedPaths: ['src/index.ts'] }],
    findings: [{ id: 'implementation-1', kind: 'todo-marker' as const, areaId: 'implementation', status: 'working_with_issues' as const, summary: 'A TODO or FIXME marker is present.', evidenceRefs: [{ path: 'src/index.ts', line: 3, reason: 'TODO/FIXME marker', kind: 'marker' as const }], affectedPaths: ['src/index.ts'] }],
    fileCount: 3,
    scannedFileCount: 2,
    scannedBytes: 120,
    limited: false,
    warning: null,
    policyVersion: 'part5-v1',
  }),
};

async function waitFor(service: CompletenessService, owner: string, runId: string, status: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = service.get(owner, runId);
    if (result.status === status) return result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`run did not reach ${status}`);
}

describe('completeness service', () => {
  it('scans only a confirmed snapshot, produces status areas, and gates scope selection', async () => {
    const events: SystemEvent[] = [];
    const service = new CompletenessService(config, engine, (event) => { events.push(event); });
    const queued = service.start('7', context);
    const review = await waitFor(service, '7', queued.runId, 'awaiting_scope');

    expect(review.detectionRunId).toBe('detection-1');
    expect(review.projectStatus).toBe('partial');
    expect(review.findings[0].evidenceRefs[0].line).toBe(3);
    expect(review.nextPhase).toBeUndefined();
    expect(events.map((event) => event.eventType)).toContain('COMPLETENESS_SCAN_COMPLETED');
    expect(events.every((event) => event.baseCommit === 'c'.repeat(40))).toBe(true);

    const selected = service.selectScope('7', queued.runId, 'EXISTING_ONLY');
    expect(selected.status).toBe('scope_selected');
    expect(selected.scopeMode).toBe('EXISTING_ONLY');
    expect(selected.nextPhase).toBe('baseline_testing');
    expect(events.map((event) => event.eventType)).toContain('SCOPE_MODE_SELECTED');
  });

  it('enforces owner boundaries and cancellation before scope selection', async () => {
    const service = new CompletenessService(config, engine);
    const queued = service.start('7', context);
    expect(() => service.get('8', queued.runId)).toThrow(/not found/);
    await waitFor(service, '7', queued.runId, 'awaiting_scope');
    const cancelled = service.cancel('7', queued.runId);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error?.code).toBe('COMPLETENESS_CANCELLED');
  });
});
