// Regression fixture for the "unlabeled `break` exits the loop" bug found
// piloting PathKit against a real Temporal sample project's
// signal-driven-poll-loop workflow (shipping.workflow.ts): a `while` loop
// wrapping an activity call, where an `if` branch's only content is a bare
// `break` rather than a `return`/`throw`. Before the fix, `break` was
// invisible to the graph builder — its open edge fell through unchanged and
// was closed as an ordinary `'retry'` back-edge, indistinguishable from the
// loop simply continuing, and the decision's `'true'` outcome never reached
// the code after the loop at all.
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './fake-status-activities';

const { checkJobStatus } = proxyActivities<typeof activities>({ startToCloseTimeout: '30 seconds' });

export async function retryLoopWithBreakWorkflow(maxAttempts: number): Promise<string> {
  let attempts = 0;
  let interrupted = false;

  while (attempts < maxAttempts) {
    const status = await checkJobStatus();
    attempts++;

    if (status === 'interrupted') {
      interrupted = true;
      break;
    }
  }

  if (interrupted) {
    return 'interrupted';
  }

  return 'done';
}
