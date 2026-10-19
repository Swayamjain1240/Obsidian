import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import type { BaselineCommandSpec } from '../baseline/adapters.js';
import { planOfflineNodeBaselineCommand } from './command-policy.js';
import type {
  BaselineCommandResult,
  BaselineCommandRunnerOptions,
} from '../baseline/runner.js';

import type { RepositoryCommandExecutor } from './executor.js';
import { defaultDockerLimits, dockerSecurityArgs, dockerWorkerUser, type DockerResourceLimits } from './docker-policy.js';
import { buildSnapshotMountArgs } from './workspace-mount.js';
import { inspectSnapshotWorkspace, type WorkspaceLimits } from './workspace-policy.js';

const execFileAsync = promisify(execFile);
const DEFAULT_IMAGE = 'obsidian-sandbox:dev';
const CONTAINER_NAME_PREFIX = 'obsidian-smoke-';
const CONTAINER_NAME_PATTERN = /^obsidian-smoke-[0-9a-f-]{36}$/i;
const WORKER_INSTANCE_ID = randomUUID();
const SAFE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:-]*(?:@sha256:[a-f0-9]{64})?$/i;
const VALID_STATUSES = new Set<BaselineCommandResult['status']>(['passed', 'failed', 'not_available', 'timed_out', 'cancelled']);
const executors = new Set<DockerExecutor>();

interface DockerExecutorOptions {
  trustedSnapshotRoot?: string;
  image?: string;
  dockerBinary?: string;
  cleanupTimeoutMs?: number;
  resourceLimits?: Partial<DockerResourceLimits>;
  workspaceLimits?: Partial<WorkspaceLimits>;
}

interface DockerCommandOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: unknown;
  timedOut?: boolean;
  interrupted?: boolean;
}

interface RunnerResult {
  status: BaselineCommandResult['status'];
  outputBytes: number;
  outputTruncated: boolean;
  exitCode: number | null;
  summary: string;
}

function result(
  status: BaselineCommandResult['status'],
  summary: string,
  durationMs = 0,
  outputBytes = 0,
  exitCode: number | null = null,
  outputTruncated = false,
): BaselineCommandResult {
  return { status, summary, durationMs, outputBytes, outputTruncated, exitCode };
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as { code?: unknown }).code;
}

function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const value = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [value.message, value.stderr, value.stdout].filter((part): part is string => typeof part === 'string').join(' ');
}

function dockerUnavailable(error: unknown): boolean {
  if (errorCode(error) === 'ENOENT') return true;
  return /cannot connect|daemon|docker desktop|named pipe|no such image|pull access denied|is the docker daemon running/i.test(errorText(error));
}

function safeImage(image: string): boolean {
  return SAFE_IMAGE.test(image) && !image.includes('..');
}

function safeLabel(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_.:/-]+$/.test(value);
}

function safeRunnerResult(value: unknown): value is RunnerResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return VALID_STATUSES.has(candidate.status as BaselineCommandResult['status'])
    && typeof candidate.summary === 'string'
    && candidate.summary.length <= 512
    && typeof candidate.outputBytes === 'number'
    && Number.isSafeInteger(candidate.outputBytes)
    && candidate.outputBytes >= 0
    && typeof candidate.outputTruncated === 'boolean'
    && (candidate.exitCode === null || Number.isSafeInteger(candidate.exitCode));
}

function normalizeOptions(input: string | DockerExecutorOptions | undefined): DockerExecutorOptions {
  if (typeof input === 'string') return { trustedSnapshotRoot: input };
  return input ?? {};
}

function workspaceLimits(options: BaselineCommandRunnerOptions, configured: Partial<WorkspaceLimits>): WorkspaceLimits {
  return {
    maxFiles: options.maxFiles ?? configured.maxFiles ?? 10_000,
    maxDirectories: options.maxDirectories ?? configured.maxDirectories ?? 5_000,
    maxBytes: options.maxBytes ?? configured.maxBytes ?? 200 * 1024 * 1024,
    maxSingleFileBytes: options.maxSingleFileBytes ?? configured.maxSingleFileBytes ?? 20 * 1024 * 1024,
    maxDepth: options.maxPathDepth ?? configured.maxDepth ?? 128,
  };
}

