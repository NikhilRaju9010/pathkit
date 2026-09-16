import { condition, defineSignal, setHandler } from '@temporalio/workflow';

export const approveSignal = defineSignal('approve');

export async function signalConditionWorkflow(): Promise<string> {
  let approved = false;
  setHandler(approveSignal, () => {
    approved = true;
  });

  await condition(() => approved);

  return 'approved';
}

export async function signalConditionWithTimeoutWorkflow(): Promise<string> {
  let approved = false;
  const metBeforeTimeout = await condition(() => approved, '1 hour');

  return metBeforeTimeout ? 'approved' : 'timed out';
}
