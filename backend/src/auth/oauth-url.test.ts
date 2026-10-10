import { describe, expect, it } from 'vitest';

import { createGithubAuthorizationUrl } from './oauth-url.js';

describe('GitHub authorization URL', () => {
  it('includes scoped OAuth and PKCE parameters', () => {
    const url = new URL(
      createGithubAuthorizationUrl(
        {
          clientId: 'client-id',
          clientSecret: 'secret',
          callbackUrl: 'http://localhost:4000/auth/github/callback',
          scopes: ['read:user', 'repo'],
          sessionSecret: 'a'.repeat(32),
        },
        { state: 'state', codeVerifier: 'verifier', codeChallenge: 'challenge' },
      ),
    );

    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('read:user repo');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_secret')).toBeNull();
  });
});
