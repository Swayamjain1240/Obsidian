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

const sessionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, enum: ['created', 'active', 'paused', 'completed', 'cancelled'], required: true },
  },
  { timestamps },
);

const runSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    phase: { type: String, enum: ['detection', 'completeness', 'baseline', 'repair', 'enhancement', 'validation'], required: true },
    status: { type: String, enum: ['queued', 'running', 'passed', 'failed', 'paused', 'cancelled'], required: true },
    baseCommit: { type: String, required: true, trim: true },
  },
  { timestamps },
);

export const ProjectModel = mongoose.models.Project ?? mongoose.model('Project', projectSchema);
export const RepositorySnapshotModel =
  mongoose.models.RepositorySnapshot ?? mongoose.model('RepositorySnapshot', repositorySnapshotSchema);
export const SessionModel = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
export const RunModel = mongoose.models.Run ?? mongoose.model('Run', runSchema);
