import { Router } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { GithubApiClient } from '../github/client.js';
import { RepositoryIntakeService } from './service.js';
import { SnapshotStore } from './snapshot-store.js';

const repositorySchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
  branch: z.string().regex(/^[A-Za-z0-9_.\/-]+$/).max(200),
});

export function createIntakeRouter(config: AppConfig, sessionStore: SessionStore) {
  const router = Router();
  const intake = new RepositoryIntakeService(new SnapshotStore(config.SNAPSHOT_ROOT, config.SNAPSHOT_MAX_BYTES));
  router.use(requireGithubSession(sessionStore));

  router.post('/snapshot', async (request, response) => {
    const parsed = repositorySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Repository reference is invalid.', response.locals.requestId as string));
      return;
    }

    try {
      const session = response.locals.githubSession as { accessToken: string };
      const result = await intake.createSnapshot(new GithubApiClient(session.accessToken), parsed.data);
      response.status(201).json({ intake: result, requestId: response.locals.requestId });
    } catch {
      response.status(502).json(errorBody('GITHUB_API_ERROR', 'Repository snapshot could not be created.', response.locals.requestId as string));
    }
  });

  return router;
}
