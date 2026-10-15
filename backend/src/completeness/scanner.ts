import path from 'node:path';

import type { ExtractionRecord } from '../intake/extraction.js';
import {
  ignoredPath,
  readFileManifest,
  readVerifiedFile,
  safeFilePath,
  type ManifestFile,
} from '../detection/scanner.js';
import {
  completenessPolicyVersion,
  type AreaStatus,
  type CompletenessArea,
  type CompletenessEvidenceRef,
  type CompletenessFinding,
  type FindingKind,
} from './types.js';

export interface CompletenessScanOptions {
  maxFileBytes: number;
  maxFiles: number;
  maxBytes: number;
  maxFindings: number;
  timeoutMs: number;
  languageCandidates?: readonly string[];
  signal?: AbortSignal;
  onProgress?: (stage: string, counters: { files: number; bytes: number; findings: number }) => void;
}

export interface CompletenessScanResult {
  projectStatus: AreaStatus;
  areas: CompletenessArea[];
  findings: CompletenessFinding[];
  fileCount: number;
  scannedFileCount: number;
  scannedBytes: number;
  limited: boolean;
  warning: string | null;
  policyVersion: string;
}

interface MutableFinding {
  kind: FindingKind;
  areaId: string;
  status: AreaStatus;
  summary: string;
  evidenceRefs: CompletenessEvidenceRef[];
  affectedPaths: string[];
}

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.fs', '.fsx', '.go', '.gradle', '.gsl', '.h', '.hpp', '.htm', '.html',
  '.ini', '.java', '.js', '.json', '.jsx', '.kt', '.kts', '.mjs', '.md', '.mdx', '.mts', '.php', '.py', '.pyi', '.rb', '.rs', '.scss',
  '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.vb', '.vue', '.xml', '.yaml', '.yml',
]);
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.dart', '.fs', '.fsx', '.go', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts', '.mjs',
  '.mts', '.php', '.py', '.pyi', '.rb', '.rs', '.ts', '.tsx', '.vb',
]);
const BINARY_EXTENSIONS = new Set([
  '.7z', '.avi', '.bmp', '.class', '.dll', '.dmg', '.doc', '.docx', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg',
  '.mov', '.mp3', '.mp4', '.pdf', '.png', '.so', '.tar', '.wasm', '.webp', '.woff', '.woff2', '.zip',
]);
const TEST_PATH = /(^|\/)(?:test|tests|spec|specs)(?:\/|$)|(?:^|[._-])(test|spec)(?:[._-]|$)/i;
const README_PATH = /(^|\/)(?:readme|contributing|changelog)(?:\.[^.]+)?$/i;
const sensitivePath = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|credentials(?:\.json)?|secrets?(?:\.json)?|id_rsa|id_ed25519)$/i;

