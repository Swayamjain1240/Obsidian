import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { BaselineCommandSpec } from '../baseline/adapters.js';
import type { BaselineCommandResult, BaselineCommandRunnerOptions } from '../baseline/runner.js';
import type { RepositoryCommandExecutor } from './executor.js';
import type { DockerResourceLimits } from './docker-policy.js';
import type { WorkspaceLimits } from './workspace-policy.js';
import { InMemoryWorkerLeaseStore, type WorkerLeaseStore } from './lease-store.js';

interface BrokerOptions {
  trustedSnapshotRoot?: string;
  image: string;
  dockerBinary?: string;
  brokerUrl?: string;
  brokerToken?: string;
  cleanupTimeoutMs: number;
  resourceLimits?: Partial<DockerResourceLimits>;
  workspaceLimits?: Partial<WorkspaceLimits>;
  leaseStore?: WorkerLeaseStore;
  ownerId?: string;
  leaseDurationMs?: number;
}

interface BrokerResponse {
  status: BaselineCommandResult['status'];
  summary: string;
  outputBytes: number;
  outputTruncated: boolean;
  exitCode: number | null;
}

const brokers = new Set<DockerBrokerExecutor>();

function brokerCommand(): string[] {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const compiled = path.join(currentDirectory, 'docker-broker-process.js');
  if (existsSync(compiled)) return [process.execPath, compiled];
  const source = path.join(currentDirectory, 'docker-broker-process.ts');
  return [process.execPath, '--import', 'tsx', source];
}

function workerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'NODE_PATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.NODE_ENV = 'production';
  env.CI = '1';
  return env;
}

function safeResult(value: unknown): value is BrokerResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.status === 'string'
    && ['passed', 'failed', 'not_available', 'timed_out', 'cancelled'].includes(candidate.status)
    && typeof candidate.summary === 'string'
    && typeof candidate.outputBytes === 'number'
    && Number.isSafeInteger(candidate.outputBytes)
    && typeof candidate.outputTruncated === 'boolean'
    && (candidate.exitCode === null || Number.isSafeInteger(candidate.exitCode));
}

function unavailable(summary: string): BaselineCommandResult {
  return { status: 'not_available', summary, outputBytes: 0, outputTruncated: false, exitCode: null, durationMs: 0 };
}

async function runRemoteBroker(request: unknown, brokerUrl: string, brokerToken: string, timeoutMs: number, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('worker-broker-timeout')), timeoutMs);
  const abort = (): void => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const endpoint = new URL((request as { type?: unknown }).type === 'recover' ? '/recover' : '/run', brokerUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${brokerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.length > 512 * 1024) return null;
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function runBrokerProcess(request: unknown, timeoutMs: number, signal: AbortSignal, children: Set<ChildProcessWithoutNullStreams>): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const output: Buffer[] = [];
    let outputBytes = 0;
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcessWithoutNullStreams;
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', interrupt);
      children.delete(child);
      resolve(value);
    };
    const interrupt = (): void => {
      if (settled) return;
      child?.kill('SIGTERM');
      setTimeout(() => { if (!settled) child?.kill('SIGKILL'); }, 2_000).unref();
    };
    try {
      const [executable, ...args] = brokerCommand();
      child = spawn(executable, args, { cwd: process.cwd(), env: workerEnvironment(), shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      children.add(child);
    } catch {
      resolve(null);
      return;
    }
    signal.addEventListener('abort', interrupt, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= 512 * 1024) output.push(Buffer.from(chunk));
    });
    child.stderr.resume();
    child.once('error', () => finish(null));
    child.once('close', () => {
      let parsed: unknown = null;
      try { parsed = JSON.parse(Buffer.concat(output).toString('utf8')); } catch { parsed = null; }
      finish(parsed);
    });
    timer = setTimeout(() => { interrupt(); }, timeoutMs);
    if (signal.aborted) interrupt();
    else child.stdin.end(JSON.stringify(request));
  });
}

function runBrokerRequest(request: unknown, timeoutMs: number, signal: AbortSignal, children: Set<ChildProcessWithoutNullStreams>, brokerUrl?: string, brokerToken?: string): Promise<unknown> {
  if (brokerUrl && brokerToken) return runRemoteBroker(request, brokerUrl, brokerToken, timeoutMs, signal);
  return runBrokerProcess(request, timeoutMs, signal, children);
}

export class DockerBrokerExecutor implements RepositoryCommandExecutor {
  private readonly options: BrokerOptions;
  private readonly leaseStore: WorkerLeaseStore;
  private readonly ownerId: string;
  private readonly leaseDurationMs: number;
  private readonly children = new Set<ChildProcessWithoutNullStreams>();

  public constructor(options: BrokerOptions) {
    if ((options.brokerUrl && !options.brokerToken) || (!options.brokerUrl && options.brokerToken)) {
      throw new Error('Worker broker URL and token must be configured together.');
    }
    this.options = options;
    this.leaseStore = options.leaseStore ?? new InMemoryWorkerLeaseStore();
    this.ownerId = options.ownerId ?? `broker-${randomUUID()}`;
    this.leaseDurationMs = options.leaseDurationMs ?? 120_000;
    brokers.add(this);
  }

