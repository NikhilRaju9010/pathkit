import { proxyActivities } from '@temporalio/workflow';

const { doWork } = proxyActivities<{ doWork(): Promise<string> }>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

export async function tryCatchActivity(): Promise<string> {
  try {
    await doWork();
  } catch (err) {
    return 'failed';
  }
  return 'succeeded';
}
