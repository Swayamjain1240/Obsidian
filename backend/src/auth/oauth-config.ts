import type { AppConfig } from '../config.js';

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes: string[];
  sessionSecret: string;
}

export function getGithubOAuthConfig(config: AppConfig): GithubOAuthConfig {
  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET || !config.GITHUB_CALLBACK_URL || !config.AUTH_SESSION_SECRET) {
    throw new Error('GitHub OAuth App configuration is incomplete.');
  }

  return {
    clientId: config.GITHUB_CLIENT_ID,
    clientSecret: config.GITHUB_CLIENT_SECRET,
    callbackUrl: config.GITHUB_CALLBACK_URL,
    scopes: config.GITHUB_OAUTH_SCOPES.split(',').map((scope) => scope.trim()).filter(Boolean),
    sessionSecret: config.AUTH_SESSION_SECRET,
  };
}
