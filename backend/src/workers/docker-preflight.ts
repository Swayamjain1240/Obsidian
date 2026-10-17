import type { RepositoryCommandExecutor } from './executor.js';
import { DockerBrokerExecutor } from './docker-broker.js';

export interface DockerPreflightResult {
  available: boolean;
  summary: string;
}

const preflightCommand = {
  id: 'worker-preflight',
  category: 'build' as const,
  label: 'Docker worker preflight',
  commandLabel: 'node --version',
  executable: 'node',
  args: ['--version'],
  evidenceRefs: [],
};

export async function checkDockerSandbox(image = 'obsidian-sandbox:dev', dockerBinary = 'docker', executor?: RepositoryCommandExecutor): Promise<DockerPreflightResult> {
  const worker = executor ?? new DockerBrokerExecutor({ image, dockerBinary, cleanupTimeoutMs: 10_000 });
  const result = await worker.run(preflightCommand, {
    cwd: process.cwd(),
    timeoutMs: 10_000,
    maxOutputBytes: 1_024,
    signal: new AbortController().signal,
  });
  return result.status === 'passed' && result.exitCode === 0
    ? { available: true, summary: 'Restricted Docker container started successfully.' }
    : { available: false, summary: result.status === 'timed_out' ? 'Docker sandbox preflight timed out.' : 'Docker sandbox preflight failed.' };
}
