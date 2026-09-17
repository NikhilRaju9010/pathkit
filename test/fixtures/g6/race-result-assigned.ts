import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './fake-activities';

const { doWork } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute' });

export async function raceResultAssigned(timeoutMs: number): Promise<string> {
  const winner = await Promise.race([doWork(), sleep(timeoutMs)]);
  return String(winner);
}
