import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import type { DetectionCandidate, EvidenceRef } from './types.js';
import {
  DETECTION_ADAPTER_RULES,
  detectionPolicyVersion,
  frameworksForManifest,
  parseManifest,
  ruleMatchesBasename,
  sourceExtension,
  type DetectionAdapterRule,
  type ParsedManifest,
} from './adapters.js';
import { extractionPolicyVersion, type ExtractionRecord } from '../intake/extraction.js';

export interface ScanOptions {
  maxEvidenceFileBytes: number;
  maxEvidencePaths: number;
  maxEvidenceBytes?: number;
  maxEvidenceRefs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ScanResult {
  candidates: DetectionCandidate[];
  primaryCandidateId: string | null;
  unknownReason: string | null;
  fileCount: number;
  evidenceFileCount: number;
  policyVersion: string;
}

interface ManifestFile { path: string; bytes: number; sha256: string }
interface VerifiedManifest { entry: ManifestFile; facts: ParsedManifest }
interface VerifiedSource { entry: ManifestFile; rule: DetectionAdapterRule }
interface MutableCandidate {
  rule: DetectionAdapterRule;
  refs: Map<string, EvidenceRef>;
  frameworks: Set<string>;
  packageManagers: Set<string>;
  strong: boolean;
}

// These are absolute scanner ceilings, independent of configurable intake limits.
// Content is hashed before it supplies evidence and is never included in a result.
const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const MANIFEST_MAX_FILES = 100_000;
const MAX_PATH_BYTES = 4096;
const MAX_PATH_DEPTH = 128;
const MAX_EVIDENCE_FILE_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const MAX_EVIDENCE_PATHS = 1024;
const MAX_EVIDENCE_REFS = 4096;
const MAX_REFS_PER_PATH = 16;
const IGNORED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor', '.venv', 'venv', '__pycache__', '.gradle', 'target', 'bin', 'obj', 'dist', 'build', 'out', 'coverage', 'generated']);
const IGNORED_BASENAMES = new Set(['.npmrc', '.pypirc', 'credentials', 'credentials.json', 'secrets.json', 'id_rsa', 'id_ed25519']);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const basename = (pathname: string): string => pathname.slice(pathname.lastIndexOf('/') + 1).toLowerCase();
const dirname = (pathname: string): string => pathname.includes('/') ? pathname.slice(0, pathname.lastIndexOf('/')) : '';
const inside = (directory: string, pathname: string): boolean => directory === '' || pathname.startsWith(`${directory}/`);

function isSafeManifestPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > MAX_PATH_BYTES || value.includes('\\')) return false;
  const parts = value.split('/');
  return parts.length <= MAX_PATH_DEPTH && parts.every((component) => component.length > 0 && component !== '.' && component !== '..'
    && !component.endsWith('.') && !component.endsWith(' ') && !/[<>:"|?*\u0000-\u001f]/.test(component) && !WINDOWS_RESERVED_NAME.test(component));
}

function ignoredPath(pathname: string): boolean {
  const parts = pathname.toLowerCase().split('/');
  const name = parts.at(-1)!;
  return parts.slice(0, -1).some((part) => IGNORED_DIRECTORIES.has(part) || part.startsWith('.env'))
    || name.startsWith('.env') || IGNORED_BASENAMES.has(name)
    || /(?:\.min\.[a-z0-9]+|\.map|\.designer\.[a-z0-9]+|\.g\.[a-z0-9]+|\.pem|\.key|\.p12)$/.test(name);
}

function sourceRules(pathname: string): DetectionAdapterRule[] {
  // Gradle's implementation language is not the application's language.
  if (basename(pathname).endsWith('.gradle.kts')) return [];
  return DETECTION_ADAPTER_RULES.filter((rule) => rule.sourceExtensions.includes(sourceExtension(pathname)));
}

async function assertDirectory(directory: string): Promise<void> {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Detection workspace contains a link or non-directory ancestor.');
}

async function safeFilePath(workspacePath: string, pathname: string): Promise<string> {
  await assertDirectory(workspacePath);
  const parts = pathname.split('/');
  let directory = workspacePath;
  for (const part of parts.slice(0, -1)) { directory = path.join(directory, part); await assertDirectory(directory); }
  return path.join(directory, parts.at(-1)!);
}

async function readVerifiedFile(filePath: string, maxBytes: number, check: () => void, signal: AbortSignal, expected?: ManifestFile | { sha256: string }): Promise<Buffer> {
  check();
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('Detection evidence is not a regular file or contains a link.');
  if (metadata.size > maxBytes || (expected && 'bytes' in expected && metadata.size !== expected.bytes)) throw new Error('Extraction manifest does not match the bounded workspace file.');
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw new Error('Detection evidence changed while opening it.');
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = handle.createReadStream({ autoClose: false, signal });
    // FileHandle streams can emit an AbortError after the async iterator has
    // already rejected. Keep the stream's error channel observed until the
    // handle is closed so cancellation never becomes an unhandled process error.
    stream.on('error', () => undefined);
    for await (const chunk of stream) {
      check();
      bytes += chunk.length;
      if (bytes > maxBytes || bytes > metadata.size) throw new Error('Detection evidence exceeds its verified byte limit.');
      hash.update(chunk);
      chunks.push(Buffer.from(chunk));
    }
    check();
    const final = await handle.stat();
    if (bytes !== metadata.size || final.size !== bytes || final.mtimeMs !== opened.mtimeMs || final.ctimeMs !== opened.ctimeMs) throw new Error('Detection evidence changed during verification.');
    if (expected && hash.digest('hex') !== expected.sha256.toLowerCase()) throw new Error('Detection evidence hash verification failed.');
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

async function readFileManifest(record: ExtractionRecord, check: () => void, signal: AbortSignal): Promise<ManifestFile[]> {
  if (record.status !== 'completed' || typeof record.workspacePath !== 'string' || typeof record.manifestPath !== 'string'
    || !isHash(record.fileManifestSha256) || !isHash(record.archiveSha256) || record.extractionPolicyVersion !== extractionPolicyVersion
    || !isCount(record.extractedFileCount) || record.extractedFileCount > MANIFEST_MAX_FILES || !isCount(record.extractedBytes)) {
    throw new Error('Detection requires a verified completed extraction record.');
  }
  if (path.dirname(path.resolve(record.workspacePath)) !== path.dirname(path.resolve(record.manifestPath))) throw new Error('Detection manifest is outside its extraction publication.');
  await assertDirectory(path.dirname(record.manifestPath));
  const bytes = await readVerifiedFile(record.manifestPath, MANIFEST_MAX_BYTES, check, signal, { sha256: record.fileManifestSha256 });
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Extraction file manifest is invalid.'); }
  if (!isObject(parsed) || parsed.version !== extractionPolicyVersion || parsed.snapshotId !== record.snapshotId || parsed.archiveSha256 !== record.archiveSha256
    || !Array.isArray(parsed.files) || parsed.files.length !== record.extractedFileCount) throw new Error('Extraction file manifest metadata does not match its record.');
  const files: ManifestFile[] = [];
  const paths = new Map<string, { path: string; file: boolean }>();
  let payloadBytes = 0;
  for (const item of parsed.files) {
    check();
    if (!isObject(item) || !isSafeManifestPath(item.path) || !isCount(item.bytes) || !isHash(item.sha256)) throw new Error('Extraction file manifest contains an invalid path, size or digest.');
    const parts = item.path.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const entryPath = parts.slice(0, i).join('/');
      const folded = entryPath.normalize('NFKC').toLowerCase();
      const existing = paths.get(folded);
      if (existing && (existing.path !== entryPath || existing.file || i === parts.length)) throw new Error('Extraction file manifest contains colliding paths.');
      paths.set(folded, { path: entryPath, file: i === parts.length });
    }
    payloadBytes += item.bytes;
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes > record.extractedBytes) throw new Error('Extraction file manifest has an inconsistent byte count.');
    files.push({ path: item.path, bytes: item.bytes, sha256: item.sha256.toLowerCase() });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function slug(value: string): string {
  return value.replace(/C#/gi, 'csharp').replace(/F#/gi, 'fsharp').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildCandidate(state: MutableCandidate): DetectionCandidate {
  const frameworks = [...state.frameworks].sort();
  const id = [slug(state.rule.language), ...frameworks.map(slug)].join('-');
  return {
    id, language: state.rule.language, frameworks,
    packageManager: state.packageManagers.size === 1 ? [...state.packageManagers][0] : null,
    evidenceStrength: state.strong ? 'strong' : 'weak',
    evidenceRefs: [...state.refs.values()].sort((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason)),
    adapterAvailable: state.rule.adapterAvailable,
  };
}

function choosePrimary(candidates: DetectionCandidate[], limited: boolean): { id: string | null; reason: string | null } {
  if (limited) return { id: null, reason: 'Detection evidence limits were reached; the available evidence is incomplete.' };
  if (!candidates.length) return { id: null, reason: 'No supported stack evidence was found.' };
  if (candidates.length === 1) return { id: candidates[0].id, reason: null };
  const strong = candidates.filter((candidate) => candidate.evidenceStrength === 'strong');
  if (strong.length === 1) return { id: strong[0].id, reason: null };
  return { id: null, reason: strong.length > 1 ? 'Multiple supported languages have strong evidence.' : 'Supported stack evidence is ambiguous.' };
}

export async function scanWorkspace(extraction: ExtractionRecord, options: ScanOptions): Promise<ScanResult> {
  const requested = [options.maxEvidenceFileBytes, options.maxEvidencePaths, options.maxEvidenceBytes ?? MAX_EVIDENCE_BYTES, options.maxEvidenceRefs ?? MAX_EVIDENCE_REFS];
  if (requested.some((limit) => !isCount(limit)) || !isCount(options.timeoutMs ?? 30_000) || (options.timeoutMs ?? 30_000) < 1 || (options.timeoutMs ?? 30_000) > 2_147_483_647) throw new Error('Detection evidence limits are invalid.');
  const maxFileBytes = Math.min(options.maxEvidenceFileBytes, MAX_EVIDENCE_FILE_BYTES);
  const maxPaths = Math.min(options.maxEvidencePaths, MAX_EVIDENCE_PATHS);
  const maxBytes = Math.min(options.maxEvidenceBytes ?? MAX_EVIDENCE_BYTES, MAX_EVIDENCE_BYTES);
  const maxRefs = Math.min(options.maxEvidenceRefs ?? MAX_EVIDENCE_REFS, MAX_EVIDENCE_REFS);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Detection timed out.')), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const check = (): void => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('Detection timed out.');
  };
  try {
    check();
    const files = await readFileManifest(extraction, check, signal);
    await assertDirectory(extraction.workspacePath);
    const states = new Map<string, MutableCandidate>();
    const evidencePaths = new Set<string>();
    const refsPerPath = new Map<string, number>();
    const readPaths = new Set<string>();
    let readBytes = 0; let refCount = 0; let limited = false;
    const manifests: VerifiedManifest[] = [];
    const sources: VerifiedSource[] = [];
    const stateFor = (rule: DetectionAdapterRule): MutableCandidate => {
      let state = states.get(rule.id);
      if (!state) { state = { rule, refs: new Map(), frameworks: new Set(), packageManagers: new Set(), strong: false }; states.set(rule.id, state); }
      return state;
    };
    const add = (state: MutableCandidate, entry: ManifestFile, reason: string, kind: EvidenceRef['kind']): boolean => {
      const key = `${entry.path}|${kind}|${reason}`;
      if (state.refs.has(key)) return true;
      const pathRefs = refsPerPath.get(entry.path) ?? 0;
      if (refCount >= maxRefs || pathRefs >= MAX_REFS_PER_PATH || (!evidencePaths.has(entry.path) && evidencePaths.size >= maxPaths)) { limited = true; return false; }
      state.refs.set(key, { path: entry.path, reason, kind });
      evidencePaths.add(entry.path); refsPerPath.set(entry.path, pathRefs + 1); refCount += 1;
      return true;
    };
    const read = async (entry: ManifestFile): Promise<Buffer | null> => {
      check();
      if (readPaths.size >= maxPaths || entry.bytes > maxFileBytes || readBytes + entry.bytes > maxBytes || maxRefs === 0) { limited = true; return null; }
      readPaths.add(entry.path); readBytes += entry.bytes;
      return readVerifiedFile(await safeFilePath(extraction.workspacePath, entry.path), maxFileBytes, check, signal, entry);
    };
    const relevant = files.filter((entry) => !ignoredPath(entry.path));
    const manifestFiles = relevant.filter((entry) => DETECTION_ADAPTER_RULES.some((rule) => ruleMatchesBasename(rule, basename(entry.path))));
    for (const entry of manifestFiles) {
      if (readPaths.size >= maxPaths) { limited = true; break; }
      const buffer = await read(entry); if (!buffer) continue;
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { continue; }
      const facts = parseManifest(basename(entry.path), text);
      check();
      if (facts) manifests.push({ entry, facts });
    }
    for (const entry of relevant) {
      const rules = sourceRules(entry.path); if (!rules.length) continue;
      if (!readPaths.has(entry.path) && readPaths.size >= maxPaths) { limited = true; break; }
      if (readPaths.has(entry.path) || await read(entry)) for (const rule of rules) sources.push({ entry, rule });
    }

    // Scope manifest evidence to the nearest package/project boundary. Do not
    // merge JavaScript into TypeScript (or Java into Kotlin) across a monorepo.
    const projectDirectories = new Map<string, Set<string>>();
    for (const entry of manifestFiles) for (const rule of DETECTION_ADAPTER_RULES) {
      if (!ruleMatchesBasename(rule, basename(entry.path))) continue;
      const directories = projectDirectories.get(rule.languageFamily) ?? new Set<string>();
      directories.add(dirname(entry.path)); projectDirectories.set(rule.languageFamily, directories);
    }
    const projectDirectory = (pathname: string, family: string): string => {
      const directories = projectDirectories.get(family);
      let directory = dirname(pathname);
      while (directory !== '') { if (directories?.has(directory)) return directory; directory = dirname(directory); }
      return '';
    };
    for (const { entry, facts } of manifests) {
      check();
      const directory = dirname(entry.path);
      const localSources = sources.filter((source) => source.rule.languageFamily === facts.family && inside(directory, source.entry.path) && projectDirectory(source.entry.path, facts.family) === directory);
      let ids = [...facts.languageIds];
      if (facts.family === 'javascript' && basename(entry.path) !== 'tsconfig.json' && basename(entry.path) !== 'tsconfig.base.json') {
        const sourceIds = new Set(localSources.map((source) => source.rule.id));
        const typed = facts.languageIds.includes('typescript') || manifests.some((item) => dirname(item.entry.path) === directory && /^tsconfig/.test(basename(item.entry.path)));
        if (typed) sourceIds.add('typescript');
        ids = sourceIds.size ? [...sourceIds] : ids;
      } else if (ids.length === 0) ids = [...new Set(localSources.map((source) => source.rule.id))];
      for (const id of ids) {
        const rule = DETECTION_ADAPTER_RULES.find((candidate) => candidate.id === id)!;
        const state = stateFor(rule);
        if (!add(state, entry, rule.languageManifestReason, 'manifest')) continue;
        state.strong = true;
        if (facts.packageManager) state.packageManagers.add(facts.packageManager);
        for (const framework of frameworksForManifest(facts)) {
          if (add(state, entry, framework.reason, 'dependency-marker')) state.frameworks.add(framework.name);
        }
      }
    }
    for (const { entry, rule } of sources) add(stateFor(rule), entry, rule.sourceReason, 'source-extension');
    check();
    const candidates = [...states.values()].filter((state) => state.refs.size > 0).map(buildCandidate).sort((a, b) => a.id.localeCompare(b.id));
    const primary = choosePrimary(candidates, limited);
    return { candidates, primaryCandidateId: primary.id, unknownReason: primary.reason, fileCount: files.length, evidenceFileCount: evidencePaths.size, policyVersion: detectionPolicyVersion };
  } finally { clearTimeout(timer); }
}
