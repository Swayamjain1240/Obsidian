import { describe, expect, it } from 'vitest';

import { assertRevision, nextRevision, operationDigest, RevisionConflictError } from './revision.js';

describe('workflow revisions', () => {
  it('increments and checks revisions', () => {
    const value = { revision: 2 };
    expect(nextRevision(value)).toBe(3);
    expect(assertRevision(value, 2)).toBe(2);
    expect(() => assertRevision(value, 1)).toThrow(RevisionConflictError);
  });

  it('creates stable operation digests', () => {
    expect(operationDigest({ path: 'a.ts', kind: 'modify' })).toBe(operationDigest({ path: 'a.ts', kind: 'modify' }));
  });
});
