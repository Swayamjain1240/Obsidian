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

interface GithubCommitResponse {
  sha?: string;
}

interface GithubCommitDetail {
  sha?: string;
  tree?: { sha?: string };
}

interface GithubBlobResponse { sha?: string }
interface GithubTreeResponse { sha?: string }
interface GithubPullRequestResponse { number?: number; html_url?: string }

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

  async getBranchCommitSha(repository: { owner: string; name: string; branch: string }): Promise<string> {
    const url = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(repository.branch)}`;
    const commit = await this.request<GithubCommitResponse>(url);

    if (!commit.sha || !/^[a-f0-9]{40}$/i.test(commit.sha)) {
      throw new Error('GitHub did not return a valid commit SHA.');
    }

    return commit.sha;
  }

  async createBranch(repository: { owner: string; name: string; branch: string }, commitSha: string): Promise<void> {
    const url = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/refs`;
    await this.request(url, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${repository.branch}`, sha: commitSha }), headers: { 'Content-Type': 'application/json' } });
  }

  async createCommitFromManifest(input: {
    owner: string;
    name: string;
    branch: string;
    baseCommit: string;
    message: string;
    files: Array<{ path: string; content?: string; delete?: boolean }>;
  }): Promise<string> {
    const base = await this.request<GithubCommitDetail>(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/git/commits/${encodeURIComponent(input.baseCommit)}`);
    if (!base.tree?.sha) throw new Error('GitHub did not return a base tree for the selected commit.');
    const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [];
    for (const file of input.files) {
      if (file.delete) tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      else {
        if (typeof file.content !== 'string') throw new Error('A non-delete GitHub file operation requires content.');
        const blob = await this.request<GithubBlobResponse>(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/git/blobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: file.content, encoding: 'utf-8' }) });
        if (!blob.sha) throw new Error('GitHub did not return a blob SHA.');
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
    }
    const createdTree = await this.request<GithubTreeResponse>(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/git/trees`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_tree: base.tree.sha, tree }) });
    if (!createdTree.sha) throw new Error('GitHub did not return a tree SHA.');
    const commit = await this.request<GithubCommitResponse>(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/git/commits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: input.message, tree: createdTree.sha, parents: [input.baseCommit] }) });
    if (!commit.sha) throw new Error('GitHub did not return a commit SHA.');
    await this.request(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/git/refs/heads/${encodeURIComponent(input.branch)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: commit.sha, force: false }) });
    return commit.sha;
  }

  async createPullRequest(input: { owner: string; name: string; title: string; body: string; head: string; base: string }): Promise<{ number: number; url: string }> {
    const response = await this.request<GithubPullRequestResponse>(`https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/pulls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }) });
    if (!response.number || !response.html_url) throw new Error('GitHub did not return a pull-request receipt.');
    return { number: response.number, url: response.html_url };
  }

  async downloadRepositoryArchive(repository: { owner: string; name: string; branch: string; commitSha?: string }, maxBytes: number): Promise<Uint8Array> {
    const ref = repository.commitSha ?? repository.branch;
    const url = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/tarball/${encodeURIComponent(ref)}`;
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

    if (!response.body) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) throw new Error('GitHub repository archive exceeds the configured size limit.');
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;

    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        byteLength += result.value.byteLength;
        if (byteLength > maxBytes) {
          await reader.cancel();
          throw new Error('GitHub repository archive exceeds the configured size limit.');
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }

    const buffer = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return buffer;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error('GitHub API request failed.');
    }

    return (await response.json()) as T;
  }
}
