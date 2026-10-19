import { describe, expect, it } from 'vitest';

import { assertWorkflowTransition, assertWorkflowTransitionForPhase, canWorkflowTransition, isWorkflowTerminal } from './state-machine.js';

describe('workflow state machine', () => {
  it('allows only legal repair, enhancement, and Version 2 transitions', () => {
    expect(canWorkflowTransition('awaiting_approval', 'approved')).toBe(true);
    expect(canWorkflowTransition('validated', 'running')).toBe(false);
    expect(canWorkflowTransition('building', 'validating')).toBe(true);
    expect(() => assertWorkflowTransition('ready_for_pr', 'building')).toThrow(/Invalid workflow transition/);
  });

  it('identifies terminal states', () => {
    expect(isWorkflowTerminal('validated')).toBe(true);
    expect(isWorkflowTerminal('running')).toBe(false);
  });

  it('keeps overlapping status names phase-specific during recovery', () => {
    expect(() => assertWorkflowTransitionForPhase('enhancement', 'failed', 'running')).not.toThrow();
    expect(() => assertWorkflowTransitionForPhase('repair', 'failed', 'running')).toThrow(/Invalid repair workflow transition/);
  });
});
