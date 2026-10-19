import { describe, expect, it } from 'vitest';

import { assertOperationsWithinEvidence, normalizeOperations, operationHash, OperationPolicyError } from './operation-policy.js';

describe('workflow operation policy', () => {
  it('rejects unsafe and colliding paths', () => {
    expect(() => normalizeOperations([{ kind: 'modify', path: '../escape', content: 'x' }])).toThrow(OperationPolicyError);
    expect(() => normalizeOperations([{ kind: 'modify', path: 'A.ts', content: 'x' }, { kind: 'modify', path: 'a.ts', content: 'y' }])).toThrow(/duplicate/);
  });

  it('binds operations to evidence and hashes canonical metadata', () => {
    const operations = normalizeOperations([{ kind: 'modify', path: 'src/a.ts', content: 'x' }]);
    expect(() => assertOperationsWithinEvidence(operations, ['package.json'])).toThrow(/outside/);
    expect(operationHash(operations)).toHaveLength(64);
  });

  it('does not allow approved operations without source evidence', () => {
    const operations = normalizeOperations([{ kind: 'add', path: 'src/a.ts', content: 'x' }]);
    expect(() => assertOperationsWithinEvidence(operations, [])).toThrow(/source evidence/);
  });
});
