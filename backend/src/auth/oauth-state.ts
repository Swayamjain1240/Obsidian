import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

interface OAuthStateRecord {
  state: string;
  codeVerifier: string;
  expiresAt: number;
}

export interface OAuthChallenge {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export class OAuthStateStore {
  private readonly records = new Map<string, OAuthStateRecord>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  create(now = Date.now()): OAuthChallenge {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    this.records.set(state, { state, codeVerifier, expiresAt: now + this.ttlMs });
    return { state, codeVerifier, codeChallenge };
  }

  consume(state: string, now = Date.now()): OAuthStateRecord | null {
    const record = this.records.get(state);
    this.records.delete(state);

    if (!record || record.expiresAt < now) {
      return null;
    }

    return record;
  }

  matches(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
