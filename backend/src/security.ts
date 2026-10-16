import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import type { AppConfig } from './config.js';
import type { NextFunction, Request, Response } from 'express';
import { errorBody } from './http/response.js';

export function securityMiddleware(config: AppConfig) {
  return [
    helmet({ contentSecurityPolicy: false }),
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_request, response) => {
        response.status(429).json(errorBody('RATE_LIMITED', 'Too many requests.', response.locals.requestId as string));
      },
    }),
  ];
}

export function requireSameOrigin(frontendOrigin: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header('origin');
    const referer = request.header('referer');
    const refererOrigin = referer ? (() => {
      try { return new URL(referer).origin; } catch { return null; }
    })() : null;

    if ((origin && origin !== frontendOrigin) || (refererOrigin && refererOrigin !== frontendOrigin)) {
      response.status(403).json(errorBody('CSRF_ORIGIN_REJECTED', 'The request origin is not allowed.', response.locals.requestId as string));
      return;
    }

    next();
  };
}
