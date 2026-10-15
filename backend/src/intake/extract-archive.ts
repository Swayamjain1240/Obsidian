import { createHash, randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import { extract as createTarExtractor, type ExtractEvents } from 'tar-stream';

import type { ExtractionPolicy } from './extraction.js';

export interface ArchiveFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ExtractArchiveResult {
  workspacePath: string;
  files: ArchiveFileRecord[];
  extractedDirectoryCount: number;
  extractedBytes: number;
}

export interface ExtractionCounters {
  files: number;
  bytes: number;
}

const DEFAULT_MAX_PATH_DEPTH = 128;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

type ArchivePathKind = 'file' | 'directory' | 'implicit-directory';
type ArchiveEntryStream = ExtractEvents['entry'][1];

interface ArchivePathRecord {
  path: string;
  components: string[];
  kind: 'file' | 'directory';
  bytes?: number;
  sha256?: string;
}

interface ArchivePathState {
  paths: Map<string, { path: string; kind: ArchivePathKind }>;
  casefoldedPaths: Map<string, string>;
  files: ArchivePathRecord[];
  directories: Set<string>;
}

class ArchiveMeter extends Transform {
  public bytes = 0;
  public readonly hash = createHash('sha256');

  public constructor(private readonly expectedBytes: number) {
    super();
  }

  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.bytes += chunk.length;
    if (this.bytes > this.expectedBytes) {
      callback(new Error('Archive byte length exceeds the snapshot manifest.'));
      return;
    }

    this.hash.update(chunk);
    callback(null, chunk);
  }
}

class InflatedMeter extends Transform {
  public bytes = 0;

  public constructor(private readonly maxBytes: number) {
    super();
  }

  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      callback(new Error('Inflated archive exceeds the configured extraction byte limit.'));
      return;
    }

    callback(null, chunk);
  }
}

// tar-stream intentionally accepts archives without end-of-archive blocks and
// buffers extended headers internally. Bound those headers and require a complete
// tar envelope before anything can be published.
class TarEnvelope extends Transform {
  private header = Buffer.alloc(512);
  private headerBytes = 0;
  private remaining = 0;
  private zeroBlocks = 0;
  private headers = 0;

  public constructor(private readonly policy: ExtractionPolicy) { super(); }

  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (this.remaining > 0) {
          const consumed = Math.min(this.remaining, chunk.length - offset);
          offset += consumed;
          this.remaining -= consumed;
          continue;
        }
        const consumed = Math.min(512 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + consumed);
        offset += consumed;
        this.headerBytes += consumed;
        if (this.headerBytes !== 512) continue;
        this.headerBytes = 0;
        if (this.header.every((byte) => byte === 0)) {
          this.zeroBlocks += 1;
          continue;
        }
        if (this.zeroBlocks > 0) throw new Error('Archive contains entries after its tar terminator.');
        for (const field of [this.header.subarray(0, 100), this.header.subarray(345, 500)]) {
          const nul = field.indexOf(0);
          if (nul >= 0 && field.subarray(nul).some((byte) => byte !== 0)) throw new Error('Archive path field contains an embedded NUL byte.');
        }
        this.headers += 1;
        if (this.headers > (this.policy.maxFiles + this.policy.maxDirectories + 1) * 4 + 16) {
          throw new Error('Archive contains too many tar headers.');
        }
        const sizeField = this.header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
        if ((this.header[124] & 0x80) !== 0 || !/^[0-7]+$/.test(sizeField)) throw new Error('Archive has an invalid tar size.');
        const size = Number.parseInt(sizeField, 8);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Archive has an invalid tar size.');
        const type = String.fromCharCode(this.header[156]);
        if (!['\0', '0', '5', 'x', 'g', 'L'].includes(type)) throw new Error('Archive entry type is not permitted.');
        if (['x', 'g', 'L'].includes(type) && size > Math.min(this.policy.maxExtractedBytes, 64 * 1024)) {
          throw new Error('Archive extended header exceeds the metadata safety limit.');
        }
        if (type === '5' && size !== 0) throw new Error('Archive directory entry has a non-empty payload.');
        if ((type === '0' || type === '\0') && size > this.policy.maxSingleFileBytes) {
          throw new Error('Archive file exceeds the configured per-file byte limit.');
        }
        this.remaining = Math.ceil(size / 512) * 512;
      }
      callback(null, chunk);
    } catch (error) { callback(asError(error)); }
  }

  public override _flush(callback: (error?: Error | null) => void): void {
    callback(this.remaining !== 0 || this.headerBytes !== 0 || this.zeroBlocks < 2
      ? new Error('Archive tar envelope is truncated or missing its terminator.') : undefined);
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw asError(signal.reason ?? new Error('Archive extraction timed out.'));
}

