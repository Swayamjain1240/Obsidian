import { describe, expect, it } from 'vitest';

import { getGithubOAuthConfig } from './oauth-config.js';
import { loadConfig, type AppConfig } from '../config.js';

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

describe('GitHub OAuth configuration', () => {
  it('parses configured OAuth App values', () => {
    const result = getGithubOAuthConfig(config);

    expect(result.clientId).toBe('client-id');
    expect(result.scopes).toEqual(['read:user', 'repo']);
    expect(result.clientSecret).toBe('client-secret');
  });

  it('rejects incomplete OAuth configuration', () => {
    expect(() => getGithubOAuthConfig({ ...config, GITHUB_CLIENT_SECRET: undefined })).toThrow(/incomplete/);
  });

  it('rejects administrative or write-capable OAuth scopes', () => {
    expect(() => getGithubOAuthConfig({ ...config, GITHUB_OAUTH_SCOPES: 'read:user,delete_repo' })).toThrow(/least-privilege/);
    expect(() => getGithubOAuthConfig({ ...config, GITHUB_OAUTH_SCOPES: 'admin:org' })).toThrow(/least-privilege/);
  });
});
