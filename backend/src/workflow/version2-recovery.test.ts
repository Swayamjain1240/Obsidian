import { describe, expect, it } from 'vitest';

import { version2RecoveryOutcome } from './version2-recovery.js';

describe('Version 2 recovery outcome', () => {
  const state = { status: 'failed' as const, manifest: { manifestId: 'manifest' } as never, operations: [{ path: 'src/index.ts' }] as never };

  it('requires rebuild when a failed run has no workspace', () => {
    expect(version2RecoveryOutcome(state, false)).toBe('recovery_required');
  });

  it('keeps a rebuildable failed run resumable when its workspace is available', () => {
    expect(version2RecoveryOutcome(state, true)).toBe('resumable');
  });
});
