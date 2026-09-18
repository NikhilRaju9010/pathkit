import {
  listTraceFiles,
  mergeCoverageTraces,
  MergeCoverageTracesOptions,
  NamedPathWithCoverage,
  UnmatchedTrace,
} from './coverageReport';
import { DiscoveredWorkflow } from './discovery';

export type CoverageBucket = 'full' | 'partial' | 'none';

/**
 * The single function that turns a (coveredCount, totalPaths) pair into a
 * percentage and a coloring/labeling bucket — used identically by every
 * per-workflow row and by the project-wide total in `buildProjectReport`,
 * so the two levels can never compute a percentage or bucket differently.
 * The percentage formula matches `mergeCoverageTraces`'s own inline
 * calculation exactly (0 for a zero-path workflow, never a division by
 * zero).
 *
 * `totalPaths === 0` is handled defensively (0%, bucket `'none'`) but is
 * unreachable for any real workflow through `buildProjectReport`'s actual
 * call path: `GraphBuilder.finalize` (`graph.ts`) always creates a distinct
 * `end` node and connects every remaining open edge into it, so even a
 * function with zero branches always yields exactly 1 declared path (see
 * `test/fixtures/g4/zero-branch.ts`'s use throughout Gap 2's tests, and
 * `paths.test.ts`'s "a function with no branches yields exactly 1 path").
 * `totalPaths: 0` therefore never needs its own bucket distinct from
 * `'none'` — there is no real input that could produce it.
 */
export function classifyCoverage(coveredCount: number, totalPaths: number): { percentage: number; bucket: CoverageBucket } {
  const percentage = totalPaths === 0 ? 0 : (coveredCount / totalPaths) * 100;
  const bucket: CoverageBucket = coveredCount === 0 ? 'none' : percentage === 100 ? 'full' : 'partial';
  return { percentage, bucket };
}

export interface WorkflowReportRow {
  filePath: string;
  functionName: string;
  totalPaths: number;
  coveredCount: number;
  percentage: number;
  bucket: CoverageBucket;
  truncated: boolean;
  paths: NamedPathWithCoverage[];
  unmatchedTraces: UnmatchedTrace[];
}

export interface ProjectReport {
  rows: WorkflowReportRow[];
  totalPaths: number;
  coveredCount: number;
  percentage: number;
  bucket: CoverageBucket;
}

export interface BuildProjectReportOptions {
  allowStale?: boolean;
}

/**
 * Combines Gap 1's path enumeration and Gap 2's coverage matching (both
 * reused unchanged, via `mergeCoverageTraces`) across every workflow
 * discovered in a project, producing one row per workflow plus a
 * project-wide total. The trace directory is read once (`listTraceFiles`)
 * and the same trace file list is passed to every `mergeCoverageTraces`
 * call — safe because it already silently skips any trace recorded for a
 * different function, exactly why one shared trace directory works for
 * many functions with no format change.
 *
 * The project-wide total is computed by summing each row's raw
 * `coveredCount`/`totalPaths` first and classifying once — never by
 * averaging already-rounded per-row percentages, which would silently
 * misreport the true total (e.g. a 1/3 row and a 1/1 row average to 66.7%,
 * but the correct combined figure is 2/4 = 50%).
 */
export function buildProjectReport(
  workflows: readonly DiscoveredWorkflow[],
  tracesDir: string,
  options: BuildProjectReportOptions = {},
): ProjectReport {
  const traceFilePaths = listTraceFiles(tracesDir);
  const mergeOptions: MergeCoverageTracesOptions = { allowStale: options.allowStale ?? false };

  const rows: WorkflowReportRow[] = workflows.map((workflow) => {
    const report = mergeCoverageTraces(workflow.filePath, workflow.functionName, traceFilePaths, mergeOptions);
    const { percentage, bucket } = classifyCoverage(report.coveredCount, report.totalPaths);

    return {
      filePath: workflow.filePath,
      functionName: workflow.functionName,
      totalPaths: report.totalPaths,
      coveredCount: report.coveredCount,
      percentage,
      bucket,
      truncated: report.truncated,
      paths: report.orderedPaths,
      unmatchedTraces: report.unmatchedTraces,
    };
  });

  const totalPaths = rows.reduce((sum, row) => sum + row.totalPaths, 0);
  const coveredCount = rows.reduce((sum, row) => sum + row.coveredCount, 0);
  const { percentage, bucket } = classifyCoverage(coveredCount, totalPaths);

  return { rows, totalPaths, coveredCount, percentage, bucket };
}
