import { proxyActivities } from '@temporalio/workflow';

// `maximumAttempts: 1` so a rejecting mock surfaces as a caught exception
// immediately instead of being retried forever (see CLAUDE.md, G5).
const { doWork } = proxyActivities<{ doWork(): Promise<string> }>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 1 },
});

/**
 * The exact shape the d0aa17a fix targets: the try block's only statement
 * directly returns an awaited activity call, as in a real project's
 * `paymentProcessingWorkflow`.
 */
export async function tryReturnAwaitWorkflow(): Promise<string> {
  try {
    return await doWork();
  } catch (err) {
    return 'failed';
  }
}
