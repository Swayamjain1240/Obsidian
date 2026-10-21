import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { SessionStore } from '../auth/session-store.js';
import { loadConfig, type AppConfig } from '../config.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import { SnapshotHandleStore } from '../intake/handle-store.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import { DetectionService, type DetectionEngine } from '../detection/service.js';
import { CompletenessService, type CompletenessEngine } from './service.js';

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
  snapshotId: 'router-completeness-snapshot',
  repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'd'.repeat(40) },
  archivePath: 'archive.tar.gz',
  manifestPath: 'snapshot.json',
  archiveSha256: 'e'.repeat(64),
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
  extractedBytes: 1,
  fileManifestSha256: 'f'.repeat(64),
  status: 'completed',
  capturedAt: new Date(0).toISOString(),
  workspacePath: 'workspace',
  manifestPath: 'files.json',
};

const detectionEngine: DetectionEngine = {
  extract: async (_snapshot, _policy, onProgress) => { onProgress('reused', { files: 1, bytes: 1 }); return extraction; },
  scan: async () => ({
    candidates: [{ id: 'typescript', language: 'TypeScript', frameworks: [], packageManager: 'npm', evidenceStrength: 'strong' as const, evidenceRefs: [], adapterAvailable: true }],
    primaryCandidateId: 'typescript',
    unknownReason: null,
    fileCount: 1,
    evidenceFileCount: 1,
    policyVersion: 'part4-v1',
  }),
};

const completenessEngine: CompletenessEngine = {
  extract: async (_snapshot, _policy, onProgress) => { onProgress('reused', { files: 1, bytes: 1 }); return extraction; },
  scan: async () => ({ projectStatus: 'working' as const, areas: [], findings: [], fileCount: 1, scannedFileCount: 1, scannedBytes: 1, limited: false, warning: null, policyVersion: 'part5-v1' }),
};

async function waitForDetection(service: DetectionService, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.get('7', runId).status === 'awaiting_confirmation') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('detection did not reach confirmation');
}

async function waitForCompleteness(service: CompletenessService, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.get('7', runId).status === 'awaiting_scope') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('completeness did not reach scope selection');
}

describe('completeness routes', () => {
  it('requires confirmed detection, then exposes review and scope selection through the authenticated API', async () => {
    const sessionStore = new SessionStore('a'.repeat(32));
    const signedSession = sessionStore.create({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' });
    const cookie = `obsidian_session=${signedSession}`;
    const handles = new SnapshotHandleStore();
    const handle = handles.create('7', snapshot, Date.now(), sessionStore.get(signedSession)!.sessionId);
    const detection = new DetectionService(config, handles, detectionEngine);
    const completeness = new CompletenessService(config, completenessEngine);
    const app = createApp(config, { sessionStore, handleStore: handles, detectionService: detection, completenessService: completeness });

    const startedDetection = await request(app).post('/api/v1/intake/detections').set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ snapshotHandle: handle });
    const detectionRunId = startedDetection.body.run.runId as string;
    const beforeConfirmation = await request(app).post('/api/v1/intake/completeness').set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ detectionRunId });
    expect(beforeConfirmation.status).toBe(409);
    expect(beforeConfirmation.body.error.code).toBe('DETECTION_STATE_INVALID');

    await waitForDetection(detection, detectionRunId);
    const confirmed = await request(app).post(`/api/v1/intake/detections/${detectionRunId}/confirm`).set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ candidateIds: ['typescript'], notDetected: false });
    expect(confirmed.status).toBe(200);

    const started = await request(app).post('/api/v1/intake/completeness').set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ detectionRunId });
    expect(started.status).toBe(202);
    const runId = started.body.run.runId as string;
    await waitForCompleteness(completeness, runId);
    const loaded = await request(app).get(`/api/v1/intake/completeness/${runId}`).set('Cookie', cookie);
    expect(loaded.status).toBe(200);
    expect(loaded.body.run.status).toBe('awaiting_scope');

    const scope = await request(app).post(`/api/v1/intake/completeness/${runId}/scope`).set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ mode: 'FULL' });
    expect(scope.status).toBe(200);
    expect(scope.body.run.scopeMode).toBe('FULL');
    expect(scope.body.run.nextPhase).toBe('baseline_testing');
  });
});
