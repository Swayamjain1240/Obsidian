import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDiffEntries, diffHash } from './diff-service.js';
import { mergeManifestOperations } from './manifest-builder.js';
import { normalizeOperations } from './operation-policy.js';
import { loadConfig } from '../config.js';
import { DurableWorkflowStore } from './store.js';
import { WorkflowService } from './service.js';
import { createArchiveFixture } from '../intake/archive-fixture.js';
import { sha256 } from '../intake/snapshot.js';
import type { RepositoryCommandExecutor } from '../workers/executor.js';

describe('workflow integration boundaries', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('keeps exact diff hashes aligned with the approved operation set', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-workflow-integration-'));
    const changed = await mkdtemp(path.join(os.tmpdir(), 'obsidian-workflow-changed-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      await mkdir(path.join(changed, 'src'), { recursive: true });
      await writeFile(path.join(root, 'src', 'index.ts'), 'before\n');
      await writeFile(path.join(changed, 'src', 'index.ts'), 'after\n');
      const operations = normalizeOperations([{ kind: 'modify', path: 'src/index.ts', content: 'after\n' }]);
      const entries = await buildDiffEntries(root, changed, operations);
      expect(entries[0].beforeSha256).not.toBe(entries[0].afterSha256);
      expect(diffHash(entries)).toHaveLength(64);
      expect(await readFile(path.join(root, 'src', 'index.ts'), 'utf8')).toBe('before\n');
      expect(mergeManifestOperations([], [{ id: 'recommendation', enhancementRunId: 'run', category: 'architecture', title: 'Change', currentProblem: 'problem', suggestedSolution: 'solution', risk: 'low', affectedPaths: ['src/index.ts'], affectedAreas: ['implementation'], expectedTests: ['test'], approvalState: 'approved', operations }])).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(changed, { recursive: true, force: true });
    }
  });

  it('completes a passing baseline to a prepared pull request with durable delivery receipts', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'obsidian-workflow-happy-'));
    const archivePath = path.join(temporaryRoot, 'archive.tar.gz');
    const snapshotRoot = path.join(temporaryRoot, 'snapshots');
    try {
      await mkdir(snapshotRoot, { recursive: true });
      const archive = await createArchiveFixture([
        { name: 'repo/package.json', content: JSON.stringify({ scripts: { build: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"', 'test:integration': 'node -e "process.exit(0)"', 'test:e2e': 'node -e "process.exit(0)"', start: 'node -e "process.exit(0)"' } }) },
        { name: 'repo/src/index.ts', content: 'before\n' },
      ]);
      await writeFile(archivePath, archive);
      const snapshot = { snapshotId: 'happy-snapshot', repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) }, archivePath, manifestPath: path.join(temporaryRoot, 'snapshot.json'), archiveSha256: sha256(archive), byteLength: archive.byteLength, capturedAt: new Date(0).toISOString(), immutable: true as const };
      const context = { detectionRunId: 'happy-detection', ownerUserId: '7', sessionId: 'happy-session', snapshot, baseCommit: snapshot.repository.commitSha, archiveSha256: snapshot.archiveSha256, languageCandidates: ['TypeScript'] };
      const baselineResult = { runId: 'happy-baseline', completenessRunId: 'happy-completeness', snapshotId: snapshot.snapshotId, baseCommit: snapshot.repository.commitSha, status: 'passed' as const, checks: [] };
      const baseline = { getDurable: async () => baselineResult, selectedContextDurable: async () => ({ baselineRunId: baselineResult.runId, completenessRunId: baselineResult.completenessRunId, scopeMode: 'EXISTING_ONLY' as const, context }) };
      const completeness = { getDurable: async () => ({ areas: [{ id: 'implementation', name: 'Implementation', status: 'working' as const, summary: 'Existing implementation.', findingIds: [], affectedPaths: ['src/index.ts'] }] }) };
      const executor: RepositoryCommandExecutor = { run: async (command) => ({ status: 'passed', exitCode: 0, durationMs: 1, outputBytes: 0, outputTruncated: false, summary: `${command.label} passed.` }) };
      const config = loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173', SNAPSHOT_ROOT: snapshotRoot });
      const store = new DurableWorkflowStore();
      const workflow = new WorkflowService(config, baseline, completeness, store, undefined, executor);

      const responses = [
        {},
        { sha: 'a'.repeat(40) },
        { tree: { sha: 'b'.repeat(40) }, sha: 'a'.repeat(40), message: 'base', parents: [] },
        { sha: 'c'.repeat(40) },
        { sha: 'd'.repeat(40) },
        { sha: 'e'.repeat(40) },
        {},
        [],
        { number: 17, html_url: 'https://github.com/owner/repo/pull/17' },
      ];
      const calls: string[] = [];
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string) => { calls.push(input); return { ok: true, json: async () => responses.shift() ?? {}, headers: new Headers() }; }));

      const enhancement = await workflow.createEnhancementRun('7', baselineResult.runId, { sessionId: 'happy-session' });
      const recommendation = enhancement.recommendations[0];
      const approved = await workflow.approveRecommendation('7', enhancement.enhancementRunId, recommendation.id, true, [{ kind: 'modify', path: 'src/index.ts', content: 'after\n' }], { expectedRevision: enhancement.revision, sessionId: 'happy-session' });
      const started = await workflow.startVersion2('7', enhancement.enhancementRunId, { expectedRevision: approved.revision, sessionId: 'happy-session' });
      let version2 = await workflow.getVersion2State('7', started.version2RunId, 'happy-session');
      await expect(workflow.validateVersion2('7', started.version2RunId, { expectedRevision: version2.revision, sessionId: 'happy-session' })).rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID' });
      const acknowledged = await workflow.acknowledgeVersion2Diff('7', started.version2RunId, started.manifest!.diffHash, { expectedRevision: version2.revision, sessionId: 'happy-session' });
      expect(acknowledged.previewAcknowledgedHash).toBe(started.manifest!.diffHash);
      version2 = await workflow.getVersion2State('7', started.version2RunId, 'happy-session');
      const validation = await workflow.validateVersion2('7', started.version2RunId, { expectedRevision: version2.revision, sessionId: 'happy-session' });
      expect(validation.status, JSON.stringify(validation)).toBe('ready_for_pr');
      version2 = await workflow.getVersion2State('7', started.version2RunId, 'happy-session');
      const prepared = await workflow.preparePullRequest('7', started.version2RunId, { expectedRevision: version2.revision, sessionId: 'happy-session' });
      expect(prepared.status).toBe('prepared');
      version2 = await workflow.getVersion2State('7', started.version2RunId, 'happy-session');
      const created = await workflow.createPullRequest('7', started.version2RunId, 'github-token', { expectedRevision: version2.revision, sessionId: 'happy-session' });
      const final = await workflow.getVersion2State('7', started.version2RunId, 'happy-session');

      expect(created.url).toBe('https://github.com/owner/repo/pull/17');
      expect(final.deliveryReceipts?.map((receipt) => [receipt.step, receipt.status])).toEqual([
        ['branch', 'completed'], ['commit', 'completed'], ['ref', 'completed'], ['pull_request', 'completed'],
      ]);
      expect(final.deliveryStep).toBe('pr_created');
      expect(final.receipt?.status).toBe('created');
      expect(calls.some((url) => url.includes('/git/refs/heads/main'))).toBe(false);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
