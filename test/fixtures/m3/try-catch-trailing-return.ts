import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './fake-activities';

const { chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

/**
 * The try block's only statement directly returns an awaited activity call
 * — exactly the shape a real project's `paymentProcessingWorkflow` used
 * (`try { return await CancellationScope.cancellable(...); } catch ...`).
 * Anything spliced in right before the try block's own closing brace lands
 * after that return statement and is unreachable.
 */
export async function chargeCardReturningDirectlyWorkflow(accountId: string): Promise<string> {
  try {
    return await chargeCard(accountId);
  } catch (err) {
    return 'charge failed';
  }
}
