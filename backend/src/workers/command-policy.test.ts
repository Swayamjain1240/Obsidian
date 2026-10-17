
import { describe, expect, it } from 'vitest';

import type { BaselineCommandSpec } from '../baseline/adapters.js';
import { planOfflineNodeBaselineCommand } from './command-policy.js';

function command(
  overrides: Partial<BaselineCommandSpec> = {},
): BaselineCommandSpec {
  return {
    id: 'test-command',
    category: 'build',
    label: 'Build',
    commandLabel: 'npm run build',
    executable: 'npm',
    args: ['run', 'build'],
    evidenceRefs: [],
    network: 'blocked',
    ...overrides,
  };
}

describe('Offline Node Baseline Command Policy', () => {
  it('allows approved build commands', () => {
    const result = planOfflineNodeBaselineCommand(
      command(),
    );

    expect(result).toEqual({
      executable: 'npm',
      args: ['run', 'build'],
      network: 'blocked',
    });
  });

  it('allows approved unit test commands', () => {
    const result = planOfflineNodeBaselineCommand(
      command({
        category: 'unit',
        args: ['run', 'test'],
      }),
    );

    expect(result).not.toBeNull();
  });

  it('rejects unknown scripts', () => {
    const result = planOfflineNodeBaselineCommand(
      command({
        args: ['run', 'dangerous-script'],
      }),
    );

    expect(result).toBeNull();
  });

  it('rejects additional command arguments', () => {
    const result = planOfflineNodeBaselineCommand(
      command({
        args: ['run', 'build', '--unsafe'],
      }),
    );

    expect(result).toBeNull();
  });

  it('rejects unsupported executables', () => {
    const result = planOfflineNodeBaselineCommand(
      command({
        executable: 'bash',
        args: ['run', 'build'],
      }),
    );

    expect(result).toBeNull();
  });

  it('rejects network-enabled commands', () => {
    const result = planOfflineNodeBaselineCommand(
      command({
        network: 'registry_only',
      }),
    );

    expect(result).toBeNull();
  });

  it('rejects mismatched categories and scripts', () => {
    const result = planOfflineNodeBaselineCommand(
      command({
        category: 'unit',
        args: ['run', 'build'],
      }),
    );

    expect(result).toBeNull();
  });
});
