import { describe, expect, it } from 'vitest';

import { getIntakeStatus } from './intake-status.js';

describe('intake status', () => {
  it('does not fabricate GitHub or analysis capability', () => {
    const status = getIntakeStatus();

    expect(status.github).toBe('not_implemented');
    expect(status.repositoryDiscovery).toBe('not_implemented');
    expect(status.aiAnalysis).toBe('not_available');
  });
});
