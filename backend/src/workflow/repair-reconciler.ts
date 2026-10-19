import { assertRepairCheckpoint } from './repair-checkpoint.js';
import type { RepairCheckpoint, RepairItem } from './types.js';

export function reconcileRepairCheckpoint(input: { checkpoint: RepairCheckpoint; snapshotId: string; baseCommit: string; operations: RepairItem['operations'] }): void {
  assertRepairCheckpoint(input.checkpoint, { snapshotId: input.snapshotId, baseCommit: input.baseCommit, operations: input.operations });
}
