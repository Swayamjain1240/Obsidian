import { describe, expect, it } from 'vitest';

import { createRunContext, isPersistedRunContext } from './run-context.js';

describe('durable run context', () => {
  it('records immutable snapshot identity and validates the envelope version', () => {
    const context = createRunContext({
      ownerUserId: '7',
      sessionId: 'session-1',
      lifecycleState: 'awaiting_scope',
      recovery: 'awaiting_user_action',
      context: {
        detectionRunId: 'detection-1',
        ownerUserId: '7',
        sessionId: 'session-1',
        snapshot: { snapshotId: 'snapshot-1', repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) }, archivePath: 'archive', manifestPath: 'manifest', archiveSha256: 'b'.repeat(64), byteLength: 1, capturedAt: new Date(0).toISOString(), immutable: true },
        baseCommit: 'a'.repeat(40),
        archiveSha256: 'b'.repeat(64),
        languageCandidates: ['TypeScript'],
      },
    });
    expect(isPersistedRunContext(context)).toBe(true);
    expect(isPersistedRunContext({ ...context, version: 99 })).toBe(false);
  });
});
