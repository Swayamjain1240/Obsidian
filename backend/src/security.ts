import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import type { AppConfig } from './config.js';

export function securityMiddleware(config: AppConfig) {
  return [
    helmet({ contentSecurityPolicy: false }),
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
    }),
  ];
}
