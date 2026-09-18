import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { buildWorkflowGraph, WorkflowGraph } from '../src/graph';
import { describePath, enumeratePaths, enumeratePathsWithEdgeIndices, PathEnumerationResult } from '../src/paths';

function graphOf(milestone: string, fileName: string, functionName: string): WorkflowGraph {
  const filePath = path.join(__dirname, 'fixtures', milestone, fileName);
  const parsed = parseWorkflowFile(filePath);
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new Error(`fixture ${milestone}/${fileName} has no exported function named ${functionName}`);
  }
  return buildWorkflowGraph(fn.node, fn.name);
}

function pathsOf(milestone: string, fileName: string, functionName: string, maxPaths?: number): PathEnumerationResult {
  const graph = graphOf(milestone, fileName, functionName);
  return maxPaths === undefined ? enumeratePaths(graph) : enumeratePaths(graph, maxPaths);
}

describe('enumeratePaths — acyclic fixtures from M2–M4', () => {
  it('a plain if/else fixture yields exactly 2 paths', () => {
    const result = pathsOf('m2', 'simple-if-else.ts', 'simpleIfElse');
    expect(result.truncated).toBe(false);
    expect(result.paths).toEqual([
      ['', 'true'],
      ['', 'false'],
    ]);
  });

  it('an if with no else still yields exactly 2 paths (the implicit else falls through)', () => {
    const result = pathsOf('m2', 'if-no-else.ts', 'ifNoElse');
    expect(result.paths).toHaveLength(2);
  });

  it('a nested if/else yields the correctly multiplied (non-symmetric) count', () => {
    const result = pathsOf('m2', 'nested-if-else.ts', 'nestedIfElse');
    expect(result.truncated).toBe(false);
    expect(result.paths).toEqual([
      ['', 'true', 'true'],
      ['', 'true', 'false'],
      ['', 'false'],
    ]);
  });

  it('a function with no branches yields exactly 1 path', () => {
    const result = pathsOf('m2', 'no-branches.ts', 'noBranches');
    expect(result.paths).toEqual([['']]);
  });

  it('a real trimmed saga sample with two sequential activity try/catches yields 3 paths', () => {
    const result = pathsOf('m3', 'real-saga-trimmed.ts', 'openAccount');
    expect(result.truncated).toBe(false);
    expect(result.paths).toEqual([
      ['', 'success', 'failure'],
      ['', 'success', 'success'],
      ['', 'failure'],
    ]);
  });

  it('a combined race-inside-if plus condition-after-try/catch fixture yields 6 paths without crashing', () => {
    const result = pathsOf('m4', 'combined-nested.ts', 'combinedWorkflow');
    expect(result.truncated).toBe(false);
    expect(result.paths).toHaveLength(6);
  });
});

describe('enumeratePaths — cyclic retry-loop fixture (M5)', () => {
  it('terminates quickly and produces a retry-taken / retry-not-taken set of paths, not a hang', () => {
    const graph = graphOf('m5', 'retry-loop.ts', 'retryLoopWorkflow');

    const start = Date.now();
    const result = enumeratePaths(graph);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(result.truncated).toBe(false);

    const withRetry = result.paths.filter((p) => p.includes('retry'));
    const withoutRetry = result.paths.filter((p) => !p.includes('retry'));
    expect(withRetry.length).toBeGreaterThan(0);
    expect(withoutRetry.length).toBeGreaterThan(0);

    expect(result.paths).toEqual([
      ['', 'iterate', 'retry', 'exit'],
      ['', 'iterate', 'true'],
      ['', 'exit'],
    ]);
  });

  it('never traverses the same edge twice within a single path (the mechanism that prevents hangs)', () => {
    const result = pathsOf('m5', 'retry-loop.ts', 'retryLoopWorkflow');
    for (const singlePath of result.paths) {
      // A path containing the retry back-edge exactly once, and not
      // repeated, is exactly what "loop taken once, not unrolled
      // indefinitely" looks like at the path level.
      const retryCount = singlePath.filter((label) => label === 'retry').length;
      expect(retryCount).toBeLessThanOrEqual(1);
    }
  });
});

describe('enumeratePaths — maxPaths cap (M6)', () => {
  it('truncates a large combinatorial (but acyclic) graph instead of hanging or crashing', () => {
    const graph = graphOf('m6', 'pathological-explosion.ts', 'combinatorialExplosionWorkflow');

    const start = Date.now();
    const result = enumeratePaths(graph);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(2000);
    expect(result.truncated).toBe(true);
    expect(result.paths).toHaveLength(2000);
  });

  it('respects a custom, lower maxPaths value', () => {
    const result = pathsOf('m6', 'pathological-explosion.ts', 'combinatorialExplosionWorkflow', 10);
    expect(result.truncated).toBe(true);
    expect(result.paths).toHaveLength(10);
  });

  it('does not report truncation when a graph has fewer paths than the cap', () => {
    const result = pathsOf('m2', 'simple-if-else.ts', 'simpleIfElse', 10);
    expect(result.truncated).toBe(false);
    expect(result.paths).toHaveLength(2);
  });
});

describe('describePath', () => {
  it('describes a flat if/else path as a human-readable Start -> ... chain', () => {
    const graph = graphOf('m2', 'simple-if-else.ts', 'simpleIfElse');
    const { paths } = enumeratePathsWithEdgeIndices(graph);
    const truePath = paths.find((p) => p.labels.includes('true'));
    expect(truePath).toBeDefined();

    const description = describePath(graph, truePath!.edgeIndices);
    expect(description).toBe("Start -> if (isHeads) --true--> End");
  });

  it('describes a Start-only path (no branches) with no arrows at all', () => {
    const graph = graphOf('m2', 'no-branches.ts', 'noBranches');
    const { paths } = enumeratePathsWithEdgeIndices(graph);
    expect(paths).toHaveLength(1);

    const description = describePath(graph, paths[0]!.edgeIndices);
    expect(description).toBe('Start -> End');
  });
});
