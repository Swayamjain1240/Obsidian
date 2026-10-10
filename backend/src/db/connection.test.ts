import { describe, expect, it } from 'vitest';

import { getDatabaseStatus } from './connection.js';
import { ProjectModel, RepositorySnapshotModel, RunModel, SessionModel } from './models.js';

describe('database boundary', () => {
  it('starts disconnected and exposes foundation models', () => {
    expect(getDatabaseStatus()).toBe('not_connected');
    expect(ProjectModel.modelName).toBe('Project');
    expect(RepositorySnapshotModel.modelName).toBe('RepositorySnapshot');
    expect(SessionModel.modelName).toBe('Session');
    expect(RunModel.modelName).toBe('Run');
  });
});
