import { describe, expect, it } from 'vitest';

import { canTransition, transition } from './lifecycle.js';

describe('session lifecycle', () => {
  it('requires stack confirmation before completeness review', () => {
    expect(canTransition('detecting', 'completeness_review')).toBe(false);
    expect(transition('detecting', 'awaiting_stack_confirmation')).toBe('awaiting_stack_confirmation');
  });

  it('requires an explicit scope selection before baseline testing', () => {
    expect(canTransition('awaiting_scope', 'baseline_testing')).toBe(false);
    expect(transition('awaiting_scope', 'scope_selected')).toBe('scope_selected');
    expect(transition('scope_selected', 'baseline_testing')).toBe('baseline_testing');
  });

  it('rejects invalid jumps', () => {
    expect(() => transition('created', 'baseline_healthy')).toThrow(/Invalid session transition/);
  });
});
