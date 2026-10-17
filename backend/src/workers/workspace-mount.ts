
import { validateSnapshotWorkspace } from './workspace-policy.js';

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
): Promise<string[]> {
  const verifiedPath = await validateSnapshotWorkspace(
    workspacePath,
    trustedRoot,
  );

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
