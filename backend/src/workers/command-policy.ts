
import type { BaselineCommandSpec } from '../baseline/adapters.js';

export interface ApprovedNodeCommand {
  executable: 'npm';
  args: [string, string];
  network: 'blocked';
}

const approvedScripts: Partial<
  Record<BaselineCommandSpec['category'], readonly string[]>
> = {
  build: ['build'],
  typecheck: ['typecheck', 'type-check', 'check-types'],
  lint: ['lint'],
  unit: ['test', 'test:unit'],
};

/**
 * Strict first-stage policy for offline Node.js
 * baseline command selection.
 *
 * Approval here does NOT authorize host execution.
 * Commands must eventually run inside a verified
 * isolated worker with network disabled.
 */
export function planOfflineNodeBaselineCommand(
  command: BaselineCommandSpec,
): ApprovedNodeCommand | null {
  // Registry access and other network modes are
  // not supported by this initial worker policy.
  if (
    command.network !== undefined &&
    command.network !== 'blocked'
  ) {
    return null;
  }

  // Only the npm package manager is supported
  // in this initial implementation.
  if (command.executable !== 'npm') {
    return null;
  }

  // Reject unexpected flags and arguments.
  if (
    command.args.length !== 2 ||
    command.args[0] !== 'run'
  ) {
    return null;
  }

  const script = command.args[1];
  const allowed = approvedScripts[command.category];

  if (!allowed?.includes(script)) {
    return null;
  }

  return {
    executable: 'npm',
    args: ['run', script],
    network: 'blocked',
  };
}
