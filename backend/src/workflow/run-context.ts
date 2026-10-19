import type { ConfirmedDetectionContext } from '../detection/service.js';

export const runContextVersion = 1;

export interface PersistedRunContext {
  version: number;
  ownerUserId: string;
  sessionId: string;
  context: ConfirmedDetectionContext;
  lifecycleState: string;
  recovery: 'resumable' | 'awaiting_user_action' | 'recovery_required' | 'failed' | 'cancelled';
  savedAt: string;
}

export function createRunContext(input: Omit<PersistedRunContext, 'version' | 'savedAt'>): PersistedRunContext {
  return { ...input, version: runContextVersion, savedAt: new Date().toISOString() };
}

export function isPersistedRunContext(value: unknown): value is PersistedRunContext {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const context = typeof candidate.context === 'object' && candidate.context !== null ? candidate.context as Record<string, unknown> : null;
  const snapshot = context && typeof context.snapshot === 'object' && context.snapshot !== null ? context.snapshot as Record<string, unknown> : null;
  return candidate.version === runContextVersion
    && typeof candidate.ownerUserId === 'string'
    && typeof candidate.sessionId === 'string'
    && typeof candidate.lifecycleState === 'string'
    && ['resumable', 'awaiting_user_action', 'recovery_required', 'failed', 'cancelled'].includes(String(candidate.recovery))
    && typeof candidate.savedAt === 'string'
    && context !== null
    && typeof context.detectionRunId === 'string'
    && context.ownerUserId === candidate.ownerUserId
    && context.sessionId === candidate.sessionId
    && typeof context.baseCommit === 'string'
    && /^[a-f0-9]{40}$/i.test(context.baseCommit)
    && typeof context.archiveSha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(context.archiveSha256)
    && typeof snapshot?.snapshotId === 'string'
    && snapshot.immutable === true;
}
