
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_ENTRIES = 10_000;

function isStrictChild(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);

  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Validate a candidate snapshot workspace before it
 * can be considered for a Docker bind mount.
 *
 * trustedRoot must come from server configuration,
 * never directly from a repository or API request.
 */
export async function validateSnapshotWorkspace(
  workspacePath: string,
  trustedRoot: string,
): Promise<string> {
  const configuredRoot = path.resolve(trustedRoot);
  const configuredWorkspace = path.resolve(workspacePath);

  if (!isStrictChild(configuredRoot, configuredWorkspace)) {
    throw new Error('Workspace is outside the trusted snapshot root.');
  }

  const root = await realpath(configuredRoot);
  const workspace = await realpath(configuredWorkspace);

  if (!isStrictChild(root, workspace)) {
    throw new Error('Workspace resolves outside the trusted snapshot root.');
  }

  const relativeParts = path
    .relative(configuredRoot, configuredWorkspace)
    .split(path.sep);

  let current = configuredRoot;

  for (const part of relativeParts) {
    current = path.join(current, part);

    const stat = await lstat(current);

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Unsafe workspace directory.');
    }
  }

  let entriesSeen = 0;
  const pending = [workspace];

  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await readdir(directory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      entriesSeen += 1;

      if (entriesSeen > MAX_ENTRIES) {
        throw new Error('Workspace exceeds validation limits.');
      }

      if (entry.isSymbolicLink()) {
        throw new Error('Workspace contains a symbolic link.');
      }

      if (entry.isDirectory()) {
        pending.push(path.join(directory, entry.name));
      } else if (!entry.isFile()) {
        throw new Error('Workspace contains an unsupported file type.');
      }
    }
  }

  return workspace;
}
