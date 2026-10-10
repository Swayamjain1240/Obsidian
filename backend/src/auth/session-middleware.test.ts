import { describe, expect, it } from 'vitest';

import { SessionStore } from './session-store.js';

describe('session store', () => {
  it('does not expose an unsigned session identifier', () => {
    const store = new SessionStore('a'.repeat(32));
    const signed = store.create({ githubUserId: 1, githubLogin: 'user', accessToken: 'token' });

    expect(store.get(signed)?.githubLogin).toBe('user');
    expect(store.get(`${signed}tampered`)).toBeNull();
  });
});