function casefold(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function policyMaxDepth(policy: ExtractionPolicy): number {
  const extended = policy as ExtractionPolicy & { maxPathDepth?: number; maxDepth?: number };
  const configured = extended.maxPathDepth ?? extended.maxDepth;
  if (configured === undefined) return DEFAULT_MAX_PATH_DEPTH;
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new Error('Extraction path depth limit must be a positive integer.');
  }
  return configured;
}

export function validateExtractionPolicy(policy: ExtractionPolicy): void {
  const numericLimits: Array<[string, number, number]> = [
    ['maxExtractedBytes', policy.maxExtractedBytes, 1],
    ['maxFiles', policy.maxFiles, 0],
    ['maxDirectories', policy.maxDirectories, 0],
    ['maxSingleFileBytes', policy.maxSingleFileBytes, 0],
    ['maxPathLength', policy.maxPathLength, 1],
    ['timeoutMs', policy.timeoutMs, 1],
  ];
  for (const [name, value, minimum] of numericLimits) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`Extraction policy ${name} must be a safe integer of at least ${minimum}.`);
    }
  }
  policyMaxDepth(policy);
  if (policy.timeoutMs > 2_147_483_647) throw new Error('Extraction timeout exceeds the supported timer range.');
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function validateExtractionPath(name: unknown, isDirectory: boolean, policy: Pick<ExtractionPolicy, 'maxPathLength'> & { maxPathDepth?: number; maxDepth?: number }): { path: string; components: string[] } {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Archive entry has an empty or invalid path.');
  }
  if (name.includes('\0')) {
    throw new Error('Archive entry paths may not contain NUL bytes.');
  }
  if (name.includes('\\')) {
    throw new Error('Archive entry paths may not contain backslashes.');
  }
  if (name.startsWith('/') || name.startsWith('//') || /^[A-Za-z]:($|\/)/.test(name)) {
    throw new Error('Archive entry path is absolute or drive-qualified.');
  }

  const rawComponents = name.split('/');
  if (isDirectory && rawComponents.at(-1) === '') rawComponents.pop();
  if (rawComponents.length === 0 || rawComponents.some((component) => component.length === 0)) {
    throw new Error('Archive entry path contains an empty component.');
  }
  if (rawComponents.some((component) => component === '.' || component === '..')) {
    throw new Error('Archive entry path contains a dot or parent component.');
  }

  const maxDepth = policyMaxDepth(policy as ExtractionPolicy);
  if (rawComponents.length > maxDepth) {
    throw new Error('Archive entry path exceeds the configured depth limit.');
  }
  if (Buffer.byteLength(name, 'utf8') > policy.maxPathLength) {
    throw new Error('Archive entry path exceeds the configured path length limit.');
  }

  for (const component of rawComponents) {
    if (component.endsWith('.') || component.endsWith(' ')) {
      throw new Error('Archive entry path contains a trailing dot or space.');
    }
    if (/[<>"|?*\u0000-\u001f]/.test(component)) {
      throw new Error('Archive entry path contains a Windows-invalid character.');
    }
    if (component.includes(':')) {
      throw new Error('Archive entry path contains a drive or alternate data stream separator.');
    }
    if (WINDOWS_RESERVED_NAMES.test(component)) {
      throw new Error('Archive entry path contains a Windows reserved name.');
    }
  }

  return { path: rawComponents.join('/'), components: rawComponents };
}

