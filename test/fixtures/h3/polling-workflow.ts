import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './fake-status-activities';

const { checkJobStatus } = proxyActivities<typeof activities>({ startToCloseTimeout: '30 seconds' });

export async function pollingWorkflow(maxAttempts: number): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await checkJobStatus();
    if (status === 'complete') {
      return 'done';
    }
    await sleep('10 seconds');
  }
  return 'timed out';
}
