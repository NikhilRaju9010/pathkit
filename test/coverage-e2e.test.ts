import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { buildWorkflowGraph } from '../src/graph';
import { removeInstrumentedCopy, writeInstrumentedCopy } from '../src/instrument';
import { parseWorkflowFile } from '../src/parser';

/**
 * G4: the first real end-to-end proof that instrumentation + a live
 * Temporal Worker + a Query actually work together, not just at the
 * text/AST level (G3). This is PathKit's own dev-only test — it is not
 * shipped — proving the mechanism before extending it to more branch kinds
 * (G5 onward).
 *
 * `TestWorkflowEnvironment.createTimeSkipping()` downloads an external test
 * server binary on first use (see CLAUDE.md's G4 decision and
 * LIMITATIONS.md), so this suite is noticeably slower than the rest of the
 * project's pure-static tests and needs generous timeouts.
 */
describe('coverage e2e — G4 (Gap 2): first real proof through TestWorkflowEnvironment + Worker', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  function expectedEdgeIndex(fixtureFile: string, functionName: string, label: 'true' | 'false'): string {
    const filePath = path.join(__dirname, 'fixtures', 'g4', fixtureFile);
    const fn = parseWorkflowFile(filePath).find((f) => f.name === functionName)!;
    const graph = buildWorkflowGraph(fn.node, functionName);
    const decisionId = graph.nodes.find((n) => n.kind === 'decision')!.id;
    const edgeIndex = graph.edges.findIndex((e) => e.from === decisionId && e.label === label);
    return String(edgeIndex);
  }

  async function runAndQueryTrace(fixtureFile: string, functionName: string, args: unknown[]): Promise<unknown> {
    const filePath = path.join(__dirname, 'fixtures', 'g4', fixtureFile);
    const instrumentedPath = writeInstrumentedCopy(filePath, functionName);
    try {
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: `g4-${randomUUID()}`,
        workflowsPath: instrumentedPath,
      });

      const handle = await testEnv.client.workflow.start(functionName, {
        workflowId: `g4-${randomUUID()}`,
        taskQueue: worker.options.taskQueue,
        args,
      });

      // The query must be issued while the Worker is still polling — once
      // `runUntil` resolves, the Worker stops, and a query dispatched after
      // that has no Worker left to compute it and simply hangs forever
      // (queries are answered by a Worker replaying/holding the workflow's
      // sandboxed state, not read directly off server-stored history).
      return await worker.runUntil(async () => {
        await handle.result();
        return handle.query(`__pathkit_coverage__${functionName}`);
      });
    } finally {
      removeInstrumentedCopy(instrumentedPath);
    }
  }

  it(
    'trivial-if-else: records the true-edge push when the true branch is taken',
    async () => {
      const trace = await runAndQueryTrace('trivial-if-else.ts', 'trivialIfElse', [true]);
      expect(trace).toEqual([expectedEdgeIndex('trivial-if-else.ts', 'trivialIfElse', 'true')]);
    },
    30_000,
  );

  it(
    'trivial-if-else: records the false-edge push when the false branch is taken',
    async () => {
      const trace = await runAndQueryTrace('trivial-if-else.ts', 'trivialIfElse', [false]);
      expect(trace).toEqual([expectedEdgeIndex('trivial-if-else.ts', 'trivialIfElse', 'false')]);
    },
    30_000,
  );

  it(
    'zero-branch: a straight-line workflow with no decision nodes records an empty trace, no crash',
    async () => {
      const trace = await runAndQueryTrace('zero-branch.ts', 'zeroBranch', [21]);
      expect(trace).toEqual([]);
    },
    30_000,
  );
});
