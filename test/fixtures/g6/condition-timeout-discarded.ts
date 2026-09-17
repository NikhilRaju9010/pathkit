import { condition } from '@temporalio/workflow';

export async function conditionTimeoutDiscarded(): Promise<string> {
  let approved = false;
  await condition(() => approved, '1 hour');
  return 'done';
}
