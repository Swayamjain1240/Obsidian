import cors from 'cors';
import express, { type Request, type Response } from 'express';

import type { AppConfig } from './config.js';
import { errorBody } from './http/response.js';
import { getIntakeStatus } from './intake-status.js';
import { createAuthRouter } from './auth/router.js';
import { SessionStore } from './auth/session-store.js';
import { createGithubRouter } from './github/router.js';
import { createIntakeRouter } from './intake/router.js';
import type { RepositoryIntakeService } from './intake/service.js';
import { SnapshotHandleStore } from './intake/handle-store.js';
import { createDetectionRouter } from './detection/router.js';
import { DetectionService, type DetectionEventSink } from './detection/service.js';
import { createCompletenessRouter } from './completeness/router.js';
import { CompletenessService } from './completeness/service.js';
import { createBaselineRouter } from './baseline/router.js';
import { BaselineService } from './baseline/service.js';
import { createRequiredDurableEventSink } from './events.js';
import { createWorkflowRouter } from './workflow/router.js';
import { WorkflowService } from './workflow/service.js';
import { DurableWorkflowStore } from './workflow/store.js';
import { DurableRunStore } from './workflow/run-store.js';
import { getDatabaseRuntimeStatus } from './db/runtime.js';
import { authRateLimit, normalizeRequestId, requireJsonContentType, securityMiddleware } from './security.js';
import { createRequiredSecurityAuditSink, requireSecurityAudit, type SecurityAuditSink } from './security-audit.js';
import { checkDockerSandbox } from './workers/docker-preflight.js';
import { DockerBrokerExecutor } from './workers/docker-broker.js';
import type { RepositoryCommandExecutor } from './workers/executor.js';
import { MongoWorkerLeaseStore, type WorkerLeaseStore } from './workers/lease-store.js';
import { RepositorySelectionStore } from './intake/repository-authorization.js';
import { parseConfiguredKeyring } from './privacy/encryption.js';
import { PrivacyDeletionService } from './privacy/deletion.js';
import { createPrivacyRouter } from './privacy/router.js';
import { PrivacyRetentionService } from './privacy/retention-service.js';
import { retentionPolicy } from './privacy/retention.js';

