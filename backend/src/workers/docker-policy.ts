
/**
 * Mandatory runtime restrictions for Obsidian's
 * isolated repository-validation containers.
 *
 * This module only prepares Docker arguments.
 * It does not execute a container.
 */

export interface DockerResourceLimits {
  memoryBytes: number;
  maxProcesses: number;
  cpus: number;
  workspaceTmpfsBytes: number;
  tmpTmpfsBytes: number;
}

export const defaultDockerLimits: DockerResourceLimits = {
  memoryBytes: 512 * 1024 * 1024,
  maxProcesses: 32,
  cpus: 0.5,
  workspaceTmpfsBytes: 128 * 1024 * 1024,
  tmpTmpfsBytes: 64 * 1024 * 1024,
};

export function dockerSecurityArgs(
  limits: DockerResourceLimits = defaultDockerLimits,
): string[] {
  if (
    !Number.isSafeInteger(limits.memoryBytes) ||
    limits.memoryBytes < 128 * 1024 * 1024 ||
    !Number.isSafeInteger(limits.maxProcesses) ||
    limits.maxProcesses < 1 ||
    limits.maxProcesses > 256 ||
    !Number.isFinite(limits.cpus) ||
    limits.cpus <= 0 ||
    limits.cpus > 4 ||
    !Number.isSafeInteger(limits.workspaceTmpfsBytes) ||
    limits.workspaceTmpfsBytes < 16 * 1024 * 1024 ||
    limits.workspaceTmpfsBytes > limits.memoryBytes ||
    !Number.isSafeInteger(limits.tmpTmpfsBytes) ||
    limits.tmpTmpfsBytes < 8 * 1024 * 1024 ||
    limits.tmpTmpfsBytes > limits.memoryBytes
  ) {
    throw new Error('Invalid Docker sandbox resource limits.');
  }

  return [
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--init',
    '--pids-limit', String(limits.maxProcesses),
    '--memory', String(limits.memoryBytes),
    '--memory-swap', String(limits.memoryBytes),
    '--cpus', String(limits.cpus),
    '--user', '1000:1000',
    '--ulimit', 'nofile=1024:1024',
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${limits.tmpTmpfsBytes},mode=1777`,
    '--tmpfs',
    `/workspace:rw,nosuid,nodev,size=${limits.workspaceTmpfsBytes},mode=1777`,
    '--workdir', '/workspace',
  ];
}
