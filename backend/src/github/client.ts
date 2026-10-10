export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
}

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  updated_at: string;
}

interface GithubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
}

export class GithubApiClient {
  constructor(private readonly accessToken: string) {}

  getAccessToken(): string {
    return this.accessToken;
  }

  static async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GithubApiClient> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    });

    if (!response.ok) {
      throw new Error('GitHub token exchange failed.');
    }

    const payload = (await response.json()) as GithubTokenResponse;
    if (!payload.access_token) {
      throw new Error('GitHub token exchange did not return an access token.');
    }

    return new GithubApiClient(payload.access_token);
  }

  async getCurrentUser(): Promise<GithubUser> {
    return this.request<GithubUser>('https://api.github.com/user');
  }

  async listRepositories(page = 1, perPage = 20): Promise<GithubRepository[]> {
    const url = new URL('https://api.github.com/user/repos');
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(Math.min(perPage, 100)));
    url.searchParams.set('sort', 'updated');
    return this.request<GithubRepository[]>(url.toString());
  }

  async downloadRepositoryArchive(repository: { owner: string; name: string; branch: string }, maxBytes: number): Promise<Uint8Array> {
    const url = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/tarball/${encodeURIComponent(repository.branch)}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'follow',
    });

    if (!response.ok) throw new Error('GitHub repository archive request failed.');
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > maxBytes) throw new Error('GitHub repository archive exceeds the configured size limit.');
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('GitHub repository archive exceeds the configured size limit.');
    return buffer;
  }

  private async request<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error('GitHub API request failed.');
    }

    return (await response.json()) as T;
  }
}
