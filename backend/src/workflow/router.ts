import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { requireSameOrigin } from '../security.js';
import { WorkflowService, WorkflowServiceError, type WorkflowMutationOptions } from './service.js';
import { IdempotencyConflictError } from './idempotency.js';
import { WorkflowPersistenceError, WorkflowRevisionConflictError } from './store.js';

const startSchema = z.object({ baselineRunId: z.string().min(1).max(160) });
const approvalSchema = z.object({
  approved: z.boolean(),
  operations: z.array(z.object({ kind: z.enum(['add', 'modify', 'delete']), path: z.string().min(1).max(1024), content: z.string().max(1_048_576).optional() })).max(100).optional(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  highRiskConfirmed: z.boolean().optional(),
});
const previewSchema = z.object({ previewHash: z.string().regex(/^[a-f0-9]{64}$/i) });

function owner(request: Request): string { return request.auth?.userId ?? ''; }
function param(request: Request, name: string): string { const value = request.params[name]; return Array.isArray(value) ? value[0] : value; }

function accessToken(response: Response): string {
  const session = response.locals.githubSession as { accessToken?: string } | undefined;
  return session?.accessToken ?? '';
}

function sessionId(response: Response): string | undefined {
  return (response.locals.githubSession as { sessionId?: string } | undefined)?.sessionId;
}

function mutationOptions(request: Request, response: Response): WorkflowMutationOptions & { key: string } {
  const rawRevision = request.header('x-workflow-revision') ?? request.header('if-match');
  const expectedRevision = rawRevision && /^\"?\d+\"?$/.test(rawRevision) ? Number(rawRevision.replace(/\"/g, '')) : undefined;
  const key = request.header('idempotency-key') ?? request.header('x-idempotency-key');
  if (!key) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'An Idempotency-Key header is required for workflow mutations.', 400);
  if (expectedRevision === undefined) throw new WorkflowServiceError('WORKFLOW_INPUT_INVALID', 'An X-Workflow-Revision or If-Match header is required for workflow mutations.', 400);
  return { expectedRevision, sessionId: (response.locals.githubSession as { sessionId?: string } | undefined)?.sessionId, key };
}

