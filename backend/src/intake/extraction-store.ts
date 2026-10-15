import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, opendir, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './snapshot.js';
import type { SnapshotRecord } from './snapshot.js';
import { extractionPolicyVersion, type ExtractionPolicy, type ExtractionRecord } from './extraction.js';
import {
  createExtractionTemporaryName,
  extractArchive,
  verifyArchive,
  validateExtractionPath,
  validateExtractionPolicy,
  type ArchiveFileRecord,
  type ExtractionCounters,
} from './extract-archive.js';

export interface FileManifest {
  version: string;
  snapshotId: string;
  archiveSha256: string;
  files: ArchiveFileRecord[];
}

const EXTRACTION_DIRECTORY = 'extraction';
const EXTRACTION_RECORD_FILE = 'record.json';
const FILE_MANIFEST_FILE = 'files.json';
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw asError(signal.reason ?? new Error('Extraction timed out.'));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function manifestLimit(policy: ExtractionPolicy): number {
  const estimated = 1_024 + policy.maxFiles * Math.min(policy.maxPathLength + 160, 16_384);
  return Math.min(MAX_MANIFEST_BYTES, Math.max(1_048_576, estimated));
}

function snapshotDirectory(snapshot: SnapshotRecord): string {
  if (typeof snapshot.archivePath !== 'string' || snapshot.archivePath.length === 0) {
    throw new Error('Snapshot archive path is invalid.');
  }
  return path.resolve(path.dirname(snapshot.archivePath));
}

function expectedPublicationPaths(snapshot: SnapshotRecord): {
  directory: string;
  recordPath: string;
  manifestPath: string;
  workspacePath: string;
} {
  const directory = path.join(snapshotDirectory(snapshot), EXTRACTION_DIRECTORY);
  return {
    directory,
    recordPath: path.join(directory, EXTRACTION_RECORD_FILE),
    manifestPath: path.join(directory, FILE_MANIFEST_FILE),
    workspacePath: path.join(directory, 'workspace'),
  };
}

function validateSnapshot(snapshot: SnapshotRecord): void {
  if (!snapshot.immutable || typeof snapshot.snapshotId !== 'string' || snapshot.snapshotId.length === 0) {
    throw new Error('Snapshot manifest is not immutable or has no snapshot id.');
  }
  if (!Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength < 0) {
    throw new Error('Snapshot archive byte length is invalid.');
  }
  if (!isSafeHash(snapshot.archiveSha256)) {
    throw new Error('Snapshot archive hash is invalid.');
  }
}

function extractionTimer(timeoutMs: number, callerSignal?: AbortSignal): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Archive extraction timed out.')), timeoutMs);
  return { signal: callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal, stop: () => clearTimeout(timer) };
}

async function boundedFile(filePath: string, maximumBytes: number, signal: AbortSignal): Promise<Buffer> {
  throwIfAborted(signal);
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('Extraction manifest is not a regular file.');
  if (metadata.size > maximumBytes) throw new Error('Extraction manifest exceeds the configured safety bound.');
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw new Error('Extraction manifest changed during verification.');
    const chunks: Buffer[] = [];
    let bytes = 0;
    const stream = handle.createReadStream({ signal, autoClose: false });
    stream.on('error', () => undefined);
    for await (const chunk of stream) {
      throwIfAborted(signal);
      bytes += chunk.length;
      if (bytes > maximumBytes || bytes > metadata.size) throw new Error('Extraction manifest exceeds the configured safety bound.');
      chunks.push(Buffer.from(chunk));
    }
    if (bytes !== metadata.size) throw new Error('Extraction manifest changed during verification.');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Extraction manifest path escapes the workspace.');
  }
}

