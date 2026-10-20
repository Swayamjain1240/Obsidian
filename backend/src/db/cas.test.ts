import { describe, expect, it } from 'vitest';

import { DatabaseRevisionConflictError, isDuplicateKeyError, nextRevision, revisionOf } from './cas.js';

describe('database CAS primitives', () => {
  it('reads and increments only safe revisions', () => {
    expect(revisionOf({ revision: 4 })).toBe(4);
    expect(revisionOf({ revision: -1 })).toBe(0);
    expect(nextRevision({ revision: 4 })).toBe(5);
  });

  it('identifies duplicate-key races without exposing database details', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ code: 11001 })).toBe(false);
    expect(new DatabaseRevisionConflictError(1, 2).name).toBe('DatabaseRevisionConflictError');
  });
});
