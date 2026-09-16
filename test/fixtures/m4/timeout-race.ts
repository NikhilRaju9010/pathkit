// Pattern adapted from temporalio/samples-typescript, timer-examples/src/workflows.ts
// (a real Promise.race([activityPromise, sleep(ms)]) timeout pattern).
import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './fake-order-activities';

const { processOrder } = proxyActivities<typeof activities>({ startToCloseTimeout: '5m' });

export async function raceTimeoutWorkflow(timeoutMs: number): Promise<string> {
  let processing = true;
  const processOrderPromise = processOrder().then(() => {
    processing = false;
  });

  await Promise.race([processOrderPromise, sleep(timeoutMs)]);

  return processing ? 'timed out' : 'completed';
}
