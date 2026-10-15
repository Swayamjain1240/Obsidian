import { describe, expect, it } from 'vitest';

import { getIntakeStatus } from './intake-status.js';

describe('intake status', () => {
  it('reports only the capabilities implemented by the current flow', () => {
    const status = getIntakeStatus();

    expect(status.github).toBe('implemented');
    expect(status.repositoryDiscovery).toBe('implemented');
    expect(status.repositorySnapshot).toBe('implemented');
    expect(status.stackDetection).toBe('implemented');
    expect(status.completeness).toBe('implemented');
    expect(status.baselineChecks).toBe('implemented');
    expect(status.aiAnalysis).toBe('not_available');
  });
});
