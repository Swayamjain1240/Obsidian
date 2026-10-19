import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { CompletenessServiceError } from '../completeness/service.js';
import { errorBody } from '../http/response.js';
import { requireSameOrigin } from '../security.js';
import { BaselineService, BaselineServiceError } from './service.js';
import { DurableRunPersistenceError } from '../workflow/run-store.js';
import { WorkflowPersistenceError } from '../workflow/store.js';

const startSchema = z.object({ completenessRunId: z.string().min(1).max(160) });

function owner(request: Request): string {
  return request.auth?.userId ?? '';
}

function sessionId(response: Response): string {
  const session = response.locals.githubSession as { sessionId?: string } | undefined;
  return session?.sessionId ?? '';
}

function respondError(response: Response, reason: unknown): void {
  if (reason instanceof BaselineServiceError || reason instanceof CompletenessServiceError) {
    response.status(reason.status).json(errorBody(reason.code, reason.message, response.locals.requestId as string));
    return;
  }
  if (reason instanceof DurableRunPersistenceError) {
    response.status(503).json(errorBody('INTERNAL_ERROR', 'Run state could not be durably persisted.', response.locals.requestId as string));
    return;
  }
  if (reason instanceof WorkflowPersistenceError) {
    response.status(503).json(errorBody('INTERNAL_ERROR', 'Workflow state could not be durably read.', response.locals.requestId as string));
    return;
  }
  response.status(500).json(errorBody('INTERNAL_ERROR', 'The baseline request could not be completed.', response.locals.requestId as string));
}

export function createBaselineRouter(config: AppConfig, sessionStore: SessionStore, baseline: BaselineService) {
  const router = Router();
  router.use(requireGithubSession(sessionStore));
  router.use(requireSameOrigin(config.FRONTEND_ORIGIN));

  router.post('/', async (request, response) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Completeness run ID is invalid.', response.locals.requestId as string));
      return;
    }
    try {
       response.status(202).json({ run: await baseline.startDurable(owner(request), parsed.data.completenessRunId, sessionId(response)), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.get('/:runId', async (request, response) => {
    try {
       response.json({ run: await baseline.getDurable(owner(request), request.params.runId, sessionId(response)), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/:runId/cancel', async (request, response) => {
    try {
       response.json({ run: await baseline.cancelDurable(owner(request), request.params.runId, sessionId(response)), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  return router;
}
