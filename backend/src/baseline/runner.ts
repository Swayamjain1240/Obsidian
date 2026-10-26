import { spawn } from 'node:child_process';

import type { BaselineCommandSpec } from './adapters.js';
import { validateSandboxCommand } from './sandbox.js';

export type BaselineCommandStatus = 'passed' | 'failed' | 'not_available' | 'timed_out' | 'cancelled';

export interface BaselineCommandResult {
  status: BaselineCommandStatus;
  exitCode: number | null;
  durationMs: number;
  outputBytes: number;
  outputTruncated: boolean;
  summary: string;
}

export interface BaselineCommandRunnerOptions {
  cwd: string;
  workspaceRoot?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
  maxMemoryBytes?: number;
  maxProcesses?: number;
  maxFiles?: number;
  maxDirectories?: number;
  maxBytes?: number;
  maxSingleFileBytes?: number;
  maxPathDepth?: number;
  scratchBytes?: number;
  workerJobId?: string;
  workerOwnerId?: string;
  workerLeaseExpiresAt?: number;
  requireIsolation?: boolean;
}

function executableName(executable: string): string {
  if (process.platform !== 'win32') return executable;
  // Windows resolves npm/pnpm/yarn shims when the bare command is passed to
  // spawn with shell:false. Appending .cmd causes EINVAL in Node 22 on some
  // hosts, while preserving a full path also makes the allowlist needlessly
  // platform-specific. The sandbox validates the basename before this step.
  return executable.replace(/^.*[\\/]/, '').replace(/\.(?:cmd|exe|bat)$/i, '');
}

function workerEnvironment(network: 'blocked' | 'registry_only' = 'blocked', maxMemoryBytes?: number): NodeJS.ProcessEnv {
  const inherited = process.env;
  const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (inherited[key]) env[key] = inherited[key];
  env.CI = '1';
  env.NO_COLOR = '1';
  env.npm_config_audit = network === 'registry_only' ? 'true' : 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  env.npm_config_ignore_scripts = 'true';
  env.NO_PROXY = network === 'blocked' ? '*' : env.NO_PROXY ?? '';
  if (network === 'registry_only') env.npm_config_registry = 'https://registry.npmjs.org/';
  if (maxMemoryBytes && maxMemoryBytes >= 64 * 1024 * 1024) env.NODE_OPTIONS = `--max-old-space-size=${Math.floor(maxMemoryBytes / (1024 * 1024))}`;
  return env;
}

function terminateProcess(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  if (child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    return;
  }
  child.kill('SIGKILL');
}

function safeSummary(status: BaselineCommandStatus, label: string, exitCode: number | null, outputTruncated: boolean): string {
  if (status === 'passed') return `${label} completed successfully.`;
  if (status === 'not_available') return `${label} is not available in the baseline worker.`;
  if (status === 'timed_out') return `${label} exceeded its configured time limit.`;
  if (status === 'cancelled') return `${label} was cancelled before completion.`;
  return `${label} exited with code ${exitCode ?? 'unknown'}${outputTruncated ? ' after reaching the output limit' : ''}.`;
}

export function runBaselineCommand(command: BaselineCommandSpec, options: BaselineCommandRunnerOptions): Promise<BaselineCommandResult> {
  const startedAt = Date.now();
  const sandbox = validateSandboxCommand(command.executable, options.cwd, options.workspaceRoot ?? options.cwd);
  if (!sandbox.ok) return Promise.resolve({ status: 'not_available', exitCode: null, durationMs: 0, outputBytes: 0, outputTruncated: false, summary: `${command.label} is not available: ${sandbox.reason}` });
  if (options.requireIsolation) {
    return Promise.resolve({
      status: 'not_available',
      exitCode: null,
      durationMs: 0,
      outputBytes: 0,
      outputTruncated: false,
      summary: `${command.label} is not available: a verified OS-level worker sandbox is required before repository execution.`,
    });
  }
  if (options.signal.aborted) return Promise.resolve({ status: 'cancelled', exitCode: null, durationMs: 0, outputBytes: 0, outputTruncated: false, summary: safeSummary('cancelled', command.label, null, false) });

  return new Promise((resolve) => {
    let settled = false;
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let cancelled = false;
    const finish = (status: BaselineCommandStatus, exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      resolve({
        status,
        exitCode,
        durationMs: Date.now() - startedAt,
        outputBytes,
        outputTruncated,
        summary: safeSummary(status, command.label, exitCode, outputTruncated),
      });
    };
    const child = spawn(executableName(command.executable), command.args, {
      cwd: options.cwd,
      env: workerEnvironment(command.network, options.maxMemoryBytes),
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const consume = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) outputTruncated = true;
    };
    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    let timer: NodeJS.Timeout | undefined;
    const startTimeout = (): void => {
      timer = setTimeout(() => {
        timedOut = true;
        terminateProcess(child);
      }, options.timeoutMs);
    };
    child.once('spawn', startTimeout);
    const onAbort = (): void => {
      cancelled = true;
      terminateProcess(child);
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      finish(error.code === 'ENOENT' ? 'not_available' : 'failed', null);
    });
    child.once('close', (code) => {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      if (cancelled || options.signal.aborted) finish('cancelled', code);
      else if (timedOut) finish('timed_out', code);
      else finish(code === 0 ? 'passed' : 'failed', code);
    });
  });
}
