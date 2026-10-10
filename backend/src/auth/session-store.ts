import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GithubSession {
  sessionId: string;
  githubUserId: number;
  githubLogin: string;
  accessToken: string;
  expiresAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, GithubSession>();

  constructor(private readonly secret: string, private readonly ttlMs = 8 * 60 * 60 * 1000) {}

  create(input: Omit<GithubSession, 'sessionId' | 'expiresAt'>): string {
    const sessionId = randomBytes(32).toString('base64url');
    this.sessions.set(sessionId, { ...input, sessionId, expiresAt: Date.now() + this.ttlMs });
    return this.sign(sessionId);
  }

  get(signedSessionId: string): GithubSession | null {
    const sessionId = this.verify(signedSessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (!session || session.expiresAt <= Date.now()) {
      if (sessionId) this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  delete(signedSessionId: string): void {
    const sessionId = this.verify(signedSessionId);
    if (sessionId) this.sessions.delete(sessionId);
  }

  private sign(sessionId: string): string {
    const signature = createHmac('sha256', this.secret).update(sessionId).digest('base64url');
    return `${sessionId}.${signature}`;
  }

  private verify(value: string): string | null {
    const [sessionId, signature] = value.split('.');
    if (!sessionId || !signature) return null;

    const expected = createHmac('sha256', this.secret).update(sessionId).digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return null;
    return sessionId;
  }
}
