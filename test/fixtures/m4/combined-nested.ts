import { condition, proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './fake-status-activities';

const { checkStatus } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute' });

export async function combinedWorkflow(useRace: boolean): Promise<string> {
  if (useRace) {
    await Promise.race([checkStatus(), sleep('30 seconds')]);
  }

  try {
    await checkStatus();
  } catch (err) {
    // ignore and fall through to the signal wait below
  }

  await condition(() => true);

  return 'done';
}
