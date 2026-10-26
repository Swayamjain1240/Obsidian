import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { requireSameOrigin } from '../security.js';
import { PrivacyDeletionService, type PublicDeletionRequest } from './deletion.js';

const deletionSchema = z.object({ scope: z.enum(['account', 'workflow']), targetId: z.string().min(1).max(160).optional() }).superRefine((value, context) => {
  if (value.scope === 'workflow' && !value.targetId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: 'A workflow target is required.' });
  if (value.scope === 'account' && value.targetId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: 'Account deletion cannot include a workflow target.' });
});

function owner(request: Request): string { return request.auth?.userId ?? ''; }
function sessionId(response: Response): string { return String((response.locals.githubSession as { sessionId?: string } | undefined)?.sessionId ?? ''); }
function param(request: Request): string { const value = request.params.requestId; return Array.isArray(value) ? value[0] : value; }

export function createPrivacyRouter(config: AppConfig, sessions: SessionStore, deletion: PrivacyDeletionService) {
  const router = Router();
  router.use(requireGithubSession(sessions));
  router.get('/status', (_request, response) => {
    response.json({ status: 'available', deletion: { account: 'owner_scoped', workflow: 'owner_scoped', auditEvidence: 'protected' }, retention: { snapshotMs: config.PRIVACY_SNAPSHOT_RETENTION_MS, workspaceMs: config.PRIVACY_WORKSPACE_RETENTION_MS, runMs: config.PRIVACY_RUN_RETENTION_MS, previewMs: config.PRIVACY_PREVIEW_RETENTION_MS, aiContextMs: config.PRIVACY_AI_CONTEXT_RETENTION_MS, auditMs: config.PRIVACY_AUDIT_RETENTION_MS }, requestId: response.locals.requestId });
  });
  router.post('/deletions', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = deletionSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Deletion request is invalid.', response.locals.requestId as string)); return; }
    try {
      const record: PublicDeletionRequest = await deletion.request(owner(request), sessionId(response), parsed.data.scope, parsed.data.targetId);
      response.status(202).json({ deletion: record, requestId: response.locals.requestId });
    } catch {
      response.status(503).json(errorBody('INTERNAL_ERROR', 'Deletion could not be durably recorded.', response.locals.requestId as string));
    }
  });
  router.get('/deletions/:requestId', async (request, response) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(param(request))) { response.status(400).json(errorBody('INVALID_INPUT', 'Deletion request identifier is invalid.', response.locals.requestId as string)); return; }
    const record: PublicDeletionRequest | null = await deletion.get(owner(request), param(request));
    if (!record) { response.status(404).json(errorBody('NOT_FOUND', 'Deletion request was not found.', response.locals.requestId as string)); return; }
    response.json({ deletion: record, requestId: response.locals.requestId });
  });
  router.post('/deletions/:requestId/retry', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(param(request))) { response.status(400).json(errorBody('INVALID_INPUT', 'Deletion request identifier is invalid.', response.locals.requestId as string)); return; }
    try {
      const record: PublicDeletionRequest = await deletion.retry(owner(request), param(request));
      response.status(202).json({ deletion: record, requestId: response.locals.requestId });
    } catch {
      response.status(503).json(errorBody('INTERNAL_ERROR', 'Deletion retry could not be completed.', response.locals.requestId as string));
    }
  });
  return router;
}
