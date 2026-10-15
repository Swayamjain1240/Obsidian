import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { sha256 } from '../intake/snapshot.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import { scanCompleteness } from './scanner.js';

async function makeExtraction(files: Record<string, string>): Promise<{ root: string; extraction: ExtractionRecord }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-completeness-'));
  const workspacePath = path.join(root, 'workspace');
  const manifestPath = path.join(root, 'files.json');
  await mkdir(workspacePath, { recursive: true });
  const manifestFiles: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(workspacePath, ...relativePath.split('/'));
    await mkdir(path.dirname(fullPath), { recursive: true });
    const bytes = Buffer.from(contents);
    await writeFile(fullPath, bytes);
    manifestFiles.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const manifest = Buffer.from(JSON.stringify({ version: 'part4-v1', snapshotId: 'completeness', archiveSha256: 'a'.repeat(64), files: manifestFiles }));
  await writeFile(manifestPath, manifest);
  return {
    root,
    extraction: {
      snapshotId: 'completeness',
      archiveSha256: 'a'.repeat(64),
      extractionPolicyVersion: 'part4-v1',
      extractedFileCount: manifestFiles.length,
      extractedDirectoryCount: 0,
      extractedBytes: manifestFiles.reduce((sum, file) => sum + file.bytes, 0),
      fileManifestSha256: sha256(manifest),
      status: 'completed',
      capturedAt: new Date(0).toISOString(),
      workspacePath,
      manifestPath,
    },
  };
}

describe('bounded completeness scanner', () => {
  it('classifies evidence without returning source text or secret values', async () => {
    const secret = 'DO_NOT_EMIT_COMPLETENESS_SECRET';
    const fixture = await makeExtraction({
      'package.json': '{"name":"app"}',
      'src/index.ts': `// TODO: wire the missing route\nimport { missing } from './missing';\nconst token = "${secret}";`,
      'src/navigation.tsx': '<a href="/missing-settings">Settings</a>',
      'src/empty.ts': '',
      'app.py': 'print("partial")',
      'README.md': 'Coming soon',
      '.env': `TOKEN=${secret}`,
      'node_modules/fake.js': '// FIXME ignored',
    });
    try {
      const result = await scanCompleteness(fixture.extraction, {
        maxFileBytes: 4096,
        maxFiles: 20,
        maxBytes: 20_000,
        maxFindings: 50,
        timeoutMs: 5_000,
        languageCandidates: ['TypeScript', 'Python'],
      });
      const kinds = result.findings.map((finding) => finding.kind);
      expect(kinds).toContain('todo-marker');
      expect(kinds).toContain('broken-import');
      expect(kinds).toContain('empty-file');
      expect(kinds).toContain('placeholder-marker');
      expect(kinds).toContain('missing-configuration');
      expect(kinds).toContain('missing-route');
      expect(result.areas.find((area) => area.id === 'tests')?.status).toBe('not_available');
      expect(result.projectStatus).toBe('broken');
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain('node_modules');
      expect(result.findings.every((finding) => finding.evidenceRefs.every((ref) => ref.line === undefined || ref.line > 0))).toBe(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('reports an unregistered static route reference without inferring dynamic routes', async () => {
    const fixture = await makeExtraction({
      'src/App.tsx': '<Route path="/home" element={<Home />} />\n<Link to="/missing">Missing</Link>\n<Link to="/home">Home</Link>',
    });
    try {
      const result = await scanCompleteness(fixture.extraction, {
        maxFileBytes: 4096,
        maxFiles: 20,
        maxBytes: 20_000,
        maxFindings: 50,
        timeoutMs: 5_000,
      });
      const routeFindings = result.findings.filter((finding) => finding.kind === 'missing-route');
      expect(routeFindings).toHaveLength(1);
      expect(routeFindings[0].evidenceRefs[0].reason).toContain('/missing');
      expect(routeFindings[0].evidenceRefs[0].kind).toBe('route');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('reports bounded evidence when limits are reached and honors cancellation', async () => {
    const fixture = await makeExtraction({
      'src/a.ts': '// TODO one\n// TODO two\n// TODO three',
      'src/b.ts': '// TODO four',
    });
    try {
      const limited = await scanCompleteness(fixture.extraction, {
        maxFileBytes: 4096,
        maxFiles: 1,
        maxBytes: 4096,
        maxFindings: 1,
        timeoutMs: 5_000,
      });
      expect(limited.limited).toBe(true);
      expect(limited.warning).toMatch(/limits/);
      expect(limited.findings.length).toBeLessThanOrEqual(1);

      const controller = new AbortController();
      controller.abort(new Error('caller cancelled completeness'));
      await expect(scanCompleteness(fixture.extraction, {
        maxFileBytes: 4096,
        maxFiles: 10,
        maxBytes: 4096,
        maxFindings: 10,
        timeoutMs: 5_000,
        signal: controller.signal,
      })).rejects.toThrow(/caller cancelled/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
