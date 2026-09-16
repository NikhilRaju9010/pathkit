import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './fake-activities';

const { chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

const legacyActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

export async function chargeCardWorkflow(accountId: string): Promise<string> {
  try {
    await chargeCard(accountId);
  } catch (err) {
    return 'charge failed';
  }
  return 'charged';
}

export async function chargeCardViaObjectWorkflow(accountId: string): Promise<string> {
  try {
    await legacyActivities.chargeCard(accountId);
  } catch (err) {
    return 'charge failed';
  }
  return 'charged';
}

export async function chargeCardWithOverrideWorkflow(accountId: string): Promise<string> {
  try {
    await chargeCard.executeWithOptions({ startToCloseTimeout: '5s' }, [accountId]);
  } catch (err) {
    return 'charge failed';
  }
  return 'charged';
}
