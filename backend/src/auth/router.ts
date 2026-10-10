import { Router, type Request } from 'express';

import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { getGithubOAuthConfig } from './oauth-config.js';
import { createGithubAuthorizationUrl } from './oauth-url.js';
import { OAuthStateStore } from './oauth-state.js';
import { GithubApiClient } from '../github/client.js';
import { SessionStore } from './session-store.js';

function queryString(request: Request, key: string): string | null {
  const value = request.query[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createAuthRouter(
  config: AppConfig,
  stateStore = new OAuthStateStore(),
  sessionStore?: SessionStore,
) {
  const router = Router();

  router.get('/github/start', (_request, response) => {
    try {
      const oauthConfig = getGithubOAuthConfig(config);
      const challenge = stateStore.create();
      response.redirect(createGithubAuthorizationUrl(oauthConfig, challenge));
    } catch {
      response.status(503).json(
        errorBody('AUTH_NOT_CONFIGURED', 'GitHub sign-in is not configured.', response.locals.requestId as string),
      );
    }
  });

  router.get('/github/callback', async (request, response) => {
    try {
      const oauthConfig = getGithubOAuthConfig(config);
      if (!sessionStore) throw new Error('Session store is not configured.');
      const code = queryString(request, 'code');
      const state = queryString(request, 'state');
      if (!code || !state) throw new Error('GitHub callback is missing code or state.');

      const stateRecord = stateStore.consume(state);
      if (!stateRecord) throw new Error('GitHub OAuth state is invalid or expired.');

      const client = await GithubApiClient.exchangeCode({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        code,
        redirectUri: oauthConfig.callbackUrl,
        codeVerifier: stateRecord.codeVerifier,
      });
      const user = await client.getCurrentUser();
      const signedSession = sessionStore.create({
        githubUserId: user.id,
        githubLogin: user.login,
        accessToken: client.getAccessToken(),
      });

      const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
      response.append(
        'Set-Cookie',
        `obsidian_session=${signedSession}; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax${secure}`,
      );
      response.redirect('/home');
    } catch {
      response.status(400).json(
        errorBody('AUTH_CALLBACK_FAILED', 'GitHub sign-in could not be completed.', response.locals.requestId as string),
      );
    }
  });

  return router;
}
