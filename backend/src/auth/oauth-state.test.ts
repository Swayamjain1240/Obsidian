import { describe, expect, it } from 'vitest';

import { OAuthStateStore } from './oauth-state.js';

describe('OAuth state and PKCE', () => {
  it('creates a one-time state and PKCE challenge', () => {
    const store = new OAuthStateStore();
    const challenge = store.create(1000);

    expect(challenge.state).toBeTruthy();
    expect(challenge.codeVerifier).toBeTruthy();
    expect(challenge.codeChallenge).toBeTruthy();
    expect(store.consume(challenge.state, 1001)?.codeVerifier).toBe(challenge.codeVerifier);
    expect(store.consume(challenge.state, 1001)).toBeNull();
  });

  it('expires state and supports constant-time equality', () => {
    const store = new OAuthStateStore(10);
    const challenge = store.create(1000);

    expect(store.consume(challenge.state, 1011)).toBeNull();
    expect(store.matches('same', 'same')).toBe(true);
    expect(store.matches('same', 'other')).toBe(false);
  });
});
