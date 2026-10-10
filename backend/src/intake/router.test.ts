import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { AppConfig } from '../config.js';

const config: AppConfig = {
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
});
