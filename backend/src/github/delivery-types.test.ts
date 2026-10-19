import { describe, expect, it } from 'vitest';

import type { GithubCommitDetails, GithubTreeEntry } from './delivery-types.js';

describe('GitHub delivery response contracts', () => {
  it('keeps commit and tree identifiers bounded to the delivery surface', () => {
    const commit: GithubCommitDetails = { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), message: 'Obsidian Version 2', parentShas: ['c'.repeat(40)] };
    const tree: GithubTreeEntry = { path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'd'.repeat(40), size: 4 };
    expect(commit.sha).toHaveLength(40);
    expect(tree.type).toBe('blob');
  });
});
