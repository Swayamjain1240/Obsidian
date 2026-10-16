import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppConfig } from '../config.js';
import { extractSnapshot } from '../intake/extraction-store.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import type { ConfirmedDetectionContext } from '../detection/service.js';
import { discoverBaselinePlan } from '../baseline/adapters.js';
import { runBaselineCommand } from '../baseline/runner.js';
import type { ChangeOperation } from './types.js';

export interface AppliedWorkspace {
  workspacePath: string;
  extraction: ExtractionRecord;
  operations: ChangeOperation[];
}

export interface ChangeValidation {
  status: 'passed' | 'failed' | 'not_available';
  checks: Array<{ id: string; label: string; status: 'passed' | 'failed' | 'not_available'; summary: string }>;
}

async function filesUnder(root: string, current = root): Promise<Array<{ path: string; bytes: number; sha256: string }>> {
  const entries = await readdir(current, { withFileTypes: true });
  const output: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Change workspace contains a symbolic link.');
    if (entry.isDirectory()) output.push(...await filesUnder(root, full));
    else if (entry.isFile()) {
      const bytes = await readFile(full);
      output.push({ path: path.relative(root, full).split(path.sep).join('/'), bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

async function publishRecord(snapshot: ConfirmedDetectionContext['snapshot'], workspacePath: string): Promise<ExtractionRecord> {
  const files = await filesUnder(workspacePath);
  const payload = Buffer.from(JSON.stringify({ version: 'part4-v1', snapshotId: snapshot.snapshotId, archiveSha256: snapshot.archiveSha256, files }));
  const root = path.dirname(workspacePath);
  const manifestPath = path.join(root, 'files.json');
  await writeFile(manifestPath, payload, { flag: 'wx', mode: 0o600 });
  return {
    snapshotId: snapshot.snapshotId, archiveSha256: snapshot.archiveSha256, extractionPolicyVersion: 'part4-v1', extractedFileCount: files.length,
    extractedDirectoryCount: 0, extractedBytes: files.reduce((sum, file) => sum + file.bytes, 0), fileManifestSha256: createHash('sha256').update(payload).digest('hex'), status: 'completed', capturedAt: new Date().toISOString(), workspacePath, manifestPath,
  };
}

export class ChangeWorker {
  public constructor(private readonly config: AppConfig) {}

  public async apply(context: ConfirmedDetectionContext, branchName: string, operations: readonly ChangeOperation[]): Promise<AppliedWorkspace> {
    const extraction = await extractSnapshot(context.snapshot, {
      maxExtractedBytes: this.config.SNAPSHOT_MAX_EXTRACTED_BYTES, maxFiles: this.config.SNAPSHOT_MAX_FILES, maxDirectories: this.config.SNAPSHOT_MAX_DIRECTORIES,
      maxSingleFileBytes: this.config.SNAPSHOT_MAX_SINGLE_FILE_BYTES, maxPathLength: this.config.SNAPSHOT_MAX_PATH_LENGTH, timeoutMs: this.config.SNAPSHOT_EXTRACTION_TIMEOUT_MS,
    });
    const root = path.resolve(this.config.SNAPSHOT_ROOT, 'workflow-changes');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const changeRoot = await mkdtemp(path.join(root, `${branchName.replace(/[^A-Za-z0-9-]+/g, '-')}-`));
    const workspacePath = path.join(changeRoot, 'workspace');
    await cp(extraction.workspacePath, workspacePath, { recursive: true, force: false, errorOnExist: true });
    for (const operation of operations) {
      if (operation.path.startsWith('/') || operation.path.split('/').some((part) => part === '..')) throw new Error('Change operation contains an unsafe path.');
      const target = path.join(workspacePath, ...operation.path.split('/'));
      if (!path.resolve(target).startsWith(`${path.resolve(workspacePath)}${path.sep}`)) throw new Error('Change operation escapes the workspace.');
      if (operation.kind === 'delete') { await rm(target, { force: true }); continue; }
      if (typeof operation.content !== 'string') throw new Error('Change operation is missing file content.');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, operation.content, { mode: 0o600 });
    }
    return { workspacePath, extraction: await publishRecord(context.snapshot, workspacePath), operations: operations.map((operation) => ({ ...operation })) };
  }

  public async validate(context: ConfirmedDetectionContext, applied: AppliedWorkspace): Promise<ChangeValidation> {
    const plan = await discoverBaselinePlan({ extraction: applied.extraction, languageCandidates: context.languageCandidates, maxChecks: this.config.BASELINE_MAX_CHECKS, maxFileBytes: this.config.COMPLETENESS_MAX_FILE_BYTES });
    const checks: ChangeValidation['checks'] = [];
    for (const planned of plan.checks) {
      if (planned.staticResult) { checks.push({ id: planned.id, label: planned.label, status: planned.staticResult.status, summary: planned.staticResult.summary }); continue; }
      if (!planned.command) { checks.push({ id: planned.id, label: planned.label, status: 'not_available', summary: planned.summary }); continue; }
      const result = await runBaselineCommand(planned.command, { cwd: applied.workspacePath, workspaceRoot: applied.workspacePath, timeoutMs: this.config.BASELINE_CHECK_TIMEOUT_MS, maxOutputBytes: this.config.BASELINE_MAX_OUTPUT_BYTES, maxMemoryBytes: this.config.BASELINE_MAX_MEMORY_BYTES, maxProcesses: this.config.BASELINE_MAX_PROCESSES, signal: new AbortController().signal });
      checks.push({ id: planned.id, label: planned.label, status: result.status === 'passed' ? 'passed' : result.status === 'not_available' ? 'not_available' : 'failed', summary: result.summary });
    }
    const status = checks.some((check) => check.status === 'failed') ? 'failed' : checks.some((check) => check.status === 'not_available') ? 'not_available' : 'passed';
    return { status, checks };
  }
}
