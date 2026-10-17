import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_LIMITS: WorkspaceLimits = {
  maxFiles: 10_000,
  maxDirectories: 5_000,
  maxBytes: 200 * 1024 * 1024,
  maxSingleFileBytes: 20 * 1024 * 1024,
  maxDepth: 128,
};

export interface WorkspaceLimits {
  maxFiles: number;
  maxDirectories: number;
  maxBytes: number;
  maxSingleFileBytes: number;
  maxDepth: number;
}

export interface WorkspaceInventory {
  workspacePath: string;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  fingerprint: string;
}

function isStrictChild(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);

  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function checkedLimits(limits: Partial<WorkspaceLimits>): WorkspaceLimits {
  const value = { ...DEFAULT_LIMITS, ...limits };
  if (
    !Number.isSafeInteger(value.maxFiles) || value.maxFiles < 1 ||
    !Number.isSafeInteger(value.maxDirectories) || value.maxDirectories < 0 ||
    !Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1 ||
    !Number.isSafeInteger(value.maxSingleFileBytes) || value.maxSingleFileBytes < 1 ||
    !Number.isSafeInteger(value.maxDepth) || value.maxDepth < 1 ||
    value.maxSingleFileBytes > value.maxBytes
  ) {
    throw new Error('Invalid workspace validation limits.');
  }
  return value;
}

function assertSafeComponent(component: string): void {
  if (
    component.length === 0 ||
    component === '.' ||
    component === '..' ||
    component.includes('\0') ||
    component.includes('/') ||
    component.includes('\\')
  ) {
    throw new Error('Workspace contains an unsafe path component.');
  }
}

async function hashRegularFile(
  filePath: string,
  maximumBytes: number,
): Promise<{ bytes: number; sha256: string }> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > maximumBytes) {
    throw new Error('Workspace contains an unsafe or oversized regular file.');
  }

  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== metadata.ino || opened.dev !== metadata.dev) {
      throw new Error('Workspace file changed during validation.');
    }
    const digest = createHash('sha256');
    let bytes = 0;
    const stream = handle.createReadStream({ autoClose: false });
    stream.on('error', () => undefined);
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > maximumBytes || bytes > metadata.size) throw new Error('Workspace file exceeded its validation limit.');
      digest.update(chunk);
    }
    const final = await handle.stat();
    if (bytes !== metadata.size || final.size !== bytes || final.ino !== opened.ino || final.dev !== opened.dev || final.mtimeMs !== opened.mtimeMs || final.ctimeMs !== opened.ctimeMs) {
      throw new Error('Workspace file changed during validation.');
    }
    return { bytes, sha256: digest.digest('hex') };
  } finally {
    await handle.close();
  }
}

/**
 * Validate and inventory a snapshot workspace before it is exposed to a
 * worker. The returned fingerprint can be compared after execution to detect
 * a host-side mutation of the supposedly immutable snapshot.
 */
export async function inspectSnapshotWorkspace(
  workspacePath: string,
  trustedRoot: string,
  limits: Partial<WorkspaceLimits> = {},
): Promise<WorkspaceInventory> {
  const policy = checkedLimits(limits);
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

  const relativeParts = path.relative(configuredRoot, configuredWorkspace).split(path.sep);
  let current = configuredRoot;

  for (const part of relativeParts) {
    current = path.join(current, part);

    const stat = await lstat(current);

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Unsafe workspace directory.');
    }
  }

  let entriesSeen = 0;
  let totalBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  const pending: Array<{ directory: string; relative: string; depth: number }> = [{ directory: workspace, relative: '', depth: 0 }];

  while (pending.length > 0) {
    const currentDirectory = pending.pop()!;
    const entries = await readdir(currentDirectory.directory, { withFileTypes: true });

    for (const entry of entries) {
      entriesSeen += 1;
      if (entriesSeen > policy.maxFiles + policy.maxDirectories) {
        throw new Error('Workspace exceeds validation limits.');
      }

      assertSafeComponent(entry.name);
      const relative = currentDirectory.relative.length === 0 ? entry.name : `${currentDirectory.relative}/${entry.name}`;
      const depth = currentDirectory.depth + 1;
      if (depth > policy.maxDepth) throw new Error('Workspace exceeds the configured directory depth.');
      const fullPath = path.join(currentDirectory.directory, entry.name);

      if (entry.isSymbolicLink()) {
        throw new Error('Workspace contains a symbolic link.');
      }

      if (entry.isDirectory()) {
        directoryCount += 1;
        if (directoryCount > policy.maxDirectories) throw new Error('Workspace exceeds the directory limit.');
        const directoryMetadata = await lstat(fullPath);
        if (!directoryMetadata.isDirectory()) throw new Error('Workspace directory changed during validation.');
        pending.push({ directory: fullPath, relative, depth });
      } else if (entry.isFile()) {
        fileCount += 1;
        if (fileCount > policy.maxFiles) throw new Error('Workspace exceeds the file limit.');
        const digest = await hashRegularFile(fullPath, policy.maxSingleFileBytes);
        totalBytes += digest.bytes;
        if (totalBytes > policy.maxBytes) throw new Error('Workspace exceeds the byte limit.');
        files.push({ path: relative, bytes: digest.bytes, sha256: digest.sha256 });
      } else {
        throw new Error('Workspace contains an unsupported file type.');
      }
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const fingerprint = createHash('sha256').update(JSON.stringify({ files })).digest('hex');
  return { workspacePath: workspace, fileCount, directoryCount, totalBytes, fingerprint };
}

/**
 * Validate a candidate snapshot workspace before it can be considered for a
 * Docker bind mount. trustedRoot must come from server configuration, never
 * directly from a repository or API request.
 */
export async function validateSnapshotWorkspace(
  workspacePath: string,
  trustedRoot: string,
  limits: Partial<WorkspaceLimits> = {},
): Promise<string> {
  return (await inspectSnapshotWorkspace(workspacePath, trustedRoot, limits)).workspacePath;
}
