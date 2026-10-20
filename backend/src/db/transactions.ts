import mongoose, { type ClientSession } from 'mongoose';

import { getDatabaseRuntimeStatus } from './runtime.js';

export class DatabaseTransactionUnavailableError extends Error {
  public constructor(message = 'MongoDB transactions require a replica-set or sharded deployment.') {
    super(message);
    this.name = 'DatabaseTransactionUnavailableError';
  }
}

export interface TransactionOptions {
  maxCommitTimeMS?: number;
  maxRetries?: number;
}

export async function withMongoTransaction<T>(
  operation: (session: ClientSession) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const runtime = await getDatabaseRuntimeStatus();
  if (!runtime.transactionsSupported) throw new DatabaseTransactionUnavailableError();
  const session = await mongoose.startSession();
  const maxRetries = options.maxRetries ?? 2;
  try {
    let attempt = 0;
    while (true) {
      try {
        let result!: T;
        await session.withTransaction(async () => {
          result = await operation(session);
        }, {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority', j: true },
          readPreference: 'primary',
          maxCommitTimeMS: options.maxCommitTimeMS ?? 10_000,
        });
        return result;
      } catch (reason: unknown) {
        const labels = typeof reason === 'object' && reason !== null && 'errorLabels' in reason
          ? (reason as { errorLabels?: unknown }).errorLabels
          : undefined;
        const retryable = Array.isArray(labels) && labels.some((label) => label === 'TransientTransactionError' || label === 'UnknownTransactionCommitResult');
        if (!retryable || attempt >= maxRetries) throw reason;
        attempt += 1;
      }
    }
  } finally {
    await session.endSession();
  }
}
