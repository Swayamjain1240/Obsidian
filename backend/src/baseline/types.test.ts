import { describe, expect, it } from 'vitest';

import { isTerminalBaselineCheckStatus, isTerminalBaselineStatus } from './types.js';

describe('baseline status contracts', () => {
  it('keeps planning and running states non-terminal', () => {
    expect(isTerminalBaselineStatus('queued')).toBe(false);
    expect(isTerminalBaselineStatus('planning')).toBe(false);
    expect(isTerminalBaselineStatus('running')).toBe(false);
    expect(isTerminalBaselineStatus('partial')).toBe(true);
  });

  it('distinguishes a missing check from an unfinished check', () => {
    expect(isTerminalBaselineCheckStatus('queued')).toBe(false);
    expect(isTerminalBaselineCheckStatus('running')).toBe(false);
    expect(isTerminalBaselineCheckStatus('not_available')).toBe(true);
    expect(isTerminalBaselineCheckStatus('timed_out')).toBe(true);
  });
});
