import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthSessionModel } from '../db/models.js';
import { getDatabaseStatus } from '../db/connection.js';

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

  async createAsync(input: Omit<GithubSession, 'sessionId' | 'expiresAt'>): Promise<string> {
    const signed = this.create(input);
    const sessionId = this.verify(signed);
    const session = sessionId ? this.sessions.get(sessionId) : null;
    if (!session) return signed;
    if (getDatabaseStatus() !== 'connected') return signed;
    try {
      const encrypted = this.encrypt(session.accessToken);
      await AuthSessionModel.updateOne(
        { sessionId: session.sessionId },
        { $set: { sessionId: session.sessionId, githubUserId: session.githubUserId, githubLogin: session.githubLogin, ...encrypted, expiresAt: new Date(session.expiresAt) } },
        { upsert: true },
      ).exec();
    } catch {
      // The in-memory record remains usable for local development; readiness and
      // the durable workflow health boundary surface database unavailability.
    }
    return signed;
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

  async getAsync(signedSessionId: string): Promise<GithubSession | null> {
    const cached = this.get(signedSessionId);
    if (cached) return cached;
    const sessionId = this.verify(signedSessionId);
    if (!sessionId) return null;
    if (getDatabaseStatus() !== 'connected') return null;
    try {
      const record = await AuthSessionModel.findOne({ sessionId }).lean().exec();
      if (!record || new Date(record.expiresAt).getTime() <= Date.now()) return null;
      const session: GithubSession = {
        sessionId,
        githubUserId: record.githubUserId,
        githubLogin: record.githubLogin,
        accessToken: this.decrypt(record.accessTokenCiphertext, record.accessTokenIv, record.accessTokenTag),
        expiresAt: new Date(record.expiresAt).getTime(),
      };
      this.sessions.set(sessionId, session);
      return session;
    } catch {
      return null;
    }
  }

  delete(signedSessionId: string): void {
    const sessionId = this.verify(signedSessionId);
    if (sessionId) this.sessions.delete(sessionId);
  }

  async deleteAsync(signedSessionId: string): Promise<void> {
    this.delete(signedSessionId);
    const sessionId = this.verify(signedSessionId);
    if (!sessionId) return;
    if (getDatabaseStatus() !== 'connected') return;
    try { await AuthSessionModel.deleteOne({ sessionId }).exec(); } catch { /* logout remains locally complete */ }
  }

  private key(): Buffer { return createHash('sha256').update(this.secret).digest(); }

  private encrypt(value: string): { accessTokenCiphertext: string; accessTokenIv: string; accessTokenTag: string } {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { accessTokenCiphertext: ciphertext.toString('base64url'), accessTokenIv: iv.toString('base64url'), accessTokenTag: cipher.getAuthTag().toString('base64url') };
  }

  private decrypt(ciphertext: string, iv: string, tag: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
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
