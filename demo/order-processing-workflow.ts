import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './order-activities';

const { reserveInventory, chargePayment, releaseInventory, shipOrder } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

export interface PlaceOrderInput {
  orderId: string;
  customerId: string;
  amountCents: number;
  itemSkus: string[];
}

export async function orderProcessingWorkflow(input: PlaceOrderInput): Promise<string> {
  if (input.amountCents <= 0) {
    return 'rejected: invalid order amount';
  }

  await reserveInventory(input.orderId, input.itemSkus);

  try {
    await chargePayment(input.orderId, input.customerId, input.amountCents);
  } catch (err) {
    await releaseInventory(input.orderId, input.itemSkus);
    return 'rejected: payment failed';
  }

  await shipOrder(input.orderId);
  return 'completed';
}
