
import { validateSnapshotWorkspace, type WorkspaceLimits } from './workspace-policy.js';
import path from 'node:path';

const CONTAINER_SNAPSHOT_PATH = '/input';

/**
 * Prepare a read-only Docker bind mount for a
 * validated snapshot workspace.
 *
 * trustedRoot must come from server configuration,
 * not from an untrusted API request.
 */
export async function buildSnapshotMountArgs(
  workspacePath: string,
  trustedRoot: string,
  limits: Partial<WorkspaceLimits> = {},
): Promise<string[]> {
  await validateSnapshotWorkspace(
    workspacePath,
    trustedRoot,
    limits,
  );
  // Keep the caller's absolute spelling for Docker Desktop. Windows can
  // return an 8.3 short path from realpath(), which is valid to Node but may
  // not map to an allowed host share in Docker Desktop. The path has already
  // been fully verified above, so this is only a mount-string normalization.
  const verifiedPath = path.resolve(workspacePath);

  // Docker's --mount option uses commas as separators.
  // Reject ambiguous or control-character-containing paths.
  if (/[,|\x00-\x1f]/.test(verifiedPath)) {
    throw new Error('Workspace path is unsafe for Docker mounting.');
  }

  return [
    '--mount',
    `type=bind,source=${verifiedPath},target=${CONTAINER_SNAPSHOT_PATH},readonly`,
  ];
}
