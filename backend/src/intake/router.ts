import { Router } from 'express';
import { z } from 'zod';

import { requireGithubSession } from '../auth/session-middleware.js';
import type { SessionStore } from '../auth/session-store.js';
import type { AppConfig } from '../config.js';
import { errorBody } from '../http/response.js';
import { GithubApiClient } from '../github/client.js';
import { RepositoryIntakeService } from './service.js';
import { SnapshotStore } from './snapshot-store.js';
import { requireSameOrigin } from '../security.js';
import { SnapshotHandleStore } from './handle-store.js';
import { RepositorySelectionStore } from './repository-authorization.js';
import { WorkflowPersistenceError } from '../workflow/store.js';

const repositorySchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
  name: z.string().regex(/^[A-Za-z0-9_.-]+$/).max(100),
  branch: z.string().regex(/^[A-Za-z0-9_.\/-]+$/).max(200),
});

export function createIntakeRouter(
  config: AppConfig,
  sessionStore: SessionStore,
  intakeService?: RepositoryIntakeService,
  handleStore = new SnapshotHandleStore(),
  selectionStore = new RepositorySelectionStore(),
) {
  const router = Router();
  const intake = intakeService ?? new RepositoryIntakeService(new SnapshotStore(config.SNAPSHOT_ROOT, config.SNAPSHOT_MAX_BYTES));
  router.use(requireGithubSession(sessionStore));
  router.use(requireSameOrigin(config.FRONTEND_ORIGIN));

  router.post('/snapshot', async (request, response) => {
    const parsed = repositorySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(errorBody('INVALID_INPUT', 'Repository reference is invalid.', response.locals.requestId as string));
      return;
    }

    try {
       const session = response.locals.githubSession as { accessToken: string; sessionId: string; githubUserId: number };
       const userId = String(session.githubUserId);
        const selected = await selectionStore.getDurable(userId, session.sessionId);
        if (!selected || selected.repository.full_name !== `${parsed.data.owner}/${parsed.data.name}` || selected.selectedBranch !== parsed.data.branch) {
         response.status(409).json(errorBody('REPOSITORY_NOT_SELECTED', 'Select this repository through the authenticated repository picker before creating a snapshot.', response.locals.requestId as string));
         return;
       }
       const result = await intake.createSnapshot(new GithubApiClient(session.accessToken), parsed.data);
       const snapshotHandle = handleStore.create(userId, result.snapshot, Date.now(), session.sessionId);
       try {
         await handleStore.persist(userId, snapshotHandle);
       } catch {
         response.status(503).json(errorBody('INTERNAL_ERROR', 'The snapshot handle could not be durably recorded.', response.locals.requestId as string));
         return;
       }
      response.status(201).json({
        intake: {
          intakeId: result.intakeId,
          snapshot: {
            snapshotId: result.snapshot.snapshotId,
            archiveSha256: result.snapshot.archiveSha256,
            byteLength: result.snapshot.byteLength,
            capturedAt: result.snapshot.capturedAt,
            immutable: result.snapshot.immutable,
            repository: {
              owner: result.snapshot.repository.owner,
              name: result.snapshot.repository.name,
              branch: result.snapshot.repository.branch,
              commitSha: result.snapshot.repository.commitSha,
            },
          },
          snapshotHandle,
          analysisStatus: result.analysisStatus,
        },
        requestId: response.locals.requestId,
      });
     } catch (reason: unknown) {
       if (reason instanceof WorkflowPersistenceError) {
         response.status(503).json(errorBody('INTERNAL_ERROR', 'Workflow state could not be durably read.', response.locals.requestId as string));
         return;
       }
       response.status(502).json(errorBody('GITHUB_API_ERROR', 'Repository snapshot could not be created.', response.locals.requestId as string));
     }
  });

  return router;
}
