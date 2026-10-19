import type { ApprovalReceipt } from './types.js';
import type { WorkflowStore } from './store.js';

export class ApprovalLedger {
  public constructor(private readonly store: WorkflowStore) {}

  public async record(receipt: ApprovalReceipt): Promise<ApprovalReceipt> {
    return this.store.saveVersioned(receipt.ownerUserId, 'approval_receipt', receipt.approvalId, { ...receipt, revision: receipt.revision });
  }

  public async get(ownerUserId: string, approvalId: string): Promise<ApprovalReceipt | null> {
    return this.store.get<ApprovalReceipt>(ownerUserId, 'approval_receipt', approvalId);
  }
}
