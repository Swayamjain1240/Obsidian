import type { Version2State } from './types.js';
import { canRetryVersion2 } from './version2-state.js';

export type Version2RecoveryOutcome = 'resumable' | 'awaiting_user_action' | 'recovery_required' | 'terminal';

export function version2RecoveryOutcome(state: Pick<Version2State, 'status' | 'manifest' | 'operations'>, workspaceAvailable: boolean): Version2RecoveryOutcome {
  if (state.status === 'cancelled' || state.status === 'ready_for_pr') return 'terminal';
  if (state.status === 'failed' && canRetryVersion2(state.status) && state.manifest && state.operations?.length) return workspaceAvailable ? 'resumable' : 'recovery_required';
  if (state.status === 'queued' || state.status === 'building' || state.status === 'validating') return workspaceAvailable ? 'resumable' : 'recovery_required';
  return 'awaiting_user_action';
}
