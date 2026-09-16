import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { buildWorkflowGraph, WorkflowGraph } from '../src/graph';

function graphOf(milestone: string, fileName: string, functionName: string): WorkflowGraph {
  const filePath = path.join(__dirname, 'fixtures', milestone, fileName);
  const parsed = parseWorkflowFile(filePath);
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new Error(`fixture ${milestone}/${fileName} has no exported function named ${functionName}`);
  }
  return buildWorkflowGraph(fn.node, fn.name);
}

function edgeTriples(graph: WorkflowGraph): [string, string, string][] {
  return graph.edges.map((e) => [e.from, e.label, e.to]);
}

describe('buildWorkflowGraph — M2 fixtures (if/else)', () => {
  it('simple-if-else: one decision, both branches reach End', () => {
    const g = graphOf('m2', 'simple-if-else.ts', 'simpleIfElse');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'end']);
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'true', 'n2'],
      ['n1', 'false', 'n2'],
    ]);
  });

  it('if-no-else: an implicit else still reaches End via the following statement', () => {
    const g = graphOf('m2', 'if-no-else.ts', 'ifNoElse');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'end']);
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'true', 'n2'],
      ['n1', 'false', 'n2'],
    ]);
  });

  it('nested-if-else: an inner decision hangs off the outer true edge', () => {
    const g = graphOf('m2', 'nested-if-else.ts', 'nestedIfElse');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'decision', 'end']);
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'true', 'n2'],
      ['n2', 'true', 'n3'],
      ['n2', 'false', 'n3'],
      ['n1', 'false', 'n3'],
    ]);
  });

  it('no-branches: a straight line from Start to End', () => {
    const g = graphOf('m2', 'no-branches.ts', 'noBranches');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'end']);
    expect(edgeTriples(g)).toEqual([['n0', '', 'n1']]);
  });

  it('switch-statement: the switch is invisible, still a straight line (deliberate v1 gap)', () => {
    const g = graphOf('m2', 'switch-statement.ts', 'usesSwitch');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'end']);
    expect(edgeTriples(g)).toEqual([['n0', '', 'n1']]);
  });
});

describe('buildWorkflowGraph — M3 fixtures (try/catch around activities)', () => {
  it('a try/catch wrapping a destructured activity call becomes a decision', () => {
    const g = graphOf('m3', 'try-catch-around-activity.ts', 'chargeCardWorkflow');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'end']);
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'failure', 'n2'],
      ['n1', 'success', 'n2'],
    ]);
  });

  it('a try/catch wrapping a proxy-object activity call becomes a decision', () => {
    const g = graphOf('m3', 'try-catch-around-activity.ts', 'chargeCardViaObjectWorkflow');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'end']);
  });

  it('a try/catch wrapping an .executeWithOptions() call becomes a decision', () => {
    const g = graphOf('m3', 'try-catch-around-activity.ts', 'chargeCardWithOverrideWorkflow');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'end']);
  });

  it('a try/catch around non-activity code is transparent — no decision node, catch is not explored', () => {
    const g = graphOf('m3', 'try-catch-non-activity.ts', 'parseInputWorkflow');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'end']);
    expect(edgeTriples(g)).toEqual([['n0', '', 'n1']]);
  });

  it('real trimmed saga sample: two sequential activity try/catches, both reachable', () => {
    const g = graphOf('m3', 'real-saga-trimmed.ts', 'openAccount');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'decision', 'end']);
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'success', 'n2'],
      ['n1', 'failure', 'n3'],
      ['n2', 'failure', 'n3'],
      ['n2', 'success', 'n3'],
    ]);
  });
});

describe('buildWorkflowGraph — M4 fixtures (Promise.race / condition)', () => {
  it('a Promise.race([activityPromise, sleep(ms)]) becomes a success/timeout decision', () => {
    const g = graphOf('m4', 'timeout-race.ts', 'raceTimeoutWorkflow');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'end']);
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'success', 'n2'],
      ['n1', 'timeout', 'n2'],
    ]);
  });

  it('condition(fn) with no timeout becomes a single-edge wait decision', () => {
    const g = graphOf('m4', 'signal-condition.ts', 'signalConditionWorkflow');
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'signaled', 'n2'],
    ]);
  });

  it('condition(fn, timeout) becomes a two-edge signaled/timedOut decision', () => {
    const g = graphOf('m4', 'signal-condition.ts', 'signalConditionWithTimeoutWorkflow');
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'signaled', 'n2'],
      ['n1', 'timedOut', 'n2'],
    ]);
  });

  it('a race nested in an if and a condition() after a try/catch are both found, correctly wired, without crashing', () => {
    const g = graphOf('m4', 'combined-nested.ts', 'combinedWorkflow');
    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'decision', 'decision', 'decision', 'end']);
    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'true', 'n2'],
      ['n2', 'success', 'n3'],
      ['n2', 'timeout', 'n3'],
      ['n1', 'false', 'n3'],
      ['n3', 'success', 'n4'],
      ['n3', 'failure', 'n4'],
      ['n4', 'signaled', 'n5'],
    ]);
  });
});

describe('buildWorkflowGraph — M5: multiple functions and retry loops', () => {
  it('produces two independent graphs for two workflow functions in one file', () => {
    const first = graphOf('m5', 'two-functions.ts', 'firstWorkflow');
    const second = graphOf('m5', 'two-functions.ts', 'secondWorkflow');

    expect(first.functionName).toBe('firstWorkflow');
    expect(first.nodes.map((n) => n.kind)).toEqual(['start', 'end']);

    expect(second.functionName).toBe('secondWorkflow');
    expect(second.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'end']);

    // Each graph is built independently, starting its own node numbering.
    expect(first.startNodeId).toBe('n0');
    expect(second.startNodeId).toBe('n0');
  });

  it('represents a for-loop wrapping an activity call as a labeled "retry" back-edge, not an unrolled or dropped structure', () => {
    const g = graphOf('m5', 'retry-loop.ts', 'retryLoopWorkflow');

    expect(g.nodes.map((n) => n.kind)).toEqual(['start', 'decision', 'decision', 'end']);

    const backEdge = g.edges.find((e) => e.label === 'retry');
    expect(backEdge).toBeDefined();
    // The back-edge must point to the loop's own decision node (n1), forming a real cycle.
    expect(backEdge?.to).toBe('n1');

    expect(edgeTriples(g)).toEqual([
      ['n0', '', 'n1'],
      ['n1', 'iterate', 'n2'],
      ['n2', 'retry', 'n1'],
      ['n2', 'true', 'n3'],
      ['n1', 'exit', 'n3'],
    ]);
  });
});
