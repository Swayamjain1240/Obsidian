import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { listManagedSmokeContainers, recoverStoppedManagedSmokeContainers } from './container-inventory.js';

const execFileAsync = promisify(execFile);
const dockerTest = process.env.OBSIDIAN_DOCKER_TESTS === '1' ? it : it.skip;

describe('managed Docker container inventory', () => {
  dockerTest('recovers only an expired, stopped worker with matching ownership metadata', async () => {
    const jobId = randomUUID();
    const ownerId = randomUUID();
    const name = `obsidian-smoke-${jobId}`;
    const now = Date.now();
    try {
      await execFileAsync('docker', [
        'create', '--name', name,
        '--label', 'com.obsidian.managed=true',
        '--label', 'com.obsidian.worker=baseline-smoke',
        '--label', `com.obsidian.job-id=${jobId}`,
        '--label', `com.obsidian.owner-id=${ownerId}`,
        '--label', `com.obsidian.lease-until=${now - 2_000}`,
        '--label', `com.obsidian.created-at=${now - 2_000}`,
        '--pull=never',
        'obsidian-sandbox:dev',
      ], { windowsHide: true, timeout: 15_000 });

      const before = await listManagedSmokeContainers();
      expect(before.some((container) => container.name === name && container.jobId === jobId)).toBe(true);
      const recovered = await recoverStoppedManagedSmokeContainers({ now, minimumAgeMs: 0 });
      expect(recovered.recovered).toContain(name);
      expect((await listManagedSmokeContainers()).some((container) => container.name === name)).toBe(false);
    } finally {
      await execFileAsync('docker', ['rm', '--force', '--volumes', name], { windowsHide: true, timeout: 8_000 }).catch(() => undefined);
    }
  }, 90_000);
});
