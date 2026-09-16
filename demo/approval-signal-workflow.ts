import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type * as activities from './approval-activities';

const { finalizePurchaseOrder, cancelPurchaseOrder } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

export const approvalGrantedSignal = defineSignal<[approver: string]>('approvalGranted');
export const approvalDeniedSignal = defineSignal('approvalDenied');

export interface RequestApprovalInput {
  purchaseOrderId: string;
}

export async function approvalSignalWorkflow(input: RequestApprovalInput): Promise<string> {
  let approved = false;
  let denied = false;

  setHandler(approvalGrantedSignal, () => {
    approved = true;
  });
  setHandler(approvalDeniedSignal, () => {
    denied = true;
  });

  await condition(() => approved || denied);

  if (denied) {
    await cancelPurchaseOrder(input.purchaseOrderId);
    return 'denied';
  }

  await finalizePurchaseOrder(input.purchaseOrderId);
  return 'approved';
}
