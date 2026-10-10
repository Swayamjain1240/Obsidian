import type { GithubOAuthConfig } from './oauth-config.js';
import type { OAuthChallenge } from './oauth-state.js';

export function createGithubAuthorizationUrl(config: GithubOAuthConfig, challenge: OAuthChallenge): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', challenge.state);
  url.searchParams.set('code_challenge', challenge.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
