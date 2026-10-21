import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { SystemEvent } from './events.js';
import { createSystemEvent } from './events.js';
import { EventPersistenceError, DurableEventStore } from './events-store.js';
import { errorBody } from './http/response.js';

export interface SecurityAuditSink {
  (event: SystemEvent): Promise<void>;
}

export function createRequiredSecurityAuditSink(): SecurityAuditSink {
  const storePromise = Promise.resolve(new DurableEventStore(true));
  return async (event) => (await storePromise).append(event);
}

function auditIdentity(request: Request): string {
  return request.header('idempotency-key')
    ?? request.header('x-idempotency-key')
    ?? request.header('x-request-id')
    ?? `${request.method}:${request.originalUrl}`;
}

export function createSecurityAuditEvent(request: Request, response: Response, eventType = 'API_MUTATION_REQUESTED'): SystemEvent {
  const requestId = String(response.locals.requestId ?? '');
  const identity = auditIdentity(request);
  const eventId = createHash('sha256').update(`${eventType}:${request.method}:${request.originalUrl}:${identity}`).digest('hex');
  const userId = request.auth?.userId ?? '';
  return createSystemEvent({
    eventId,
    eventType,
    sessionId: String((response.locals.githubSession as { sessionId?: string } | undefined)?.sessionId ?? ''),
    projectId: '',
    runId: '',
    baseCommit: '',
    phase: 'security',
    status: 'passed',
    safeSummary: `${request.method} ${request.path} requested by ${userId || 'anonymous'}.`,
    affectedPaths: [],
    userActionRequired: false,
    requestId,
    correlationId: identity,
  });
}

export function requireSecurityAudit(sink: SecurityAuditSink, required = true): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      next();
      return;
    }
    void sink(createSecurityAuditEvent(request, response)).then(() => next()).catch((reason: unknown) => {
      if (!required) {
        next();
        return;
      }
      const message = reason instanceof EventPersistenceError
        ? 'Security audit persistence is unavailable.'
        : 'Security audit could not be recorded.';
      response.status(503).json(errorBody('INTERNAL_ERROR', message, response.locals.requestId as string));
    });
  };
}
