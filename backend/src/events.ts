import { randomUUID } from 'node:crypto';

export type EventStatus = 'passed' | 'failed' | 'skipped' | 'unavailable' | 'not_implemented';

export interface SystemEvent {
  eventId: string;
  eventType: string;
  timestamp: Date;
  sessionId: string;
  projectId: string;
  runId: string;
  baseCommit: string;
  phase: string;
  status: EventStatus;
  safeSummary: string;
  affectedPaths: string[];
  userActionRequired: boolean;
}

const secretPatterns = [
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

export function redact(value: string): string {
  return secretPatterns.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value);
}

export function createSystemEvent(input: Omit<SystemEvent, 'eventId' | 'timestamp' | 'safeSummary'> & { safeSummary: string }): SystemEvent {
  return {
    ...input,
    eventId: randomUUID(),
    timestamp: new Date(),
    safeSummary: redact(input.safeSummary),
    affectedPaths: input.affectedPaths.map((path) => redact(path)),
  };
}

export function createDurableEventSink(): (event: SystemEvent) => Promise<void> {
  return async (event) => {
    const { getDatabaseStatus } = await import('./db/connection.js');
    if (getDatabaseStatus() !== 'connected') return;
    const { SystemEventModel } = await import('./db/models.js');
    await SystemEventModel.updateOne(
      { eventId: event.eventId },
      { $setOnInsert: event },
      { upsert: true },
    ).exec();
  };
}