export function createApp(config: AppConfig, dependencies: {
  sessionStore?: SessionStore;
  intakeService?: RepositoryIntakeService;
  handleStore?: SnapshotHandleStore;
  detectionService?: DetectionService;
  detectionEventSink?: DetectionEventSink;
  completenessService?: CompletenessService;
  baselineService?: BaselineService;
  workflowService?: WorkflowService;
  workerExecutor?: RepositoryCommandExecutor;
  workerLeaseStore?: WorkerLeaseStore;
  securityAuditSink?: SecurityAuditSink;
} = {}) {
  const app = express();
  const workerExecutor: RepositoryCommandExecutor = dependencies.workerExecutor ?? new DockerBrokerExecutor({
    trustedSnapshotRoot: config.SNAPSHOT_ROOT,
    image: config.BASELINE_WORKER_IMAGE,
    brokerUrl: config.BASELINE_WORKER_BROKER_URL,
    brokerToken: config.BASELINE_WORKER_BROKER_TOKEN,
    cleanupTimeoutMs: config.BASELINE_WORKER_CLEANUP_TIMEOUT_MS,
    resourceLimits: { memoryBytes: config.BASELINE_MAX_MEMORY_BYTES, maxProcesses: config.BASELINE_MAX_PROCESSES, workspaceTmpfsBytes: config.BASELINE_WORKER_SCRATCH_BYTES },
    workspaceLimits: { maxFiles: config.SNAPSHOT_MAX_FILES, maxDirectories: config.SNAPSHOT_MAX_DIRECTORIES, maxBytes: config.SNAPSHOT_MAX_EXTRACTED_BYTES, maxSingleFileBytes: config.SNAPSHOT_MAX_SINGLE_FILE_BYTES, maxDepth: config.BASELINE_MAX_PATH_DEPTH },
    leaseDurationMs: config.BASELINE_WORKER_LEASE_MS,
    leaseStore: dependencies.workerLeaseStore ?? new MongoWorkerLeaseStore(),
  });
  app.locals.workerExecutor = workerExecutor;

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use((request, response, next) => {
    const requestId = normalizeRequestId(request.header('x-request-id'));
    response.locals.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  });
  app.use(securityMiddleware(config));
  app.use(express.json({ limit: '100kb' }));
  app.use(requireJsonContentType);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || origin === config.FRONTEND_ORIGIN) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: true,
    }),
  );
  const securityAuditSink = dependencies.securityAuditSink ?? createRequiredSecurityAuditSink();
  app.use('/auth', authRateLimit(config), requireSecurityAudit(securityAuditSink, config.REQUIRE_SECURITY_AUDIT));
  app.get('/health/live', (_request: Request, response: Response) => {
    response.json({ status: 'ok', service: 'backend', requestId: response.locals.requestId });
  });

  app.get('/health/ready', async (_request: Request, response: Response) => {
    const runtime = await getDatabaseRuntimeStatus();
    const mongodb = runtime.status;
    const worker = mongodb === 'connected'
      ? await checkDockerSandbox(config.BASELINE_WORKER_IMAGE, 'docker', workerExecutor)
      : { available: false, summary: 'Worker preflight is waiting for MongoDB readiness.' };
    const ready = mongodb === 'connected' && worker.available;
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks: {
        mongodb,
        workerSandbox: worker.available ? 'available' : 'not_available',
        topology: runtime.topology,
        transactions: runtime.transactionsSupported ? 'available' : 'not_available',
        pingMs: runtime.pingMs,
        generation: runtime.generation,
      },
      requestId: response.locals.requestId,
    });
  });

  app.get('/api/v1/status', (_request: Request, response: Response) => {
    response.json({
      status: getIntakeStatus(),
      requestId: response.locals.requestId,
    });
  });

  const tokenKeyring = parseConfiguredKeyring(config.AUTH_TOKEN_ENCRYPTION_KEYS, config.AUTH_TOKEN_ENCRYPTION_CURRENT_KEY_ID);
  const sessionStore = dependencies.sessionStore ?? (config.AUTH_SESSION_SECRET ? new SessionStore(config.AUTH_SESSION_SECRET, config.AUTH_SESSION_TTL_MS, undefined, config.NODE_ENV !== 'test', tokenKeyring) : undefined);
  app.use('/auth', createAuthRouter(config, undefined, sessionStore));
  if (sessionStore) {
    const eventSink = dependencies.detectionEventSink ?? createRequiredDurableEventSink();
    const runStore = new DurableRunStore(config.NODE_ENV !== 'test');
    const workflowStore = new DurableWorkflowStore(config.NODE_ENV !== 'test');
     const privacyRetention = new PrivacyRetentionService(workflowStore, retentionPolicy(config), runStore);
    app.locals.privacyRetention = privacyRetention;
    const handleStore = dependencies.handleStore ?? new SnapshotHandleStore(60 * 60 * 1000, 10_000, workflowStore);
    const selectionStore = new RepositorySelectionStore(workflowStore);
    const detectionService = dependencies.detectionService ?? new DetectionService(config, handleStore, undefined, eventSink, runStore);
    const completenessService = dependencies.completenessService ?? new CompletenessService(config, undefined, eventSink, runStore);
    const baselineService = dependencies.baselineService ?? new BaselineService(config, completenessService, undefined, eventSink, runStore, workerExecutor);
    const workflowService = dependencies.workflowService ?? new WorkflowService(config, baselineService, completenessService, workflowStore, eventSink, workerExecutor);
     const privacyDeletion = new PrivacyDeletionService(config, workflowStore, sessionStore, eventSink, runStore);
    app.locals.privacyDeletion = privacyDeletion;
    app.use('/api/v1', requireSecurityAudit(securityAuditSink, config.REQUIRE_SECURITY_AUDIT));
    app.use('/api/v1/github', createGithubRouter(sessionStore, config, selectionStore));
    app.use('/api/v1/intake', createIntakeRouter(config, sessionStore, dependencies.intakeService, handleStore, selectionStore, privacyRetention));
    app.use('/api/v1/intake/detections', createDetectionRouter(config, sessionStore, detectionService));
    app.use('/api/v1/intake/completeness', createCompletenessRouter(config, sessionStore, detectionService, completenessService));
    app.use('/api/v1/intake/baseline', createBaselineRouter(config, sessionStore, baselineService));
    app.use('/api/v1/workflow', createWorkflowRouter(config, sessionStore, workflowService));
    app.use('/api/v1/privacy', createPrivacyRouter(config, sessionStore, privacyDeletion));
  }

  app.use((_request, response: Response) => {
    const requestId = response.locals.requestId as string;
    response.status(404).json(errorBody('NOT_FOUND', 'Route not found.', requestId));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
    const requestId = (response.locals.requestId as string | undefined) ?? crypto.randomUUID();
    if (response.headersSent) return;
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Request JSON is invalid.', requestId));
      return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request payload is too large.', requestId));
      return;
    }
    console.error(`[${requestId}] request failed`);
    response.status(500).json(errorBody('INTERNAL_ERROR', 'An internal error occurred.', requestId));
  });

  return app;
}
