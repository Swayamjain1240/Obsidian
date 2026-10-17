
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import type { BaselineCommandSpec } from '../baseline/adapters.js';
import type {
  BaselineCommandResult,
  BaselineCommandRunnerOptions,
} from '../baseline/runner.js';

import type { RepositoryCommandExecutor } from './executor.js';
import { dockerSecurityArgs } from './docker-policy.js';
import { buildSnapshotMountArgs } from './workspace-mount.js';

const execFileAsync = promisify(execFile);

const SANDBOX_IMAGE = 'obsidian-sandbox:dev';

function result(
  status: BaselineCommandResult['status'],
  summary: string,
  durationMs = 0,
  outputBytes = 0,
  exitCode: number | null = null,
  outputTruncated = false,
): BaselineCommandResult {
  return {
    status,
    summary,
    durationMs,
    outputBytes,
    outputTruncated,
    exitCode,
  };
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  return (error as { code?: unknown }).code;
}

function errorOutput(
  error: unknown,
): { stdout: string; stderr: string } {
  if (typeof error !== 'object' || error === null) {
    return { stdout: '', stderr: '' };
  }

  const value = error as {
    stdout?: unknown;
    stderr?: unknown;
  };

  return {
    stdout:
      typeof value.stdout === 'string' ? value.stdout : '',
    stderr:
      typeof value.stderr === 'string' ? value.stderr : '',
  };
}

/**
 * Docker-backed command executor.
 *
 * Current supported operations:
 * 1. node --version
 * 2. node --check /input/probe.js
 *
 * Arbitrary repository execution remains disabled.
 *
 * This is a development-stage implementation.
 * It must not be used as a production sandbox until
 * isolation, cleanup recovery, and worker ownership
 * have been independently verified.
 */
export class DockerExecutor implements RepositoryCommandExecutor {
  constructor(
    private readonly trustedSnapshotRoot?: string,
  ) {}