function resourceLimits(options: BaselineCommandRunnerOptions, configured: Partial<DockerResourceLimits>): DockerResourceLimits {
  const memoryBytes = options.maxMemoryBytes ?? configured.memoryBytes ?? defaultDockerLimits.memoryBytes;
  const workspaceTmpfsBytes = options.scratchBytes ?? configured.workspaceTmpfsBytes ?? defaultDockerLimits.workspaceTmpfsBytes;
  return {
    memoryBytes,
    maxProcesses: options.maxProcesses ?? configured.maxProcesses ?? defaultDockerLimits.maxProcesses,
    cpus: configured.cpus ?? defaultDockerLimits.cpus,
    workspaceTmpfsBytes,
    tmpTmpfsBytes: configured.tmpTmpfsBytes ?? defaultDockerLimits.tmpTmpfsBytes,
  };
}

async function removeContainer(
  dockerBinary: string,
  containerName: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await execFileAsync(dockerBinary, ['rm', '--force', '--volumes', containerName], {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024,
    });
    return true;
  } catch (error) {
    return /no such container|is not running|already removed/i.test(errorText(error)) ? true : false;
  }
}

async function stopContainer(dockerBinary: string, containerName: string): Promise<void> {
  try {
    await execFileAsync(dockerBinary, ['stop', '--time', '1', containerName], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 16 * 1024,
    });
  } catch {
    try {
      await execFileAsync(dockerBinary, ['kill', containerName], {
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 16 * 1024,
      });
    } catch {
      // Cleanup performs a final force removal and records failure if Docker
      // cannot verify it.
    }
  }
}

async function inspectContainer(
  dockerBinary: string,
  containerName: string,
): Promise<{ exitCode: number; state: string }> {
  const { stdout } = await execFileAsync(dockerBinary, ['inspect', '--format', '{{.State.ExitCode}}\t{{.State.Status}}', containerName], {
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 16 * 1024,
  });
  const [exitText, state = ''] = stdout.trim().split(/\s+/, 2);
  if (!/^\d+$/.test(exitText) || !state || !Number.isSafeInteger(Number(exitText))) throw new Error('Invalid Docker container state.');
  return { exitCode: Number(exitText), state };
}

function startAttached(
  dockerBinary: string,
  containerName: string,
  job: string,
  timeoutMs: number,
  signal: AbortSignal,
  onInterrupt: () => Promise<void>,
): Promise<DockerCommandOutput> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let interrupted = false;
    const stdout: string[] = [];
    const stderr: string[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcessWithoutNullStreams;

    const finish = (output: DockerCommandOutput): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve({ ...output, timedOut, interrupted });
    };

    const terminate = (): void => {
      if (child.killed) return;
      child.kill();
    };

    const interrupt = (): void => {
      if (interrupted || settled) return;
      interrupted = true;
      void onInterrupt().finally(terminate);
    };

    const onAbort = (): void => interrupt();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      child = spawn(dockerBinary, ['start', '--attach', '--interactive', containerName], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({ code: null, stdout: '', stderr: '', error });
      return;
    }

    const collect = (target: string[], value: Buffer, current: 'stdout' | 'stderr'): void => {
      const limit = 128 * 1024;
      if (current === 'stdout') stdoutBytes += value.byteLength;
      else stderrBytes += value.byteLength;
      const currentBytes = current === 'stdout' ? stdoutBytes : stderrBytes;
      if (currentBytes <= limit) target.push(value.toString('utf8'));
    };

    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk, 'stderr'));
    child.once('error', (error) => finish({ code: null, stdout: stdout.join(''), stderr: stderr.join(''), error }));
    child.once('close', (code) => finish({ code, stdout: stdout.join(''), stderr: stderr.join('') }));
    timer = setTimeout(() => {
      timedOut = true;
      interrupt();
    }, timeoutMs);
    if (signal.aborted) interrupt();
    else child.stdin.end(job);
  });
}

