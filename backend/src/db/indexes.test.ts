import { describe, expect, it } from 'vitest';

import { DurableRunStateModel, ProjectModel, RepositorySnapshotModel, SystemEventModel, WorkerLeaseModel, WorkflowStateModel } from './models.js';

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
});
