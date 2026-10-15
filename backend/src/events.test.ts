import { describe, expect, it } from 'vitest';

import { createSystemEvent, redact } from './events.js';

describe('system events', () => {
  it('redacts secret-like values from event summaries', () => {
    expect(redact('api_key=hidden-token')).toBe('[REDACTED]');

    const event = createSystemEvent({
      eventType: 'CHECK_COMPLETED',
      sessionId: 'session-1',
      projectId: 'project-1',
      runId: 'run-1',
      baseCommit: 'a'.repeat(40),
      phase: 'baseline',
      status: 'passed',
      safeSummary: 'token=hidden-token check passed',
      affectedPaths: ['src/config.ts'],
      userActionRequired: false,
    });

    expect(event.eventId).toBeTruthy();
    expect(event.safeSummary).not.toContain('hidden-token');
  });
});
