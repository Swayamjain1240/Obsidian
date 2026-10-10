import crypto from 'node:crypto';

import cors from 'cors';
import express, { type Request, type Response } from 'express';

import type { AppConfig } from './config.js';
import { errorBody } from './http/response.js';

export function createApp(config: AppConfig) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
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
