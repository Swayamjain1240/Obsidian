import { Router } from 'express';

import { errorBody } from '../http/response.js';
import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import { GithubApiClient } from './client.js';

export function createGithubRouter(sessionStore: SessionStore) {
  const router = Router();
  router.use(requireGithubSession(sessionStore));

  router.get('/repositories', async (request, response) => {
    try {
      const page = Math.max(Number(request.query.page ?? 1), 1);
      const perPage = Math.min(Math.max(Number(request.query.perPage ?? 20), 1), 100);
      if (!Number.isInteger(page) || !Number.isInteger(perPage)) {
        response.status(400).json(errorBody('INVALID_INPUT', 'Pagination values are invalid.', response.locals.requestId as string));
        return;
      }

      const session = response.locals.githubSession as { accessToken: string };
      const repositories = await new GithubApiClient(session.accessToken).listRepositories(page, perPage);
      response.json({ repositories, pagination: { page, perPage }, requestId: response.locals.requestId });
    } catch {
      response.status(502).json(errorBody('GITHUB_API_ERROR', 'GitHub repository data is unavailable.', response.locals.requestId as string));
    }
  });

  return router;
}
