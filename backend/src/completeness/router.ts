import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { DetectionService, DetectionServiceError } from '../detection/service.js';
import { errorBody } from '../http/response.js';
import { requireSameOrigin } from '../security.js';
import { CompletenessService, CompletenessServiceError } from './service.js';

const startSchema = z.object({ detectionRunId: z.string().min(1).max(160) });
const scopeSchema = z.object({ mode: z.enum(['FULL', 'EXISTING_ONLY']) });

function owner(request: Request): string {
  return request.auth?.userId ?? '';
}

function sessionId(response: Response): string {
  const session = response.locals.githubSession as { sessionId?: string } | undefined;
  return session?.sessionId ?? '';
}

function respondError(response: Response, reason: unknown): void {
  if (reason instanceof DetectionServiceError || reason instanceof CompletenessServiceError) {
    response.status(reason.status).json(errorBody(reason.code, reason.message, response.locals.requestId as string));
    return;
  }
  response.status(500).json(errorBody('INTERNAL_ERROR', 'The completeness request could not be completed.', response.locals.requestId as string));
}

export function createCompletenessRouter(
  config: AppConfig,
  sessionStore: SessionStore,
  detection: DetectionService,
  completeness: CompletenessService,
) {
  const router = Router();
  router.use(requireGithubSession(sessionStore));
  router.use(requireSameOrigin(config.FRONTEND_ORIGIN));

  router.post('/', (request, response) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Detection run ID is invalid.', response.locals.requestId as string));
      return;
    }
    try {
      const context = detection.confirmedContext(owner(request), parsed.data.detectionRunId);
      response.status(202).json({ run: completeness.start(owner(request), context, sessionId(response)), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.get('/:runId', (request, response) => {
    try {
      response.json({ run: completeness.get(owner(request), request.params.runId), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/:runId/scope', (request, response) => {
    const parsed = scopeSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Scope mode is invalid.', response.locals.requestId as string));
      return;
    }
    try {
      response.json({ run: completeness.selectScope(owner(request), request.params.runId, parsed.data.mode), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/:runId/cancel', (request, response) => {
    try {
      response.json({ run: completeness.cancel(owner(request), request.params.runId), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  return router;
}
