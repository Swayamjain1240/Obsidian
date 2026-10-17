
import { spawn } from 'node:child_process';
import { dockerSecurityArgs } from './docker-policy.js';

export interface DockerPreflightResult {
  available: boolean;
  summary: string;
}

export function checkDockerSandbox(): Promise<DockerPreflightResult> {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let timedOut = false;

    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        ...dockerSecurityArgs(),
        'obsidian-sandbox:dev',
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const finish = (available: boolean, summary: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ available, summary });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(0, 1024);
    });

    // Do not expose Docker diagnostic output to API clients.
    child.stderr?.resume();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 15_000);

    child.once('error', () => {
      finish(false, 'Docker sandbox is unavailable.');
    });

    child.once('close', (code) => {
      if (timedOut) {
        finish(false, 'Docker sandbox preflight timed out.');
      } else if (code === 0 && output.trim() === 'v22.19.0') {
        finish(true, 'Restricted Docker container started successfully.');
      } else {
        finish(false, 'Docker sandbox preflight failed.');
      }
    });
  });
}