function respondError(response: Response, reason: unknown): void {
  if (reason instanceof WorkflowServiceError) {
    response.status(reason.status).json(errorBody(reason.code, reason.message, response.locals.requestId as string));
    return;
  }
  if (reason instanceof IdempotencyConflictError) {
    response.status(409).json(errorBody('WORKFLOW_IDEMPOTENCY_CONFLICT', reason.message, response.locals.requestId as string));
    return;
  }
  if (reason instanceof WorkflowRevisionConflictError) {
    response.status(409).json(errorBody('WORKFLOW_REVISION_CONFLICT', reason.message, response.locals.requestId as string));
    return;
  }
  if (reason instanceof WorkflowPersistenceError) {
    response.status(503).json(errorBody('INTERNAL_ERROR', 'Workflow state could not be durably persisted.', response.locals.requestId as string));
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
    try { const options = mutationOptions(request, response); response.status(202).json({ plan: await workflow.idempotent(owner(request), options.key, 'repair-plan-create', { ...parsed.data, revision: options.expectedRevision }, () => workflow.createRepairPlan(owner(request), parsed.data.baselineRunId, options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/repairs/:planId', async (request, response) => {
    try { response.json({ plan: await workflow.getRepairPlan(owner(request), param(request, 'planId'), sessionId(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/items/:itemId/approval', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = approvalSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Repair approval payload is invalid.', response.locals.requestId as string)); return; }
     try { const options = { ...mutationOptions(request, response), previewHash: parsed.data.previewHash, highRiskConfirmed: parsed.data.highRiskConfirmed }; response.json({ plan: await workflow.idempotent(owner(request), options.key, 'repair-approval', { planId: param(request, 'planId'), itemId: param(request, 'itemId'), ...parsed.data }, () => workflow.approveRepairItem(owner(request), param(request, 'planId'), param(request, 'itemId'), parsed.data.approved, parsed.data.operations, options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/start', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     try { const options = mutationOptions(request, response); response.json({ plan: await workflow.idempotent(owner(request), options.key, 'repair-start', { planId: param(request, 'planId'), revision: options.expectedRevision }, () => workflow.startRepair(owner(request), param(request, 'planId'), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/validate', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     try { const options = mutationOptions(request, response); response.json({ ...await workflow.idempotent(owner(request), options.key, 'repair-validate', { planId: param(request, 'planId'), revision: options.expectedRevision }, () => workflow.validateRepair(owner(request), param(request, 'planId'), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/repairs/:planId/publish', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     try { const options = mutationOptions(request, response); response.json({ plan: await workflow.idempotent(owner(request), options.key, 'repair-publish', { planId: param(request, 'planId'), revision: options.expectedRevision }, () => workflow.publishRepairBranch(owner(request), param(request, 'planId'), accessToken(response), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });

  router.post('/enhancements', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Baseline run ID is invalid.', response.locals.requestId as string)); return; }
     try { const options = mutationOptions(request, response); response.status(202).json({ run: await workflow.idempotent(owner(request), options.key, 'enhancement-create', { ...parsed.data, revision: options.expectedRevision }, () => workflow.createEnhancementRun(owner(request), parsed.data.baselineRunId, options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/enhancements/:runId', async (request, response) => {
    try { response.json({ run: await workflow.getEnhancementRun(owner(request), param(request, 'runId'), sessionId(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/enhancements/:runId/recommendations', async (request, response) => {
    const page = Number(request.query.page ?? 1);
    const perPage = Number(request.query.perPage ?? 5);
    if (!Number.isInteger(page) || !Number.isInteger(perPage) || page < 1 || perPage < 1 || perPage > 20) { response.status(400).json(errorBody('INVALID_INPUT', 'Recommendation pagination is invalid.', response.locals.requestId as string)); return; }
    try { response.json({ ...await workflow.listRecommendations(owner(request), param(request, 'runId'), page, perPage, sessionId(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/enhancements/:runId/recommendations/:recommendationId', async (request, response) => {
    try { response.json({ recommendation: await workflow.viewRecommendation(owner(request), param(request, 'runId'), param(request, 'recommendationId'), sessionId(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/enhancements/:runId/recommendations/:recommendationId/approval', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
    const parsed = approvalSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Recommendation approval payload is invalid.', response.locals.requestId as string)); return; }
     try { const options = { ...mutationOptions(request, response), previewHash: parsed.data.previewHash, highRiskConfirmed: parsed.data.highRiskConfirmed }; response.json({ run: await workflow.idempotent(owner(request), options.key, 'recommendation-approval', { runId: param(request, 'runId'), recommendationId: param(request, 'recommendationId'), ...parsed.data }, () => workflow.approveRecommendation(owner(request), param(request, 'runId'), param(request, 'recommendationId'), parsed.data.approved, parsed.data.operations, options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/enhancements/:runId/version2', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     try { const options = mutationOptions(request, response); response.status(202).json({ ...await workflow.idempotent(owner(request), options.key, 'version2-start', { runId: param(request, 'runId'), revision: options.expectedRevision }, () => workflow.startVersion2(owner(request), param(request, 'runId'), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/pull-request', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     try { const options = mutationOptions(request, response); response.status(202).json({ pullRequest: await workflow.idempotent(owner(request), options.key, 'pull-request-prepare', { runId: param(request, 'runId'), revision: options.expectedRevision }, () => workflow.preparePullRequest(owner(request), param(request, 'runId'), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/version2/:runId', async (request, response) => {
    try { response.json({ version2: await workflow.getVersion2State(owner(request), param(request, 'runId'), sessionId(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/version2/:runId/manifest', async (request, response) => {
    try { response.json({ manifest: await workflow.getVersion2Manifest(owner(request), param(request, 'runId'), sessionId(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.get('/version2/:runId/diff', async (request, response) => {
     try { response.json({ diff: await workflow.getVersion2Diff(owner(request), param(request, 'runId'), sessionId(response)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/preview/acknowledge', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     const parsed = previewSchema.safeParse(request.body);
     if (!parsed.success) { response.status(400).json(errorBody('INVALID_INPUT', 'Version 2 preview hash is invalid.', response.locals.requestId as string)); return; }
     try { const options = mutationOptions(request, response); response.json({ version2: await workflow.idempotent(owner(request), options.key, 'version2-preview-acknowledge', { runId: param(request, 'runId'), previewHash: parsed.data.previewHash, revision: options.expectedRevision }, () => workflow.acknowledgeVersion2Diff(owner(request), param(request, 'runId'), parsed.data.previewHash, options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/validate', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
      try { const options = mutationOptions(request, response); response.json({ ...await workflow.idempotent(owner(request), options.key, 'version2-validate', { runId: param(request, 'runId'), revision: options.expectedRevision }, () => workflow.validateVersion2(owner(request), param(request, 'runId'), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/retry', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
      try { const options = mutationOptions(request, response); response.status(202).json({ version2: await workflow.idempotent(owner(request), options.key, 'version2-retry', { runId: param(request, 'runId'), revision: options.expectedRevision }, () => workflow.retryVersion2(owner(request), param(request, 'runId'), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/cancel', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     try { const options = mutationOptions(request, response); response.json({ version2: await workflow.idempotent(owner(request), options.key, 'version2-cancel', { runId: param(request, 'runId'), revision: options.expectedRevision }, () => workflow.cancelVersion2(owner(request), param(request, 'runId'), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });
  router.post('/version2/:runId/pull-request/create', requireSameOrigin(config.FRONTEND_ORIGIN), async (request, response) => {
     try { const options = mutationOptions(request, response); response.status(201).json({ pullRequest: await workflow.idempotent(owner(request), options.key, 'pull-request-create', { runId: param(request, 'runId'), revision: options.expectedRevision }, () => workflow.createPullRequest(owner(request), param(request, 'runId'), accessToken(response), options)), requestId: response.locals.requestId }); } catch (reason: unknown) { respondError(response, reason); }
  });

  return router;
}