function addDirectoryPath(state: ArchivePathState, directoryPath: string, components: string[], policy: ExtractionPolicy, explicit: boolean): void {
  const folded = casefold(directoryPath);
  const existingFolded = state.casefoldedPaths.get(folded);
  if (existingFolded !== undefined && existingFolded !== directoryPath) {
    throw new Error('Archive contains case-insensitive colliding paths.');
  }

  const existing = state.paths.get(directoryPath);
  if (existing !== undefined) {
    if (existing.kind === 'file') throw new Error('Archive contains a file/directory path collision.');
    if (explicit && existing.kind === 'directory') throw new Error('Archive contains duplicate paths.');
    if (existing.path !== directoryPath) throw new Error('Archive contains colliding paths.');
    if (explicit) existing.kind = 'directory';
  } else {
    state.paths.set(directoryPath, { path: directoryPath, kind: explicit ? 'directory' : 'implicit-directory' });
    state.casefoldedPaths.set(folded, directoryPath);
  }

  state.directories.add(directoryPath);
  if (state.directories.size > policy.maxDirectories + 1) {
    throw new Error('Archive contains more directories than the configured limit.');
  }
}

function addParentDirectories(state: ArchivePathState, components: string[], policy: ExtractionPolicy): void {
  for (let index = 1; index < components.length; index += 1) {
    const parentComponents = components.slice(0, index);
    addDirectoryPath(state, parentComponents.join('/'), parentComponents, policy, false);
  }
}

function registerPath(state: ArchivePathState, archivePath: string, components: string[], kind: 'file' | 'directory', policy: ExtractionPolicy): void {
  addParentDirectories(state, components, policy);
  const folded = casefold(archivePath);
  const existingFolded = state.casefoldedPaths.get(folded);
  if (existingFolded !== undefined && existingFolded !== archivePath) {
    throw new Error('Archive contains case-insensitive colliding paths.');
  }

  const existing = state.paths.get(archivePath);
  if (kind === 'file') {
    if (existing !== undefined) throw new Error('Archive contains duplicate or colliding paths.');
    state.paths.set(archivePath, { path: archivePath, kind: 'file' });
    state.casefoldedPaths.set(folded, archivePath);
    return;
  }

  addDirectoryPath(state, archivePath, components, policy, true);
}

