import { spawn } from 'node:child_process';

import type { BaselineCommandSpec } from './adapters.js';

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
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

function executableName(executable: string): string {
  if (process.platform !== 'win32' || executable.endsWith('.cmd') || executable.endsWith('.exe')) return executable;
  if (['npm', 'pnpm', 'yarn', 'bun', 'npx'].includes(executable)) return `${executable}.cmd`;
  return executable;
}

function workerEnvironment(): NodeJS.ProcessEnv {
  const inherited = process.env;
  const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (inherited[key]) env[key] = inherited[key];
  env.CI = '1';
  env.NO_COLOR = '1';
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  return env;
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
      env: workerEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const consume = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) outputTruncated = true;
    };
    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      child.kill();
    };
    options.signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      finish(error.code === 'ENOENT' ? 'not_available' : 'failed', null);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      if (cancelled || options.signal.aborted) finish('cancelled', code);
      else if (timedOut) finish('timed_out', code);
      else finish(code === 0 ? 'passed' : 'failed', code);
    });
  });
}
