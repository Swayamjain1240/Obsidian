import { describe, expect, it } from 'vitest';

import { runBaselineCommand } from './runner.js';

const command = (args: string[]) => ({
  id: 'node-test', category: 'unit' as const, label: 'Node test', commandLabel: 'node test', executable: process.execPath, args, evidenceRefs: [],
});

describe('bounded baseline command runner', () => {
  it('returns status and counters without returning command output', async () => {
    const result = await runBaselineCommand(command(['-e', 'process.stdout.write("secret-output")']), {
      cwd: process.cwd(), timeoutMs: 2_000, maxOutputBytes: 64, signal: new AbortController().signal,
    });
    expect(result.status).toBe('passed');
    expect(result.outputBytes).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('secret-output');
  });

  it('classifies non-zero exit, timeout, and cancellation explicitly', async () => {
    const failed = await runBaselineCommand(command(['-e', 'process.exit(3)']), {
      cwd: process.cwd(), timeoutMs: 2_000, maxOutputBytes: 64, signal: new AbortController().signal,
    });
    expect(failed.status).toBe('failed');
    expect(failed.exitCode).toBe(3);

    const timedOut = await runBaselineCommand(command(['-e', 'setTimeout(() => {}, 5_000)']), {
      cwd: process.cwd(), timeoutMs: 25, maxOutputBytes: 64, signal: new AbortController().signal,
    });
    expect(timedOut.status).toBe('timed_out');

    const controller = new AbortController();
    const cancelledPromise = runBaselineCommand(command(['-e', 'setTimeout(() => {}, 5_000)']), {
      cwd: process.cwd(), timeoutMs: 2_000, maxOutputBytes: 64, signal: controller.signal,
    });
    controller.abort(new Error('cancel test'));
    expect((await cancelledPromise).status).toBe('cancelled');
  });
});
