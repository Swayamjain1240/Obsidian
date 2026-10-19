import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import { SessionStore } from '../auth/session-store.js';
import { SnapshotHandleStore } from '../intake/handle-store.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { SnapshotRecord } from '../intake/snapshot.js';
import { DetectionService, type DetectionEngine } from './service.js';

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
  snapshotId: 'router-snapshot',
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

const engine: DetectionEngine = {
  extract: async (_snapshot, _policy, onProgress) => { onProgress('completed', { files: 1, bytes: 1 }); return extraction; },
  scan: async () => ({ candidates: [], primaryCandidateId: null, unknownReason: 'No supported stack evidence was found.', fileCount: 1, evidenceFileCount: 0, policyVersion: 'part4-v1' }),
};

describe('detection routes', () => {
  it('protects the full run lifecycle with the authenticated session and same-origin checks', async () => {
    const sessionStore = new SessionStore('a'.repeat(32));
    const signedSession = sessionStore.create({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' });
    const handles = new SnapshotHandleStore();
    const handle = handles.create('7', snapshot, Date.now(), sessionStore.get(signedSession)!.sessionId);
    const app = createApp(config, { sessionStore, handleStore: handles, detectionService: new DetectionService(config, handles, engine) });
    const cookie = `obsidian_session=${signedSession}`;

    const started = await request(app).post('/api/v1/intake/detections').set('Cookie', cookie).send({ snapshotHandle: handle });
    expect(started.status).toBe(202);
    const runId = started.body.run.runId as string;

    const loaded = await request(app).get(`/api/v1/intake/detections/${runId}`).set('Cookie', cookie);
    expect(loaded.status).toBe(200);
    expect(loaded.body.run.snapshotId).toBe(snapshot.snapshotId);

    const wrongOrigin = await request(app).post(`/api/v1/intake/detections/${runId}/cancel`).set('Cookie', cookie).set('Origin', 'https://untrusted.example').send({});
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.body.error.code).toBe('CSRF_ORIGIN_REJECTED');
  });

  it('does not disclose another user’s run or snapshot handle', async () => {
    const first = new SessionStore('a'.repeat(32));
    const firstCookie = `obsidian_session=${first.create({ githubUserId: 7, githubLogin: 'one', accessToken: 'token' })}`;
    const secondCookie = `obsidian_session=${first.create({ githubUserId: 8, githubLogin: 'two', accessToken: 'token' })}`;
    const handles = new SnapshotHandleStore();
    const handle = handles.create('7', snapshot, Date.now(), first.get(firstCookie.split('=')[1])!.sessionId);
    const app = createApp(config, { sessionStore: first, handleStore: handles, detectionService: new DetectionService(config, handles, engine) });

    const started = await request(app).post('/api/v1/intake/detections').set('Cookie', firstCookie).send({ snapshotHandle: handle });
    const runId = started.body.run.runId as string;
    const forbidden = await request(app).get(`/api/v1/intake/detections/${runId}`).set('Cookie', secondCookie);
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('DETECTION_NOT_FOUND');
  });
});
