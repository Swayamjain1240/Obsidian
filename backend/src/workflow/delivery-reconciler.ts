import type { DeliveryStepName, DeliveryStepReceipt, DeliveryStepStatus } from './types.js';

export interface DeliveryIdentity {
  ownerUserId: string;
  version2RunId: string;
  baseCommit: string;
  manifestHash: string;
  branchName: string;
}

export function deliveryReceiptFor(receipts: readonly DeliveryStepReceipt[] | undefined, step: DeliveryStepName): DeliveryStepReceipt | undefined {
  return receipts?.find((receipt) => receipt.step === step);
}

export function upsertDeliveryReceipt(
  receipts: readonly DeliveryStepReceipt[] | undefined,
  identity: DeliveryIdentity,
  step: DeliveryStepName,
  status: DeliveryStepStatus,
  fields: Pick<DeliveryStepReceipt, 'remoteId' | 'responseHash' | 'commitSha' | 'errorCode'> = {},
  now = new Date().toISOString(),
): DeliveryStepReceipt[] {
  const current = deliveryReceiptFor(receipts, step);
  const next: DeliveryStepReceipt = {
    ...current,
    ...identity,
    step,
    status,
    remoteId: fields.remoteId ?? current?.remoteId ?? null,
    responseHash: fields.responseHash ?? current?.responseHash ?? null,
    commitSha: fields.commitSha ?? current?.commitSha ?? null,
    errorCode: fields.errorCode ?? null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  return [...(receipts ?? []).filter((receipt) => receipt.step !== step), next];
}

export function markDeliveryRecovery(
  receipts: readonly DeliveryStepReceipt[] | undefined,
  identity: DeliveryIdentity,
  step: DeliveryStepName,
  errorCode: string,
  now = new Date().toISOString(),
): DeliveryStepReceipt[] {
  return upsertDeliveryReceipt(receipts, identity, step, 'recovery_required', { errorCode }, now);
}

export function deliveryIdentityMatches(receipt: DeliveryStepReceipt, identity: DeliveryIdentity): boolean {
  return receipt.ownerUserId === identity.ownerUserId
    && receipt.version2RunId === identity.version2RunId
    && receipt.baseCommit === identity.baseCommit
    && receipt.manifestHash === identity.manifestHash
    && receipt.branchName === identity.branchName;
}
