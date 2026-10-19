import { describe, expect, it } from 'vitest';

import { pageRecommendations } from './recommendation-page.js';

describe('recommendation pagination', () => {
  it('bounds pages and returns a detached page', () => {
    const source = Array.from({ length: 7 }, (_, index) => ({ id: String(index), affectedPaths: [], affectedAreas: [], expectedTests: [], operations: [] })) as never[];
    const page = pageRecommendations(source as never, 2, 3);
    expect(page.total).toBe(7);
    expect(page.recommendations).toHaveLength(3);
    expect(page.recommendations[0]).not.toBe(source[3]);
  });
});
