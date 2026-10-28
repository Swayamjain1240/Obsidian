import mongoose, { Schema } from 'mongoose';

const timestamps = true;

const projectSchema = new Schema(
  {
    githubOwner: { type: String, required: true, trim: true },
    repository: { type: String, required: true, trim: true },
    defaultBranch: { type: String, required: true, trim: true },
    accessScope: { type: String, enum: ['public', 'private'], required: true },
  },
  { timestamps },
);
projectSchema.index({ githubOwner: 1, repository: 1 }, { unique: true });

const repositorySnapshotSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    commitSha: { type: String, required: true, trim: true },
    branch: { type: String, required: true, trim: true },
    fileManifestHash: { type: String, required: true, trim: true },
    capturedAt: { type: Date, required: true },
  },
  { timestamps: false },
);
repositorySnapshotSchema.index({ projectId: 1, commitSha: 1 }, { unique: true });

const sessionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, enum: ['created', 'active', 'paused', 'completed', 'cancelled'], required: true },
  },
  { timestamps },
);
sessionSchema.index({ projectId: 1, status: 1, updatedAt: -1 });

const authSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, immutable: true },
    githubUserId: { type: Number, required: true, immutable: true },
    githubLogin: { type: String, required: true, immutable: true },
    accessTokenCiphertext: { type: String, required: true },
    accessTokenIv: { type: String, required: true },
    accessTokenTag: { type: String, required: true },
    accessTokenKeyId: { type: String, required: false, default: null },
    // TTL index is declared below; a second `index: true` here would drop its options.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const runSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    phase: { type: String, enum: ['detection', 'completeness', 'baseline', 'repair', 'enhancement', 'validation'], required: true },
    status: { type: String, enum: ['queued', 'running', 'passed', 'failed', 'paused', 'cancelled'], required: true },
    baseCommit: { type: String, required: true, trim: true },
  },
  { timestamps },
);

const durableRunStateSchema = new Schema(
  {
    ownerUserId: { type: String, required: true, index: true, immutable: true },
    runId: { type: String, required: true, index: true, immutable: true },
    phase: { type: String, required: true, immutable: true },
    schemaVersion: { type: Number, required: true, default: 2, min: 1 },
    revision: { type: Number, required: true, default: 1, min: 1 },
    lifecycleState: { type: String, default: null },
    recovery: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
durableRunStateSchema.index({ ownerUserId: 1, runId: 1 }, { unique: true });
durableRunStateSchema.index({ ownerUserId: 1, phase: 1, updatedAt: -1 });

const systemEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, immutable: true },
    eventType: { type: String, required: true, immutable: true },
    timestamp: { type: Date, required: true, immutable: true },
    sessionId: { type: String, required: true, immutable: true },
    projectId: { type: String, required: true, immutable: true },
    runId: { type: String, required: true, immutable: true },
    baseCommit: { type: String, required: true, immutable: true },
    phase: { type: String, required: true, immutable: true },
    status: { type: String, required: true, immutable: true },
    safeSummary: { type: String, required: true, immutable: true },
    affectedPaths: { type: [String], required: true, immutable: true },
    userActionRequired: { type: Boolean, required: true, immutable: true },
    requestId: { type: String, default: null, immutable: true, match: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ },
    correlationId: { type: String, default: null, immutable: true, match: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/ },
    integrityHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  },
  { timestamps: false },
);
systemEventSchema.index({ sessionId: 1, timestamp: 1 });
systemEventSchema.index({ projectId: 1, runId: 1, timestamp: 1 });
systemEventSchema.index({ timestamp: 1 });

export const ProjectModel = mongoose.models.Project ?? mongoose.model('Project', projectSchema);
export const RepositorySnapshotModel =
  mongoose.models.RepositorySnapshot ?? mongoose.model('RepositorySnapshot', repositorySnapshotSchema);
export const SessionModel = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
export const AuthSessionModel = mongoose.models.AuthSession ?? mongoose.model('AuthSession', authSessionSchema);
export const RunModel = mongoose.models.Run ?? mongoose.model('Run', runSchema);
export const DurableRunStateModel = mongoose.models.DurableRunState ?? mongoose.model('DurableRunState', durableRunStateSchema);
export const SystemEventModel = mongoose.models.SystemEvent ?? mongoose.model('SystemEvent', systemEventSchema);

const workflowStateSchema = new Schema(
  {
    ownerUserId: { type: String, required: true, index: true, immutable: true },
    kind: { type: String, required: true, index: true, immutable: true },
    stateId: { type: String, required: true, index: true, immutable: true },
    schemaVersion: { type: Number, required: true, default: 2, min: 1 },
    revision: { type: Number, required: true, default: 1, min: 1 },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
workflowStateSchema.index({ ownerUserId: 1, kind: 1, stateId: 1 }, { unique: true });
workflowStateSchema.index({ ownerUserId: 1, kind: 1, revision: 1 });
workflowStateSchema.index({ ownerUserId: 1, updatedAt: -1 });
workflowStateSchema.index({ ownerUserId: 1, kind: 1, 'payload.dueAt': 1, 'payload.createdAt': 1, stateId: 1 });

export const WorkflowStateModel = mongoose.models.WorkflowState ?? mongoose.model('WorkflowState', workflowStateSchema);

const workerLeaseSchema = new Schema(
  {
    jobId: { type: String, required: true, unique: true, immutable: true },
    ownerId: { type: String, required: true, index: true },
    leaseTokenHash: { type: String, required: true },
    fence: { type: Number, required: true, default: 1, min: 1 },
    containerName: { type: String, required: true, immutable: true },
    state: { type: String, enum: ['claimed', 'running', 'completed', 'failed', 'cancelled', 'recovery', 'recovered', 'recovery_failed'], required: true, index: true },
    leaseExpiresAt: { type: Date, required: true, index: true },
    heartbeatAt: { type: Date, required: true },
    lastErrorCode: { type: String, default: null },
  },
  { timestamps: true },
);
workerLeaseSchema.index({ state: 1, leaseExpiresAt: 1 });
workerLeaseSchema.index({ ownerId: 1, state: 1, leaseExpiresAt: 1 });

export const WorkerLeaseModel = mongoose.models.WorkerLease ?? mongoose.model('WorkerLease', workerLeaseSchema);
