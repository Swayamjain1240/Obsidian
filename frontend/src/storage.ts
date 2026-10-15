import type { DetectionResult, RepositorySummary, SnapshotResult } from './api';

const REPOSITORY_KEY = 'obsidian.selectedRepository';
const SNAPSHOT_KEY = 'obsidian.snapshot';
const DETECTION_KEY = 'obsidian.detectionContext';

interface DetectionContext {
  run: DetectionResult;
  snapshotHandle: string | null;
  snapshot: SnapshotResult | null;
  repository: RepositorySummary | null;
}

function read(key: string): unknown {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function repositoryValue(value: unknown): value is RepositorySummary {
  return record(value) && typeof value.id === 'number' && typeof value.private === 'boolean'
    && ['name', 'full_name', 'default_branch', 'updated_at', 'html_url'].every((key) => typeof value[key] === 'string')
    && (value.language === null || typeof value.language === 'string');
}

function snapshotValue(value: unknown): value is SnapshotResult {
  if (!record(value) || !record(value.snapshot) || typeof value.snapshotHandle !== 'string') return false;
  const snapshot = value.snapshot;
  return snapshot.immutable === true && typeof snapshot.byteLength === 'number'
    && ['snapshotId', 'archiveSha256', 'capturedAt'].every((key) => typeof snapshot[key] === 'string')
    && record(snapshot.repository) && ['owner', 'name', 'branch', 'commitSha'].every((key) => typeof (snapshot.repository as Record<string, unknown>)[key] === 'string');
}

function write(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session storage is a convenience for refresh recovery, never the source of truth.
  }
}

export function readSelectedRepository(): RepositorySummary | null {
  const value = read(REPOSITORY_KEY);
  return repositoryValue(value) ? value : null;
}

export function saveSelectedRepository(repository: RepositorySummary): void {
  write(REPOSITORY_KEY, repository);
}

export function readSnapshot(): SnapshotResult | null {
  const value = read(SNAPSHOT_KEY);
  return snapshotValue(value) ? value : null;
}

export function saveSnapshot(snapshot: SnapshotResult): void {
  write(SNAPSHOT_KEY, snapshot);
}

export function readDetectionContext(): DetectionContext | null {
  const value = read(DETECTION_KEY);
  // Cached run data is only a route hint; GET remains authoritative. Validate
  // the shape used during hydration so older or damaged storage cannot crash it.
  if (!record(value) || !record(value.run) || typeof value.run.runId !== 'string' || typeof value.run.snapshotId !== 'string') return null;
  return {
    run: value.run as unknown as DetectionResult,
    snapshotHandle: typeof value.snapshotHandle === 'string' ? value.snapshotHandle : null,
    snapshot: snapshotValue(value.snapshot) ? value.snapshot : null,
    repository: repositoryValue(value.repository) ? value.repository : null,
  };
}

export function saveDetectionContext(context: DetectionContext): void {
  write(DETECTION_KEY, context);
}

export function clearProjectStorage(): void {
  try {
    window.sessionStorage.removeItem(REPOSITORY_KEY);
    window.sessionStorage.removeItem(SNAPSHOT_KEY);
    window.sessionStorage.removeItem(DETECTION_KEY);
  } catch {
    // Session storage is optional and may be disabled by the browser.
  }
}
