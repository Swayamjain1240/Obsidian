import type { NextFunction, Request, Response } from 'express';

import { errorBody } from './http/response.js';

export interface AuthContext {
  userId: string;
  permissions: readonly string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requirePermission(permission: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.auth?.permissions.includes(permission)) {
      response.status(403).json(
        errorBody('FORBIDDEN', 'You do not have permission to access this resource.', response.locals.requestId as string),
      );
      return;
    }

    next();
  };
}