function parseFileManifest(value: unknown, snapshot: SnapshotRecord, policy: ExtractionPolicy, signal: AbortSignal): FileManifest {
  if (!isObject(value) || value.version !== extractionPolicyVersion || value.snapshotId !== snapshot.snapshotId || value.archiveSha256 !== snapshot.archiveSha256) {
    throw new Error('Extraction file manifest metadata is invalid.');
  }
  if (!Array.isArray(value.files) || value.files.length > policy.maxFiles) throw new Error('Extraction file manifest has an invalid file count.');
  const files: ArchiveFileRecord[] = [];
  const seen = new Map<string, string>();
  for (const item of value.files) {
    throwIfAborted(signal);
    if (!isObject(item) || !isSafeNonnegativeInteger(item.bytes) || item.bytes > policy.maxSingleFileBytes || !isSafeHash(item.sha256)) {
      throw new Error('Extraction file manifest contains an invalid entry.');
    }
    const validated = validateExtractionPath(item.path, false, policy);
    const entry = { path: validated.path, bytes: item.bytes, sha256: item.sha256.toLowerCase() };
    const folded = entry.path.normalize('NFKC').toLowerCase();
    if (seen.has(folded)) throw new Error('Extraction file manifest contains colliding paths.');
    seen.set(folded, entry.path);
    files.push(entry);
  }
  return {
    version: value.version as string,
    snapshotId: value.snapshotId as string,
    archiveSha256: value.archiveSha256 as string,
    files,
  };
}

function parseExtractionRecord(value: unknown, expected: ReturnType<typeof expectedPublicationPaths>, snapshot: SnapshotRecord): ExtractionRecord {
  if (!isObject(value)
    || value.snapshotId !== snapshot.snapshotId
    || value.archiveSha256 !== snapshot.archiveSha256
    || value.extractionPolicyVersion !== extractionPolicyVersion
    || value.status !== 'completed'
    || value.workspacePath !== expected.workspacePath
    || value.manifestPath !== expected.manifestPath
    || typeof value.capturedAt !== 'string'
    || !isSafeNonnegativeInteger(value.extractedFileCount)
    || !isSafeNonnegativeInteger(value.extractedDirectoryCount)
    || !isSafeNonnegativeInteger(value.extractedBytes)
    || !isSafeHash(value.fileManifestSha256)) {
    throw new Error('Extraction record is incomplete or does not match the snapshot.');
  }
  return value as unknown as ExtractionRecord;
}

async function hashRegularFile(filePath: string, expectedBytes: number, signal: AbortSignal): Promise<{ bytes: number; sha256: string }> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('Extracted workspace contains a link or non-regular file.');
  if (metadata.size !== expectedBytes) throw new Error('Extraction file manifest size verification failed.');
  const digest = createHash('sha256');
  let bytes = 0;
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw new Error('Extracted workspace changed during verification.');
    const stream = handle.createReadStream({ signal, autoClose: false });
    stream.on('error', () => undefined);
    for await (const chunk of stream) {
      throwIfAborted(signal);
      bytes += chunk.length;
      if (bytes > expectedBytes) throw new Error('Extraction file manifest size verification failed.');
      digest.update(chunk);
    }
    return { bytes, sha256: digest.digest('hex') };
  } finally { await handle.close(); }
}

interface WorkspaceInventory {
  files: Map<string, { path: string; bytes: number }>;
  directories: Set<string>;
}

