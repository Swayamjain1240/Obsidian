import { randomUUID } from 'node:crypto';

import { operationHash } from './operation-policy.js';
import type { RepairCheckpoint, RepairItem, RepairPlan, ValidationReceipt } from './types.js';

export function createRepairCheckpoint(plan: RepairPlan, receipt: ValidationReceipt): RepairCheckpoint {
  if (receipt.status !== 'passed') throw new Error('A repair checkpoint requires a passing validation receipt.');
  const approved = plan.items.filter((item) => item.approvalState === 'approved');
  if (approved.some((item) => !item.approvalReceipt || item.approvalReceipt.operationHash !== operationHash(item.operations))) throw new Error('Every approved repair item requires a matching approval receipt.');
  const operations = approved.flatMap((item) => item.operations.map((operation) => ({ ...operation })));
  return {
    checkpointId: randomUUID(),
    planId: plan.planId,
    baselineRunId: plan.baselineRunId,
    snapshotId: plan.snapshotId,
    baseCommit: plan.baseCommit,
    operationHash: operationHash(operations),
    operations,
    validationId: receipt.validationId,
    status: 'validated',
    createdAt: new Date().toISOString(),
    revision: 1,
  };
}

export function assertRepairCheckpoint(checkpoint: RepairCheckpoint, expected: { snapshotId: string; baseCommit: string; operations: RepairItem['operations'] }): void {
  if (checkpoint.status !== 'validated') throw new Error('The repair checkpoint is not validated.');
  if (checkpoint.snapshotId !== expected.snapshotId || checkpoint.baseCommit !== expected.baseCommit) throw new Error('The repair checkpoint is bound to a different snapshot or base commit.');
  if (checkpoint.operationHash !== operationHash(expected.operations) || checkpoint.operationHash !== operationHash(checkpoint.operations)) throw new Error('The repair checkpoint operation hash does not match the approved operations.');
}
