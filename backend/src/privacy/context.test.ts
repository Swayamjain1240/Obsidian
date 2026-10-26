import { describe, expect, it } from 'vitest';

import { minimizeContext } from './context.js';

describe('privacy-safe AI context', () => {
  it('excludes sensitive files and bounds source excerpts', () => {
    const result = minimizeContext([
      { path: '.env', content: 'TOKEN=private' },
      { path: 'src/index.ts', content: 'const value = "safe";' },
      { path: 'README.md', content: 'x'.repeat(100) },
    ], { maxFiles: 2, maxFileBytes: 20, maxTotalBytes: 30 });
    expect(result.excludedPaths).toContain('.env');
    expect(result.files.map((file) => file.path)).toEqual(['src/index.ts', 'README.md']);
    expect(result.files[1].truncated).toBe(true);
    expect(result.totalBytes).toBeLessThanOrEqual(30);
  });
});