async function inventoryWorkspace(workspacePath: string, policy: ExtractionPolicy, signal: AbortSignal): Promise<WorkspaceInventory> {
  const files = new Map<string, { path: string; bytes: number }>();
  const directories = new Set<string>();
  const foldedPaths = new Set<string>();
  let bytes = 0;
  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    throwIfAborted(signal);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory()) throw new Error('Extracted workspace contains a link or special filesystem entry.');
    const entries = await opendir(directory);
    for await (const entry of entries) {
      throwIfAborted(signal);
      const relative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      validateExtractionPath(relative, entry.isDirectory(), policy);
      const folded = relative.normalize('NFKC').toLowerCase();
      if (foldedPaths.has(folded)) throw new Error('Extracted workspace contains colliding paths.');
      foldedPaths.add(folded);
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket()) {
        throw new Error('Extracted workspace contains a link or special filesystem entry.');
      }
      if (entry.isDirectory()) {
        directories.add(relative);
        if (directories.size > policy.maxDirectories) throw new Error('Extracted workspace exceeds the directory limit.');
        await visit(fullPath, relative);
      } else if (entry.isFile()) {
        const metadata = await lstat(fullPath);
        if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('Extracted workspace contains a link or special filesystem entry.');
        bytes += metadata.size;
        if (metadata.size > policy.maxSingleFileBytes || bytes > policy.maxExtractedBytes || files.size >= policy.maxFiles) throw new Error('Extracted workspace exceeds the file or byte limit.');
        files.set(relative, { path: relative, bytes: metadata.size });
      } else {
        throw new Error('Extracted workspace contains an unsupported filesystem entry.');
      }
    }
  }
  const metadata = await lstat(workspacePath);
  if (!metadata.isDirectory()) throw new Error('Extracted workspace is not a directory.');
  await visit(workspacePath, '');
  return { files, directories };
}

async function verifyCompleteExtraction(
  snapshot: SnapshotRecord,
  policy: ExtractionPolicy,
  expected: ReturnType<typeof expectedPublicationPaths>,
  signal: AbortSignal,
): Promise<ExtractionRecord> {
  if (!(await lstat(expected.directory)).isDirectory()) throw new Error('Extraction publication path is not a directory.');
  const recordValue = JSON.parse((await boundedFile(expected.recordPath, 64 * 1024, signal)).toString('utf8')) as unknown;
  const record = parseExtractionRecord(recordValue, expected, snapshot);
  const manifestBytes = await boundedFile(expected.manifestPath, manifestLimit(policy), signal);
  if (manifestBytes.byteLength > manifestLimit(policy) || sha256(manifestBytes) !== record.fileManifestSha256) {
    throw new Error('Extraction file manifest hash verification failed.');
  }
  const manifest = parseFileManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown, snapshot, policy, signal);
  if (manifest.files.length !== record.extractedFileCount || record.extractedFileCount > policy.maxFiles || record.extractedDirectoryCount > policy.maxDirectories || record.extractedBytes > policy.maxExtractedBytes) {
    throw new Error('Completed extraction exceeds the requested policy.');
  }

  assertInside(expected.directory, expected.workspacePath);
  const inventory = await inventoryWorkspace(expected.workspacePath, policy, signal);
  if (inventory.files.size !== manifest.files.length || inventory.directories.size !== record.extractedDirectoryCount) {
    throw new Error('Extraction workspace does not match its immutable file manifest.');
  }

  let payloadBytes = 0;
  for (const entry of manifest.files) {
    throwIfAborted(signal);
    const fullPath = path.join(expected.workspacePath, ...entry.path.split('/'));
    assertInside(expected.workspacePath, fullPath);
    const actual = inventory.files.get(entry.path);
    if (actual === undefined || actual.bytes !== entry.bytes || entry.bytes > policy.maxSingleFileBytes) {
      throw new Error('Extraction file manifest size verification failed.');
    }
    const digest = await hashRegularFile(fullPath, entry.bytes, signal);
    if (digest.bytes !== entry.bytes || digest.sha256 !== entry.sha256) {
      throw new Error('Extraction file manifest content verification failed.');
    }
    payloadBytes += entry.bytes;
    if (payloadBytes > policy.maxExtractedBytes) throw new Error('Extraction exceeds the payload byte limit.');
  }
  if (record.extractedBytes < payloadBytes) throw new Error('Extraction record byte count is inconsistent.');
  return record;
}

