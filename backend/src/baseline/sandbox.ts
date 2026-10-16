import path from 'node:path';

export interface SandboxPolicy {
  network: 'blocked';
  maxCpuMs: number;
  maxMemoryBytes: number;
  maxProcesses: number;
  maxOutputBytes: number;
}

export function networkPolicyDescription(network: 'blocked' | 'registry_only'): string {
  return network === 'registry_only'
    ? 'Network is restricted to the package-manager registry policy and scripts are disabled.'
    : 'Network access is blocked by the worker policy.';
}

export const defaultSandboxPolicy: SandboxPolicy = {
  network: 'blocked',
  maxCpuMs: 120_000,
  maxMemoryBytes: 512 * 1024 * 1024,
  maxProcesses: 32,
  maxOutputBytes: 65_536,
};

export function sandboxPolicyFromConfig(config: { BASELINE_MAX_MEMORY_BYTES: number; BASELINE_MAX_PROCESSES: number; BASELINE_MAX_OUTPUT_BYTES: number; BASELINE_CHECK_TIMEOUT_MS: number; BASELINE_NETWORK_MODE: 'blocked' | 'registry_only' }): SandboxPolicy {
  return {
    network: config.BASELINE_NETWORK_MODE,
    maxCpuMs: config.BASELINE_CHECK_TIMEOUT_MS,
    maxMemoryBytes: config.BASELINE_MAX_MEMORY_BYTES,
    maxProcesses: config.BASELINE_MAX_PROCESSES,
    maxOutputBytes: config.BASELINE_MAX_OUTPUT_BYTES,
  };
}

const allowedExecutables = new Set(['npm', 'pnpm', 'yarn', 'bun', 'python', 'go', 'cargo', 'mvn', 'gradle', 'dotnet', 'composer', 'bundle', 'ruby', 'dart', 'node']);

export function validateSandboxCommand(executable: string, cwd: string, workspaceRoot: string): { ok: true } | { ok: false; reason: string } {
  const normalized = executable.toLowerCase().replace(/\.cmd$|\.exe$/g, '');
  if (!allowedExecutables.has(normalized)) return { ok: false, reason: 'The executable is outside the verified baseline allowlist.' };
  const root = path.resolve(workspaceRoot);
  const working = path.resolve(cwd);
  if (working !== root && !working.startsWith(`${root}${path.sep}`)) return { ok: false, reason: 'The command working directory is outside the immutable workspace.' };
  return { ok: true };
}
