import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { requireSameOrigin } from '../security.js';
import { WorkflowService, WorkflowServiceError } from './service.js';

const startSchema = z.object({ baselineRunId: z.string().min(1).max(160) });
const approvalSchema = z.object({
  approved: z.boolean(),
  operations: z.array(z.object({ kind: z.enum(['add', 'modify', 'delete']), path: z.string().min(1).max(1024), content: z.string().max(1_048_576).optional() })).max(100).optional(),
});

function owner(request: Request): string { return request.auth?.userId ?? ''; }
function param(request: Request, name: string): string { const value = request.params[name]; return Array.isArray(value) ? value[0] : value; }

function accessToken(response: Response): string {
  const session = response.locals.githubSession as { accessToken?: string } | undefined;
  return session?.accessToken ?? '';
}

function respondError(response: Response, reason: unknown): void {
  if (reason instanceof WorkflowServiceError) {
    response.status(reason.status).json(errorBody(reason.code, reason.message, response.locals.requestId as string));
    return;
  }
  response.status(500).json(errorBody('INTERNAL_ERROR', 'The workflow request could not be completed.', response.locals.requestId as string));
}

export function createWorkflowRouter(config: AppConfig, sessionStore: SessionStore, workflow: WorkflowService) {
  const router = Router();
  router.use(requireGithubSession(sessionStore));

  router.post('/repairs', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Baseline run ID is invalid.', response.locals.requestId as string)); return; }
    try { response.status(202).json({ plan: await workflow.createRepairPlan(owner(request), parsed.data.baselineRunId), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/repairs/:planId', async (request, response) => {
    try { response.json({ plan: await workflow.getRepairPlan(owner(request), param(request, 'planId')), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/items/:itemId/approval', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = approvalSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Repair approval payload is invalid.', response.locals.requestId as string)); return; }
    try { response.json({ plan: await workflow.approveRepairItem(owner(request), param(request, 'planId'), param(request, 'itemId'), parsed.data.approved, parsed.data.operations), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/start', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    try { response.json({ plan: await workflow.startRepair(owner(request), param(request, 'planId')), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/validate', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    try { response.json({ ...await workflow.validateRepair(owner(request), param(request, 'planId')), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/publish', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    try { response.json({ plan: await workflow.publishRepairBranch(owner(request), param(request, 'planId'), accessToken(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/enhancements', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Baseline run ID is invalid.', response.locals.requestId as string)); return; }
    try { response.status(202).json({ run: await workflow.createEnhancementRun(owner(request), parsed.data.baselineRunId), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/enhancements/:runId', async (request, response) => {
    try { response.json({ run: await workflow.getEnhancementRun(owner(request), param(request, 'runId')), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/enhancements/:runId/recommendations/:recommendationId/approval', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = approvalSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Recommendation approval payload is invalid.', response.locals.requestId as string)); return; }
    try { response.json({ run: await workflow.approveRecommendation(owner(request), param(request, 'runId'), param(request, 'recommendationId'), parsed.data.approved, parsed.data.operations), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/enhancements/:runId/version2', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    try { response.status(202).json({ ...await workflow.startVersion2(owner(request), param(request, 'runId')), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/pull-request', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    try { response.status(202).json({ pullRequest: await workflow.preparePullRequest(owner(request), param(request, 'runId')), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/validate', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    try { response.json({ ...await workflow.validateVersion2(owner(request), param(request, 'runId')), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/pull-request/create', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    try { response.status(201).json({ pullRequest: await workflow.createPullRequest(owner(request), param(request, 'runId'), accessToken(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });

  return router;
}
