import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const INPUT_ROOT = '/input';
const WORKSPACE_ROOT = '/workspace/project';
const MAX_JOB_BYTES = 128 * 1024;
const ALLOWED_NPM_SCRIPTS = new Set([
  'build',
  'typecheck',
  'type-check',
  'check-types',
  'lint',
  'test',
  'test:unit',
]);

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function commandPolicy(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
  if (!Array.isArray(job.args) || job.args.some((argument) => typeof argument !== 'string' || argument.length > 4096)) return null;
  if (typeof job.executable !== 'string' || job.executable.includes('/') || job.executable.includes('\\') || job.executable.includes('\0')) return null;
  if (job.network !== undefined && job.network !== 'blocked') return null;

  if (job.executable === 'npm' && job.args.length === 2 && job.args[0] === 'run' && ALLOWED_NPM_SCRIPTS.has(job.args[1])) {
    return { executable: 'npm', args: ['run', job.args[1]], cwd: WORKSPACE_ROOT, copySnapshot: true };
  }
  if (job.executable === 'node' && job.args.length === 1 && job.args[0] === '--version') {
    return { executable: 'node', args: ['--version'], cwd: WORKSPACE_ROOT, copySnapshot: false };
  }
  if (job.executable === 'node' && job.args.length === 2 && job.args[0] === '--check' && typeof job.args[1] === 'string' && job.args[1].startsWith(`${INPUT_ROOT}/`) && safeRelativePath(job.args[1].slice(`${INPUT_ROOT}/`.length))) {
    return { executable: 'node', args: ['--check', `${WORKSPACE_ROOT}/${job.args[1].slice(`${INPUT_ROOT}/`.length)}`], cwd: WORKSPACE_ROOT, copySnapshot: true };
  }
  return null;
}

function safeLimits(job) {
  if (!safeInteger(job.timeoutMs, 1, 900_000)
    || !safeInteger(job.maxOutputBytes, 1, 1_000_000)
    || !safeInteger(job.maxFiles, 1, 100_000)
    || !safeInteger(job.maxDirectories, 0, 50_000)
    || !safeInteger(job.maxBytes, 1, 2_000_000_000)
    || !safeInteger(job.maxSingleFileBytes, 1, 500_000_000)
    || !safeInteger(job.maxPathDepth, 1, 512)
    || job.maxSingleFileBytes > job.maxBytes) return null;
  return job;
}

function result(status, summary, outputBytes = 0, outputTruncated = false, exitCode = null) {
  return { status, summary, outputBytes, outputTruncated, exitCode };
}

async function readJob() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.byteLength;
    if (bytes > MAX_JOB_BYTES) throw new Error('job-too-large');
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return safeLimits(parsed);
}

function safeComponent(name) {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !name.includes('\0') && !name.includes('/') && !name.includes('\\');
}

async function copySnapshot(job) {
  const source = await lstat(INPUT_ROOT);
  if (!source.isDirectory()) throw new Error('snapshot-not-directory');
  await rm(WORKSPACE_ROOT, { recursive: true, force: true });
  await mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });

  let files = 0;
  let directories = 0;
  let totalBytes = 0;

  async function copyDirectory(sourceDirectory, targetDirectory, depth) {
    if (depth > job.maxPathDepth) throw new Error('snapshot-depth-limit');
    const directoryMetadata = await lstat(sourceDirectory);
    if (!directoryMetadata.isDirectory()) throw new Error('snapshot-directory-changed');
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!safeComponent(entry.name)) throw new Error('snapshot-unsafe-name');
      const sourcePath = path.join(sourceDirectory, entry.name);
      const targetPath = path.join(targetDirectory, entry.name);
      if (entry.isSymbolicLink() || entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket()) throw new Error('snapshot-unsafe-entry');
      if (entry.isDirectory()) {
        directories += 1;
        if (directories > job.maxDirectories) throw new Error('snapshot-directory-limit');
        await mkdir(targetPath, { recursive: false, mode: 0o700 });
        await copyDirectory(sourcePath, targetPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) throw new Error('snapshot-unsupported-entry');
      files += 1;
      if (files > job.maxFiles) throw new Error('snapshot-file-limit');
      const metadata = await lstat(sourcePath);
      if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > job.maxSingleFileBytes) throw new Error('snapshot-file-invalid');
      totalBytes += metadata.size;
      if (totalBytes > job.maxBytes) throw new Error('snapshot-byte-limit');
      await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
      const final = await lstat(sourcePath);
      if (!final.isFile() || final.nlink !== 1 || final.size !== metadata.size || final.ino !== metadata.ino || final.dev !== metadata.dev) throw new Error('snapshot-file-changed');
    }
  }

  await copyDirectory(INPUT_ROOT, WORKSPACE_ROOT, 0);
}

function terminate(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

async function runCommand(job, command) {
  if (command.copySnapshot) await copySnapshot(job);
  else await mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  const env = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/home/node',
    USER: 'node',
    NODE_ENV: 'test',
    CI: '1',
    NO_COLOR: '1',
    NO_PROXY: '*',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_ignore_scripts: 'false',
    npm_config_offline: 'true',
    npm_config_prefer_offline: 'true',
    npm_config_userconfig: '/dev/null',
  };

  let outputBytes = 0;
  let outputTruncated = false;
  let timedOut = false;
  let cancelled = false;
  let settled = false;
  let timer;
  let child;

  const outcome = await new Promise((resolve) => {
    child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const consume = (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > job.maxOutputBytes && !outputTruncated) {
        outputTruncated = true;
        terminate(child);
      }
    };
    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    const complete = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, job.timeoutMs);
    const onSignal = () => {
      cancelled = true;
      terminate(child);
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    child.once('error', (error) => {
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGINT', onSignal);
      complete({ error });
    });
    child.once('close', (code) => {
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGINT', onSignal);
      complete({ code });
    });
  });

  if (cancelled) return result('cancelled', 'The repository command was cancelled.', outputBytes, outputTruncated, null);
  if (timedOut) return result('timed_out', 'The repository command exceeded its time limit.', outputBytes, outputTruncated, null);
  if (outputTruncated) return result('failed', 'The repository command exceeded its output limit.', outputBytes, true, outcome.code ?? null);
  if (outcome.error?.code === 'ENOENT') return result('not_available', 'The requested baseline executable is not available in the worker.', outputBytes, false, null);
  if (outcome.error) return result('failed', 'The repository command could not be started.', outputBytes, false, null);
  return outcome.code === 0
    ? result('passed', 'The repository command completed successfully.', outputBytes, false, 0)
    : result('failed', `The repository command exited with code ${outcome.code ?? 'unknown'}.`, outputBytes, false, outcome.code ?? null);
}

async function main() {
  let job;
  try {
    job = await readJob();
    const command = commandPolicy(job);
    if (!command || !safeLimits(job)) {
      process.stdout.write(JSON.stringify(result('not_available', 'The requested baseline command is not available in the worker.')));
      return;
    }
    const outcome = await runCommand(job, command);
    process.stdout.write(JSON.stringify(outcome));
  } catch {
    process.stdout.write(JSON.stringify(result('not_available', 'The snapshot or worker job failed validation.')));
  }
}

await main();
