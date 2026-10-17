import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SMOKE_NAME = /^obsidian-smoke-[0-9a-f-]{36}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ManagedContainer {
  id: string;
  name: string;
  state: string;
  status: string;
  jobId: string;
  ownerId: string;
  leaseUntil: number;
  createdAt: number;
}

export interface OrphanRecoveryResult {
  recovered: string[];
  skippedRunning: string[];
}

export type ManagedContainerRecovery = 'recovered' | 'active' | 'not_found' | 'failed';

function validNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Read-only inventory of Obsidian worker containers. The name, labels, and
 * Docker-reported state are all validated before a record is returned.
 */
export async function listManagedSmokeContainers(dockerBinary = 'docker'): Promise<ManagedContainer[]> {
  const { stdout } = await execFileAsync(
    dockerBinary,
    [
      'ps', '-a',
      '--filter', 'label=com.obsidian.managed=true',
      '--filter', 'label=com.obsidian.worker=baseline-smoke',
      '--format', '{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Label "com.obsidian.job-id"}}\t{{.Label "com.obsidian.owner-id"}}\t{{.Label "com.obsidian.lease-until"}}\t{{.Label "com.obsidian.created-at"}}',
    ],
    { windowsHide: true, timeout: 8_000, maxBuffer: 64 * 1024 },
  );

  const containers: ManagedContainer[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    if (fields.length !== 8) throw new Error('Invalid Docker container inventory.');
    const [id, name, state, status, jobId, ownerId, leaseText, createdText] = fields;
    const leaseUntil = validNumber(leaseText);
    const createdAt = validNumber(createdText);
    if (!/^[a-f0-9]{12,64}$/i.test(id) || !SMOKE_NAME.test(name) || !UUID.test(jobId) || !UUID.test(ownerId) || !state || !status || leaseUntil === null || createdAt === null) {
      throw new Error('Unexpected managed container metadata.');
    }
    containers.push({ id, name, state, status, jobId, ownerId, leaseUntil, createdAt });
  }
  return containers;
}

/**
 * Recover only stopped, sufficiently old containers whose explicit lease has
 * expired and whose job is not active in this worker process. Running
 * containers are never removed by this helper; a label alone is not proof of
 * abandonment.
 */
export async function recoverStoppedManagedSmokeContainers(options: {
  activeJobIds?: ReadonlySet<string>;
  now?: number;
  minimumAgeMs?: number;
  dockerBinary?: string;
} = {}): Promise<OrphanRecoveryResult> {
  const now = options.now ?? Date.now();
  const minimumAgeMs = options.minimumAgeMs ?? 60_000;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < 0) throw new Error('Invalid orphan recovery limits.');
  const active = options.activeJobIds ?? new Set<string>();
  const containers = await listManagedSmokeContainers(options.dockerBinary);
  const recovered: string[] = [];
  const skippedRunning: string[] = [];

  for (const container of containers) {
    if (container.state === 'running') {
      skippedRunning.push(container.name);
      continue;
    }
    if (active.has(container.jobId) || now < container.leaseUntil || now - container.createdAt < minimumAgeMs) continue;
    try {
      await execFileAsync(options.dockerBinary ?? 'docker', ['rm', '--force', '--volumes', container.name], { windowsHide: true, timeout: 8_000, maxBuffer: 16 * 1024 });
      recovered.push(container.name);
    } catch (error) {
      if (/no such container|already removed/i.test(error instanceof Error ? error.message : String(error))) recovered.push(container.name);
    }
  }
  return { recovered, skippedRunning };
}

/** Verify labels/state for one durable lease before removing its exact container. */
export async function recoverManagedSmokeContainer(input: { containerName: string; jobId: string; now?: number; dockerBinary?: string }): Promise<ManagedContainerRecovery> {
  const dockerBinary = input.dockerBinary ?? 'docker';
  const now = input.now ?? Date.now();
  if (!SMOKE_NAME.test(input.containerName) || !UUID.test(input.jobId)) return 'failed';
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(dockerBinary, [
      'inspect', '--format', '{{.State.Status}}\t{{index .Config.Labels "com.obsidian.managed"}}\t{{index .Config.Labels "com.obsidian.worker"}}\t{{index .Config.Labels "com.obsidian.job-id"}}\t{{index .Config.Labels "com.obsidian.lease-until"}}', input.containerName,
    ], { windowsHide: true, timeout: 8_000, maxBuffer: 16 * 1024 }));
  } catch (error) {
    return /no such object|no such container|not found/i.test(error instanceof Error ? error.message : String(error)) ? 'not_found' : 'failed';
  }
  const [state, managed, worker, jobId, leaseText] = stdout.trim().split('\t');
  const leaseUntil = leaseText ? validNumber(leaseText) : null;
  if (managed !== 'true' || worker !== 'baseline-smoke' || jobId !== input.jobId || leaseUntil === null) return 'failed';
  if (state === 'running' || leaseUntil >= now) return 'active';
  try {
    await execFileAsync(dockerBinary, ['rm', '--force', '--volumes', input.containerName], { windowsHide: true, timeout: 8_000, maxBuffer: 16 * 1024 });
    return 'recovered';
  } catch (error) {
    return /no such container|already removed/i.test(error instanceof Error ? error.message : String(error)) ? 'not_found' : 'failed';
  }
}
