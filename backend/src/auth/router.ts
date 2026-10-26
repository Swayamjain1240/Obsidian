import { Router, type Request } from 'express';

import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { getGithubOAuthConfig } from './oauth-config.js';
import { createGithubAuthorizationUrl } from './oauth-url.js';
import { OAuthStateStore } from './oauth-state.js';
import { GithubApiClient } from '../github/client.js';
import { SessionPersistenceError, SessionStore } from './session-store.js';
import { getCookie } from './session-middleware.js';
import { requireSameOrigin } from '../security.js';

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
      const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
      response.append(
        'Set-Cookie',
        `obsidian_oauth_binding=${encodeURIComponent(challenge.browserBinding)}; Max-Age=600; Path=/auth/github; HttpOnly; SameSite=Lax${secure}`,
      );
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

      const stateRecord = stateStore.consume(state, getCookie(request, 'obsidian_oauth_binding'));
      if (!stateRecord) throw new Error('GitHub OAuth state is invalid or expired.');

      const client = await GithubApiClient.exchangeCode({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        code,
        redirectUri: oauthConfig.callbackUrl,
        codeVerifier: stateRecord.codeVerifier,
      });
      const user = await client.getCurrentUser();
      const signedSession = await sessionStore.createAsync({
        githubUserId: user.id,
        githubLogin: user.login,
        accessToken: client.getAccessToken(),
      });

      const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
      response.append(
        'Set-Cookie',
         `obsidian_session=${signedSession}; Max-Age=${Math.floor(config.AUTH_SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
      );
      response.append(
        'Set-Cookie',
        `obsidian_oauth_binding=; Max-Age=0; Path=/auth/github; HttpOnly; SameSite=Lax${secure}`,
      );
      response.redirect(`${config.FRONTEND_ORIGIN}/home`);
    } catch (reason: unknown) {
      if (reason instanceof SessionPersistenceError) {
        response.status(503).json(errorBody('INTERNAL_ERROR', 'Authentication session could not be durably recorded.', response.locals.requestId as string));
        return;
      }
      response.status(400).json(
        errorBody('AUTH_CALLBACK_FAILED', 'GitHub sign-in could not be completed.', response.locals.requestId as string),
      );
    }
  });

  router.get('/me', async (request, response) => {
    const signedSession = getCookie(request, 'obsidian_session');
    const session = signedSession && sessionStore ? await sessionStore.getAsync(signedSession) : null;
    response.json({
      user: session ? { id: session.githubUserId, login: session.githubLogin } : null,
      configured: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET && config.GITHUB_CALLBACK_URL && config.AUTH_SESSION_SECRET),
      requestId: response.locals.requestId,
    });
  });

  router.post('/logout', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const signedSession = getCookie(request, 'obsidian_session');
    if (signedSession && sessionStore) await sessionStore.deleteAsync(signedSession);
    const secure = config.NODE_ENV === 'production' ? '; Secure' : '';
    response.append('Set-Cookie', `obsidian_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
    response.status(204).send();
  });

  return router;
}
