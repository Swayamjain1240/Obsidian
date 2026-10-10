import mongoose from 'mongoose';

export type DatabaseStatus = 'not_connected' | 'connected' | 'disconnected' | 'error';

let status: DatabaseStatus = 'not_connected';

export function getDatabaseStatus(): DatabaseStatus {
  return status;
}

export async function connectDatabase(uri: string): Promise<void> {
  status = 'not_connected';

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
    status = 'connected';
  } catch (error) {
    status = 'error';
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  status = 'disconnected';
}
