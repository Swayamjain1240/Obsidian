import { describe, expect, it } from 'vitest';

import { buildRecommendationCatalog } from './recommendation-catalog.js';

describe('recommendation catalog', () => {
  it('keeps existing-only analysis from inventing missing areas', () => {
    const recommendations = buildRecommendationCatalog('run-1', [
      { id: 'working', name: 'Working', status: 'working', summary: 'Present.', findingIds: [], affectedPaths: ['src/a.ts'] },
      { id: 'missing', name: 'Missing', status: 'not_implemented', summary: 'Absent.', findingIds: [], affectedPaths: [] },
      { id: 'tool', name: 'Tool', status: 'not_available', summary: 'Unavailable.', findingIds: [], affectedPaths: [] },
    ], 'EXISTING_ONLY');
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].affectedPaths).toEqual(['src/a.ts']);
  });
});
