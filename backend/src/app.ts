import crypto from 'node:crypto';

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
import { securityMiddleware } from './security.js';

export function createApp(config: AppConfig, dependencies: {
  sessionStore?: SessionStore;
  intakeService?: RepositoryIntakeService;
  handleStore?: SnapshotHandleStore;
  detectionService?: DetectionService;
  detectionEventSink?: DetectionEventSink;
  completenessService?: CompletenessService;
  baselineService?: BaselineService;
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityMiddleware(config));
  app.use(express.json({ limit: '100kb' }));
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
  app.use((request, response, next) => {
    const requestId = request.header('x-request-id') ?? crypto.randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  });

  app.get('/health/live', (_request: Request, response: Response) => {
    response.json({ status: 'ok', service: 'backend', requestId: response.locals.requestId });
  });

  app.get('/health/ready', (_request: Request, response: Response) => {
    response.status(503).json({
      status: 'not_ready',
      checks: { mongodb: 'not_connected' },
      requestId: response.locals.requestId,
    });
  });

  app.get('/api/v1/status', (_request: Request, response: Response) => {
    response.json({
      status: getIntakeStatus(),
      requestId: response.locals.requestId,
    });
  });

  const sessionStore = dependencies.sessionStore ?? (config.AUTH_SESSION_SECRET ? new SessionStore(config.AUTH_SESSION_SECRET) : undefined);
  app.use('/auth', createAuthRouter(config, undefined, sessionStore));
  if (sessionStore) {
    const handleStore = dependencies.handleStore ?? new SnapshotHandleStore();
    const detectionService = dependencies.detectionService ?? new DetectionService(config, handleStore, undefined, dependencies.detectionEventSink);
    const completenessService = dependencies.completenessService ?? new CompletenessService(config, undefined, dependencies.detectionEventSink);
    const baselineService = dependencies.baselineService ?? new BaselineService(config, completenessService, undefined, dependencies.detectionEventSink);
    app.use('/api/v1/github', createGithubRouter(sessionStore));
    app.use('/api/v1/intake', createIntakeRouter(config, sessionStore, dependencies.intakeService, handleStore));
    app.use('/api/v1/intake/detections', createDetectionRouter(config, sessionStore, detectionService));
    app.use('/api/v1/intake/completeness', createCompletenessRouter(config, sessionStore, detectionService, completenessService));
    app.use('/api/v1/intake/baseline', createBaselineRouter(config, sessionStore, baselineService));
  }

  app.use((_request, response: Response) => {
    const requestId = response.locals.requestId as string;
    response.status(404).json(errorBody('NOT_FOUND', 'Route not found.', requestId));
  });

  app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
    const requestId = response.locals.requestId as string;
    console.error(`[${requestId}] request failed`);
    response.status(500).json(errorBody('INTERNAL_ERROR', 'An internal error occurred.', requestId));
  });

  return app;
}
