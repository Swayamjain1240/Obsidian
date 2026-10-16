import path from 'node:path';

import type { ExtractionRecord } from '../intake/extraction.js';
import { readFileManifest, readVerifiedFile, safeFilePath, type ManifestFile } from '../detection/scanner.js';
import type { BaselineCheckCategory, BaselineEvidenceRef } from './types.js';
import { scanSecretMarkers } from '../security/secret-scanner.js';

export interface BaselineCommandSpec {
  id: string;
  category: BaselineCheckCategory;
  label: string;
  commandLabel: string;
  executable: string;
  args: string[];
  evidenceRefs: BaselineEvidenceRef[];
  network?: 'blocked' | 'registry_only';
}

export interface BaselinePlannedCheck {
  id: string;
  category: BaselineCheckCategory;
  label: string;
  commandLabel: string | null;
  command: BaselineCommandSpec | null;
  initialStatus: 'queued' | 'not_available';
  summary: string;
  evidenceRefs: BaselineEvidenceRef[];
  staticResult?: { status: 'passed' | 'failed'; summary: string };
}

export interface BaselinePlan {
  checks: BaselinePlannedCheck[];
  fileCount: number;
  limited: boolean;
  warning: string | null;
}

interface DiscoveryOptions {
  extraction: ExtractionRecord;
  languageCandidates: readonly string[];
  maxChecks: number;
  maxFileBytes: number;
  signal?: AbortSignal;
  onProgress?: (stage: string, checks: number) => void;
}

interface PackageManifest {
  scripts?: Record<string, unknown>;
}

const scriptMap: Array<{ scriptNames: string[]; category: BaselineCheckCategory; label: string }> = [
  { scriptNames: ['build'], category: 'build', label: 'Build' },
  { scriptNames: ['typecheck', 'type-check', 'check-types'], category: 'typecheck', label: 'Typecheck' },
  { scriptNames: ['lint'], category: 'lint', label: 'Lint' },
  { scriptNames: ['test', 'test:unit'], category: 'unit', label: 'Unit tests' },
  { scriptNames: ['test:integration', 'integration'], category: 'integration', label: 'Integration tests' },
  { scriptNames: ['test:e2e', 'e2e', 'test:functional'], category: 'functional', label: 'Functional tests' },
  { scriptNames: ['start', 'dev'], category: 'runtime', label: 'Runtime smoke check' },
];

function basename(pathname: string): string {
  return pathname.slice(pathname.lastIndexOf('/') + 1).toLowerCase();
}

function findPath(files: readonly ManifestFile[], names: readonly string[]): ManifestFile | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return files.find((file) => wanted.has(basename(file.path)));
}

function findSuffix(files: readonly ManifestFile[], suffixes: readonly string[]): ManifestFile | undefined {
  return files.find((file) => suffixes.some((suffix) => basename(file.path).endsWith(suffix.toLowerCase())));
}

function managerFor(files: readonly ManifestFile[]): { executable: string; label: string; evidence: ManifestFile } | null {
  const candidates = [
    { names: ['pnpm-lock.yaml'], executable: 'pnpm', label: 'pnpm' },
    { names: ['yarn.lock'], executable: 'yarn', label: 'yarn' },
    { names: ['bun.lock', 'bun.lockb'], executable: 'bun', label: 'bun' },
    { names: ['package-lock.json', 'npm-shrinkwrap.json'], executable: 'npm', label: 'npm' },
    { names: ['package.json'], executable: 'npm', label: 'npm' },
  ];
  for (const candidate of candidates) {
    const evidence = findPath(files, candidate.names);
    if (evidence) return { ...candidate, evidence };
  }
  return null;
}

function manifestEvidence(file: ManifestFile, reason: string): BaselineEvidenceRef[] {
  return [{ path: file.path, reason, kind: 'manifest' }];
}

function scriptValue(manifest: PackageManifest, name: string): boolean {
  return typeof manifest.scripts?.[name] === 'string' && manifest.scripts[name].trim().length > 0;
}

function addNotAvailable(
  checks: BaselinePlannedCheck[],
  id: string,
  category: BaselineCheckCategory,
  label: string,
  summary: string,
  evidenceRefs: BaselineEvidenceRef[] = [],
): void {
  checks.push({ id, category, label, commandLabel: null, command: null, initialStatus: 'not_available', summary, evidenceRefs });
}

function addCommand(
  checks: BaselinePlannedCheck[],
  command: BaselineCommandSpec,
  summary: string,
): void {
  checks.push({
    id: command.id,
    category: command.category,
    label: command.label,
    commandLabel: command.commandLabel,
    command,
    initialStatus: 'queued',
    summary,
    evidenceRefs: [...command.evidenceRefs],
  });
}

