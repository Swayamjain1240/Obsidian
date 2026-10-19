export interface GithubCommitDetails {
  sha: string;
  treeSha: string;
  message: string;
  parentShas: string[];
}

export interface GithubTreeEntry {
  path: string;
  mode: string | null;
  type: 'blob' | 'tree' | 'commit' | null;
  sha: string | null;
  size?: number | null;
}
