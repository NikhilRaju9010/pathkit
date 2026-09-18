import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildWorkflowGraphWithNodeRefs } from '../src/graph';
import { computeSourceHash, CoverageTraceFile, mergeCoverageTraces, recordCoverageTrace } from '../src/coverageReport';
import { parseWorkflowFile } from '../src/parser';

/**
 * G8 is verified purely from hand-written trace files — no live Temporal
 * run needed (that's `test/coverage-e2e.test.ts`, which produces real raw
 * traces that this same merging logic then consumes in G9/G10).
 */

let traceDir: string;

beforeEach(() => {
  traceDir = mkdtempSync(path.join(tmpdir(), 'pathkit-g8-'));
});

afterEach(() => {
  rmSync(traceDir, { recursive: true, force: true });
});

function writeTraceFile(
  fileName: string,
  workflowFilePath: string,
  functionName: string,
  rawTrace: string[],
  overrides: Partial<CoverageTraceFile> = {},
): string {
  const trace: CoverageTraceFile = {
    schemaVersion: 1,
    workflowFile: workflowFilePath,
    functionName,
    sourceHash: computeSourceHash(readFileSync(workflowFilePath, 'utf8')),
    recordedAt: new Date().toISOString(),
    rawTrace,
    ...overrides,
  };
  const filePath = path.join(traceDir, fileName);
  writeFileSync(filePath, JSON.stringify(trace, null, 2), 'utf8');
  return filePath;
}

function outcomeIdx(filePath: string, functionName: string, decisionLabel: string, outcome: string): string {
  const fn = parseWorkflowFile(filePath).find((f) => f.name === functionName)!;
  const { graph, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn.node, functionName);
  const decisionId = graph.nodes.find((n) => n.label === decisionLabel)!.id;
  const idx = outcomeEdgeIndex.get(`${decisionId}#${outcome}`);
  if (idx === undefined) throw new Error(`no outcome edge for ${decisionId}#${outcome}`);
  return String(idx);
}

