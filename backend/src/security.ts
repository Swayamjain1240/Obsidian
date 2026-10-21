import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import crypto from 'node:crypto';

import type { AppConfig } from './config.js';
import type { NextFunction, Request, Response } from 'express';
import { errorBody } from './http/response.js';

export function securityMiddleware(config: AppConfig) {
  return [
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX_REQUESTS,
      keyGenerator: (request) => request.auth?.userId ? `user:${request.auth.userId}` : `ip:${ipKeyGenerator(request.ip ?? 'unknown')}`,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (request) => request.path === '/health/live' || request.path === '/health/ready',
      handler: (_request, response) => {
        response.status(429).json(errorBody('RATE_LIMITED', 'Too many requests.', response.locals.requestId as string));
      },
    }),
  ];
}

export function authRateLimit(config: AppConfig) {
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_AUTH_MAX_REQUESTS,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (request) => `ip:${ipKeyGenerator(request.ip ?? 'unknown')}`,
    handler: (_request, response) => {
      response.status(429).json(errorBody('RATE_LIMITED', 'Too many authentication requests.', response.locals.requestId as string));
    },
  });
}

export function requireSameOrigin(frontendOrigin: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      next();
      return;
    }
    const origin = request.header('origin');
    const referer = request.header('referer');
    const refererOrigin = referer ? (() => {
      try { return new URL(referer).origin; } catch { return null; }
    })() : null;

    if ((!origin && !refererOrigin) || (origin && origin !== frontendOrigin) || (refererOrigin && refererOrigin !== frontendOrigin)) {
      response.status(403).json(errorBody('CSRF_ORIGIN_REJECTED', 'The request origin is not allowed.', response.locals.requestId as string));
      return;
    }

    next();
  };
}

export function normalizeRequestId(value: string | undefined): string {
  if (value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) return value;
  return crypto.randomUUID();
}

export function requireJsonContentType(request: Request, response: Response, next: NextFunction): void {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
    next();
    return;
  }
  const contentLength = request.header('content-length');
  const transferEncoding = request.header('transfer-encoding');
  const contentType = request.header('content-type');
  if (!contentType && (!contentLength || contentLength === '0') && !transferEncoding) {
    next();
    return;
  }
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    response.status(415).json(errorBody('UNSUPPORTED_MEDIA_TYPE', 'JSON request content is required.', response.locals.requestId as string));
    return;
  }
  next();
}
