import { describe, expect, it } from 'vitest';

import { assertVersion2Transition, canRetryVersion2, canVersion2Transition, isVersion2PrReady } from './version2-state.js';

describe('Version 2 state contract', () => {
  it('allows only explicit build, validation, recovery, and cancellation transitions', () => {
    expect(canVersion2Transition('queued', 'building')).toBe(true);
    expect(canVersion2Transition('failed', 'ready_for_pr')).toBe(false);
    expect(() => assertVersion2Transition('ready_for_pr', 'building')).toThrow(/Invalid version_2 workflow transition/);
  });

  it('exposes PR readiness and retry gates', () => {
    expect(isVersion2PrReady('ready_for_pr')).toBe(true);
    expect(canRetryVersion2('recovery_required')).toBe(true);
    expect(canRetryVersion2('ready_for_pr')).toBe(false);
  });
});