  async run(
    command: BaselineCommandSpec,
    options: BaselineCommandRunnerOptions,
  ): Promise<BaselineCommandResult> {
    const isSmokeTest =
      command.executable === 'node' &&
      command.args.length === 1 &&
      command.args[0] === '--version';

    const isSyntaxCheck =
      command.executable === 'node' &&
      command.args.length === 2 &&
      command.args[0] === '--check' &&
      command.args[1] === '/input/probe.js' &&
      Boolean(this.trustedSnapshotRoot);

    // Deny all commands that are not explicitly supported.
    if (!isSmokeTest && !isSyntaxCheck) {
      return result(
        'not_available',
        'Repository execution is disabled until sandbox integration is verified.',
      );
    }

    if (
      !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      !Number.isSafeInteger(options.maxOutputBytes) ||
      options.maxOutputBytes <= 0
    ) {
      return result(
        'not_available',
        'Invalid Docker execution limits.',
      );
    }

    if (options.signal.aborted) {
      return result(
        'cancelled',
        'Docker execution was cancelled.',
      );
    }

    // Validate any requested snapshot mount.
    let snapshotMountArgs: string[] = [];

    if (this.trustedSnapshotRoot) {
      try {
        snapshotMountArgs = await buildSnapshotMountArgs(
          options.cwd,
          this.trustedSnapshotRoot,
        );
      } catch {
        return result(
          'not_available',
          'Snapshot workspace failed security validation.',
        );
      }
    }

    if (options.signal.aborted) {
      return result(
        'cancelled',
        'Docker execution was cancelled.',
      );
    }

    // Syntax checking requires a verified read-only snapshot.
    if (isSyntaxCheck && snapshotMountArgs.length === 0) {
      return result(
        'not_available',
        'A verified snapshot mount is required.',
      );
    }

    const startedAt = Date.now();
    const deadline = startedAt + options.timeoutMs;

    const jobId = randomUUID();
    const containerName = `obsidian-smoke-${jobId}`;

    const controller = new AbortController();

    let timedOut = false;

    let status: BaselineCommandResult['status'] = 'failed';
    let summary = 'Restricted Docker execution failed.';

    let outputBytes = 0;
    let outputTruncated = false;
    let exitCode: number | null = null;

    let cleanupConfirmed = false;

    const onAbort = (): void => {
      controller.abort();
    };

    options.signal.addEventListener('abort', onAbort, {
      once: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);

    const execute = (args: string[]) =>
      execFileAsync('docker', args, {
        windowsHide: true,
        signal: controller.signal,
        timeout: Math.max(1, deadline - Date.now()),
        maxBuffer: 64 * 1024,
      });

    const containerCommand = isSyntaxCheck
      ? ['node', '--check', '/input/probe.js']
      : ['node', '--version'];

    try {
      // 1. Create a restricted container.
      await execute([
        'create',

        '--name',
        containerName,

        '--label',
        'com.obsidian.managed=true',

        '--label',
        'com.obsidian.worker=baseline-smoke',

        '--label',
        `com.obsidian.job-id=${jobId}`,

        '--pull=never',

        ...dockerSecurityArgs(),
        ...snapshotMountArgs,

        SANDBOX_IMAGE,
        ...containerCommand,
      ]);

      if (controller.signal.aborted) {
        throw new Error('Execution interrupted.');
      }

      // 2. Start and attach to the container.
      //
      // docker start --attach may return a non-zero
      // CLI exit code when the command inside the
      // container fails. Preserve that output and
      // inspect the container's actual exit code.
      let stdout = '';
      let stderr = '';
      let startFailed = false;

      try {
        const started = await execute([
          'start',
          '--attach',
          containerName,
        ]);

        stdout = started.stdout;
        stderr = started.stderr;
      } catch (error) {
        if (typeof errorCode(error) !== 'number') {
          throw error;
        }

        startFailed = true;

        const captured = errorOutput(error);

        stdout = captured.stdout;
        stderr = captured.stderr;
      }

      outputBytes =
        Buffer.byteLength(stdout) +
        Buffer.byteLength(stderr);

      outputTruncated =
        outputBytes > options.maxOutputBytes;

      // 3. Inspect the actual container exit code.
      const { stdout: inspectOutput } = await execute([
        'inspect',
        '--format',
        '{{.State.ExitCode}}',
        containerName,
      ]);

      const exitText = inspectOutput.trim();

      if (!/^\d+$/.test(exitText)) {
        throw new Error(
          'Invalid Docker container exit code.',
        );
      }

      const containerExitCode = Number(exitText);

      if (!Number.isSafeInteger(containerExitCode)) {
        throw new Error(
          'Invalid Docker container exit code.',
        );
      }

      exitCode = containerExitCode;

      // 4. Classify the execution result.
      if (
        !startFailed &&
        containerExitCode === 0 &&
        !outputTruncated &&
        (isSyntaxCheck || stdout.trim() === 'v22.19.0')
      ) {
        status = 'passed';

        summary = isSyntaxCheck
          ? 'Read-only JavaScript syntax check passed.'
          : 'Restricted Docker smoke test passed.';
      } else {
        status = 'failed';

        summary = isSyntaxCheck
          ? 'Read-only JavaScript syntax check failed.'
          : 'Restricted Docker smoke test failed validation.';
      }
    } catch (error) {
      if (options.signal.aborted) {
        status = 'cancelled';
        summary = 'Docker execution was cancelled.';
      } else if (timedOut || Date.now() >= deadline) {
        status = 'timed_out';
        summary = 'Docker execution exceeded its time limit.';
      } else if (errorCode(error) === 'ENOENT') {
        status = 'not_available';
        summary = 'Docker CLI is unavailable.';
      } else {
        status = 'failed';
        summary = 'Docker container execution failed.';
      }
    } finally {
      clearTimeout(timer);

      options.signal.removeEventListener(
        'abort',
        onAbort,
      );

      // 5. Cleanup independently from the execution
      // cancellation signal.
      //
      // Attempt removal even when container creation
      // was interrupted, since creation might have
      // succeeded before the Docker CLI was stopped.
      try {
        await execFileAsync(
          'docker',
          [
            'rm',
            '--force',
            '--volumes',
            containerName,
          ],
          {
            windowsHide: true,
            timeout: 5_000,
            maxBuffer: 16 * 1024,
          },
        );

        cleanupConfirmed = true;
      } catch {
        cleanupConfirmed = false;
      }
    }

    // Never report a successful job if cleanup
    // could not be confirmed.
    if (!cleanupConfirmed) {
      status = 'not_available';
      summary =
        'Docker container cleanup could not be confirmed.';
      exitCode = null;
    }

    return result(
      status,
      summary,
      Date.now() - startedAt,
      outputBytes,
      exitCode,
      outputTruncated,
    );
  }
}
