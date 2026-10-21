import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createSecurityAuditEvent, requireSecurityAudit, type SecurityAuditSink } from './security-audit.js';

describe('security audit middleware', () => {
  it('creates deterministic idempotent audit identities and preserves correlation context', () => {
    const app = express();
    app.use((request, response, next) => {
      response.locals.requestId = 'request-1';
      request.auth = { userId: '7', permissions: [] };
      response.locals.githubSession = { sessionId: 'session-1' };
      next();
    });
    app.post('/mutation', (request, response) => response.json(createSecurityAuditEvent(request, response)));

    return request(app)
      .post('/mutation')
      .set('Idempotency-Key', 'same-operation')
      .then((response) => {
        expect(response.status).toBe(200);
        expect(response.body.eventType).toBe('API_MUTATION_REQUESTED');
        expect(response.body.requestId).toBe('request-1');
        expect(response.body.correlationId).toBe('same-operation');
        expect(response.body.integrityHash).toMatch(/^[a-f0-9]{64}$/);
      });
  });

  it('fails closed before a mutation when required audit persistence fails', async () => {
    const sink: SecurityAuditSink = vi.fn(async () => { throw new Error('database unavailable'); });
    const app = express();
    app.use((request, response, next) => { response.locals.requestId = 'request-2'; next(); });
    app.post('/mutation', requireSecurityAudit(sink, true), (_request, response) => response.sendStatus(204));

    const response = await request(app).post('/mutation');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('allows explicitly best-effort development mutations when audit persistence is unavailable', async () => {
    const sink: SecurityAuditSink = vi.fn(async () => { throw new Error('database unavailable'); });
    const app = express();
    app.use((request, response, next) => { response.locals.requestId = 'request-3'; next(); });
    app.post('/mutation', requireSecurityAudit(sink, false), (_request, response) => response.sendStatus(204));

    const response = await request(app).post('/mutation');
    expect(response.status).toBe(204);
  });
});
