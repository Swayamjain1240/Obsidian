export type SessionState =
  | 'created'
  | 'github_connected'
  | 'repository_selected'
  | 'detecting'
  | 'awaiting_stack_confirmation'
  | 'stack_confirmed'
  | 'completeness_review'
  | 'awaiting_scope'
  | 'scope_selected'
  | 'baseline_testing'
  | 'repair_required'
  | 'baseline_healthy'
  | 'repair_approval'
  | 'repair_validating'
  | 'enhancement_analyzing'
  | 'recommendation_review'
  | 'version_2_validating'
  | 'pr_ready'
  | 'paused'
  | 'cancelled';

const allowedTransitions: Record<SessionState, readonly SessionState[]> = {
  created: ['github_connected', 'cancelled'],
  github_connected: ['repository_selected', 'cancelled'],
  repository_selected: ['detecting', 'cancelled'],
  detecting: ['awaiting_stack_confirmation', 'paused', 'cancelled'],
  awaiting_stack_confirmation: ['detecting', 'stack_confirmed', 'cancelled'],
  stack_confirmed: ['completeness_review', 'cancelled'],
  completeness_review: ['awaiting_scope', 'cancelled'],
  awaiting_scope: ['scope_selected', 'cancelled'],
  scope_selected: ['baseline_testing', 'cancelled'],
  baseline_testing: ['repair_required', 'baseline_healthy', 'paused', 'cancelled'],
  repair_required: ['repair_approval', 'paused', 'cancelled'],
  repair_approval: ['repair_validating', 'paused', 'cancelled'],
  repair_validating: ['baseline_healthy', 'repair_required', 'paused', 'cancelled'],
  baseline_healthy: ['enhancement_analyzing', 'cancelled'],
  enhancement_analyzing: ['recommendation_review', 'paused', 'cancelled'],
  recommendation_review: ['version_2_validating', 'paused', 'cancelled'],
  version_2_validating: ['pr_ready', 'recommendation_review', 'paused', 'cancelled'],
  pr_ready: [],
  paused: ['detecting', 'baseline_testing', 'repair_approval', 'enhancement_analyzing', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return allowedTransitions[from].includes(to);
}

export function transition(from: SessionState, to: SessionState): SessionState {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid session transition: ${from} -> ${to}`);
  }

  return to;
}
