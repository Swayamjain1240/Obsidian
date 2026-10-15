import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createArchiveFixture,
  maliciousPaxFixture,
  malformedGzipFixture,
  malformedTarHeaderFixture,
  mutateTarFixture,
  rewriteTarHeader,
  truncatedArchiveFixture,
  truncatedTarFixture,
} from './archive-fixture.js';
import { extractSnapshot } from './extraction-store.js';
import { sha256, type SnapshotRecord } from './snapshot.js';
import type { ExtractionPolicy } from './extraction.js';
import { extractArchive } from './extract-archive.js';

const policy: ExtractionPolicy = {
  maxExtractedBytes: 64 * 1024,
  maxFiles: 20,
  maxDirectories: 20,
  maxSingleFileBytes: 8 * 1024,
  maxPathLength: 512,
  timeoutMs: 5_000,
};

async function snapshotFor(root: string, archive: Uint8Array): Promise<SnapshotRecord> {
  const archivePath = path.join(root, 'repository.tar.gz');
  await writeFile(archivePath, archive);
  return {
    snapshotId: 'snapshot-test',
    repository: { owner: 'owner', name: 'repo', branch: 'main' },
    archivePath,
    manifestPath: path.join(root, 'snapshot.json'),
    archiveSha256: sha256(archive),
    byteLength: archive.byteLength,
    capturedAt: new Date(0).toISOString(),
    immutable: true,
  };
}

