import { describe, expect, it } from 'vitest';

import { SessionPersistenceError, SessionStore } from './session-store.js';

describe('durable authentication session policy', () => {
  it('fails closed for required persistence while MongoDB is disconnected', async () => {
    const store = new SessionStore('a'.repeat(32), 60_000, 10, true);
    await expect(store.createAsync({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' })).rejects.toBeInstanceOf(SessionPersistenceError);
  });
});