describe('mergeCoverageTraces — G8 (Gap 2)', () => {
  it('reports 1 covered / 2 total / 50% for a simple if/else with only one branch traced, naming the untested path', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const trueIdx = outcomeIdx(filePath, 'simpleIfElse', "if (isHeads)", 'true');
    writeTraceFile('trace-1.json', filePath, 'simpleIfElse', [trueIdx]);

    const report = mergeCoverageTraces(filePath, 'simpleIfElse', [path.join(traceDir, 'trace-1.json')]);

    expect(report.totalPaths).toBe(2);
    expect(report.coveredCount).toBe(1);
    expect(report.percentage).toBe(50);
    expect(report.truncated).toBe(false);
    expect(report.unmatchedTraces).toEqual([]);
    expect(report.untestedPaths).toHaveLength(1);
    expect(report.untestedPaths[0]!.description).toContain('false');
  });

  it('reports 1 covered / 1 total / 100% for a zero-branch function traced with an empty raw trace', () => {
    const filePath = path.join(__dirname, 'fixtures', 'g4', 'zero-branch.ts');
    writeTraceFile('trace-1.json', filePath, 'zeroBranch', []);

    const report = mergeCoverageTraces(filePath, 'zeroBranch', [path.join(traceDir, 'trace-1.json')]);

    expect(report.totalPaths).toBe(1);
    expect(report.coveredCount).toBe(1);
    expect(report.percentage).toBe(100);
    expect(report.untestedPaths).toEqual([]);
    expect(report.unmatchedTraces).toEqual([]);
  });

  it('collapses two independently-retried loops (different iteration counts) down to the one declared path that took both back-edges', () => {
    const filePath = path.join(__dirname, 'fixtures', 'g8', 'two-loops.ts');
    const iterateA = outcomeIdx(filePath, 'twoLoopsWorkflow', 'for (let i = 1; i <= maxA; i++)', 'iterate');
    const exitA = outcomeIdx(filePath, 'twoLoopsWorkflow', 'for (let i = 1; i <= maxA; i++)', 'exit');
    const iterateB = outcomeIdx(filePath, 'twoLoopsWorkflow', 'for (let j = 1; j <= maxB; j++)', 'iterate');
    const exitB = outcomeIdx(filePath, 'twoLoopsWorkflow', 'for (let j = 1; j <= maxB; j++)', 'exit');

    // Hand-written raw trace: loop A "ran" 3 times (iterateA x3) before
    // exiting, loop B "ran" 2 times (iterateB x2) before exiting — different
    // iteration counts for each independently-retried loop.
    const rawTrace = [iterateA, iterateA, iterateA, exitA, iterateB, iterateB, exitB];
    writeTraceFile('trace-1.json', filePath, 'twoLoopsWorkflow', rawTrace);

    const report = mergeCoverageTraces(filePath, 'twoLoopsWorkflow', [path.join(traceDir, 'trace-1.json')]);

    expect(report.unmatchedTraces).toEqual([]);
    expect(report.totalPaths).toBe(4); // 2 independent binary choices (loop A retried or not, loop B retried or not)
    expect(report.coveredCount).toBe(1);
    // The one covered path must be the one that takes BOTH loops' retry edges.
    expect(report.coveredPaths[0]!.edgeIndices).toEqual(
      expect.arrayContaining([Number(iterateA), Number(exitA), Number(iterateB), Number(exitB)]),
    );
  });

  it('exposes orderedPaths in the same order enumeratePaths declares them, each tagged with its covered flag', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const trueIdx = outcomeIdx(filePath, 'simpleIfElse', "if (isHeads)", 'true');
    writeTraceFile('trace-1.json', filePath, 'simpleIfElse', [trueIdx]);

    const report = mergeCoverageTraces(filePath, 'simpleIfElse', [path.join(traceDir, 'trace-1.json')]);

    expect(report.orderedPaths).toHaveLength(2);
    expect(report.orderedPaths[0]!.description).toContain('true');
    expect(report.orderedPaths[0]!.covered).toBe(true);
    expect(report.orderedPaths[1]!.description).toContain('false');
    expect(report.orderedPaths[1]!.covered).toBe(false);
  });

  it('reports a stale-sourceHash trace as unmatched by default, but matches it when allowStale is set', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const trueIdx = outcomeIdx(filePath, 'simpleIfElse', "if (isHeads)", 'true');
    writeTraceFile('trace-1.json', filePath, 'simpleIfElse', [trueIdx], { sourceHash: 'not-the-real-hash' });

    const strict = mergeCoverageTraces(filePath, 'simpleIfElse', [path.join(traceDir, 'trace-1.json')]);
    expect(strict.coveredCount).toBe(0);
    expect(strict.unmatchedTraces).toHaveLength(1);
    expect(strict.unmatchedTraces[0]!.reason).toMatch(/sourceHash/i);

    const lenient = mergeCoverageTraces(filePath, 'simpleIfElse', [path.join(traceDir, 'trace-1.json')], {
      allowStale: true,
    });
    expect(lenient.coveredCount).toBe(1);
    expect(lenient.unmatchedTraces).toEqual([]);
  });

  it('reports a trace with no matching declared path as unmatched, never silently dropped', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    writeTraceFile('trace-1.json', filePath, 'simpleIfElse', ['999']); // no such edge index

    const report = mergeCoverageTraces(filePath, 'simpleIfElse', [path.join(traceDir, 'trace-1.json')]);

    expect(report.coveredCount).toBe(0);
    expect(report.unmatchedTraces).toHaveLength(1);
    expect(report.unmatchedTraces[0]!.reason).toMatch(/does not correspond to any currently-declared path/);
  });

  it('rejects an unsupported schemaVersion as unmatched rather than guessing at its shape', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    writeTraceFile('trace-1.json', filePath, 'simpleIfElse', [], { schemaVersion: 2 as unknown as 1 });

    const report = mergeCoverageTraces(filePath, 'simpleIfElse', [path.join(traceDir, 'trace-1.json')]);

    expect(report.coveredCount).toBe(0);
    expect(report.unmatchedTraces).toHaveLength(1);
    expect(report.unmatchedTraces[0]!.reason).toMatch(/schemaVersion/);
  });

  it('silently skips (not an error) a trace file recorded for a different function', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    writeTraceFile('trace-1.json', filePath, 'someOtherFunction', []);

    const report = mergeCoverageTraces(filePath, 'simpleIfElse', [path.join(traceDir, 'trace-1.json')]);

    expect(report.coveredCount).toBe(0);
    expect(report.unmatchedTraces).toEqual([]); // skipped, not flagged as broken
  });

  it('reports malformed JSON as unmatched and keeps processing the remaining trace files', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const brokenPath = path.join(traceDir, 'broken.json');
    writeFileSync(brokenPath, '{ this is not valid JSON', 'utf8');

    const trueIdx = outcomeIdx(filePath, 'simpleIfElse', "if (isHeads)", 'true');
    const goodPath = writeTraceFile('good.json', filePath, 'simpleIfElse', [trueIdx]);

    const report = mergeCoverageTraces(filePath, 'simpleIfElse', [brokenPath, goodPath]);

    expect(report.coveredCount).toBe(1);
    expect(report.unmatchedTraces).toHaveLength(1);
    expect(report.unmatchedTraces[0]!.traceFilePath).toBe(brokenPath);
  });

  it('surfaces Gap 1s maxPaths truncation explicitly rather than reporting a clean percentage against a silently-incomplete total', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm6', 'pathological-explosion.ts');

    const report = mergeCoverageTraces(filePath, 'combinatorialExplosionWorkflow', []);

    expect(report.truncated).toBe(true);
    expect(report.totalPaths).toBe(2000); // DEFAULT_MAX_PATHS, not the true 4096
    expect(report.coveredCount).toBe(0);
    expect(report.percentage).toBe(0);
  });
});

