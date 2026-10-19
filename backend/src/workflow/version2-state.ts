import type { Version2Status } from './types.js';
import { assertWorkflowTransitionForPhase, canWorkflowTransitionForPhase } from './state-machine.js';

export function canVersion2Transition(from: Version2Status, to: Version2Status): boolean {
  return canWorkflowTransitionForPhase('version_2', from, to);
}

export function assertVersion2Transition(from: Version2Status, to: Version2Status): Version2Status {
  return assertWorkflowTransitionForPhase('version_2', from, to);
}

export function isVersion2PrReady(status: Version2Status): boolean {
  return status === 'ready_for_pr';
}

export function canRetryVersion2(status: Version2Status): boolean {
  return status === 'failed' || status === 'recovery_required';
}