async function existingPublication(expected: ReturnType<typeof expectedPublicationPaths>): Promise<boolean> {
  try {
    const metadata = await lstat(expected.directory);
    if (!metadata.isDirectory()) throw new Error('Extraction publication path is not a directory.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function publicationRace(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM';
}

export async function extractSnapshot(
  snapshot: SnapshotRecord,
  policy: ExtractionPolicy,
  onProgress?: (stage: string, counters: ExtractionCounters) => void,
  signal?: AbortSignal,
): Promise<ExtractionRecord> {
  validateSnapshot(snapshot);
  validateExtractionPolicy(policy);
  const expected = expectedPublicationPaths(snapshot);
  const deadline = extractionTimer(policy.timeoutMs, signal);
  let temporaryRoot: string | undefined;
  try {
    onProgress?.('verifying', { files: 0, bytes: 0 });
    throwIfAborted(deadline.signal);
    if (await existingPublication(expected)) {
      try {
        await verifyArchive(snapshot.archivePath, snapshot.byteLength, snapshot.archiveSha256, deadline.signal);
        const reused = await verifyCompleteExtraction(snapshot, policy, expected, deadline.signal);
        throwIfAborted(deadline.signal);
        onProgress?.('reused', { files: reused.extractedFileCount, bytes: reused.extractedBytes });
        return reused;
      } catch (error) {
        throw new Error(`Existing extraction is not a verified complete publication: ${asError(error).message}`);
      }
    }

    const snapshotRoot = snapshotDirectory(snapshot);
    await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
    temporaryRoot = createExtractionTemporaryName(snapshotRoot);
    const extracted = await extractArchive(
      snapshot.archivePath,
      snapshot.byteLength,
      snapshot.archiveSha256,
      temporaryRoot,
      policy,
      deadline.signal,
      onProgress,
    );
    throwIfAborted(deadline.signal);
    const manifest: FileManifest = {
      version: extractionPolicyVersion,
      snapshotId: snapshot.snapshotId,
      archiveSha256: snapshot.archiveSha256,
      files: extracted.files,
    };
    const manifestContents = Buffer.from(JSON.stringify(manifest));
    if (manifestContents.byteLength > manifestLimit(policy)) throw new Error('Extraction file manifest exceeds the configured safety bound.');
    const fileManifestPath = path.join(temporaryRoot, FILE_MANIFEST_FILE);
    const recordPath = path.join(temporaryRoot, EXTRACTION_RECORD_FILE);
    const workspacePath = path.join(temporaryRoot, 'workspace');
    if (extracted.workspacePath !== workspacePath) throw new Error('Extraction workspace publication path is invalid.');
    await writeFile(fileManifestPath, manifestContents, { flag: 'wx', mode: 0o600, signal: deadline.signal });
    const record: ExtractionRecord = {
      snapshotId: snapshot.snapshotId,
      archiveSha256: snapshot.archiveSha256,
      extractionPolicyVersion,
      extractedFileCount: extracted.files.length,
      extractedDirectoryCount: extracted.extractedDirectoryCount,
      extractedBytes: extracted.extractedBytes,
      fileManifestSha256: sha256(manifestContents),
      status: 'completed',
      capturedAt: new Date().toISOString(),
      workspacePath: expected.workspacePath,
      manifestPath: expected.manifestPath,
    };
    await writeFile(recordPath, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600, signal: deadline.signal });
    onProgress?.('publishing', { files: record.extractedFileCount, bytes: record.extractedBytes });
    throwIfAborted(deadline.signal);
    try {
      await rename(temporaryRoot, expected.directory);
    } catch (error) {
      if (!publicationRace(error)) throw error;
      const reused = await verifyCompleteExtraction(snapshot, policy, expected, deadline.signal);
      // Keep ownership of the losing staging directory until finally removes it.
      onProgress?.('reused', { files: reused.extractedFileCount, bytes: reused.extractedBytes });
      return reused;
    }
    temporaryRoot = undefined;
    onProgress?.('completed', { files: record.extractedFileCount, bytes: record.extractedBytes });
    return record;
  } finally {
    deadline.stop();
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}
