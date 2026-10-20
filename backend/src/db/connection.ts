import mongoose from 'mongoose';

export type DatabaseStatus = 'not_connected' | 'connected' | 'disconnected' | 'error';

export interface DatabaseConnectionOptions {
  serverSelectionTimeoutMS?: number;
  connectTimeoutMS?: number;
  socketTimeoutMS?: number;
  heartbeatFrequencyMS?: number;
}

let status: DatabaseStatus = 'not_connected';
let generation = 0;
let lastErrorAt: number | null = null;

mongoose.connection.on('connected', () => { status = 'connected'; generation += 1; });
mongoose.connection.on('disconnected', () => { status = 'disconnected'; generation += 1; });
mongoose.connection.on('error', () => { status = 'error'; lastErrorAt = Date.now(); generation += 1; });

export function getDatabaseStatus(): DatabaseStatus {
  return status;
}

export function getDatabaseGeneration(): number {
  return generation;
}

export function getDatabaseLastErrorAt(): number | null {
  return lastErrorAt;
}

export async function connectDatabase(uri: string, options: DatabaseConnectionOptions = {}): Promise<void> {
  status = 'not_connected';

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 5_000,
      connectTimeoutMS: options.connectTimeoutMS ?? 5_000,
      socketTimeoutMS: options.socketTimeoutMS ?? 30_000,
      heartbeatFrequencyMS: options.heartbeatFrequencyMS ?? 10_000,
      retryWrites: true,
      w: 'majority',
      journal: true,
    });
    status = 'connected';
    generation += 1;
  } catch (error) {
    status = 'error';
    lastErrorAt = Date.now();
    generation += 1;
    throw error;
  }
}

export async function pingDatabase(): Promise<number | null> {
  if (status !== 'connected') return null;
  const started = Date.now();
  try {
    await mongoose.connection.db?.command({ ping: 1 });
    return Date.now() - started;
  } catch {
    status = 'error';
    lastErrorAt = Date.now();
    generation += 1;
    return null;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  status = 'disconnected';
}
