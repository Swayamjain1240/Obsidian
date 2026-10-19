import { Router } from 'express';

import { errorBody } from '../http/response.js';
import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import { GithubApiClient } from './client.js';
import { requireSameOrigin } from '../security.js';
import type { AppConfig } from '../config.js';
import { z } from 'zod';
import { RepositorySelectionStore } from '../intake/repository-authorization.js';

const selectionSchema = z.object({ repositoryId: z.number().int().positive(), owner: z.string().min(1).max(100), name: z.string().min(1).max(100), branch: z.string().regex(/^[A-Za-z0-9_.\/-]+$/).max(200).optional() });

export function createGithubRouter(sessionStore: SessionStore, config?: AppConfig, selectionStore = new RepositorySelectionStore()) {
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

  router.post('/repositories/select', config ? requireSameOrigin(config.FRONTEND_ORIGIN) : (_request, _response, next) => next(), async (request, response) => {
    const parsed = selectionSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Repository selection is invalid.', response.locals.requestId as string)); return; }
    const session = response.locals.githubSession as { accessToken: string; sessionId: string; githubUserId: number };
    let repository: Awaited<ReturnType<GithubApiClient['getRepository']>>;
    try {
      repository = await new GithubApiClient(session.accessToken).getRepository(parsed.data.owner, parsed.data.name);
    } catch {
      response.status(404).json(errorBody('REPOSITORY_NOT_FOUND', 'The repository is not available to this GitHub session.', response.locals.requestId as string));
      return;
    }
    if (repository.id !== parsed.data.repositoryId) {
      response.status(404).json(errorBody('REPOSITORY_NOT_FOUND', 'The repository is not available to this GitHub session.', response.locals.requestId as string));
      return;
    }
    const selected = selectionStore.select(String(session.githubUserId), session.sessionId, repository, parsed.data.branch ?? repository.default_branch);
    try {
      await selectionStore.persist(String(session.githubUserId), session.sessionId);
    } catch {
      selectionStore.clear(String(session.githubUserId), session.sessionId);
      response.status(503).json(errorBody('INTERNAL_ERROR', 'The repository selection could not be durably recorded.', response.locals.requestId as string));
      return;
    }
    response.status(201).json({ repository: selected.repository, branch: selected.selectedBranch, selectedAt: selected.selectedAt, requestId: response.locals.requestId });
  });

  return router;
}
