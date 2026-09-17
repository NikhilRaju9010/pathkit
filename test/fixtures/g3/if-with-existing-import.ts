import { proxyActivities } from '@temporalio/workflow';

const { doWork } = proxyActivities<{ doWork(): Promise<string> }>({
  startToCloseTimeout: '1 minute',
});

export async function ifWithExistingImport(flag: boolean): Promise<string> {
  if (flag) {
    return doWork();
  } else {
    return 'skipped';
  }
}
