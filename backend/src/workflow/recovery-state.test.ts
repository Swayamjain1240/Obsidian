import { describe, expect, it } from 'vitest';

import { recoveryStateFor } from './recovery-state.js';

describe('workflow recovery state', () => {
  it('keeps terminal and user-action states explicit', () => {
    expect(recoveryStateFor('cancelled', false)).toBe('cancelled');
    expect(recoveryStateFor('failed', false)).toBe('failed');
    expect(recoveryStateFor('recovery_required', false)).toBe('recovery_required');
    expect(recoveryStateFor('awaiting_scope', true)).toBe('awaiting_user_action');
    expect(recoveryStateFor('running', false)).toBe('resumable');
  });
});
