import { proxyActivities, sleep } from '@temporalio/workflow';

const { checkJobStatus } = proxyActivities<{ checkJobStatus(): Promise<string> }>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 1 },
});

export async function retryLoopWorkflow(maxAttempts: number): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await checkJobStatus();
    if (status === 'complete') {
      return 'done';
    }
    await sleep('50ms');
  }
  return 'timed out';
}
