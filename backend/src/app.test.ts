import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { loadConfig, type AppConfig } from './config.js';

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
};

describe('backend health routes', () => {
  const app = createApp(config);

  it('reports process liveness', async () => {
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows only the configured frontend origin', async () => {
    const response = await request(app)
      .get('/health/live')
      .set('Origin', 'https://untrusted.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not claim readiness before MongoDB is connected', async () => {
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks.mongodb).toBe('not_connected');
  });

  it('uses the secure error envelope for unknown routes', async () => {
    const response = await request(app).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBe('Route not found.');
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('returns structured errors for malformed and oversized JSON bodies', async () => {
    const malformed = await request(app)
      .post('/auth/logout')
      .set('Origin', config.FRONTEND_ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_INPUT');
    expect(malformed.body.error.requestId).toBeTruthy();

    const oversized = await request(app)
      .post('/auth/logout')
      .set('Origin', config.FRONTEND_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ payload: 'x'.repeat(110_000) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(oversized.body.error.requestId).toBeTruthy();
  });

  it('treats malformed session cookies as unauthenticated instead of throwing', async () => {
    const response = await request(app).get('/auth/me').set('Cookie', 'obsidian_session=%');
    expect(response.status).toBe(200);
    expect(response.body.user).toBeNull();
  });
});
