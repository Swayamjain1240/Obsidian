import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { SessionStore } from '../auth/session-store.js';

describe('privacy routes', () => {
  it('requires authentication and exposes owner-scoped deletion status', async () => {
    const config = loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' });
    const sessions = new SessionStore('a'.repeat(32));
    const app = createApp(config, { sessionStore: sessions, securityAuditSink: async () => undefined, detectionEventSink: async () => undefined });
    const unauthorized = await request(app).get('/api/v1/privacy/status');
    expect(unauthorized.status).toBe(401);
    const cookie = `obsidian_session=${sessions.create({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' })}`;
    const status = await request(app).get('/api/v1/privacy/status').set('Cookie', cookie);
    expect(status.status).toBe(200);
    expect(status.body.deletion.auditEvidence).toBe('protected');
  });

  it('accepts an authenticated account deletion request with the existing CSRF and JSON controls', async () => {
    const config = loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' });
    const sessions = new SessionStore('b'.repeat(32));
    const app = createApp(config, { sessionStore: sessions, securityAuditSink: async () => undefined, detectionEventSink: async () => undefined });
    const cookie = `obsidian_session=${sessions.create({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' })}`;
    const response = await request(app).post('/api/v1/privacy/deletions').set('Cookie', cookie).set('Origin', config.FRONTEND_ORIGIN).send({ scope: 'account' });
     expect(response.status).toBe(202);
     expect(response.body.deletion.scope).toBe('account');
     expect(response.body.deletion.status).toBe('completed');
     expect(response.body.deletion.ownerUserId).toBeUndefined();
     expect(response.body.deletion.sessionId).toBeUndefined();
   });
});
