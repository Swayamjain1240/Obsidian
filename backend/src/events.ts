import { createHash, randomUUID } from 'node:crypto';

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
  requestId?: string;
  correlationId?: string;
  integrityHash: string;
}

const secretPatterns = [
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

export function redact(value: string): string {
  return secretPatterns.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value);
}

export function createSystemEvent(input: Omit<SystemEvent, 'eventId' | 'timestamp' | 'safeSummary' | 'integrityHash'> & { eventId?: string; safeSummary: string }): SystemEvent {
  const event = {
    ...input,
    eventId: input.eventId ?? randomUUID(),
    timestamp: new Date(),
    safeSummary: redact(input.safeSummary),
    affectedPaths: input.affectedPaths.map((path) => redact(path)),
  };
  const integrityHash = createHash('sha256').update(JSON.stringify({ ...event, timestamp: event.timestamp.toISOString() })).digest('hex');
  return { ...event, integrityHash };
}

export function createDurableEventSink(): (event: SystemEvent) => Promise<void> {
  return async (event) => {
    const { DurableEventStore } = await import('./events-store.js');
    await new DurableEventStore(false).append(event);
  };
}

export function createRequiredDurableEventSink(): (event: SystemEvent) => Promise<void> {
  const storePromise = import('./events-store.js').then(({ DurableEventStore }) => new DurableEventStore(true));
  return async (event) => { await (await storePromise).append(event); };
}
