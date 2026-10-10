import { Router } from 'express';

import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { getGithubOAuthConfig } from './oauth-config.js';
import { createGithubAuthorizationUrl } from './oauth-url.js';
import { OAuthStateStore } from './oauth-state.js';

export function createAuthRouter(config: AppConfig, stateStore = new OAuthStateStore()) {
  const router = Router();

  router.get('/github/start', (request, response) => {
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

  return router;
}
