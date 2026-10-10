import { describe, expect, it } from 'vitest';

import { canTransition, transition } from './lifecycle.js';

describe('session lifecycle', () => {
  it('requires stack confirmation before completeness review', () => {
    expect(canTransition('detecting', 'completeness_review')).toBe(false);
    expect(transition('detecting', 'awaiting_stack_confirmation')).toBe('awaiting_stack_confirmation');
  });

  it('rejects invalid jumps', () => {
    expect(() => transition('created', 'baseline_healthy')).toThrow(/Invalid session transition/);
  });
});