const configurationRequirements: Record<string, { basenames?: string[]; suffixes?: string[] }> = {
  JavaScript: { basenames: ['package.json'] },
  TypeScript: { basenames: ['package.json', 'tsconfig.json', 'tsconfig.base.json'] },
  Python: { basenames: ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'pipfile'] },
  Java: { basenames: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'] },
  Kotlin: { basenames: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle.kts'] },
  Go: { basenames: ['go.mod', 'go.work'] },
  PHP: { basenames: ['composer.json'] },
  'C#': { basenames: ['global.json', 'nuget.config'], suffixes: ['.csproj', '.sln'] },
  FSharp: { suffixes: ['.fsproj'] },
  'Visual Basic': { suffixes: ['.vbproj'] },
  Rust: { basenames: ['cargo.toml'] },
  Dart: { basenames: ['pubspec.yaml'] },
  Ruby: { basenames: ['gemfile', 'rakefile'], suffixes: ['.gemspec'] },
};

const languageSourceExtensions: Record<string, Set<string>> = {
  JavaScript: new Set(['.js', '.jsx', '.mjs', '.cjs']),
  TypeScript: new Set(['.ts', '.tsx', '.mts', '.cts']),
  Python: new Set(['.py', '.pyi']),
  Java: new Set(['.java']),
  Kotlin: new Set(['.kt', '.kts']),
  Go: new Set(['.go']),
  PHP: new Set(['.php']),
  'C#': new Set(['.cs']),
  FSharp: new Set(['.fs', '.fsx', '.fsi']),
  'Visual Basic': new Set(['.vb']),
  Rust: new Set(['.rs']),
  Dart: new Set(['.dart']),
  Ruby: new Set(['.rb', '.rake']),
};

const statusRank: Record<AreaStatus, number> = {
  working: 0,
  not_available: 1,
  working_with_issues: 2,
  partial: 3,
  placeholder: 4,
  not_implemented: 5,
  broken: 6,
};

function extension(pathname: string): string {
  const basename = pathname.slice(pathname.lastIndexOf('/') + 1).toLowerCase();
  const dot = basename.lastIndexOf('.');
  return dot === -1 ? '' : basename.slice(dot);
}

function isTextPath(pathname: string): boolean {
  const basename = pathname.slice(pathname.lastIndexOf('/') + 1).toLowerCase();
  return !BINARY_EXTENSIONS.has(extension(pathname)) && (TEXT_EXTENSIONS.has(extension(pathname)) || !basename.includes('.'));
}

function isCodePath(pathname: string): boolean {
  return CODE_EXTENSIONS.has(extension(pathname));
}

function areaName(id: string): string {
  return ({
    implementation: 'Implementation',
    configuration: 'Configuration',
    imports: 'Imports',
    routes: 'Routes',
    tests: 'Tests',
    documentation: 'Documentation',
    data: 'Data and placeholders',
  } as Record<string, string>)[id] ?? id;
}

function statusForMarker(kind: FindingKind, pathname: string): AreaStatus {
  if (kind === 'broken-import') return 'broken';
  if (kind === 'missing-route') return 'not_implemented';
  if (kind === 'missing-configuration') return 'partial';
  if (kind === 'unimplemented-marker') return 'not_implemented';
  if (kind === 'empty-file') return isCodePath(pathname) ? 'not_implemented' : 'placeholder';
  if (kind === 'placeholder-marker' || kind === 'dummy-data') return 'placeholder';
  return 'working_with_issues';
}

function normalizedTarget(source: string, target: string): string | null {
  const directory = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  const result = path.posix.normalize(directory ? `${directory}/${target}` : target);
  if (result === '..' || result.startsWith('../') || result.startsWith('/')) return null;
  return result;
}

function relativeImportExists(source: string, target: string, paths: Set<string>): boolean {
  const normalized = normalizedTarget(source, target);
  if (!normalized) return false;
  const candidates = [normalized, `${normalized}/index`];
  const extensions = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.py'];
  return candidates.some((candidate) => paths.has(candidate) || extensions.some((suffix) => paths.has(`${candidate}${suffix}`)));
}

function projectStatus(findings: readonly MutableFinding[], areas: readonly CompletenessArea[]): AreaStatus {
  let rank = 0;
  for (const finding of findings) rank = Math.max(rank, statusRank[finding.status]);
  if (!findings.length && areas.some((area) => area.status === 'not_available')) return 'not_available';
  return (Object.keys(statusRank) as AreaStatus[]).find((status) => statusRank[status] === rank) ?? 'working';
}

export async function scanCompleteness(
  extraction: ExtractionRecord,
  options: CompletenessScanOptions,
): Promise<CompletenessScanResult> {
  const limits = [options.maxFileBytes, options.maxFiles, options.maxBytes, options.maxFindings, options.timeoutMs];
  if (limits.some((limit) => !Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647)) throw new Error('Completeness limits are invalid.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Completeness scan timed out.')), options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const deadline = Date.now() + options.timeoutMs;
  const check = (): void => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('Completeness scan timed out.');
  };
  const findings: MutableFinding[] = [];
  const findingKeys = new Set<string>();
  const addFinding = (finding: MutableFinding, pathValue: string, line?: number): boolean => {
    if (findings.length >= options.maxFindings) return false;
    const key = `${finding.kind}|${pathValue}|${line ?? 0}|${finding.areaId}`;
    if (findingKeys.has(key)) return true;
    findingKeys.add(key);
    findings.push({
      ...finding,
      evidenceRefs: finding.evidenceRefs.map((ref) => ({ ...ref })),
      affectedPaths: [...new Set(finding.affectedPaths)],
    });
    return true;
  };

  try {
    const files = await readFileManifest(extraction, check, signal);
    const relevant = files.filter((entry) => !ignoredPath(entry.path));
    const pathSet = new Set(relevant.map((entry) => entry.path));
    const basenames = new Set(relevant.map((entry) => entry.path.slice(entry.path.lastIndexOf('/') + 1).toLowerCase()));
    const areasWithEvidence = new Set<string>();
    const declaredRoutes = new Set<string>();
    const routeReferences: Array<{ path: string; source: string; line: number }> = [];
    let scannedFileCount = 0;
    let scannedBytes = 0;
    let limited = false;
    options.onProgress?.('manifest_indexed', { files: 0, bytes: 0, findings: 0 });

    for (const entry of relevant) {
      check();
      if (scannedFileCount >= options.maxFiles || scannedBytes + entry.bytes > options.maxBytes) { limited = true; break; }
      if (entry.bytes === 0) {
        const kind: FindingKind = isCodePath(entry.path) ? 'empty-file' : 'placeholder-marker';
        addFinding({
          kind,
          areaId: 'implementation',
          status: statusForMarker(kind, entry.path),
          summary: 'The file is empty in the immutable snapshot.',
          evidenceRefs: [{ path: entry.path, reason: 'empty file', kind: 'empty-file' }],
          affectedPaths: [entry.path],
        }, entry.path);
        areasWithEvidence.add('implementation');
        scannedFileCount += 1;
        options.onProgress?.('scanning', { files: scannedFileCount, bytes: scannedBytes, findings: findings.length });
        continue;
      }
      if (entry.bytes > options.maxFileBytes || !isTextPath(entry.path) || sensitivePath.test(entry.path)) continue;
      const buffer = await readVerifiedFile(await safeFilePath(extraction.workspacePath, entry.path), options.maxFileBytes, check, signal, entry);
      scannedFileCount += 1;
      scannedBytes += buffer.byteLength;
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { continue; }
      const lines = text.split(/\r?\n/);
      const sourcePaths = new Set<string>();
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        check();
        const line = lines[lineIndex];
        const lineNumber = lineIndex + 1;
        const ref = (reason: string, kind: CompletenessEvidenceRef['kind'] = 'marker'): CompletenessEvidenceRef => ({ path: entry.path, line: lineNumber, reason, kind });
        if (/\bTODO\b|\bFIXME\b/i.test(line)) {
          addFinding({ kind: 'todo-marker', areaId: 'implementation', status: 'working_with_issues', summary: 'A TODO or FIXME marker is present.', evidenceRefs: [ref('TODO/FIXME marker')], affectedPaths: [entry.path] }, entry.path, lineNumber);
          areasWithEvidence.add('implementation');
        }
        if (/\b(?:not implemented|unimplemented|NotImplementedException)\b|throw\s+new\s+(?:Error|Exception)\s*\(\s*["'](?:todo|not implemented)/i.test(line)) {
          addFinding({ kind: 'unimplemented-marker', areaId: 'implementation', status: 'not_implemented', summary: 'An explicit unimplemented marker is present.', evidenceRefs: [ref('explicit unimplemented marker')], affectedPaths: [entry.path] }, entry.path, lineNumber);
          areasWithEvidence.add('implementation');
        }
        if (/\b(?:coming soon|replace me|replace this|lorem ipsum)\b/i.test(line)) {
          addFinding({ kind: 'placeholder-marker', areaId: 'data', status: 'placeholder', summary: 'Placeholder content is present.', evidenceRefs: [ref('placeholder marker')], affectedPaths: [entry.path] }, entry.path, lineNumber);
          areasWithEvidence.add('data');
        }
        if (/\b(?:dummy data|mock data|sample data)\b/i.test(line)) {
          addFinding({ kind: 'dummy-data', areaId: 'data', status: 'placeholder', summary: 'Dummy or sample data marker is present.', evidenceRefs: [ref('dummy/sample data marker')], affectedPaths: [entry.path] }, entry.path, lineNumber);
          areasWithEvidence.add('data');
        }
        if (isCodePath(entry.path)) {
          for (const match of line.matchAll(/(?:<Route\s+[^>]*\bpath\s*=|(?:router|app)\.(?:get|post|put|patch|delete)\s*\(|(?:route|path)\s*:\s*)["'](\/[A-Za-z0-9_./:{}*-]*)["']/g)) {
            declaredRoutes.add(match[1]);
          }
          for (const match of line.matchAll(/(?:\b(?:to|href)\s*=|\bnavigate\s*\(|\bredirect\s*\()\s*["'](\/[A-Za-z0-9_./:{}*-]*)["']/g)) {
            routeReferences.push({ path: match[1], source: entry.path, line: lineNumber });
          }
          const importMatch = /\b(?:from|import|require\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g;
          for (const match of line.matchAll(importMatch)) {
            const target = match[1];
            sourcePaths.add(target);
            if (!relativeImportExists(entry.path, target, pathSet)) {
              addFinding({ kind: 'broken-import', areaId: 'imports', status: 'broken', summary: 'A relative import target was not found in the immutable snapshot.', evidenceRefs: [ref('relative import target missing', 'import')], affectedPaths: [entry.path] }, entry.path, lineNumber);
              areasWithEvidence.add('imports');
            }
          }
        }
      }
      options.onProgress?.('scanning', { files: scannedFileCount, bytes: scannedBytes, findings: findings.length });
    }

    for (const reference of routeReferences) {
      check();
      if (declaredRoutes.has(reference.path)) continue;
      addFinding({
        kind: 'missing-route',
        areaId: 'routes',
        status: 'not_implemented',
        summary: 'A route reference has no matching route declaration in the immutable snapshot.',
        evidenceRefs: [{ path: reference.source, line: reference.line, reason: `route reference ${reference.path} has no matching declaration`, kind: 'route' }],
        affectedPaths: [reference.source],
      }, `${reference.source}:${reference.path}`, reference.line);
      areasWithEvidence.add('routes');
    }

    const candidates = [...new Set(options.languageCandidates ?? [])];
    for (const language of candidates) {
      const requirement = configurationRequirements[language];
      const extensions = languageSourceExtensions[language];
      if (!requirement || !extensions) continue;
      const hasSource = relevant.some((entry) => extensions.has(extension(entry.path)));
      const hasConfig = relevant.some((entry) => {
        const name = entry.path.slice(entry.path.lastIndexOf('/') + 1).toLowerCase();
        return (requirement.basenames?.includes(name) ?? false) || (requirement.suffixes?.some((suffix) => name.endsWith(suffix)) ?? false);
      });
      if (hasSource && !hasConfig) {
        addFinding({ kind: 'missing-configuration', areaId: 'configuration', status: 'partial', summary: `No standard ${language} project configuration file was found.`, evidenceRefs: [{ path: relevant.find((entry) => extensions.has(extension(entry.path)))?.path ?? '', reason: 'source exists without standard project configuration', kind: 'configuration' }], affectedPaths: relevant.filter((entry) => extensions.has(extension(entry.path))).slice(0, 8).map((entry) => entry.path) }, `configuration:${language}`);
        areasWithEvidence.add('configuration');
      }
    }

    const hasTests = relevant.some((entry) => TEST_PATH.test(entry.path));
    const areas: CompletenessArea[] = [];
    const areaIds = ['implementation', 'configuration', 'imports', 'routes', 'tests', 'documentation', 'data'];
    for (const id of areaIds) {
      const areaFindings = findings.filter((finding) => finding.areaId === id);
      let status: AreaStatus = 'working';
      if (id === 'tests' && !hasTests) status = 'not_available';
      else if (areaFindings.length) status = areaFindings.reduce((best, finding) => statusRank[finding.status] > statusRank[best] ? finding.status : best, 'working' as AreaStatus);
      const paths = [...new Set(areaFindings.flatMap((finding) => finding.affectedPaths))].sort();
      areas.push({
        id,
        name: areaName(id),
        status,
        summary: id === 'tests' && !hasTests ? 'No conventional test files were detected; baseline execution is a later phase.' : areaFindings.length ? `${areaFindings.length} completeness finding${areaFindings.length === 1 ? '' : 's'} reported.` : `${areaName(id)} evidence did not show a completeness issue.`,
        findingIds: areaFindings.map((_, index) => `${id}-${index + 1}`),
        affectedPaths: paths,
      });
    }
    const publicFindings: CompletenessFinding[] = findings.map((finding, index) => ({ ...finding, id: `${finding.areaId}-${index + 1}` }));
    const findingIdMap = new Map(findings.map((finding, index) => [`${finding.areaId}|${index}`, `${finding.areaId}-${index + 1}`]));
    for (const area of areas) {
      area.findingIds = findings.map((finding, index) => finding.areaId === area.id ? findingIdMap.get(`${area.id}|${index}`)! : '').filter(Boolean);
    }
    return {
      projectStatus: projectStatus(findings, areas),
      areas,
      findings: publicFindings,
      fileCount: files.length,
      scannedFileCount,
      scannedBytes,
      limited,
      warning: limited ? 'Completeness evidence limits were reached; the available findings are incomplete.' : null,
      policyVersion: completenessPolicyVersion,
    };
  } finally {
    clearTimeout(timer);
  }
}
