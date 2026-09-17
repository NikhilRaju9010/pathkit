import { condition, defineSignal, setHandler } from '@temporalio/workflow';

export const approveSignal = defineSignal('approve');

export async function conditionWorkflow(): Promise<string> {
  let approved = false;
  setHandler(approveSignal, () => {
    approved = true;
  });
  await condition(() => approved);
  return 'approved';
}

export async function conditionTimeoutWorkflow(): Promise<string> {
  let approved = false;
  setHandler(approveSignal, () => {
    approved = true;
  });
  const metBeforeTimeout = await condition(() => approved, '200ms');
  return metBeforeTimeout ? 'approved' : 'timed out';
}
