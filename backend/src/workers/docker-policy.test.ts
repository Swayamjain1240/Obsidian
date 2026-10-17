import { describe, expect, it } from 'vitest';

import { defaultDockerLimits, dockerSecurityArgs } from './docker-policy.js';

describe('Docker sandbox policy', () => {
  it('emits the required isolation and resource controls', () => {
    const args = dockerSecurityArgs();
    expect(args).toEqual(expect.arrayContaining([
      '--network', 'none',
      '--read-only',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--init',
      '--pids-limit', String(defaultDockerLimits.maxProcesses),
      '--memory', String(defaultDockerLimits.memoryBytes),
      '--memory-swap', String(defaultDockerLimits.memoryBytes),
      '--user', '1000:1000',
      '--workdir', '/workspace',
    ]));
    expect(args.some((value) => value.includes('/workspace:rw') && value.includes('mode=1777'))).toBe(true);
  });

  it('rejects unsafe or inconsistent limits', () => {
    expect(() => dockerSecurityArgs({ ...defaultDockerLimits, maxProcesses: 0 })).toThrow(/resource limits/);
    expect(() => dockerSecurityArgs({ ...defaultDockerLimits, workspaceTmpfsBytes: defaultDockerLimits.memoryBytes + 1 })).toThrow(/resource limits/);
    expect(() => dockerSecurityArgs({ ...defaultDockerLimits, tmpTmpfsBytes: 1 })).toThrow(/resource limits/);
  });
});
