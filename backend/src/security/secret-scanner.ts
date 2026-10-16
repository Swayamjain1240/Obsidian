import type { ExtractionRecord } from '../intake/extraction.js';
import { ignoredPath, readFileManifest, readVerifiedFile, safeFilePath, type ManifestFile } from '../detection/scanner.js';

export interface SecretFinding {
  path: string;
  line: number;
  kind: 'private-key' | 'github-token' | 'cloud-access-key' | 'generic-secret-assignment';
  reason: string;
}

const patterns: Array<{ kind: SecretFinding['kind']; expression: RegExp; reason: string }> = [
  { kind: 'private-key', expression: /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/, reason: 'private-key marker' },
  { kind: 'github-token', expression: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/, reason: 'GitHub token pattern' },
  { kind: 'cloud-access-key', expression: /\bAKIA[0-9A-Z]{16}\b/, reason: 'cloud access-key pattern' },
  { kind: 'generic-secret-assignment', expression: /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*(?:["'][^"']{12,}["']|[^\s#;]{12,})/i, reason: 'secret-like assignment' },
];

const sensitivePath = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|credentials(?:\.json)?|secrets?(?:\.json)?|id_rsa|id_ed25519)$/i;
const binaryPath = /(?:\.png|\.jpg|\.jpeg|\.gif|\.pdf|\.zip|\.gz|\.woff2?)$/i;

function textCandidate(file: ManifestFile): boolean {
  const sensitive = sensitivePath.test(file.path);
  return file.bytes > 0
    && file.bytes <= 262_144
    && (sensitive || !ignoredPath(file.path))
    && !binaryPath.test(file.path);
}

export async function scanSecretMarkers(extraction: ExtractionRecord, signal?: AbortSignal): Promise<{ findings: SecretFinding[]; scannedFileCount: number }> {
  const files = await readFileManifest(extraction, () => signal?.throwIfAborted(), signal ?? new AbortController().signal);
  const findings: SecretFinding[] = [];
  let scannedFileCount = 0;
  for (const file of files) {
    if (!textCandidate(file)) continue;
    const bytes = await readVerifiedFile(await safeFilePath(extraction.workspacePath, file.path), 262_144, () => signal?.throwIfAborted(), signal ?? new AbortController().signal, file);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { continue; }
    scannedFileCount += 1;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const match = patterns.find((pattern) => pattern.expression.test(line));
      if (match) findings.push({ path: file.path, line: index + 1, kind: match.kind, reason: match.reason });
      if (findings.length >= 100) return { findings, scannedFileCount };
    }
  }
  return { findings, scannedFileCount };
}
