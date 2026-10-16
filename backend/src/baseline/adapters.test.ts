import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { sha256 } from '../intake/snapshot.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import { discoverBaselinePlan } from './adapters.js';

async function fixture(): Promise<{ root: string; extraction: ExtractionRecord }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-baseline-plan-'));
  const workspacePath = path.join(root, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const files = {
    'package.json': JSON.stringify({ scripts: { build: 'tsc -b', test: 'vitest run', lint: 'eslint .' } }),
    'package-lock.json': '{}',
    'src/index.ts': 'export const value = 1;',
    'tests/index.test.ts': 'test()',
  };
  const manifestFiles = [];
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(workspacePath, ...relative.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    const bytes = Buffer.from(contents);
    await writeFile(full, bytes);
    manifestFiles.push({ path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const manifest = Buffer.from(JSON.stringify({ version: 'part4-v1', snapshotId: 'baseline', archiveSha256: 'a'.repeat(64), files: manifestFiles }));
  const manifestPath = path.join(root, 'files.json');
  await writeFile(manifestPath, manifest);
  return {
    root,
    extraction: {
      snapshotId: 'baseline', archiveSha256: 'a'.repeat(64), extractionPolicyVersion: 'part4-v1', extractedFileCount: manifestFiles.length,
      extractedDirectoryCount: 0, extractedBytes: manifestFiles.reduce((sum, file) => sum + file.bytes, 0), fileManifestSha256: sha256(manifest), status: 'completed',
      capturedAt: new Date(0).toISOString(), workspacePath, manifestPath,
    },
  };
}

describe('baseline adapter discovery', () => {
  it('discovers declared scripts without returning script source', async () => {
    const value = await fixture();
    try {
      const plan = await discoverBaselinePlan({ extraction: value.extraction, languageCandidates: ['TypeScript'], maxChecks: 20, maxFileBytes: 64_000 });
      expect(plan.checks.find((check) => check.id === 'node-build')?.commandLabel).toBe('npm run build');
      expect(plan.checks.find((check) => check.id === 'node-unit')?.initialStatus).toBe('queued');
      expect(JSON.stringify(plan)).not.toContain('tsc -b');
      expect(plan.checks.find((check) => check.id === 'dependency-audit')?.initialStatus).toBe('queued');
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
});
