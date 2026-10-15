import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { requireSameOrigin } from '../security.js';
import { DetectionService, DetectionServiceError } from './service.js';

const startSchema = z.object({ snapshotHandle: z.string().min(32).max(256) });
const confirmationSchema = z.object({
  candidateIds: z.array(z.string().min(1).max(160)).max(100),
  notDetected: z.boolean(),
});

function owner(request: Request): string {
  return request.auth?.userId ?? '';
}

function sessionId(response: Response): string {
  const session = response.locals.githubSession as { sessionId?: string } | undefined;
  return session?.sessionId ?? '';
}

function respondError(response: Response, reason: unknown): void {
  if (reason instanceof DetectionServiceError) {
    response.status(reason.status).json(errorBody(reason.code, reason.message, response.locals.requestId as string));
    return;
  }
  response.status(500).json(errorBody('INTERNAL_ERROR', 'The detection request could not be completed.', response.locals.requestId as string));
}

export function createDetectionRouter(config: AppConfig, sessionStore: SessionStore, detection: DetectionService) {
  const router = Router();
  router.use(requireGithubSession(sessionStore));
  router.use(requireSameOrigin(config.FRONTEND_ORIGIN));

  router.post('/', (request, response) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Snapshot handle is invalid.', response.locals.requestId as string));
      return;
    }
    try {
      response.status(202).json({ run: detection.start(owner(request), parsed.data.snapshotHandle, sessionId(response)), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.get('/:runId', (request, response) => {
    try {
      response.json({ run: detection.get(owner(request), request.params.runId), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/:runId/confirm', (request, response) => {
    const parsed = confirmationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Confirmation payload is invalid.', response.locals.requestId as string));
      return;
    }
    try {
      response.json({ run: detection.confirm(owner(request), request.params.runId, parsed.data.candidateIds, parsed.data.notDetected), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/:runId/rescan', (request, response) => {
    try {
      response.status(202).json({ run: detection.rescan(owner(request), request.params.runId), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/:runId/cancel', (request, response) => {
    try {
      response.json({ run: detection.cancel(owner(request), request.params.runId), requestId: response.locals.requestId });
    } catch (reason: unknown) { respondError(response, reason); }
  });

  return router;
}
