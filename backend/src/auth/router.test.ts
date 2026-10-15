import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, type AppConfig } from '../config.js';
import { createAuthRouter } from './router.js';
import { OAuthStateStore } from './oauth-state.js';
import { SessionStore } from './session-store.js';

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
  GITHUB_CLIENT_ID: 'client-id',
  GITHUB_CLIENT_SECRET: 'client-secret',
  GITHUB_CALLBACK_URL: 'http://localhost:4000/auth/github/callback',
  GITHUB_OAUTH_SCOPES: 'read:user,repo',
  AUTH_SESSION_SECRET: 'a'.repeat(32),
  SNAPSHOT_MAX_BYTES: 52_428_800,
  SNAPSHOT_ROOT: '.obsidian-workspaces',
};

function makeApp(stateStore: OAuthStateStore, sessionStore: SessionStore) {
  const app = express();
  app.use((_request, response, next) => {
    response.locals.requestId = 'auth-test';
    next();
  });
  app.use('/auth', createAuthRouter(config, stateStore, sessionStore));
  return app;
}

function cookieValue(setCookies: string[] | undefined, name: string): string {
  const cookie = setCookies?.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Missing ${name} cookie`);
  return cookie.split(';', 1)[0];
}

describe('authentication router', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('binds OAuth state to the browser cookie, clears it after callback, and protects logout by origin', async () => {
    const stateStore = new OAuthStateStore();
    const sessionStore = new SessionStore('a'.repeat(32));
    const app = makeApp(stateStore, sessionStore);

    const firstStart = await request(app).get('/auth/github/start');
    expect(firstStart.status).toBe(302);
    const firstState = new URL(firstStart.headers.location).searchParams.get('state');
    expect(firstState).toBeTruthy();
    const firstBinding = cookieValue(firstStart.headers['set-cookie'], 'obsidian_oauth_binding');

    const rejected = await request(app)
      .get(`/auth/github/callback?code=oauth-code&state=${encodeURIComponent(firstState!)}`)
      .set('Cookie', 'obsidian_oauth_binding=wrong-browser');
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('AUTH_CALLBACK_FAILED');

    const secondStart = await request(app).get('/auth/github/start');
    const secondState = new URL(secondStart.headers.location).searchParams.get('state');
    const secondBinding = cookieValue(secondStart.headers['set-cookie'], 'obsidian_oauth_binding');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'server-only-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 7, login: 'octocat', name: null }) });
    vi.stubGlobal('fetch', fetchMock);

    const callback = await request(app)
      .get(`/auth/github/callback?code=oauth-code&state=${encodeURIComponent(secondState!)}`)
      .set('Cookie', secondBinding);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:5173/home');
    expect(callback.headers['set-cookie'].some((value: string) => value.startsWith('obsidian_session='))).toBe(true);
    expect(callback.headers['set-cookie'].some((value: string) => value.startsWith('obsidian_oauth_binding=; Max-Age=0'))).toBe(true);
    expect(JSON.stringify(callback.headers['set-cookie'])).not.toContain('server-only-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const sessionCookie = cookieValue(callback.headers['set-cookie'], 'obsidian_session');
    const csrfRejected = await request(app).post('/auth/logout').set('Cookie', sessionCookie).set('Origin', 'https://evil.example');
    expect(csrfRejected.status).toBe(403);
    expect(csrfRejected.body.error.code).toBe('CSRF_ORIGIN_REJECTED');

    const logout = await request(app).post('/auth/logout').set('Cookie', sessionCookie).set('Origin', config.FRONTEND_ORIGIN);
    expect(logout.status).toBe(204);
    expect(sessionStore.get(sessionCookie)).toBeNull();
    expect(firstBinding).toMatch(/^obsidian_oauth_binding=/);
  });
});
