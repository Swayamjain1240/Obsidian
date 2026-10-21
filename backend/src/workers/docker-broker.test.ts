import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DockerBrokerExecutor } from './docker-broker.js';
import { InMemoryWorkerLeaseStore } from './lease-store.js';

const command = { id: 'broker-test', category: 'build' as const, label: 'Node version', commandLabel: 'node --version', executable: 'node', args: ['--version'], evidenceRefs: [] };

describe('Docker broker boundary', () => {
  it('keeps Docker execution behind the broker process and records failure when Docker is unavailable', async () => {
    const leases = new InMemoryWorkerLeaseStore();
    const broker = new DockerBrokerExecutor({ image: 'obsidian-sandbox:dev', dockerBinary: 'docker-that-is-not-installed', cleanupTimeoutMs: 5_000, leaseStore: leases, leaseDurationMs: 10_000 });
    const result = await broker.run(command, { cwd: process.cwd(), timeoutMs: 2_000, maxOutputBytes: 1_024, signal: new AbortController().signal, workerJobId: '00000000-0000-4000-8000-000000000010' });
    expect(result.status).toBe('not_available');
    expect(leases.get('00000000-0000-4000-8000-000000000010')?.state).toBe('failed');
  });

  it('supports an authenticated separately launched broker process', async () => {
    const port = 40_000 + Math.floor(Math.random() * 1_000);
    const token = 'b'.repeat(48);
    const processPath = fileURLToPath(new URL('./docker-broker-process.ts', import.meta.url));
    const brokerProcess = spawn(process.execPath, ['--import', 'tsx', processPath, '--server'], {
      cwd: process.cwd(),
      env: { ...process.env, OBSIDIAN_WORKER_BROKER_SERVER: '1', OBSIDIAN_WORKER_BROKER_HOST: '127.0.0.1', OBSIDIAN_WORKER_BROKER_PORT: String(port), OBSIDIAN_WORKER_BROKER_TOKEN: token },
      stdio: 'ignore',
      windowsHide: true,
    });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/run`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
          ready = response.status === 401;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(ready).toBe(true);
      const unsupported = await fetch(`http://127.0.0.1:${port}/run`, {
        method: 'POST',
        body: '{}',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
      });
      expect(unsupported.status).toBe(415);
      const leases = new InMemoryWorkerLeaseStore();
      const broker = new DockerBrokerExecutor({ image: 'obsidian-sandbox:dev', brokerUrl: `http://127.0.0.1:${port}`, brokerToken: token, dockerBinary: 'docker-that-is-not-installed', cleanupTimeoutMs: 5_000, leaseStore: leases, leaseDurationMs: 10_000 });
      const result = await broker.run(command, { cwd: process.cwd(), timeoutMs: 2_000, maxOutputBytes: 1_024, signal: new AbortController().signal, workerJobId: '00000000-0000-4000-8000-000000000011' });
      expect(result.status).toBe('not_available');
      expect(leases.get('00000000-0000-4000-8000-000000000011')?.state).toBe('failed');
    } finally {
      brokerProcess.kill('SIGTERM');
      if (brokerProcess.exitCode === null) await new Promise((resolve) => brokerProcess.once('close', resolve));
    }
  });
});
