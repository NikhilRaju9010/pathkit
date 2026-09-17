import { proxyActivities, sleep } from '@temporalio/workflow';

const { checkA, checkB } = proxyActivities<{ checkA(): Promise<void>; checkB(): Promise<void> }>({
  startToCloseTimeout: '30 seconds',
});

export async function twoLoopsWorkflow(maxA: number, maxB: number): Promise<string> {
  for (let i = 1; i <= maxA; i++) {
    await checkA();
    await sleep('10 seconds');
  }
  for (let j = 1; j <= maxB; j++) {
    await checkB();
    await sleep('10 seconds');
  }
  return 'done';
}