function parseRunnerOutput(stdout: string): RunnerResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return safeRunnerResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class DockerExecutor implements RepositoryCommandExecutor {
  private readonly trustedSnapshotRoot?: string;
  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly cleanupTimeoutMs: number;
  private readonly configuredResourceLimits: Partial<DockerResourceLimits>;
  private readonly configuredWorkspaceLimits: Partial<WorkspaceLimits>;
  private readonly activeJobs = new Map<string, string>();

  public constructor(input?: string | DockerExecutorOptions) {
    const options = normalizeOptions(input);
    this.trustedSnapshotRoot = options.trustedSnapshotRoot;
    this.image = options.image ?? DEFAULT_IMAGE;
    this.dockerBinary = options.dockerBinary ?? 'docker';
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 10_000;
    this.configuredResourceLimits = options.resourceLimits ?? {};
    this.configuredWorkspaceLimits = options.workspaceLimits ?? {};
    if (!safeImage(this.image)) throw new Error('Invalid Docker worker image reference.');
    if (!safeLabel(WORKER_INSTANCE_ID)) throw new Error('Invalid Docker worker identity.');
    if (!Number.isSafeInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs < 1 || this.cleanupTimeoutMs > 120_000) throw new Error('Invalid Docker cleanup timeout.');
    executors.add(this);
  }

  public async run(command: BaselineCommandSpec, options: BaselineCommandRunnerOptions): Promise<BaselineCommandResult> {
    const startedAt = Date.now();
    const smokeTest = command.executable === 'node' && command.args.length === 1 && command.args[0] === '--version';
    const syntaxCheck = command.executable === 'node'
      && command.args.length === 2
      && command.args[0] === '--check'
      && /^\/input\/[A-Za-z0-9._/-]+$/.test(command.args[1] ?? '')
      && !command.args[1].includes('..')
      && Boolean(this.trustedSnapshotRoot);
    const approvedNodeCommand = command.executable === 'npm' ? planOfflineNodeBaselineCommand(command) : null;
    const approvedNpm = approvedNodeCommand !== null;

    if (command.executable === 'npm' && command.network === 'registry_only') {
      return result('not_available', 'Registry-dependent checks are unavailable while the worker network is blocked.');
    }
    if (!smokeTest && !syntaxCheck && !approvedNpm) {
      return result('not_available', 'The requested baseline command is not available in the verified Docker worker.');
    }
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 900_000 || !Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0 || options.maxOutputBytes > 1_000_000) {
      return result('not_available', 'Invalid Docker execution limits.');
    }
    if (options.signal.aborted) return result('cancelled', 'Docker execution was cancelled.');
    if ((approvedNpm || syntaxCheck) && !this.trustedSnapshotRoot) return result('not_available', 'A verified snapshot root is required for repository execution.');

    const limits = resourceLimits(options, this.configuredResourceLimits);
    const sourceLimits = workspaceLimits(options, this.configuredWorkspaceLimits);
    let securityArgs: string[];
    try {
      securityArgs = dockerSecurityArgs({ ...defaultDockerLimits, ...limits }, dockerWorkerUser());
    } catch {
      return result('not_available', 'Invalid Docker sandbox resource limits.');
    }
    let mountArgs: string[] = [];
    let beforeInventory: Awaited<ReturnType<typeof inspectSnapshotWorkspace>> | undefined;
    if (this.trustedSnapshotRoot) {
      try {
        beforeInventory = await inspectSnapshotWorkspace(options.cwd, this.trustedSnapshotRoot, sourceLimits);
        mountArgs = await buildSnapshotMountArgs(options.cwd, this.trustedSnapshotRoot, sourceLimits);
      } catch {
        return result('not_available', 'Snapshot workspace failed security validation.');
      }
    }

    const jobId = options.workerJobId ?? randomUUID();
    const containerName = `${CONTAINER_NAME_PREFIX}${jobId}`;
    const ownerId = options.workerOwnerId ?? WORKER_INSTANCE_ID;
    const leaseUntil = options.workerLeaseExpiresAt ?? (Date.now() + options.timeoutMs + this.cleanupTimeoutMs + 30_000);
    if (!CONTAINER_NAME_PATTERN.test(containerName) || !safeLabel(jobId) || !safeLabel(containerName) || !safeLabel(ownerId) || !Number.isSafeInteger(leaseUntil) || leaseUntil <= Date.now()) return result('not_available', 'Docker worker identity could not be validated.');
    this.activeJobs.set(jobId, containerName);
    let created = false;
    let createAttempted = false;
    let execution: BaselineCommandResult = result('failed', 'Docker container execution failed.');
    try {
      const createArgs = [
        'create', '--name', containerName,
        '--label', 'com.obsidian.managed=true',
        '--label', 'com.obsidian.worker=baseline-smoke',
        '--label', `com.obsidian.job-id=${jobId}`,
        '--label', `com.obsidian.owner-id=${ownerId}`,
        '--label', `com.obsidian.lease-until=${leaseUntil}`,
        '--label', `com.obsidian.created-at=${Date.now()}`,
        '--pull=never',
        '--interactive',
        ...securityArgs,
        ...mountArgs,
        this.image,
      ];
      try {
        createAttempted = true;
        await execFileAsync(this.dockerBinary, createArgs, { windowsHide: true, timeout: 15_000, maxBuffer: 32 * 1024 });
        created = true;
      } catch (error) {
        execution = result(dockerUnavailable(error) ? 'not_available' : 'failed', dockerUnavailable(error) ? 'Docker worker is unavailable.' : 'Docker worker container could not be created.');
      }

      if (created) {
        const job = JSON.stringify({
          executable: command.executable,
          args: approvedNpm ? approvedNodeCommand!.args : command.args,
          network: 'blocked',
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
          maxFiles: sourceLimits.maxFiles,
          maxDirectories: sourceLimits.maxDirectories,
          maxBytes: sourceLimits.maxBytes,
          maxSingleFileBytes: sourceLimits.maxSingleFileBytes,
          maxPathDepth: sourceLimits.maxDepth,
        });
        const attached = await startAttached(
          this.dockerBinary,
          containerName,
          `${job}\n`,
          options.timeoutMs + 5_000,
          options.signal,
          () => stopContainer(this.dockerBinary, containerName),
        );
        let inspected: { exitCode: number; state: string } | undefined;
        try {
          inspected = await inspectContainer(this.dockerBinary, containerName);
        } catch (error) {
          execution = result(dockerUnavailable(error) ? 'not_available' : 'failed', dockerUnavailable(error) ? 'Docker worker state is unavailable.' : 'Docker worker state could not be verified.');
        }
        const runner = parseRunnerOutput(attached.stdout);
        if (execution.status === 'failed') {
          if (attached.timedOut) {
            execution = result('timed_out', 'Docker execution exceeded its time limit.', Date.now() - startedAt);
          } else if (attached.interrupted && options.signal.aborted) {
            execution = result('cancelled', 'Docker execution was cancelled.', Date.now() - startedAt);
          } else if (runner && inspected) {
            const status = runner.status === 'passed' && inspected.exitCode !== 0 ? 'failed' : runner.status;
            const commandExitCode = status === 'failed' && inspected.exitCode !== 0 && runner.exitCode === 0
              ? inspected.exitCode
              : runner.exitCode;
            execution = result(status, runner.summary, Date.now() - startedAt, runner.outputBytes, commandExitCode, runner.outputTruncated);
          } else if (options.signal.aborted) {
            execution = result('cancelled', 'Docker execution was cancelled.', Date.now() - startedAt);
          } else if (dockerUnavailable(attached.error)) {
            execution = result('not_available', 'Docker worker is unavailable.', Date.now() - startedAt);
          } else if (inspected && inspected.exitCode !== 0) {
            execution = result('failed', 'Docker worker command failed without a safe result receipt.', Date.now() - startedAt, 0, inspected.exitCode);
          } else {
            execution = result('failed', 'Docker worker did not return a valid result receipt.', Date.now() - startedAt);
          }
        }

        if (beforeInventory && execution.status !== 'cancelled') {
          try {
            const afterInventory = await inspectSnapshotWorkspace(options.cwd, this.trustedSnapshotRoot!, sourceLimits);
            if (afterInventory.fingerprint !== beforeInventory.fingerprint) {
              execution = result('failed', 'Snapshot integrity changed during isolated validation.', Date.now() - startedAt);
            }
          } catch {
            execution = result('failed', 'Snapshot integrity could not be verified after isolated validation.', Date.now() - startedAt);
          }
        }
      }
    } finally {
      const cleanupConfirmed = createAttempted
        ? await removeContainer(this.dockerBinary, containerName, this.cleanupTimeoutMs)
        : true;
      this.activeJobs.delete(jobId);
      if (!cleanupConfirmed) execution = result('not_available', 'Docker container cleanup could not be confirmed.', Date.now() - startedAt);
    }
    return { ...execution, durationMs: execution.durationMs || Date.now() - startedAt };
  }

  public activeJobIds(): string[] {
    return [...this.activeJobs.keys()];
  }

  public async shutdown(): Promise<void> {
    const jobs = [...this.activeJobs.values()];
    await Promise.all(jobs.map(async (containerName) => {
      await stopContainer(this.dockerBinary, containerName);
      await removeContainer(this.dockerBinary, containerName, this.cleanupTimeoutMs);
    }));
  }
}

export async function shutdownDockerExecutors(): Promise<void> {
  await Promise.all([...executors].map((executor) => executor.shutdown()));
}
