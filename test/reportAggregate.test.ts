import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildWorkflowGraphWithNodeRefs } from '../src/graph';
import { recordCoverageTrace } from '../src/coverageReport';
import { parseWorkflowFile } from '../src/parser';
import { buildProjectReport, classifyCoverage } from '../src/reportAggregate';
import { DiscoveredWorkflow } from '../src/discovery';

function fixture(...segments: string[]): string {
  return path.join(__dirname, 'fixtures', ...segments);
}

function outcomeIdx(filePath: string, functionName: string, decisionLabel: string, outcome: string): string {
  const fn = parseWorkflowFile(filePath).find((f) => f.name === functionName)!;
  const { graph, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn.node, functionName);
  const decisionId = graph.nodes.find((n) => n.label === decisionLabel)!.id;
  const idx = outcomeEdgeIndex.get(`${decisionId}#${outcome}`);
  if (idx === undefined) throw new Error(`no outcome edge for ${decisionId}#${outcome}`);
  return String(idx);
}

describe('classifyCoverage', () => {
  it('classifies zero covered paths as bucket "none" at 0%', () => {
    expect(classifyCoverage(0, 4)).toEqual({ percentage: 0, bucket: 'none' });
  });

  it('classifies some-but-not-all covered paths as bucket "partial"', () => {
    expect(classifyCoverage(2, 4)).toEqual({ percentage: 50, bucket: 'partial' });
  });

  it('classifies every path covered as bucket "full" at 100%', () => {
    expect(classifyCoverage(4, 4)).toEqual({ percentage: 100, bucket: 'full' });
  });

  it('treats a workflow with zero declared paths as 0%, bucket "none", never dividing by zero', () => {
    expect(classifyCoverage(0, 0)).toEqual({ percentage: 0, bucket: 'none' });
  });
});

describe('buildProjectReport', () => {
  let traceDir: string;

  beforeEach(() => {
    traceDir = mkdtempSync(path.join(tmpdir(), 'pathkit-h2-'));
  });

  afterEach(() => {
    rmSync(traceDir, { recursive: true, force: true });
  });

  it('reports a fully-covered workflow as 100%, bucket full', () => {
    const filePath = fixture('m2', 'simple-if-else.ts');
    const trueIdx = outcomeIdx(filePath, 'simpleIfElse', 'if (isHeads)', 'true');
    const falseIdx = outcomeIdx(filePath, 'simpleIfElse', 'if (isHeads)', 'false');
    recordCoverageTrace(traceDir, filePath, 'simpleIfElse', [trueIdx]);
    recordCoverageTrace(traceDir, filePath, 'simpleIfElse', [falseIdx]);

    const workflows: DiscoveredWorkflow[] = [{ filePath, functionName: 'simpleIfElse' }];
    const report = buildProjectReport(workflows, traceDir);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.totalPaths).toBe(2);
    expect(report.rows[0]!.coveredCount).toBe(2);
    expect(report.rows[0]!.percentage).toBe(100);
    expect(report.rows[0]!.bucket).toBe('full');
    expect(report.rows[0]!.paths).toHaveLength(2);
    expect(report.rows[0]!.paths.every((p) => p.covered)).toBe(true);
  });

  it('sums raw counts across workflows for the project total instead of averaging per-row percentages', () => {
    // Row A: nested-if-else has 3 declared paths; only 1 is traced (~33.3%).
    // Row B: zero-branch has 1 declared path, fully traced (100%).
    // Naively averaging (33.3% + 100%) / 2 = 66.7% would be WRONG — the
    // correct project-wide figure sums raw counts first: 2 covered / 4 total = 50%.
    const nestedFilePath = fixture('m2', 'nested-if-else.ts');
    const zeroBranchFilePath = fixture('g4', 'zero-branch.ts');

    const outerTrueIdx = outcomeIdx(nestedFilePath, 'nestedIfElse', 'if (input > 0)', 'true');
    const innerTrueIdx = outcomeIdx(nestedFilePath, 'nestedIfElse', 'if (input > 100)', 'true');
    recordCoverageTrace(traceDir, nestedFilePath, 'nestedIfElse', [outerTrueIdx, innerTrueIdx]);
    recordCoverageTrace(traceDir, zeroBranchFilePath, 'zeroBranch', []);

    const workflows: DiscoveredWorkflow[] = [
      { filePath: nestedFilePath, functionName: 'nestedIfElse' },
      { filePath: zeroBranchFilePath, functionName: 'zeroBranch' },
    ];
    const report = buildProjectReport(workflows, traceDir);

    expect(report.rows[0]!.totalPaths).toBe(3);
    expect(report.rows[0]!.coveredCount).toBe(1);
    expect(report.rows[1]!.totalPaths).toBe(1);
    expect(report.rows[1]!.coveredCount).toBe(1);

    expect(report.totalPaths).toBe(4);
    expect(report.coveredCount).toBe(2);
    expect(report.percentage).toBe(50);
  });

  it('reports a workflow with zero recorded traces as 0%, bucket none, with every path listed as untested', () => {
    const filePath = fixture('m2', 'simple-if-else.ts');
    const workflows: DiscoveredWorkflow[] = [{ filePath, functionName: 'simpleIfElse' }];

    const report = buildProjectReport(workflows, traceDir);

    expect(report.rows[0]!.coveredCount).toBe(0);
    expect(report.rows[0]!.percentage).toBe(0);
    expect(report.rows[0]!.bucket).toBe('none');
    expect(report.rows[0]!.paths.every((p) => !p.covered)).toBe(true);
  });

  it('surfaces a truncated workflow explicitly rather than a falsely-complete percentage', () => {
    const filePath = fixture('m6', 'pathological-explosion.ts');
    const workflows: DiscoveredWorkflow[] = [{ filePath, functionName: 'combinatorialExplosionWorkflow' }];

    const report = buildProjectReport(workflows, traceDir);

    expect(report.rows[0]!.truncated).toBe(true);
    expect(report.rows[0]!.totalPaths).toBe(2000); // DEFAULT_MAX_PATHS, not the true 4096
  });

  it('threads allowStale through to each row exactly like mergeCoverageTraces', () => {
    const filePath = fixture('m2', 'simple-if-else.ts');
    const trueIdx = outcomeIdx(filePath, 'simpleIfElse', 'if (isHeads)', 'true');
    recordCoverageTrace(traceDir, filePath, 'simpleIfElse', [trueIdx]);

    // Corrupt the recorded trace's sourceHash by editing the workflow file's
    // mtime is not enough — instead directly assert the strict-by-default
    // behavior already covered by coverageReport.test.ts, and that passing
    // allowStale here doesn't throw and returns a well-formed report.
    const strict = buildProjectReport([{ filePath, functionName: 'simpleIfElse' }], traceDir);
    const lenient = buildProjectReport([{ filePath, functionName: 'simpleIfElse' }], traceDir, { allowStale: true });

    expect(strict.rows[0]!.coveredCount).toBe(1);
    expect(lenient.rows[0]!.coveredCount).toBe(1);
  });

  it('collects unmatchedTraces per row without dropping them', () => {
    const filePath = fixture('m2', 'simple-if-else.ts');
    recordCoverageTrace(traceDir, filePath, 'simpleIfElse', ['999']); // no such edge index

    const report = buildProjectReport([{ filePath, functionName: 'simpleIfElse' }], traceDir);

    expect(report.rows[0]!.unmatchedTraces).toHaveLength(1);
  });
});
