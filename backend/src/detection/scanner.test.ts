import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { scanWorkspace } from './scanner.js';
import type { ExtractionRecord } from '../intake/extraction.js';
import { sha256 } from '../intake/snapshot.js';

async function makeExtraction(files: Record<string, string | undefined>): Promise<{ root: string; extraction: ExtractionRecord }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-scan-'));
  const workspacePath = path.join(root, 'workspace');
  const manifestPath = path.join(root, 'files.json');
  await mkdir(workspacePath, { recursive: true });
  const manifestFiles: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const [relativePath, contents] of Object.entries(files)) {
    if (contents === undefined) throw new Error('Fixture content must be defined.');
    const fullPath = path.join(workspacePath, ...relativePath.split('/'));
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents);
    manifestFiles.push({ path: relativePath, bytes: Buffer.byteLength(contents), sha256: sha256(Buffer.from(contents)) });
  }
  const manifest = Buffer.from(JSON.stringify({ version: 'part4-v1', snapshotId: 'scan', archiveSha256: 'a'.repeat(64), files: manifestFiles }));
  await writeFile(manifestPath, manifest);
  return {
    root,
    extraction: {
      snapshotId: 'scan',
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

describe('bounded evidence scanner', () => {
  it('recognizes exact package markers and ignores credentials and dependency trees', async () => {
    const fixture = await makeExtraction({
      'apps/web/package.json': JSON.stringify({ dependencies: { react: '^18.0.0', typescript: '^5.0.0' } }),
      'apps/web/src/App.tsx': 'export const App = () => null;',
      'apps/web/.env': 'TOKEN=must-not-be-read',
      'apps/web/node_modules/fake/package.json': JSON.stringify({ dependencies: { vue: '1.0.0' } }),
      'apps/web/generated/Fake.tsx': 'generated',
    });
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 });
      const candidate = result.candidates.find((entry) => entry.language === 'TypeScript');
      expect(candidate?.id).toBe('typescript-react');
      expect(candidate?.frameworks).toEqual(['React']);
      expect(candidate?.evidenceStrength).toBe('strong');
      expect(candidate?.evidenceRefs.every((entry) => !entry.path.includes('.env'))).toBe(true);
      expect(result.evidenceFileCount).toBeGreaterThan(0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('uses weak extension evidence without making filename-only framework guesses', async () => {
    const fixture = await makeExtraction({ 'src/App.jsx': 'export default function App() {}' });
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 128, maxEvidencePaths: 5 });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].language).toBe('JavaScript');
      expect(result.candidates[0].frameworks).toEqual([]);
      expect(result.candidates[0].evidenceStrength).toBe('weak');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('returns an ambiguous result for strong evidence from multiple languages', async () => {
    const fixture = await makeExtraction({
      'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }),
      'requirements.txt': 'Django>=5.0\n',
    });
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 });
      expect(result.candidates.map((entry) => entry.language).sort()).toEqual(['JavaScript', 'Python']);
      expect(result.primaryCandidateId).toBeNull();
      expect(result.unknownReason).toMatch(/strong evidence/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('does not promote prose, metadata-only keys, empty package metadata, or unrelated Maven artifacts into stack evidence', async () => {
    const fixture = await makeExtraction({
      'package.json': '{"name":"plain"}',
      'pyproject.toml': '[project]\nname="plain"\ndescription="Django Flask FastAPI"\n',
      'Cargo.toml': '[package]\nname="plain"\n[package.metadata]\naxum="0.8"\n',
      'pom.xml': '<project><dependencies><dependency><artifactId>kotlin-maven-plugin</artifactId></dependency></dependencies></project>',
    });
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 });
      expect(result.candidates.some((candidate) => candidate.language === 'Kotlin')).toBe(false);
      expect(result.candidates.flatMap((candidate) => candidate.frameworks)).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    { name: 'JS', files: { 'package.json': '{"dependencies":{"express":"5"}}' }, language: 'JavaScript', frameworks: ['Express'] },
    { name: 'TS JSONC', files: { 'tsconfig.json': '{/* comment */"compilerOptions":{"strict":true,},}' }, language: 'TypeScript', frameworks: [] },
    { name: 'Python PEP 621', files: { 'pyproject.toml': '[project]\nname = "app"\ndependencies = [\n "Django>=5",\n "celery[redis]>=5",\n]\n' }, language: 'Python', frameworks: ['Celery', 'Django'] },
    { name: 'Python Poetry', files: { 'pyproject.toml': '[tool.poetry]\nname="app"\n[tool.poetry.dependencies]\npython="^3.12"\nfastapi="^0.115"\n' }, language: 'Python', frameworks: ['FastAPI'] },
    { name: 'Go', files: { 'go.mod': 'module example.com/app\ngo 1.23\nrequire (\n github.com/gin-gonic/gin v1.10.0 // indirect\n github.com/go-chi/chi/v5 v5.1.0\n)\n' }, language: 'Go', frameworks: ['Chi', 'Gin'] },
    { name: 'Java Maven', files: { 'pom.xml': '<project><build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId></plugin></plugins></build><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>' }, language: 'Java', frameworks: ['Spring'] },
    { name: 'Kotlin Maven', files: { 'pom.xml': '<project><build><plugins><plugin><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-maven-plugin</artifactId></plugin></plugins></build></project>' }, language: 'Kotlin', frameworks: [] },
    { name: 'Kotlin Gradle', files: { 'build.gradle.kts': 'plugins { kotlin("jvm") version "2.0.0" }\ndependencies { implementation("org.springframework.boot:spring-boot-starter-web:3.3") }' }, language: 'Kotlin', frameworks: ['Spring'] },
    { name: 'Java Gradle Kotlin DSL', files: { 'build.gradle.kts': 'plugins { java }' }, language: 'Java', frameworks: [] },
    { name: 'PHP', files: { 'composer.json': '{"require":{"php":"^8.3","laravel/framework":"^11"}}' }, language: 'PHP', frameworks: ['Laravel'] },
    { name: '.NET', files: { 'app.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference\n Include="Microsoft.EntityFrameworkCore"\n Version="8.0" /></ItemGroup></Project>' }, language: 'C#', frameworks: ['ASP.NET Core', 'Entity Framework'] },
    { name: 'F#', files: { 'app.fsproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.App" Version="8.0" /></ItemGroup></Project>' }, language: 'F#', frameworks: ['ASP.NET Core'] },
    { name: 'Rust', files: { 'Cargo.toml': '[package]\nname="app"\nversion="0.1.0"\n[dependencies]\naxum = "0.8"\ntokio = { version = "1", features = ["full"] }\n' }, language: 'Rust', frameworks: ['Axum', 'Tokio'] },
    { name: 'Rust aliases', files: { 'Cargo.toml': '[package]\nname="app"\n[dependencies.web]\npackage="axum"\nversion="0.8"\n' }, language: 'Rust', frameworks: ['Axum'] },
    { name: 'Dart Flutter', files: { 'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_riverpod: ^2.0.0\n' }, language: 'Dart', frameworks: ['Flutter', 'Riverpod'] },
    { name: 'Ruby', files: { Gemfile: 'source "https://rubygems.org"\ngem "rails", "~> 7.2"\n' }, language: 'Ruby', frameworks: ['Rails'] },
  ])('recognizes scoped declarations for $name', async ({ files, language, frameworks }) => {
    const fixture = await makeExtraction(files);
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ language, frameworks, evidenceStrength: 'strong' });
      expect(result.primaryCandidateId).toBe(result.candidates[0].id);
      expect(result.candidates[0].evidenceRefs.some((ref) => ref.kind === 'manifest')).toBe(true);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    { name: 'empty Node manifest', files: { 'package.json': '{}' }, language: null },
    { name: 'invalid Node manifest', files: { 'package.json': '"dependencies": { "react": "18" }' }, language: null },
    { name: 'Node description and invalid dependency values', files: { 'package.json': '{"description":"react next angular","dependencies":{"react":null,"next":{}}}' }, language: null },
    { name: 'Python description', files: { 'pyproject.toml': '[project]\nname="plain"\ndescription="Django Flask FastAPI"\n' }, language: 'Python' },
    { name: 'Python multiline metadata', files: { 'pyproject.toml': '[project]\nname="plain"\ndescription="""\n[tool.poetry.dependencies]\ndjango="5"\n"""\n' }, language: 'Python' },
    { name: 'Python metadata keys', files: { 'pyproject.toml': '[tool.unrelated.dependencies]\ndjango="5"\n' }, language: null },
    { name: 'empty Maven project', files: { 'pom.xml': '<project><artifactId>plain</artifactId></project>' }, language: null },
    { name: 'Maven unrelated tags', files: { 'pom.xml': '<project><description><groupId>org.springframework</groupId><artifactId>kotlin-maven-plugin</artifactId></description></project>' }, language: null },
    { name: 'Gradle wrapper and script extension', files: { gradlew: '#!/bin/sh\nexit 0', 'build.gradle.kts': 'description = "kotlin org.springframework"', 'settings.gradle.kts': 'rootProject.name = "plain"' }, language: null },
    { name: 'Gradle commented plugins', files: { 'build.gradle.kts': '/* plugins { kotlin("jvm") } */\nval description = "plugins { java }"' }, language: null },
    { name: 'Gradle unapplied plugins', files: { 'build.gradle.kts': 'plugins { kotlin("jvm") version "2.0" apply false }' }, language: null },
    { name: 'Gradle computed plugin names', files: { 'build.gradle.kts': 'plugins { id("java" + "-unknown") }' }, language: null },
    { name: 'Go replacement and lookalikes', files: { 'go.mod': 'module example.com/app\nreplace example.com/mine => github.com/gin-gonic/gin v1.10.0\nrequire evilgithub.com/gofiber/fiber v1.0.0\n' }, language: 'Go' },
    { name: 'Composer prose', files: { 'composer.json': '{"description":"laravel/framework","extra":{"require":{"laravel/framework":"11"}}}' }, language: null },
    { name: '.NET description and comments', files: { 'app.csproj': '<Project Sdk="Microsoft.NET.Sdk"><!-- <PackageReference Include="Microsoft.EntityFrameworkCore"/> --><PropertyGroup><Description>Microsoft.AspNetCore</Description></PropertyGroup></Project>' }, language: 'C#' },
    { name: '.NET global SDK only', files: { 'global.json': '{"sdk":{"version":"8.0.0"}}', 'app.sln': 'Microsoft Visual Studio Solution File' }, language: null },
    { name: 'XML entity declaration', files: { 'app.csproj': '<!DOCTYPE Project [<!ENTITY package "Microsoft.AspNetCore">]><Project Sdk="Microsoft.NET.Sdk.Web">&package;</Project>' }, language: null },
    { name: 'Rust metadata keys', files: { 'Cargo.toml': '[package]\nname="plain"\n[package.metadata]\naxum="0.8"\nrocket="0.5"\n' }, language: 'Rust' },
    { name: 'Rust dependency aliases', files: { 'Cargo.toml': '[package]\nname="plain"\n[dependencies.axum]\npackage="serde"\nversion="1"\n' }, language: 'Rust' },
    { name: 'Dart top-level Flutter config', files: { 'pubspec.yaml': 'name: plain\ndescription: flutter riverpod\nflutter:\n  assets: []\n' }, language: 'Dart' },
    { name: 'Ruby multiline prose', files: { Gemfile: 'description = \'example\ngem "rails"\n\'\ngem "rake"\n' }, language: 'Ruby' },
    { name: 'Ruby commented declaration', files: { Gemfile: '# gem "rails"\n' }, language: null },
    { name: 'Ruby computed dependency names', files: { Gemfile: 'gem "rails" + "-unknown"\n' }, language: null },
    { name: 'unsupported languages', files: { 'main.c': 'int main() {}', 'README.md': 'Built with Django, Axum, and React' }, language: null },
  ])('does not guess frameworks or languages from $name', async ({ files, language }) => {
    const fixture = await makeExtraction(files);
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 });
      expect(result.candidates.flatMap((candidate) => candidate.frameworks)).toEqual([]);
      expect(result.candidates.map((candidate) => candidate.language)).toEqual(language ? [language] : []);
      if (!language) { expect(result.primaryCandidateId).toBeNull(); expect(result.unknownReason).toMatch(/No supported/); }
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('keeps JS and TS monorepo language/framework evidence scoped to their own projects', async () => {
    const fixture = await makeExtraction({
      'package.json': '{"private":true,"workspaces":["apps/*"]}',
      'apps/web/package.json': '{"dependencies":{"react":"18"}}',
      'apps/web/tsconfig.json': '{"compilerOptions":{"strict":true}}',
      'apps/web/src/App.tsx': 'export const App = () => null;',
      'apps/api/package.json': '{"dependencies":{"express":"5"}}',
      'apps/api/server.js': 'export const app = null;',
      'tools/job.py': 'print("source must not be emitted")',
    });
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 20 });
      expect(result.candidates.map((candidate) => candidate.id)).toEqual(['javascript-express', 'python', 'typescript-react']);
      const javascript = result.candidates.find((candidate) => candidate.language === 'JavaScript')!;
      const typescript = result.candidates.find((candidate) => candidate.language === 'TypeScript')!;
      expect(javascript.evidenceRefs.every((ref) => ref.path.startsWith('apps/api/'))).toBe(true);
      expect(typescript.evidenceRefs.every((ref) => ref.path.startsWith('apps/web/'))).toBe(true);
      expect(result.primaryCandidateId).toBeNull();
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('keeps both source languages in a mixed package and requires source/plugin evidence on the JVM', async () => {
    const fixture = await makeExtraction({
      'web/package.json': '{"dependencies":{"react":"18","typescript":"5"}}',
      'web/a.js': 'export default 1', 'web/b.ts': 'export default 2',
      'jvm/pom.xml': '<project><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId></dependency></dependencies></project>',
      'jvm/src/Main.java': 'class Main {}', 'jvm/src/Main.kt': 'fun main() {}',
    });
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 20 });
      expect(result.candidates.map((candidate) => candidate.language).sort()).toEqual(['Java', 'JavaScript', 'Kotlin', 'TypeScript']);
      expect(result.candidates.find((candidate) => candidate.language === 'Java')?.frameworks).toEqual(['Spring']);
      expect(result.candidates.find((candidate) => candidate.language === 'Kotlin')?.frameworks).toEqual(['Spring']);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('checks immutable manifest metadata and hashes before trusting any evidence', async () => {
    const fixture = await makeExtraction({ 'package.json': '{"dependencies":{"react":"18"}}' });
    try {
      const original = await readFile(fixture.extraction.manifestPath);
      await writeFile(fixture.extraction.manifestPath, Buffer.concat([original, Buffer.from(' ')]));
      await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 })).rejects.toThrow(/hash/);
      const parsed = JSON.parse(original.toString('utf8'));
      parsed.snapshotId = 'different-snapshot';
      const contents = Buffer.from(JSON.stringify(parsed));
      await writeFile(fixture.extraction.manifestPath, contents);
      fixture.extraction.fileManifestSha256 = sha256(contents);
      await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 })).rejects.toThrow(/metadata/);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it.each(['package.json', 'src/app.py'])('verifies same-length file digest for %s before accepting evidence', async (name) => {
    const fixture = await makeExtraction({ [name]: name.endsWith('.json') ? '{"dependencies":{"react":"18"}}' : 'print("original")' });
    try {
      const filePath = path.join(fixture.extraction.workspacePath, ...name.split('/'));
      const bytes = await readFile(filePath); bytes[bytes.length - 2] ^= 1;
      await writeFile(filePath, bytes);
      await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 })).rejects.toThrow(/hash/);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('rejects missing digests, unsafe and casefold-colliding manifest paths', async () => {
    const fixture = await makeExtraction({ 'app.py': 'x' });
    try {
      const original = JSON.parse(await readFile(fixture.extraction.manifestPath, 'utf8'));
      const variants = [
        [{ ...original.files[0], sha256: undefined }],
        [{ ...original.files[0], path: '../app.py' }],
        [{ ...original.files[0], path: 'a/'.repeat(129) + 'app.py' }],
        [{ ...original.files[0], path: 'A/app.py' }, { ...original.files[0], path: 'a/other.py' }],
        [{ ...original.files[0], path: 'a' }, { ...original.files[0], path: 'a/app.py' }],
      ];
      for (const files of variants) {
        const bytes = Buffer.from(JSON.stringify({ ...original, files }));
        await writeFile(fixture.extraction.manifestPath, bytes);
        fixture.extraction.fileManifestSha256 = sha256(bytes); fixture.extraction.extractedFileCount = files.length; fixture.extraction.extractedBytes = files.length;
        await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 })).rejects.toThrow(/invalid|colliding/);
      }
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('does not follow junctions or accept hardlinked evidence', async () => {
    const fixture = await makeExtraction({ 'app/package.json': '{"dependencies":{"react":"18"}}' });
    try {
      const manifest = path.join(fixture.extraction.workspacePath, 'app', 'package.json');
      const external = path.join(fixture.root, 'external'); await mkdir(external);
      await link(manifest, path.join(external, 'package.json'));
      await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 })).rejects.toThrow(/link|regular/);
      await rm(path.join(fixture.extraction.workspacePath, 'app'), { recursive: true });
      await symlink(external, path.join(fixture.extraction.workspacePath, 'app'), 'junction');
      await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 })).rejects.toThrow(/ancestor|link/);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    { maxEvidenceFileBytes: 0, maxEvidencePaths: 10 },
    { maxEvidenceFileBytes: 4096, maxEvidencePaths: 0 },
    { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10, maxEvidenceBytes: 1 },
    { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10, maxEvidenceRefs: 0 },
  ])('does not infer a stack when evidence cannot be read under %j', async (limits) => {
    const fixture = await makeExtraction({ 'package.json': '{"dependencies":{"react":"18"}}', 'app.py': 'print(1)' });
    try {
      const result = await scanWorkspace(fixture.extraction, limits);
      expect(result.candidates).toEqual([]); expect(result.evidenceFileCount).toBe(0);
      expect(result.primaryCandidateId).toBeNull(); expect(result.unknownReason).toMatch(/limits/);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('caps read paths and evidence refs, without allowing unreferenced frameworks to strengthen candidates', async () => {
    const fixture = await makeExtraction({
      'package.json': '{"dependencies":{"react":"18","next":"14","express":"5","vue":"3"}}',
      'z/requirements.txt': 'Django>=5',
    });
    try {
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 1, maxEvidenceRefs: 1 });
      expect(result.evidenceFileCount).toBe(1);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].frameworks).toEqual([]);
      expect(result.candidates[0].evidenceRefs).toHaveLength(1);
      expect(result.primaryCandidateId).toBeNull(); expect(result.unknownReason).toMatch(/limits/);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('honors cancellation and never emits secret values, commands, or raw source', async () => {
    const secret = 'DO_NOT_EMIT_PRIVATE_TOKEN';
    const fixture = await makeExtraction({
      'package.json': JSON.stringify({ dependencies: { react: '18' }, scripts: { postinstall: `echo ${secret}` }, description: secret }),
      'src/App.jsx': `const token = "${secret}";`, '.env': `TOKEN=${secret}`, '.npmrc': `token=${secret}`,
      'vendor/evil/package.json': '{"dependencies":{"vue":"3"}}',
    });
    try {
      const controller = new AbortController(); controller.abort(new Error('cancelled detection'));
      await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10, signal: controller.signal })).rejects.toThrow(/cancelled/);
      const result = await scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 4096, maxEvidencePaths: 10 });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toMatch(/postinstall|\.npmrc|\.env|vendor/);
      expect(result.candidates[0].frameworks).toEqual(['React']);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('enforces its deadline during a real bounded evidence read', async () => {
    const fixture = await makeExtraction({ 'package.json': JSON.stringify({ dependencies: { react: '18' }, description: 'x'.repeat(800_000) }) });
    try {
      await expect(scanWorkspace(fixture.extraction, { maxEvidenceFileBytes: 1024 * 1024, maxEvidencePaths: 10, timeoutMs: 1 })).rejects.toThrow(/timed out|abort/i);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
});
