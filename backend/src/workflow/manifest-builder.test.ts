import { describe, expect, it } from 'vitest';

import { mergeManifestOperations } from './manifest-builder.js';

describe('manifest builder', () => {
  it('rejects conflicting operations rather than silently overwriting', () => {
    const item = { id: 'r', planId: 'p', sourceCheckId: 'b', category: 'build', title: 'Build', reason: 'x', risk: 'low' as const, affectedPaths: ['a.ts'], expectedTests: [], approvalState: 'approved' as const, workerStatus: 'applied' as const, operations: [{ kind: 'modify' as const, path: 'a.ts', contentHash: 'a', contentBytes: 1, content: 'a' }] };
    const recommendation = { id: 'n', enhancementRunId: 'e', category: 'architecture' as const, title: 'n', currentProblem: 'x', suggestedSolution: 'y', risk: 'low' as const, affectedPaths: ['a.ts'], affectedAreas: ['implementation'], expectedTests: [], approvalState: 'approved' as const, operations: [{ kind: 'modify' as const, path: 'a.ts', contentHash: 'b', contentBytes: 1, content: 'b' }] };
    expect(() => mergeManifestOperations([item], [recommendation])).toThrow(/Conflicting/);
  });
});
