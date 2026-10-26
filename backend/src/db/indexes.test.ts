import { describe, expect, it } from 'vitest';

import { AuthSessionModel, DurableRunStateModel, ProjectModel, RepositorySnapshotModel, SystemEventModel, WorkerLeaseModel, WorkflowStateModel } from './models.js';

function indexKeys(model: { schema: { indexes: () => Array<[Record<string, number>, Record<string, unknown>?]> } }): string[] {
  return model.schema.indexes().map(([keys]) => Object.keys(keys).join(','));
}

describe('MongoDB index declarations', () => {
  it('declares ownership, revision, recovery, and timeline indexes', () => {
    expect(indexKeys(ProjectModel)).toContain('githubOwner,repository');
    expect(indexKeys(RepositorySnapshotModel)).toContain('projectId,commitSha');
    expect(indexKeys(DurableRunStateModel)).toContain('ownerUserId,runId');
    expect(indexKeys(WorkflowStateModel)).toContain('ownerUserId,kind,stateId');
    expect(indexKeys(WorkerLeaseModel)).toContain('state,leaseExpiresAt');
    expect(indexKeys(SystemEventModel)).toContain('projectId,runId,timestamp');
  });

  it('declares expiration enforcement for durable authentication sessions', () => {
    expect(AuthSessionModel.schema.indexes().some(([keys, options]) => Object.keys(keys).join(',') === 'expiresAt' && options?.expireAfterSeconds === 0)).toBe(true);
  });

  it('declares ordered due-task support for bounded privacy cleanup pages', () => {
    expect(indexKeys(WorkflowStateModel)).toContain('ownerUserId,kind,payload.dueAt,payload.createdAt,stateId');
  });
});