async function readJsonManifest(
  extraction: ExtractionRecord,
  file: ManifestFile,
  maxFileBytes: number,
  signal: AbortSignal,
): Promise<PackageManifest | null> {
  const buffer = await readVerifiedFile(
    await safeFilePath(extraction.workspacePath, file.path),
    maxFileBytes,
    () => signal?.throwIfAborted(),
    signal,
    file,
  );
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as PackageManifest : null;
  } catch {
    return null;
  }
}

function addNodeChecks(checks: BaselinePlannedCheck[], files: readonly ManifestFile[], manifest: PackageManifest, manager: { executable: string; label: string; evidence: ManifestFile }, maxChecks: number): void {
  for (const mapping of scriptMap) {
    const script = mapping.scriptNames.find((name) => scriptValue(manifest, name));
    if (!script) {
      addNotAvailable(checks, `node-${mapping.category}`, mapping.category, mapping.label, `No ${mapping.label.toLowerCase()} script was declared in package.json.`, manifestEvidence(manager.evidence, 'package script availability checked'));
    } else {
      addCommand(checks, {
        id: `node-${mapping.category}`,
        category: mapping.category,
        label: mapping.label,
        commandLabel: `${manager.label} run ${script}`,
        executable: manager.executable,
        args: ['run', script],
        evidenceRefs: manifestEvidence(manager.evidence, `package script ${script} selected for ${mapping.label.toLowerCase()}`),
      }, `The ${manager.label} ${script} script is available for bounded execution.`);
    }
    if (checks.length >= maxChecks) return;
  }
  const lock = findPath(files, ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
  if (lock && checks.length < maxChecks) {
    addCommand(checks, {
      id: 'dependency-audit', category: 'security', label: 'Dependency security audit', commandLabel: 'npm audit --package-lock-only --ignore-scripts', executable: 'npm',
      args: ['audit', '--package-lock-only', '--ignore-scripts', '--json'], network: 'registry_only', evidenceRefs: manifestEvidence(lock, 'lockfile found; registry-only dependency audit selected'),
    }, 'A registry-only dependency audit is available; package scripts are disabled.');
  }
}

function addLanguageChecks(checks: BaselinePlannedCheck[], files: readonly ManifestFile[], language: string, maxChecks: number): void {
  const pythonManifest = findPath(files, ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg']);
  if (language === 'Python' && pythonManifest) {
    addCommand(checks, {
      id: 'python-compile', category: 'build', label: 'Python compile check', commandLabel: 'python -m compileall -q .', executable: 'python', args: ['-m', 'compileall', '-q', '.'],
      evidenceRefs: manifestEvidence(pythonManifest, 'Python project configuration found'),
    }, 'Python source can be checked with the bounded compile command.');
    const hasTests = files.some((file) => /(^|\/)(?:test|tests|spec|specs)(?:\/|$)/i.test(file.path));
    if (checks.length < maxChecks) {
      if (hasTests) addCommand(checks, {
        id: 'python-unit', category: 'unit', label: 'Python unit tests', commandLabel: 'python -m pytest', executable: 'python', args: ['-m', 'pytest'],
        evidenceRefs: manifestEvidence(pythonManifest, 'Python test directory found'),
      }, 'A Python test directory was found for bounded pytest execution.');
      else addNotAvailable(checks, 'python-unit', 'unit', 'Python unit tests', 'No conventional Python test directory was detected.', manifestEvidence(pythonManifest, 'Python project configuration found'));
    }
    return;
  }
  if (language === 'Go' && findPath(files, ['go.mod', 'go.work'])) {
    const evidence = findPath(files, ['go.mod', 'go.work'])!;
    addCommand(checks, { id: 'go-unit', category: 'unit', label: 'Go tests', commandLabel: 'go test ./...', executable: 'go', args: ['test', './...'], evidenceRefs: manifestEvidence(evidence, 'Go module configuration found') }, 'Go module tests are available for bounded execution.');
    return;
  }
  if (language === 'Rust' && findPath(files, ['cargo.toml'])) {
    const evidence = findPath(files, ['cargo.toml'])!;
    addCommand(checks, { id: 'rust-unit', category: 'unit', label: 'Rust tests', commandLabel: 'cargo test', executable: 'cargo', args: ['test'], evidenceRefs: manifestEvidence(evidence, 'Cargo manifest found') }, 'Cargo tests are available for bounded execution.');
    return;
  }
  if (language === 'Java' && findPath(files, ['pom.xml'])) {
    const evidence = findPath(files, ['pom.xml'])!;
    addCommand(checks, { id: 'java-unit', category: 'unit', label: 'Maven tests', commandLabel: 'mvn test', executable: 'mvn', args: ['test'], evidenceRefs: manifestEvidence(evidence, 'Maven project configuration found') }, 'Maven tests are available for bounded execution.');
    return;
  }
  if (language === 'Kotlin' && (findPath(files, ['build.gradle', 'build.gradle.kts']) || findSuffix(files, ['.gradle', '.gradle.kts']))) {
    const evidence = findPath(files, ['build.gradle', 'build.gradle.kts']) ?? findSuffix(files, ['.gradle', '.gradle.kts'])!;
    addCommand(checks, { id: 'kotlin-unit', category: 'unit', label: 'Gradle tests', commandLabel: 'gradle test', executable: 'gradle', args: ['test'], evidenceRefs: manifestEvidence(evidence, 'Gradle project configuration found') }, 'Gradle tests are available for bounded execution.');
  }
  if (language === 'PHP' && findPath(files, ['composer.json'])) {
    const evidence = findPath(files, ['composer.json'])!;
    addCommand(checks, { id: 'php-unit', category: 'unit', label: 'Composer tests', commandLabel: 'composer test', executable: 'composer', args: ['test'], evidenceRefs: manifestEvidence(evidence, 'Composer project configuration found') }, 'Composer tests are available for bounded execution.');
  }
  if (language === 'C#' && (findPath(files, ['global.json']) || findSuffix(files, ['.sln', '.csproj']))) {
    const evidence = findPath(files, ['global.json']) ?? findSuffix(files, ['.sln', '.csproj'])!;
    addCommand(checks, { id: 'dotnet-unit', category: 'unit', label: '.NET tests', commandLabel: 'dotnet test', executable: 'dotnet', args: ['test', '--no-restore'], evidenceRefs: manifestEvidence(evidence, '.NET project configuration found') }, '.NET tests are available for bounded execution.');
  }
  if (language === 'Dart' && findPath(files, ['pubspec.yaml'])) {
    const evidence = findPath(files, ['pubspec.yaml'])!;
    addCommand(checks, { id: 'dart-unit', category: 'unit', label: 'Dart tests', commandLabel: 'dart test', executable: 'dart', args: ['test'], evidenceRefs: manifestEvidence(evidence, 'Dart project configuration found') }, 'Dart tests are available for bounded execution.');
  }
  if (language === 'Ruby' && findPath(files, ['gemfile'])) {
    const evidence = findPath(files, ['gemfile'])!;
    addCommand(checks, { id: 'ruby-unit', category: 'unit', label: 'Ruby tests', commandLabel: 'bundle exec rake test', executable: 'bundle', args: ['exec', 'rake', 'test'], evidenceRefs: manifestEvidence(evidence, 'Ruby project configuration found') }, 'Ruby tests are available for bounded execution.');
  }
}

export async function discoverBaselinePlan(options: DiscoveryOptions): Promise<BaselinePlan> {
  const signal = options.signal ?? new AbortController().signal;
  const files = await readFileManifest(options.extraction, () => signal.throwIfAborted(), signal);
  const checks: BaselinePlannedCheck[] = [];
  const secretScan = await scanSecretMarkers(options.extraction, signal);
  checks.push({
    id: 'secret-scan', category: 'security', label: 'Secret pattern scan', commandLabel: null, command: null, initialStatus: 'queued',
    summary: secretScan.findings.length ? 'Potential secret patterns require review.' : 'No configured secret patterns were detected.',
    evidenceRefs: secretScan.findings.slice(0, 8).map((finding) => ({ path: finding.path, reason: `${finding.reason} at line ${finding.line}`, kind: 'result' })),
    staticResult: { status: secretScan.findings.length ? 'failed' : 'passed', summary: secretScan.findings.length ? `${secretScan.findings.length} potential secret pattern${secretScan.findings.length === 1 ? '' : 's'} detected.` : 'No configured secret patterns were detected.' },
  });
  const manager = managerFor(files);
  const packageFile = findPath(files, ['package.json']);
  if (packageFile && manager && options.languageCandidates.some((candidate) => candidate === 'JavaScript' || candidate === 'TypeScript')) {
    const manifest = await readJsonManifest(options.extraction, packageFile, options.maxFileBytes, signal);
    if (manifest) addNodeChecks(checks, files, manifest, manager, options.maxChecks);
    else addNotAvailable(checks, 'node-manifest', 'dependencies', 'Project manifest', 'package.json could not be parsed safely.', manifestEvidence(packageFile, 'package manifest parse failed'));
  }
  for (const language of options.languageCandidates) {
    if (checks.length >= options.maxChecks) break;
    addLanguageChecks(checks, files, language, options.maxChecks);
  }
  if (!checks.length) addNotAvailable(checks, 'adapter-unavailable', 'runtime', 'Baseline adapter', 'No verified baseline adapter or safe command was found for the confirmed stack.');
  const limited = checks.length > options.maxChecks;
  const bounded = checks.slice(0, options.maxChecks);
  options.onProgress?.('plan_ready', bounded.length);
  return {
    checks: bounded,
    fileCount: files.length,
    limited,
    warning: limited ? 'The baseline check plan reached its configured check limit.' : null,
  };
}

export function workingDirectory(extraction: ExtractionRecord): string {
  return path.resolve(extraction.workspacePath);
}
