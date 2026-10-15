import { mkdirSync, writeFileSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createArchiveFixture } from './archive-fixture.js';
import { extractSnapshot } from './extraction-store.js';
import { sha256, type SnapshotRecord } from './snapshot.js';
import type { ExtractionPolicy } from './extraction.js';

const policy: ExtractionPolicy = {
  maxExtractedBytes: 64 * 1024,
  maxFiles: 10,
  maxDirectories: 10,
  maxSingleFileBytes: 4 * 1024,
  maxPathLength: 256,
  timeoutMs: 5_000,
};

async function makeSnapshot(root: string): Promise<SnapshotRecord> {
  const archive = await createArchiveFixture([{ name: 'repo/app.txt', content: 'immutable' }]);
  const archivePath = path.join(root, 'repository.tar.gz');
  await writeFile(archivePath, archive);
  return {
    snapshotId: 'store-test',
    repository: { owner: 'owner', name: 'repo', branch: 'main' },
    archivePath,
    manifestPath: path.join(root, 'snapshot.json'),
    archiveSha256: sha256(archive),
    byteLength: archive.byteLength,
    capturedAt: new Date(0).toISOString(),
    immutable: true,
  };
}

describe('extraction persistence', () => {
  it('does not reuse a publication after workspace content is tampered with', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      const record = await extractSnapshot(snapshot, policy);
      await writeFile(path.join(record.workspacePath, 'app.txt'), 'tampered');
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/verified complete publication|content verification/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('publishes an exclusive file manifest whose hash matches its bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      const record = await extractSnapshot(snapshot, policy);
      const manifest = await readFile(record.manifestPath);
      expect(sha256(manifest)).toBe(record.fileManifestSha256);
      expect(JSON.parse(manifest.toString('utf8')).files[0].path).toBe('app.txt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans every losing staging directory when concurrent extractors race to publish', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      const stages: string[] = [];
      const records = await Promise.all(Array.from({ length: 4 }, () => extractSnapshot(snapshot, policy, (stage) => { stages.push(stage); })));
      expect(stages.filter((stage) => stage === 'publishing').length).toBeGreaterThan(1);
      expect(stages.filter((stage) => stage === 'completed')).toHaveLength(1);
      expect(new Set(records.map((record) => record.capturedAt)).size).toBe(1);
      expect(await readdir(root)).toEqual(['extraction', 'repository.tar.gz']);
      expect((await extractSnapshot(snapshot, policy)).fileManifestSha256).toBe(records[0].fileManifestSha256);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('cleans staging and preserves an invalid publication that wins a race', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      await expect(extractSnapshot(snapshot, policy, (stage) => {
        if (stage !== 'publishing') return;
        mkdirSync(path.join(root, 'extraction'));
        writeFileSync(path.join(root, 'extraction', 'record.json'), '{}');
      })).rejects.toThrow(/record|snapshot/);
      expect(await readdir(root)).toEqual(['extraction', 'repository.tar.gz']);
      expect(await readFile(path.join(root, 'extraction', 'record.json'), 'utf8')).toBe('{}');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['verifying', 'extracting', 'extracted', 'publishing'])('honors caller cancellation during %s and removes partial output', async (stageToCancel) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      const controller = new AbortController();
      await expect(extractSnapshot(snapshot, policy, (stage) => {
        if (stage === stageToCancel) controller.abort(new Error('caller cancelled'));
      }, controller.signal)).rejects.toThrow(/caller cancelled|abort/i);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('times out a real extraction workload and cleans its staging directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      await expect(extractSnapshot(snapshot, { ...policy, timeoutMs: 1 })).rejects.toThrow(/timed out|abort/i);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([{ maxPathLength: 4 }, { maxPathDepth: 1 }, { maxFiles: 0 }, { maxDirectories: 0 }, { maxSingleFileBytes: 1 }, { maxExtractedBytes: 1024 }])('revalidates reused extraction under tighter bounds %j', async (limits) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      const archive = await createArchiveFixture([{ name: 'repo/sub/long-name.txt', content: 'immutable' }]);
      await writeFile(snapshot.archivePath, archive);
      snapshot.byteLength = archive.byteLength; snapshot.archiveSha256 = sha256(archive);
      await extractSnapshot(snapshot, policy);
      await expect(extractSnapshot(snapshot, { ...policy, ...limits })).rejects.toThrow(/verified complete publication/);
      expect(await readdir(root)).toEqual(['extraction', 'repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects corrupt manifest bytes, corrupt archives, and same-length content changes on reuse', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      const record = await extractSnapshot(snapshot, policy);
      const originalManifest = await readFile(record.manifestPath);
      await writeFile(record.manifestPath, Buffer.concat([originalManifest, Buffer.from(' ')]));
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/hash verification/);
      await writeFile(record.manifestPath, originalManifest);
      await writeFile(path.join(record.workspacePath, 'app.txt'), 'MUTATED!!');
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/content verification/);
      await writeFile(path.join(record.workspacePath, 'app.txt'), 'immutable');
      const archive = await readFile(snapshot.archivePath); archive[0] ^= 0xff;
      await writeFile(snapshot.archivePath, archive);
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/hash/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects additional files, hardlinks, and junctions in reused workspaces', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extraction-store-'));
    try {
      const snapshot = await makeSnapshot(root);
      const record = await extractSnapshot(snapshot, policy);
      const filePath = path.join(record.workspacePath, 'app.txt');
      await writeFile(path.join(record.workspacePath, 'extra'), 'x');
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/manifest/);
      await rm(path.join(record.workspacePath, 'extra'));
      await link(filePath, path.join(root, 'outside-link'));
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/link|regular/);
      await rm(path.join(root, 'outside-link'));
      const external = path.join(root, 'external');
      await mkdir(external);
      await symlink(external, path.join(record.workspacePath, 'junction'), 'junction');
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/link|special/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
