import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import { SessionStore } from '../auth/session-store.js';
import { RepositoryIntakeService } from './service.js';
import { SnapshotStore } from './snapshot-store.js';

const config: AppConfig = {
  ...loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' }),
  NODE_ENV: 'test', PORT: 4000, MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test',
  FRONTEND_ORIGIN: 'http://localhost:5173', RATE_LIMIT_WINDOW_MS: 900_000, RATE_LIMIT_MAX_REQUESTS: 100,
  AI_PROVIDER: 'disabled', AI_PROVIDER_TIMEOUT_MS: 10_000, GITHUB_OAUTH_SCOPES: 'read:user,repo',
  SNAPSHOT_MAX_BYTES: 52_428_800, SNAPSHOT_ROOT: '.obsidian-workspaces',
  AUTH_SESSION_SECRET: 'a'.repeat(32),
};

describe('snapshot intake route', () => {
  it('requires an authenticated session', async () => {
    const response = await request(createApp(config)).post('/api/v1/intake/snapshot').send({ owner: 'o', name: 'r', branch: 'main' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('creates an authenticated immutable snapshot without exposing its filesystem path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-router-'));
    const sessionStore = new SessionStore('a'.repeat(32));
    const signedSession = sessionStore.create({ githubUserId: 1, githubLogin: 'user', accessToken: 'github-token' });
     const fetchMock = vi
       .fn()
       .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 9, name: 'repo', full_name: 'owner/repo', private: true, default_branch: 'main', html_url: 'https://github.com/owner/repo', language: 'TypeScript', updated_at: new Date(0).toISOString() }) })
       .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'c'.repeat(40) }) })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '4' }),
        arrayBuffer: async () => new TextEncoder().encode('data').buffer,
      });
     vi.stubGlobal('fetch', fetchMock);

     try {
       const app = createApp(config, { sessionStore, intakeService: new RepositoryIntakeService(new SnapshotStore(root, 1024)) });
       await request(app)
         .post('/api/v1/github/repositories/select')
         .set('Cookie', `obsidian_session=${signedSession}`)
         .set('Origin', config.FRONTEND_ORIGIN)
         .send({ repositoryId: 9, owner: 'owner', name: 'repo' });
       const response = await request(
         app,
      )
         .post('/api/v1/intake/snapshot')
         .set('Cookie', `obsidian_session=${signedSession}`)
         .set('Origin', config.FRONTEND_ORIGIN)
        .send({ owner: 'owner', name: 'repo', branch: 'main' });

      expect(response.status).toBe(201);
      expect(response.body.intake.snapshot.immutable).toBe(true);
      expect(response.body.intake.snapshot.repository.commitSha).toBe('c'.repeat(40));
      expect(response.body.intake.snapshot.archivePath).toBeUndefined();
      expect(response.body.intake.snapshotHandle).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    } finally {
      vi.unstubAllGlobals();
      await rm(root, { recursive: true, force: true });
    }
  });
});
