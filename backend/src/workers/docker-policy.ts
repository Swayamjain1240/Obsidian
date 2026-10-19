
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

const DEFAULT_DOCKER_USER = '1000:1000';

/**
 * Bind-mounted extracted files are intentionally mode 0600 on the host. Use
 * the non-root identity that owns the worker process on POSIX hosts so the
 * container can read those files without making the snapshot world-readable.
 * Windows Docker Desktop does not expose a meaningful POSIX identity here.
 */
export function dockerWorkerUser(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid !== undefined && gid !== undefined && uid > 0 && gid > 0 && uid <= 0xffffffff && gid <= 0xffffffff) {
    return `${uid}:${gid}`;
  }
  return DEFAULT_DOCKER_USER;
}

export function dockerSecurityArgs(
  limits: DockerResourceLimits = defaultDockerLimits,
  user = DEFAULT_DOCKER_USER,
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
    limits.tmpTmpfsBytes > limits.memoryBytes ||
    !/^([1-9][0-9]{0,9}):([1-9][0-9]{0,9})$/.test(user)
  ) {
    throw new Error('Invalid Docker sandbox resource limits or user.');
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
    '--user', user,
    '--ulimit', 'nofile=1024:1024',
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${limits.tmpTmpfsBytes},mode=1777`,
    '--tmpfs',
    `/workspace:rw,nosuid,nodev,size=${limits.workspaceTmpfsBytes},mode=1777`,
    '--workdir', '/workspace',
  ];
}
