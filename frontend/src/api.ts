export interface IntakeStatus {
  github: 'not_implemented';
  repositoryDiscovery: 'not_implemented';
  stackDetection: 'not_implemented';
  baselineChecks: 'not_implemented';
  aiAnalysis: 'not_available';
}

export interface RepositorySummary {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  language: string | null;
  updated_at: string;
}

export async function fetchIntakeStatus(): Promise<IntakeStatus> {
  const response = await fetch('/api/v1/status');

  if (!response.ok) {
    throw new Error('Backend status is unavailable.');
  }

  const payload = (await response.json()) as { status: IntakeStatus };
  return payload.status;
}

export async function fetchRepositories(page = 1, perPage = 5): Promise<{ repositories: RepositorySummary[]; page: number; perPage: number }> {
  const response = await fetch(`/api/v1/github/repositories?page=${page}&perPage=${perPage}`);

  if (!response.ok) {
    throw new Error(response.status === 401 ? 'GitHub sign-in is required.' : 'GitHub repositories are unavailable.');
  }

  const payload = (await response.json()) as { repositories: RepositorySummary[]; pagination: { page: number; perPage: number } };
  return { repositories: payload.repositories, page: payload.pagination.page, perPage: payload.pagination.perPage };
}
