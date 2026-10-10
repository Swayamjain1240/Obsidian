import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

import { errorBody } from './http/response.js';

export function validateBody<T>(schema: ZodType<T>) {
  return (request: Request, response: Response, next: NextFunction) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json(
        errorBody('INVALID_INPUT', 'Request input is invalid.', response.locals.requestId as string),
      );
      return;
    }

    request.body = result.data;
    next();
  };
}
