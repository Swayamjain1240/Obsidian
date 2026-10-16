import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OAuthStateRecord {
  state: string;
  codeVerifier: string;
  browserBinding: string;
  expiresAt: number;
}

export interface OAuthChallenge {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  browserBinding: string;
}

export class OAuthStateStore {
  private readonly records = new Map<string, OAuthStateRecord>();

  constructor(private readonly ttlMs = 10 * 60 * 1000, private readonly maxRecords = 1_000) {}

  create(now = Date.now()): OAuthChallenge {
    for (const [key, record] of this.records) if (record.expiresAt <= now) this.records.delete(key);
    while (this.records.size >= this.maxRecords) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.records.delete(oldest);
    }
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const browserBinding = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    this.records.set(state, { state, codeVerifier, browserBinding, expiresAt: now + this.ttlMs });
    return { state, codeVerifier, browserBinding, codeChallenge };
  }

  consume(state: string, browserBinding: string | null, now = Date.now()): OAuthStateRecord | null {
    const record = this.records.get(state);
    this.records.delete(state);

    if (!record || record.expiresAt < now || browserBinding === null || !this.matches(record.browserBinding, browserBinding)) {
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
