import { describe, expect, it } from 'vitest';

import type { DetectionCandidate } from './types.js';

describe('detection contracts', () => {
  it('keeps evidence bounded and explicit', () => {
    const candidate: DetectionCandidate = {
      id: 'typescript-react',
      language: 'TypeScript',
      frameworks: ['React'],
      packageManager: 'npm',
      evidenceStrength: 'strong',
      evidenceRefs: [{ path: 'package.json', reason: 'dependency marker: react', kind: 'dependency-marker' }],
      adapterAvailable: true,
    };

    expect(candidate.evidenceRefs[0].path).toBe('package.json');
    expect(candidate.adapterAvailable).toBe(true);
  });
});
