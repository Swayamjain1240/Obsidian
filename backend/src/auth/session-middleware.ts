import type { NextFunction, Request, Response } from 'express';

import { errorBody } from '../http/response.js';
import type { SessionStore } from './session-store.js';

function getCookie(request: Request, name: string): string | null {
  const header = request.header('cookie');
  const pair = header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

export function requireGithubSession(sessionStore: SessionStore) {
  return (request: Request, response: Response, next: NextFunction) => {
    const signedSession = getCookie(request, 'obsidian_session');
    const session = signedSession ? sessionStore.get(signedSession) : null;

    if (!session) {
      response.status(401).json(errorBody('UNAUTHENTICATED', 'GitHub sign-in is required.', response.locals.requestId as string));
      return;
    }

    request.auth = { userId: String(session.githubUserId), permissions: ['repository:read'] };
    response.locals.githubSession = session;
    next();
  };
}