describe('recordCoverageTrace — G10 (Gap 2)', () => {
  it('writes a trace file with a unique name and returns the path written', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const first = recordCoverageTrace(traceDir, filePath, 'simpleIfElse', ['1']);
    const second = recordCoverageTrace(traceDir, filePath, 'simpleIfElse', ['2']);

    expect(first).not.toBe(second);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
    expect(path.basename(first)).toMatch(/^simpleIfElse-.+\.json$/);
  });

  it('writes a schema-correct trace, with sourceHash computed from the real workflow file', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const traceFilePath = recordCoverageTrace(traceDir, filePath, 'simpleIfElse', ['1']);

    const written = JSON.parse(readFileSync(traceFilePath, 'utf8')) as CoverageTraceFile;
    expect(written.schemaVersion).toBe(1);
    expect(written.workflowFile).toBe(filePath);
    expect(written.functionName).toBe('simpleIfElse');
    expect(written.rawTrace).toEqual(['1']);
    expect(written.sourceHash).toBe(computeSourceHash(readFileSync(filePath, 'utf8')));
    expect(() => new Date(written.recordedAt).toISOString()).not.toThrow();
  });

  it('creates traceDir (including missing parent directories) if it does not exist yet', () => {
    const nestedDir = path.join(traceDir, 'does', 'not', 'exist', 'yet');
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');

    const traceFilePath = recordCoverageTrace(nestedDir, filePath, 'simpleIfElse', []);

    expect(existsSync(traceFilePath)).toBe(true);
  });

  it('round-trips directly into mergeCoverageTraces — the exact real usage pattern', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const fn = parseWorkflowFile(filePath).find((f) => f.name === 'simpleIfElse')!;
    const { graph, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn.node, 'simpleIfElse');
    const decisionId = graph.nodes.find((n) => n.kind === 'decision')!.id;
    const trueIdx = String(outcomeEdgeIndex.get(`${decisionId}#true`));

    recordCoverageTrace(traceDir, filePath, 'simpleIfElse', [trueIdx]);

    const traceFilePaths = readdirSync(traceDir).map((name) => path.join(traceDir, name));
    const report = mergeCoverageTraces(filePath, 'simpleIfElse', traceFilePaths);

    expect(report.unmatchedTraces).toEqual([]);
    expect(report.coveredCount).toBe(1);
    expect(report.percentage).toBe(50);
  });
});
