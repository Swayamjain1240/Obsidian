import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import { SessionStore } from '../auth/session-store.js';
import { DurableWorkflowStore } from './store.js';
import { WorkflowService } from './service.js';

const config: AppConfig = {
  ...loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' }),
  NODE_ENV: 'test', PORT: 4000, MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173',
  RATE_LIMIT_WINDOW_MS: 900_000, RATE_LIMIT_MAX_REQUESTS: 100, AI_PROVIDER: 'disabled', AI_PROVIDER_TIMEOUT_MS: 10_000,
  GITHUB_OAUTH_SCOPES: 'read:user,repo', SNAPSHOT_MAX_BYTES: 52_428_800, SNAPSHOT_ROOT: '.obsidian-workspaces', AUTH_SESSION_SECRET: 'a'.repeat(32),
};

function setup() {
  const snapshot = { snapshotId: 'workflow-snapshot', repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) }, archivePath: 'archive.tar.gz', manifestPath: 'snapshot.json', archiveSha256: 'b'.repeat(64), byteLength: 1, capturedAt: new Date(0).toISOString(), immutable: true as const };
  const sessionStore = new SessionStore('a'.repeat(32));
  const cookie = sessionStore.create({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' });
  const sessionId = sessionStore.get(cookie)!.sessionId;
  const baseline = {
    get: () => ({ runId: 'baseline-1', completenessRunId: 'completeness-1', snapshotId: snapshot.snapshotId, baseCommit: 'a'.repeat(40), status: 'failed' as const, checks: [{ id: 'build', category: 'build' as const, label: 'Build', status: 'failed' as const, summary: 'Build failed.', commandLabel: null, exitCode: 1, durationMs: 1, evidenceRefs: [{ path: 'src/build.ts', reason: 'Build evidence.' }] }] }),
    getDurable: async () => baseline.get(),
    selectedContext: () => ({ baselineRunId: 'baseline-1', completenessRunId: 'completeness-1', scopeMode: 'EXISTING_ONLY' as const, context: { detectionRunId: 'detection-1', ownerUserId: '7', sessionId, snapshot, baseCommit: 'a'.repeat(40), archiveSha256: snapshot.archiveSha256, languageCandidates: ['TypeScript'] } }),
    selectedContextDurable: async () => baseline.selectedContext(),
  };
  const completeness = { get: async () => ({ areas: [] }), getDurable: async () => ({ areas: [] }) };
  const workflow = new WorkflowService(config, baseline as never, completeness as never, new DurableWorkflowStore());
  return { app: createApp(config, { sessionStore, workflowService: workflow }), cookie };
}

describe('workflow mutation protocol', () => {
  it('requires revision and idempotency headers, then replays the original receipt', async () => {
    const { app, cookie } = setup();
    const missing = await request(app).post('/api/v1/workflow/repairs').set('Cookie', `obsidian_session=${cookie}`).set('Origin', config.FRONTEND_ORIGIN).send({ baselineRunId: 'baseline-1' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('WORKFLOW_INPUT_INVALID');

    const headers = { Cookie: `obsidian_session=${cookie}`, Origin: config.FRONTEND_ORIGIN, 'Idempotency-Key': 'repair-create-1', 'X-Workflow-Revision': '0' };
    const first = await request(app).post('/api/v1/workflow/repairs').set(headers).send({ baselineRunId: 'baseline-1' });
    const replay = await request(app).post('/api/v1/workflow/repairs').set(headers).send({ baselineRunId: 'baseline-1' });
    const changed = await request(app).post('/api/v1/workflow/repairs').set(headers).send({ baselineRunId: 'different' });
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.body.plan.planId).toBe(first.body.plan.planId);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('WORKFLOW_IDEMPOTENCY_CONFLICT');
  });
});