describe('streaming archive extraction', () => {
  it('strips one safe GitHub root and reuses only the verified publication', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const archive = await createArchiveFixture([
        { name: 'owner-repo-abc/', type: 'directory' },
        { name: 'owner-repo-abc/package.json', content: '{"name":"repo"}' },
      ]);
      const snapshot = await snapshotFor(root, archive);
      const first = await extractSnapshot(snapshot, policy);
      const second = await extractSnapshot(snapshot, policy);

      expect(first.workspacePath).toBe(path.join(root, 'extraction', 'workspace'));
      expect(first.extractedFileCount).toBe(1);
      expect(second.capturedAt).toBe(first.capturedAt);
      expect(second.fileManifestSha256).toBe(first.fileManifestSha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'root/../escape.txt',
    '/absolute.txt',
    'C:/drive.txt',
    'root\\backslash.txt',
    'root/CON.txt',
    'root/name:stream.txt',
    'root/name.txt ',
    'root//file.txt',
    'root/./file.txt',
    'root/file.',
    '//server/share/file.txt',
    'C:drive.txt',
    'root/NUL',
    'root/COM1.txt',
    'root/a?b.txt',
    'root/control\u0001.txt',
    'root/embedded\0name.txt',
  ])('rejects unsafe archive path %s without publishing partial output', async (name) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const archive = await createArchiveFixture([{ name, content: 'unsafe' }]);
      const snapshot = await snapshotFor(root, archive);
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow();
      expect(await readdir(root)).not.toContain('extraction');
      expect((await readdir(root)).filter((entry) => entry.startsWith('.part4-extraction-'))).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects links, duplicates, malformed gzip, malformed headers, PAX traversal, and truncated tar streams', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const linkArchive = await createArchiveFixture([{ name: 'root/link', type: 'symlink', linkname: 'target' }]);
      const linkSnapshot = await snapshotFor(root, linkArchive);
      await expect(extractSnapshot(linkSnapshot, policy)).rejects.toThrow();

      const duplicateArchive = await createArchiveFixture([
        { name: 'root/file.txt', content: 'one' },
        { name: 'root/file.txt', content: 'two' },
      ]);
      const duplicateSnapshot = await snapshotFor(root, duplicateArchive);
      await expect(extractSnapshot(duplicateSnapshot, policy)).rejects.toThrow();

      const malformed = malformedGzipFixture();
      const malformedSnapshot = await snapshotFor(root, malformed);
      await expect(extractSnapshot(malformedSnapshot, policy)).rejects.toThrow();

      const malformedHeader = await malformedTarHeaderFixture();
      const malformedHeaderSnapshot = await snapshotFor(root, malformedHeader);
      await expect(extractSnapshot(malformedHeaderSnapshot, policy)).rejects.toThrow();

      const pax = await maliciousPaxFixture();
      const paxSnapshot = await snapshotFor(root, pax);
      await expect(extractSnapshot(paxSnapshot, policy)).rejects.toThrow();

      const valid = await createArchiveFixture([{ name: 'root/file.txt', content: 'payload' }]);
      const truncatedSnapshot = await snapshotFor(root, await truncatedTarFixture(valid));
      await expect(extractSnapshot(truncatedSnapshot, policy)).rejects.toThrow();
      const truncatedGzipSnapshot = await snapshotFor(root, truncatedArchiveFixture(valid, 12));
      await expect(extractSnapshot(truncatedGzipSnapshot, policy)).rejects.toThrow();
      expect((await readdir(root)).filter((entry) => entry.startsWith('.part4-extraction-'))).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['symlink', 'link', 'fifo', 'block-device', 'character-device'] as const)('rejects %s entries without leaving staging files', async (type) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const snapshot = await snapshotFor(root, await createArchiveFixture([{ name: 'repo/unsafe', type, linkname: '../../outside' }]));
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/type|permitted/);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([
    [{ name: 'repo/a', content: 'x' }, { name: 'repo/A', content: 'x' }],
    [{ name: 'repo/A/x', content: 'x' }, { name: 'repo/a/y', content: 'x' }],
    [{ name: 'repo/café', content: 'x' }, { name: 'repo/cafe\u0301', content: 'x' }],
    [{ name: 'repo/a', content: 'x' }, { name: 'repo/a/b', content: 'x' }],
    [{ name: 'repo/a/b', content: 'x' }, { name: 'repo/a', content: 'x' }],
    [{ name: 'repo/a/', type: 'directory' as const }, { name: 'repo/a/', type: 'directory' as const }],
  ])('rejects duplicate, casefold and ancestor collisions %#', async (...entries) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const snapshot = await snapshotFor(root, await createArchiveFixture(entries));
      await expect(extractSnapshot(snapshot, policy)).rejects.toThrow(/collid|collision|duplicate/i);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([
    { limit: { maxFiles: 1 }, entries: [{ name: 'repo/a', content: 'x' }, { name: 'repo/b', content: 'y' }], reason: /files/ },
    { limit: { maxDirectories: 0 }, entries: [{ name: 'repo/a/b', content: 'x' }], reason: /directories/ },
    { limit: { maxSingleFileBytes: 2 }, entries: [{ name: 'repo/a', content: 'xxxx' }], reason: /per-file/ },
    { limit: { maxExtractedBytes: 1536 }, entries: [{ name: 'repo/a', content: 'x' }], reason: /Inflated/ },
    { limit: { maxPathLength: 8 }, entries: [{ name: 'repo/long-name', content: 'x' }], reason: /path length/ },
    { limit: { maxPathDepth: 2 }, entries: [{ name: 'repo/a/b', content: 'x' }], reason: /depth/ },
    { limit: { maxPathLength: 9 }, entries: [{ name: 'repo/ééé', content: 'x' }], reason: /path length/ },
  ])('enforces resource bound $limit', async ({ limit, entries, reason }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const snapshot = await snapshotFor(root, await createArchiveFixture(entries));
      await expect(extractSnapshot(snapshot, { ...policy, ...limit })).rejects.toThrow(reason);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('bounds gzip expansion including zero padding and extended metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const archive = await createArchiveFixture([{ name: 'repo/a', content: 'x' }]);
      const padded = mutateTarFixture(archive, (tar) => Buffer.concat([tar, Buffer.alloc(512 * 1024)]));
      await expect(extractSnapshot(await snapshotFor(root, padded), policy)).rejects.toThrow(/Inflated/);
      const metadata = await createArchiveFixture([{ name: 'repo/a', content: 'x', pax: { comment: 'x'.repeat(80 * 1024) } }]);
      await expect(extractSnapshot(await snapshotFor(root, metadata), { ...policy, maxExtractedBytes: 1024 * 1024 })).rejects.toThrow(/metadata safety/);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([
    { name: 'directory payload', make: async (archive: Uint8Array) => mutateTarFixture(archive, (tar) => { rewriteTarHeader(tar, { type: '5' }); }), reason: /directory entry has a non-empty payload/ },
    { name: 'PAX directory payload', make: async () => createArchiveFixture([{ name: 'repo/', type: 'directory', pax: { size: '7' } }]), reason: /directory entry has a non-empty payload/ },
    { name: 'trailing archive', make: async (archive: Uint8Array) => mutateTarFixture(archive, (tar) => Buffer.concat([tar, tar])), reason: /after its tar terminator/ },
    { name: 'incomplete terminator', make: async (archive: Uint8Array) => mutateTarFixture(archive, (tar) => tar.subarray(0, tar.length - 512)), reason: /truncated|terminator/ },
    { name: 'truncated file payload', make: async (archive: Uint8Array) => mutateTarFixture(archive, (tar) => tar.subarray(0, 514)), reason: /truncated|end of data/ },
    { name: 'sparse PAX metadata', make: async () => createArchiveFixture([{ name: 'repo/a', content: 'x', pax: { 'GNU.sparse.map': '0,1' } }]), reason: /sparse metadata/ },
  ])('promptly rejects $name and removes staging files', async ({ make, reason }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const archive = await createArchiveFixture([{ name: 'repo/a', content: 'payload' }]);
      const fixture = await make(archive);
      await expect(extractSnapshot(await snapshotFor(root, fixture), { ...policy, timeoutMs: 30_000 })).rejects.toThrow(reason);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 2000);

  it('preserves multiple roots, empty directories, and exact file digests', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const snapshot = await snapshotFor(root, await createArchiveFixture([
        { name: 'a/file.txt', content: 'a' }, { name: 'b/file.txt', content: 'b' }, { name: 'empty/', type: 'directory' },
      ]));
      const record = await extractSnapshot(snapshot, policy);
      expect(record.extractedDirectoryCount).toBe(3);
      const manifest = JSON.parse((await readFile(record.manifestPath)).toString('utf8'));
      expect(manifest.files).toEqual([{ path: 'a/file.txt', bytes: 1, sha256: sha256(Buffer.from('a')) }, { path: 'b/file.txt', bytes: 1, sha256: sha256(Buffer.from('b')) }]);
      expect(await readdir(record.workspacePath)).toEqual(['a', 'b', 'empty']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('direct extraction rejects cancellation and corrupt snapshot hashes and cleans its own staging area', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const snapshot = await snapshotFor(root, await createArchiveFixture([{ name: 'repo/a', content: 'a' }]));
      const controller = new AbortController();
      const temporaryRoot = path.join(root, 'temporary');
      await expect(extractArchive(snapshot.archivePath, snapshot.byteLength, '0'.repeat(64), temporaryRoot, policy, controller.signal)).rejects.toThrow(/hash/);
      await expect(extractArchive(snapshot.archivePath, snapshot.byteLength, snapshot.archiveSha256, temporaryRoot, policy, controller.signal, () => controller.abort(new Error('cancelled')))).rejects.toThrow(/cancelled/);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('accepts bounded PAX paths and strips only the actual shared root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const snapshot = await snapshotFor(root, await createArchiveFixture([
        { name: 'repo/original.txt', content: 'pax', pax: { path: 'repo/sub/renamed.txt' } },
        { name: 'repo/normal.txt', content: 'normal' },
      ]));
      const record = await extractSnapshot(snapshot, policy);
      expect(await readFile(path.join(record.workspacePath, 'sub', 'renamed.txt'), 'utf8')).toBe('pax');
      expect(await readFile(path.join(record.workspacePath, 'normal.txt'), 'utf8')).toBe('normal');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([{ maxFiles: -1 }, { maxPathDepth: 0 }, { maxPathLength: 0 }, { timeoutMs: 2 ** 31 }, { maxExtractedBytes: Number.NaN }])('rejects invalid policy %j before writing staging files', async (limits) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-extract-'));
    try {
      const snapshot = await snapshotFor(root, await createArchiveFixture([{ name: 'repo/a', content: 'x' }]));
      await expect(extractSnapshot(snapshot, { ...policy, ...limits })).rejects.toThrow(/policy|limit|timeout/);
      expect(await readdir(root)).toEqual(['repository.tar.gz']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