  public async run(command: BaselineCommandSpec, options: BaselineCommandRunnerOptions): Promise<BaselineCommandResult> {
    if (options.signal.aborted) return { ...unavailable('Docker worker execution was cancelled.'), status: 'cancelled' };
    const jobId = options.workerJobId ?? randomUUID();
    const leaseToken = randomBytes(32).toString('base64url');
    const now = Date.now();
    const leaseExpiresAt = options.workerLeaseExpiresAt ?? now + this.leaseDurationMs;
    const claimed = await this.leaseStore.claim({ jobId, ownerId: this.ownerId, leaseToken, containerName: `obsidian-smoke-${jobId}`, leaseExpiresAt, now });
    if (!claimed) return unavailable('Durable worker ownership could not be claimed.');

    const controller = new AbortController();
    const signal = AbortSignal.any([options.signal, controller.signal]);
    let heartbeatFailed = false;
    const heartbeat = setInterval(() => {
      void this.leaseStore.renew(jobId, this.ownerId, leaseToken, Date.now() + this.leaseDurationMs, Date.now()).then((ok) => {
        if (!ok) { heartbeatFailed = true; controller.abort(new Error('Worker lease renewal failed.')); }
      });
    }, Math.max(1_000, Math.floor(this.leaseDurationMs / 3)));
    heartbeat.unref();
    try {
      const startedAt = Date.now();
      const response = await runBrokerRequest({
        type: 'run',
        command,
        options: { ...options, signal: undefined },
        trustedSnapshotRoot: this.options.trustedSnapshotRoot,
        image: this.options.image,
        dockerBinary: this.options.dockerBinary,
        cleanupTimeoutMs: this.options.cleanupTimeoutMs,
        resourceLimits: this.options.resourceLimits,
        workspaceLimits: this.options.workspaceLimits,
        workerJobId: jobId,
        workerOwnerId: this.ownerId,
        workerLeaseExpiresAt: leaseExpiresAt,
      }, Math.max(options.timeoutMs + 15_000, 30_000), signal, this.children, this.options.brokerUrl, this.options.brokerToken);
      const result = response && safeResult(response)
        ? { ...response, durationMs: 0 }
        : unavailable('The worker broker did not return a valid result.');
      const finalResult = heartbeatFailed
        ? unavailable('Durable worker lease renewal failed.')
        : options.signal.aborted
          ? { ...unavailable('Docker worker execution was cancelled.'), status: 'cancelled' as const }
          : { ...result, durationMs: Date.now() - startedAt };
      const state = finalResult.status === 'cancelled' ? 'cancelled' : finalResult.status === 'passed' ? 'completed' : 'failed';
      const finished = await this.leaseStore.finish(jobId, this.ownerId, leaseToken, state, Date.now(), finalResult.status === 'passed' ? undefined : finalResult.status);
      return finished ? finalResult : unavailable('Durable worker completion could not be recorded.');
    } finally {
      clearInterval(heartbeat);
    }
  }

  public async recoverExpiredLeases(now = Date.now(), limit = 50): Promise<{ recovered: number; active: number; failed: number }> {
    const recoveryOwnerId = `${this.ownerId}-recovery-${randomUUID()}`;
    const leases = await this.leaseStore.claimExpired(recoveryOwnerId, now, now + 30_000, limit);
    if (leases.length === 0) return { recovered: 0, active: 0, failed: 0 };
    const response = await runBrokerRequest({ type: 'recover', dockerBinary: this.options.dockerBinary, leases: leases.map((lease) => ({ containerName: lease.containerName, jobId: lease.jobId })) }, 30_000, new AbortController().signal, this.children, this.options.brokerUrl, this.options.brokerToken);
    const statuses = response && typeof response === 'object' ? response as Record<string, unknown> : {};
    let recovered = 0; let active = 0; let failed = 0;
    for (const lease of leases) {
      const status = statuses[lease.jobId];
      if (status === 'recovered' || status === 'not_found') { recovered += 1; await this.leaseStore.markRecovered(lease.jobId, recoveryOwnerId, 'recovered', Date.now()); }
      else if (status === 'active') { active += 1; failed += 1; await this.leaseStore.markRecovered(lease.jobId, recoveryOwnerId, 'recovery_failed', Date.now(), 'active-container'); }
      else { failed += 1; await this.leaseStore.markRecovered(lease.jobId, recoveryOwnerId, 'recovery_failed', Date.now(), 'cleanup-unverified'); }
    }
    return { recovered, active, failed };
  }

  public async shutdown(): Promise<void> {
    for (const child of [...this.children]) child.kill('SIGTERM');
  }
}

export async function shutdownDockerBrokers(): Promise<void> {
  await Promise.all([...brokers].map((broker) => broker.shutdown()));
}