async function writeArchiveFile(
  stream: ArchiveEntryStream,
  destination: string,
  declaredBytes: number,
  policy: ExtractionPolicy,
  signal: AbortSignal,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
      if (signal.aborted) { callback(asError(signal.reason)); return; }
      bytes += chunk.length;
      if (bytes > policy.maxSingleFileBytes) {
        callback(new Error('Archive file exceeds the configured per-file byte limit.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  try {
    await pipeline(stream, meter, output, { signal });
  } catch (error) {
    output.destroy();
    throw error;
  }
  if (bytes !== declaredBytes) {
    throw new Error('Archive file payload is truncated or has an invalid header size.');
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function writeArchiveDirectory(stream: ArchiveEntryStream, destination: string, declaredBytes: number, signal: AbortSignal): Promise<void> {
  if (declaredBytes !== 0) throw new Error('Archive directory entry has a non-empty payload.');
  let bytes = 0;
  for await (const chunk of stream) {
    throwIfAborted(signal);
    bytes += Buffer.byteLength(chunk as Uint8Array);
  }
  if (declaredBytes !== 0 || bytes !== 0) {
    throw new Error('Archive directory entry has a non-empty payload.');
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await mkdir(destination, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

function commonTopDirectory(state: ArchivePathState): string | null {
  const allPaths = [...state.paths.keys()];
  if (allPaths.length === 0) return null;
  const first = allPaths[0].split('/')[0];
  if (!allPaths.every((entryPath) => entryPath.split('/')[0] === first)) return null;
  if (!allPaths.some((entryPath) => entryPath.includes('/'))) return null;
  const root = state.paths.get(first);
  if (root?.kind === 'file') return null;
  return first;
}

function outputPath(rawPath: string, root: string | null): string {
  if (root === null) return rawPath;
  if (rawPath === root) return '';
  return rawPath.slice(root.length + 1);
}

function registerOutputPath(
  outputPaths: Map<string, { path: string; kind: 'file' | 'directory' }>,
  outputPathValue: string,
  kind: 'file' | 'directory',
): void {
  if (outputPathValue.length === 0) {
    if (kind === 'directory') return;
    throw new Error('Archive top-level file cannot be safely stripped.');
  }
  const folded = casefold(outputPathValue);
  const existingPath = outputPaths.get(folded);
  if (existingPath !== undefined) {
    if (existingPath.path !== outputPathValue || existingPath.kind !== kind || kind === 'file') {
      throw new Error('Archive contains colliding paths after top-directory normalization.');
    }
    return;
  }
  // The input tree already checks ancestor collisions. Removing one common
  // directory is injective, so no quadratic pairwise scan is needed here.
  outputPaths.set(folded, { path: outputPathValue, kind });
}

export async function verifyArchive(
  archivePath: string,
  expectedBytes: number,
  expectedSha256: string,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new Error('Snapshot archive byte length is invalid.');
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error('Snapshot archive hash is invalid.');
  }
  const metadata = await lstat(archivePath);
  if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('Snapshot archive is not a regular file without hard links.');
  if (metadata.size !== expectedBytes) throw new Error('Archive byte length does not match the snapshot manifest.');
  const input = await open(archivePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await input.stat();
    if (!opened.isFile() || opened.ino !== metadata.ino || opened.dev !== metadata.dev || opened.nlink !== 1) throw new Error('Snapshot archive changed during verification.');
    const archiveMeter = new ArchiveMeter(expectedBytes);
    const sink = new Writable({ write(_chunk, _encoding, callback): void { callback(); } });
    await pipeline(input.createReadStream({ signal, autoClose: false }), archiveMeter, sink, { signal });
    if (archiveMeter.bytes !== expectedBytes) throw new Error('Archive byte length does not match the snapshot manifest.');
    if (archiveMeter.hash.digest('hex') !== expectedSha256.toLowerCase()) throw new Error('Archive hash does not match the snapshot manifest.');
  } finally {
    await input.close();
  }
}

export async function extractArchive(
  archivePath: string,
  expectedBytes: number,
  expectedSha256: string,
  temporaryRoot: string,
  policy: ExtractionPolicy,
  callerSignal: AbortSignal,
  onProgress?: (stage: string, counters: ExtractionCounters) => void,
): Promise<ExtractArchiveResult> {
  validateExtractionPolicy(policy);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Archive extraction timed out.')), policy.timeoutMs);
  const signal = AbortSignal.any([callerSignal, controller.signal]);
  let ownsTemporaryRoot = false;
  const rawWorkspace = path.join(temporaryRoot, 'raw');
  const state: ArchivePathState = {
    paths: new Map(),
    casefoldedPaths: new Map(),
    files: [],
    directories: new Set(),
  };
  const extractor = createTarExtractor();
  const archiveMeter = new ArchiveMeter(expectedBytes);
  const inflatedMeter = new InflatedMeter(policy.maxExtractedBytes);
  let fileCount = 0;
  let firstError: Error | undefined;
  let entryChain = Promise.resolve();

  extractor.on('entry', (header, stream, next) => {
    // A header can be rejected before a file pipeline is attached. The outer
    // pipeline carries the failure; consume the entry's destruction error too.
    stream.on('error', () => undefined);
    entryChain = entryChain.then(async () => {
      throwIfAborted(signal);
      const type = header.type;
      const isDirectory = type === 'directory';
      if (type !== 'file' && !isDirectory) {
        throw new Error(`Archive entry type ${String(type)} is not permitted.`);
      }
      const declaredBytes = header.size;
      if (!isSafeNonnegativeInteger(declaredBytes)) {
        throw new Error('Archive entry has an invalid size header.');
      }
      if (!isDirectory && declaredBytes > policy.maxSingleFileBytes) {
        throw new Error('Archive file exceeds the configured per-file byte limit.');
      }
      if (header.pax && Object.keys(header.pax).some((key) => /sparse|linkpath/i.test(key))) throw new Error('Archive extended link or sparse metadata is not permitted.');
      const validated = validateExtractionPath(header.name, isDirectory, policy);
      registerPath(state, validated.path, validated.components, isDirectory ? 'directory' : 'file', policy);
      const destination = path.join(rawWorkspace, ...validated.components);
      if (isDirectory) {
        await writeArchiveDirectory(stream, destination, declaredBytes, signal);
        return;
      }

      fileCount += 1;
      if (fileCount > policy.maxFiles) {
        throw new Error('Archive contains more files than the configured limit.');
      }
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const file = await writeArchiveFile(stream, destination, declaredBytes, policy, signal);
      state.files.push({ path: validated.path, components: validated.components, kind: 'file', ...file });
      onProgress?.('extracting', { files: fileCount, bytes: inflatedMeter.bytes });
    }).then(() => {
      next();
    }).catch((error: unknown) => {
      const normalized = asError(error);
      firstError ??= normalized;
      stream.resume();
      extractor.destroy(normalized);
    });
  });

  try {
    throwIfAborted(signal);
    await verifyArchive(archivePath, expectedBytes, expectedSha256, signal);
    await mkdir(temporaryRoot, { recursive: false, mode: 0o700 });
    ownsTemporaryRoot = true;
    await mkdir(rawWorkspace, { recursive: false, mode: 0o700 });
    onProgress?.('extracting', { files: 0, bytes: 0 });
    const input = await open(archivePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const metadata = await input.stat();
      if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('Snapshot archive is not a regular file.');
      try {
        await pipeline(input.createReadStream({ signal, autoClose: false }), archiveMeter, createGunzip(), inflatedMeter, new TarEnvelope(policy), extractor, { signal });
      } catch (error) {
        // Entry handlers may still be awaiting mkdir/open when a truncated tar
        // destroys its Source. Abort both current and later-attached file
        // pipelines before waiting for those handlers or closing the archive.
        controller.abort(firstError ?? asError(error));
        throw error;
      }
    } finally { await input.close(); }
    await entryChain;
    if (firstError !== undefined) throw firstError;
    if (archiveMeter.bytes !== expectedBytes) {
      throw new Error('Archive byte length does not match the snapshot manifest.');
    }
    if (archiveMeter.hash.digest('hex') !== expectedSha256.toLowerCase()) {
      throw new Error('Archive hash does not match the snapshot manifest.');
    }

    const root = commonTopDirectory(state);
    const outputPaths = new Map<string, { path: string; kind: 'file' | 'directory' }>();
    const outputDirectories = new Set<string>();
    for (const rawDirectory of state.directories) {
      const normalized = outputPath(rawDirectory, root);
      if (normalized.length > 0) {
        registerOutputPath(outputPaths, normalized, 'directory');
        outputDirectories.add(normalized);
      }
    }
    for (const file of state.files) {
      const normalized = outputPath(file.path, root);
      registerOutputPath(outputPaths, normalized, 'file');
      if (normalized.length > 0) {
        const parts = normalized.split('/');
        for (let index = 1; index < parts.length; index += 1) outputDirectories.add(parts.slice(0, index).join('/'));
      }
    }
    if (outputDirectories.size > policy.maxDirectories) {
      throw new Error('Archive contains more directories than the configured limit.');
    }

    const sourceRoot = root === null ? rawWorkspace : path.join(rawWorkspace, root);
    const workspacePath = path.join(temporaryRoot, 'workspace');
    throwIfAborted(signal);
    await rename(sourceRoot, workspacePath);
    const files = state.files
      .map((file) => ({ path: outputPath(file.path, root), bytes: file.bytes ?? 0, sha256: file.sha256 ?? '' }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (files.some((file) => file.path.length === 0)) {
      throw new Error('Archive contains an unsafe top-level file path.');
    }
    onProgress?.('extracted', { files: files.length, bytes: inflatedMeter.bytes });
    throwIfAborted(signal);
    return {
      workspacePath,
      files,
      extractedDirectoryCount: outputDirectories.size,
      extractedBytes: inflatedMeter.bytes,
    };
  } catch (error) {
    controller.abort(firstError ?? asError(error));
    extractor.destroy();
    await entryChain.catch(() => undefined);
    if (ownsTemporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    throwIfAborted(signal);
    if (firstError !== undefined) throw firstError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createExtractionTemporaryName(snapshotDirectory: string): string {
  return path.join(snapshotDirectory, `.part4-extraction-${randomUUID()}`);
}
