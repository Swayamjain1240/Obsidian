import mongoose from 'mongoose';

import { getDatabaseStatus, getDatabaseGeneration, pingDatabase } from './connection.js';

export interface DatabaseRuntimeStatus {
  status: ReturnType<typeof getDatabaseStatus>;
  generation: number;
  topology: 'unknown' | 'standalone' | 'replica_set' | 'sharded';
  transactionsSupported: boolean;
  pingMs: number | null;
}

export async function getDatabaseRuntimeStatus(): Promise<DatabaseRuntimeStatus> {
  const ping = await pingDatabase();
  const topology = (mongoose.connection.getClient() as unknown as { topology?: { description?: { type?: string } } } | undefined)?.topology?.description?.type;
  const normalizedTopology = topology === 'ReplicaSetWithPrimary' || topology === 'ReplicaSetNoPrimary'
    ? 'replica_set'
    : topology === 'Sharded'
      ? 'sharded'
      : topology === 'Single'
        ? 'standalone'
        : 'unknown';
  return {
    status: getDatabaseStatus(),
    generation: getDatabaseGeneration(),
    topology: normalizedTopology,
    transactionsSupported: normalizedTopology === 'replica_set' || normalizedTopology === 'sharded',
    pingMs: ping,
  };
}
