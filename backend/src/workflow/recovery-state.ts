export type RecoveryState = 'resumable' | 'awaiting_user_action' | 'recovery_required' | 'failed' | 'cancelled';

export function recoveryStateFor(status: string, requiresUserAction: boolean): RecoveryState {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  if (status === 'recovery_required') return 'recovery_required';
  if (requiresUserAction) return 'awaiting_user_action';
  return 'resumable';
}
