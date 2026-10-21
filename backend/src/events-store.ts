import type { SystemEvent } from './events.js';
import { SystemEventModel } from './db/models.js';
import { getDatabaseStatus } from './db/connection.js';

export class EventPersistenceError extends Error {
  public constructor(message = 'System event could not be durably persisted.') {
    super(message);
    this.name = 'EventPersistenceError';
  }
}

export class DurableEventStore {
  public constructor(private readonly required = true) {}

  public async append(event: SystemEvent): Promise<void> {
    if (getDatabaseStatus() !== 'connected') {
      if (this.required) throw new EventPersistenceError();
      return;
    }
    try {
      await SystemEventModel.updateOne(
        { eventId: event.eventId },
        { $setOnInsert: event },
        { upsert: true, writeConcern: { w: 'majority', j: true } },
      ).exec();
      const persisted = await SystemEventModel.findOne({ eventId: event.eventId }).select({ integrityHash: 1 }).lean().exec();
      if (!persisted || persisted.integrityHash !== event.integrityHash) throw new EventPersistenceError('System event integrity conflict.');
    } catch (reason: unknown) {
      throw new EventPersistenceError(reason instanceof Error ? reason.message : undefined);
    }
  }
}
