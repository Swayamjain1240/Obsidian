import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createTarGzFixture } from '../intake/archive-fixture.js';
import { extractSnapshot } from '../intake/extraction-store.js';
import { SnapshotStore } from '../intake/snapshot-store.js';
import { scanSecretMarkers } from './secret-scanner.js';

describe('secret scanner', () => {
  it('scans sensitive configuration paths without returning secret values', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-secret-scan-'));
    try {
      const archive = await createTarGzFixture([
        { name: 'repo/.env', content: 'TOKEN=ghp_123456789012345678901234567890\n' },
        { name: 'repo/.npmrc', content: 'token=private-registry-token-value\n' },
        { name: 'repo/src/config.ts', content: 'const apiKey = "ordinary-test-secret-value";\n' },
      ]);
      const snapshot = await new SnapshotStore(root, 1_000_000).save({ owner: 'owner', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) }, archive);
      const extraction = await extractSnapshot(snapshot, {
        maxExtractedBytes: 100_000,
        maxFiles: 20,
        maxDirectories: 20,
        maxSingleFileBytes: 10_000,
        maxPathLength: 512,
        timeoutMs: 5_000,
      });

      const result = await scanSecretMarkers(extraction);
      expect(result.findings.map((finding) => finding.path)).toEqual(expect.arrayContaining(['.env', '.npmrc', 'src/config.ts']));
      expect(JSON.stringify(result)).not.toContain('private-registry-token-value');
      expect(JSON.stringify(result)).not.toContain('ordinary-test-secret-value');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
