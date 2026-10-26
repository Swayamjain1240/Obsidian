import type { AppConfig } from '../config.js';

export type RetentionCategory = 'snapshot' | 'workspace' | 'run' | 'preview' | 'ai_context' | 'audit';

export interface RetentionPolicy {
  snapshotMs: number;
  workspaceMs: number;
  runMs: number;
  previewMs: number;
  aiContextMs: number;
  auditMs: number;
  cleanupBatchSize: number;
  deletionActivePolicy: 'block' | 'cancel';
}

export function retentionPolicy(config: Pick<AppConfig, 'PRIVACY_SNAPSHOT_RETENTION_MS' | 'PRIVACY_WORKSPACE_RETENTION_MS' | 'PRIVACY_RUN_RETENTION_MS' | 'PRIVACY_PREVIEW_RETENTION_MS' | 'PRIVACY_AI_CONTEXT_RETENTION_MS' | 'PRIVACY_AUDIT_RETENTION_MS' | 'PRIVACY_CLEANUP_BATCH_SIZE' | 'PRIVACY_DELETION_ACTIVE_POLICY'>): RetentionPolicy {
  return {
    snapshotMs: config.PRIVACY_SNAPSHOT_RETENTION_MS ?? 7 * 24 * 60 * 60 * 1000,
    workspaceMs: config.PRIVACY_WORKSPACE_RETENTION_MS ?? 24 * 60 * 60 * 1000,
    runMs: config.PRIVACY_RUN_RETENTION_MS ?? 30 * 24 * 60 * 60 * 1000,
    previewMs: config.PRIVACY_PREVIEW_RETENTION_MS ?? 24 * 60 * 60 * 1000,
    aiContextMs: config.PRIVACY_AI_CONTEXT_RETENTION_MS ?? 24 * 60 * 60 * 1000,
    auditMs: config.PRIVACY_AUDIT_RETENTION_MS ?? 365 * 24 * 60 * 60 * 1000,
    cleanupBatchSize: config.PRIVACY_CLEANUP_BATCH_SIZE ?? 100,
    deletionActivePolicy: config.PRIVACY_DELETION_ACTIVE_POLICY ?? 'block',
  };
}

export function retentionDuration(policy: RetentionPolicy, category: RetentionCategory): number {
  return policy[`${category === 'ai_context' ? 'aiContext' : category}Ms` as keyof RetentionPolicy] as number;
}

export function expiresAt(policy: RetentionPolicy, category: RetentionCategory, terminalAt: number): number {
  return terminalAt + retentionDuration(policy, category);
}

export function isTerminalWorkflowStatus(value: unknown): boolean {
  return ['passed', 'failed', 'cancelled', 'validated', 'blocked', 'ready_for_pr', 'rejected', 'completed'].includes(String(value));
}

export function isActiveWorkflowStatus(value: unknown): boolean {
  return ['queued', 'running', 'analyzing', 'awaiting_review', 'awaiting_approval', 'building', 'validating', 'recovery_required'].includes(String(value));
}
