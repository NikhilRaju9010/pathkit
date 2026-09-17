import { proxyActivities, sleep } from '@temporalio/workflow';

const { checkStatus } = proxyActivities<{ checkStatus(): Promise<string> }>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

export async function raceWorkflow(): Promise<string> {
  await Promise.race([checkStatus(), sleep('100ms')]);
  return 'done';
}
