// Applies the index declarations in db/models.ts to the connected database.
//
// Mongoose autoIndex creates missing indexes but never changes an existing one, so a
// database that ran an earlier schema keeps its old options - notably a plain
// `expiresAt` index in place of the session TTL index. Run this after upgrading a
// deployment instead of dropping collections.
import 'dotenv/config';

import { connectDatabase, disconnectDatabase } from './connection.js';
import {
  AuthSessionModel,
  DurableRunStateModel,
  ProjectModel,
  RepositorySnapshotModel,
  RunModel,
  SessionModel,
  SystemEventModel,
  WorkerLeaseModel,
  WorkflowStateModel,
} from './models.js';

const models = [
  ProjectModel,
  RepositorySnapshotModel,
  SessionModel,
  AuthSessionModel,
  RunModel,
  DurableRunStateModel,
  SystemEventModel,
  WorkflowStateModel,
  WorkerLeaseModel,
];

// Only the database URI is needed here. Loading the whole application config would
// make this maintenance script fail on an unrelated variable (a stray PORT, for
// example) that the running service already tolerates.
const mongodbUri = process.env.MONGODB_URI;
if (!mongodbUri) throw new Error('MONGODB_URI is required to synchronize indexes.');

await connectDatabase(mongodbUri);
try {
  for (const model of models) {
    const dropped = await model.syncIndexes();
    console.log(
      `[sync-indexes] ${model.modelName} (${model.collection.name}): synchronized${
        dropped.length > 0 ? `; replaced ${dropped.join(', ')}` : ''
      }`,
    );
  }
} finally {
  await disconnectDatabase();
}
