import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildDiffEntries, diffHash } from './diff-service.js';

describe('Version 2 diff service', () => {
  it('returns bounded before/after hashes and a deterministic diff hash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'obsidian-diff-'));
    const before = path.join(root, 'before');
    const after = path.join(root, 'after');
    try {
      await mkdir(path.join(before, 'src'), { recursive: true });
      await mkdir(path.join(after, 'src'), { recursive: true });
      await writeFile(path.join(before, 'src', 'a.ts'), 'old');
      await writeFile(path.join(after, 'src', 'a.ts'), 'new');
      const entries = await buildDiffEntries(before, after, [{ kind: 'modify', path: 'src/a.ts', contentHash: 'x', contentBytes: 3, content: 'new' }]);
      expect(entries[0]?.beforeSha256).toHaveLength(64);
      expect(entries[0]?.afterSha256).toHaveLength(64);
      expect(entries[0]?.patch).toContain('src/a.ts');
      expect(diffHash(entries)).toBe(diffHash(entries));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
