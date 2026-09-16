import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './fake-activities';

const { chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

export async function parseInputWorkflow(rawInput: string): Promise<number> {
  try {
    return JSON.parse(rawInput) as number;
  } catch (err) {
    return 0;
  }
}
