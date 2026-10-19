import type { EnhancementRunStatus, RepairPlanStatus, Version2Status } from './types.js';

export type WorkflowPhase =
  | 'repair'
  | 'enhancement'
  | 'version_2'
  | 'delivery';

export type WorkflowStatus = RepairPlanStatus | EnhancementRunStatus | Version2Status;

const repairTransitions: Record<RepairPlanStatus, readonly RepairPlanStatus[]> = {
  awaiting_approval: ['approved', 'blocked', 'cancelled'],
  approved: ['running', 'blocked', 'cancelled'],
  running: ['validated', 'failed', 'blocked', 'cancelled'],
  blocked: ['awaiting_approval', 'cancelled'],
  validated: [],
  failed: ['awaiting_approval', 'cancelled'],
  cancelled: [],
};

const enhancementTransitions: Record<EnhancementRunStatus, readonly EnhancementRunStatus[]> = {
  analyzing: ['awaiting_review', 'blocked', 'failed', 'cancelled'],
  awaiting_review: ['approved', 'blocked', 'cancelled'],
  approved: ['running', 'blocked', 'cancelled'],
  running: ['validated', 'failed', 'blocked', 'cancelled'],
  blocked: ['awaiting_review', 'cancelled'],
  validated: [],
  failed: ['awaiting_review', 'running', 'cancelled'],
  cancelled: [],
};

const version2Transitions: Record<Version2Status, readonly Version2Status[]> = {
  queued: ['building', 'cancelled', 'failed'],
  building: ['validating', 'failed', 'cancelled'],
  validating: ['ready_for_pr', 'failed', 'cancelled', 'recovery_required'],
  ready_for_pr: ['failed', 'cancelled'],
  failed: ['queued', 'building', 'cancelled', 'recovery_required'],
  recovery_required: ['queued', 'building', 'cancelled', 'failed'],
  cancelled: [],
};

export function canWorkflowTransition<T extends WorkflowStatus>(from: T, to: T): boolean {
  if (from in repairTransitions && to in repairTransitions) return repairTransitions[from as RepairPlanStatus].includes(to as RepairPlanStatus);
  if (from in enhancementTransitions && to in enhancementTransitions) return enhancementTransitions[from as EnhancementRunStatus].includes(to as EnhancementRunStatus);
  if (from in version2Transitions && to in version2Transitions) return version2Transitions[from as Version2Status].includes(to as Version2Status);
  return false;
}

export function canWorkflowTransitionForPhase<T extends WorkflowStatus>(phase: WorkflowPhase, from: T, to: T): boolean {
  const transitions: Record<string, readonly string[]> = phase === 'repair' ? repairTransitions : phase === 'enhancement' ? enhancementTransitions : version2Transitions;
  return (from in transitions && to in transitions) ? transitions[from].includes(to) : false;
}

export function assertWorkflowTransitionForPhase<T extends WorkflowStatus>(phase: WorkflowPhase, from: T, to: T): T {
  if (!canWorkflowTransitionForPhase(phase, from, to)) throw new Error(`Invalid ${phase} workflow transition: ${from} -> ${to}`);
  return to;
}

export function assertWorkflowTransition<T extends WorkflowStatus>(from: T, to: T): T {
  if (!canWorkflowTransition(from, to)) throw new Error(`Invalid workflow transition: ${from} -> ${to}`);
  return to;
}

export function isWorkflowTerminal(status: WorkflowStatus): boolean {
  return status === 'validated' || status === 'ready_for_pr' || status === 'failed' || status === 'blocked' || status === 'cancelled';
}
