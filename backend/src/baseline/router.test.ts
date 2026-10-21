import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { SessionStore } from '../auth/session-store.js';
import { loadConfig, type AppConfig } from '../config.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import type { ConfirmedDetectionContext } from '../detection/service.js';
import type { BaselinePlan } from './adapters.js';
import { BaselineService, type BaselineEngine, type BaselineScopeProvider } from './service.js';

const config: AppConfig = {
  ...loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' }),
  NODE_ENV: 'test', PORT: 4000, MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173',
  RATE_LIMIT_WINDOW_MS: 900_000, RATE_LIMIT_MAX_REQUESTS: 100, AI_PROVIDER: 'disabled', AI_PROVIDER_TIMEOUT_MS: 10_000,
  GITHUB_OAUTH_SCOPES: 'read:user,repo', SNAPSHOT_MAX_BYTES: 52_428_800, SNAPSHOT_ROOT: '.obsidian-workspaces', AUTH_SESSION_SECRET: 'a'.repeat(32),
};

const snapshot: SnapshotRecord = {
  snapshotId: 'baseline-router-snapshot', repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'd'.repeat(40) }, archivePath: 'archive.tar.gz', manifestPath: 'snapshot.json', archiveSha256: 'b'.repeat(64), byteLength: 1, capturedAt: new Date(0).toISOString(), immutable: true,
};
const extraction: ExtractionRecord = {
  snapshotId: snapshot.snapshotId, archiveSha256: snapshot.archiveSha256, extractionPolicyVersion: 'part4-v1', extractedFileCount: 1, extractedDirectoryCount: 0, extractedBytes: 1, fileManifestSha256: 'c'.repeat(64), status: 'completed', capturedAt: new Date(0).toISOString(), workspacePath: 'workspace', manifestPath: 'files.json',
};
const context: ConfirmedDetectionContext = {
  detectionRunId: 'detection-router', ownerUserId: '7', sessionId: 'session-router', snapshot, baseCommit: 'd'.repeat(40), archiveSha256: snapshot.archiveSha256, languageCandidates: ['TypeScript'],
};
const provider: BaselineScopeProvider = { selectedContext: () => ({ completenessRunId: 'completeness-router', scopeMode: 'EXISTING_ONLY', context }) };
const plan: BaselinePlan = {
  checks: [{ id: 'unit', category: 'unit', label: 'Unit tests', commandLabel: 'fake unit', command: { id: 'unit', category: 'unit', label: 'Unit tests', commandLabel: 'fake unit', executable: 'node', args: ['--version'], evidenceRefs: [] }, initialStatus: 'queued', summary: 'Available.', evidenceRefs: [] }],
  fileCount: 1, limited: false, warning: null,
};
const engine: BaselineEngine = {
  extract: async () => extraction,
  discover: async () => plan,
  run: async () => ({ status: 'passed', exitCode: 0, durationMs: 1, outputBytes: 0, outputTruncated: false, summary: 'Unit tests completed successfully.' }),
};

async function waitFor(service: BaselineService, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.get('7', runId).status === 'passed') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('baseline did not pass');
}

describe('baseline routes', () => {
  it('requires authentication and exposes owner-bound start, read, and cancel routes', async () => {
    const sessionStore = new SessionStore('a'.repeat(32));
    const cookie = `obsidian_session=${sessionStore.create({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' })}`;
    const baseline = new BaselineService(config, provider, engine);
    const app = createApp(config, { sessionStore, baselineService: baseline });

    const unauthenticated = await request(app).post('/api/v1/intake/baseline').send({ completenessRunId: 'completeness-router' });
    expect(unauthenticated.status).toBe(401);
    const invalid = await request(app).post('/api/v1/intake/baseline').set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ completenessRunId: '' });
    expect(invalid.status).toBe(400);

    const started = await request(app).post('/api/v1/intake/baseline').set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ completenessRunId: 'completeness-router' });
    expect(started.status).toBe(202);
    const runId = started.body.run.runId as string;
    await waitFor(baseline, runId);
    const loaded = await request(app).get(`/api/v1/intake/baseline/${runId}`).set('Cookie', cookie);
    expect(loaded.status).toBe(200);
    expect(loaded.body.run.scopeMode).toBe('EXISTING_ONLY');
    const cancelled = await request(app).post(`/api/v1/intake/baseline/${runId}/cancel`).set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.run.status).toBe('passed');
  });
});
