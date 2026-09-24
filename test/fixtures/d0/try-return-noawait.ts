import { proxyActivities } from '@temporalio/workflow';

const { doWork } = proxyActivities<{ doWork(): Promise<string> }>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 1 },
});

/**
 * `return doWork();` with NO `await` inside the try. A promise returned from
 * an async function is settled outside the try block, so this `catch` can
 * never run — a rejecting activity fails the workflow instead. The `catch`
 * is dead code in the original source; see LIMITATIONS.md.
 */
export async function tryReturnNoAwaitWorkflow(): Promise<string> {
  try {
    return doWork();
  } catch (err) {
    return 'failed';
  }
}
