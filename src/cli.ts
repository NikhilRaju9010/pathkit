import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorkflowGraph } from './graph';
import { colorize, shouldColorize } from './color';
import { CoverageReport, listTraceFiles, mergeCoverageTraces } from './coverageReport';
import { discoverWorkflows } from './discovery';
import { PathKitError } from './errors';
import { renderMermaid } from './mermaid';
import { ParsedWorkflowFunction, parseWorkflowFile } from './parser';
import { DEFAULT_MAX_PATHS, enumeratePaths } from './paths';
import { buildProjectReport, ProjectReport, WorkflowReportRow } from './reportAggregate';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Whether stdout is a real terminal — used only by `report` to decide whether to colorize. Omit (or leave undefined) for a non-TTY sink (a pipe, a test harness). */
  isTTY?: boolean;
}

/**
 * Runs the CLI given argv (already stripped of `node`/script name) and I/O
 * sinks, returning the process exit code. Kept as a plain function (not
 * wired directly to `process`) so it can be exercised directly in tests as
 * well as from `bin/pathkit`.
 */
export function runCli(argv: string[], io: CliIO): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    io.stdout(`${getPackageVersion()}\n`);
    return 0;
  }

  const [command, ...rest] = argv;

  if (command === 'analyze') {
    return runAnalyze(rest, io);
  }
  if (command === 'coverage') {
    return runCoverage(rest, io);
  }
  if (command === 'report') {
    return runReport(rest, io);
  }

  io.stderr(
    'pathkit: unknown or missing command. Supported:\n' +
      '  --version\n' +
      '  analyze <file> [--out <path>]\n' +
      '  coverage <file> --traces <dir> [--function <name>] [--out <path>] [--json] [--allow-stale] [--clean]\n' +
      '  report <dir> --traces <dir> [--out <path>] [--json] [--no-color] [--allow-stale]\n',
  );
  return 1;
}

function runAnalyze(args: string[], io: CliIO): number {
  const { filePath, outPath } = parseAnalyzeArgs(args);

  if (filePath === undefined) {
    io.stderr('pathkit analyze: missing <file> argument. Usage: pathkit analyze <file> [--out <path>]\n');
    return 1;
  }

  let functions: ParsedWorkflowFunction[];
  try {
    functions = parseWorkflowFile(filePath);
  } catch (err) {
    if (err instanceof PathKitError) {
      io.stderr(`pathkit analyze: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (functions.length === 0) {
    io.stderr(`pathkit analyze: ${filePath} has no exported workflow functions to analyze.\n`);
    return 1;
  }

  const report = functions
    .map((fn) => {
      const graph = buildWorkflowGraph(fn.node, fn.name);
      const pathResult = enumeratePaths(graph);
      const mermaidText = renderMermaid(graph);
      const totalPathsLine = pathResult.truncated
        ? `Total paths: ${pathResult.paths.length}+ (truncated at maxPaths=${DEFAULT_MAX_PATHS})`
        : `Total paths: ${pathResult.paths.length}`;

      return `Workflow: ${fn.name}\n${totalPathsLine}\n\n\`\`\`mermaid\n${mermaidText}\n\`\`\`\n`;
    })
    .join('\n');

  io.stdout(report);

  if (outPath !== undefined) {
    writeFileSync(outPath, report, 'utf8');
  }

  return 0;
}

function parseAnalyzeArgs(args: string[]): { filePath: string | undefined; outPath: string | undefined } {
  let outPath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      outPath = args[i + 1];
      i++;
    } else {
      const value = args[i];
      if (value !== undefined) positional.push(value);
    }
  }

  return { filePath: positional[0], outPath };
}

interface CoverageArgs {
  filePath: string | undefined;
  tracesDir: string | undefined;
  functionName: string | undefined;
  outPath: string | undefined;
  json: boolean;
  allowStale: boolean;
  clean: boolean;
}

function runCoverage(args: string[], io: CliIO): number {
  const usage =
    'Usage: pathkit coverage <file> --traces <dir> [--function <name>] [--out <path>] [--json] [--allow-stale] [--clean]\n';
  const { filePath, tracesDir, functionName: requestedFunctionName, outPath, json, allowStale, clean } =
    parseCoverageArgs(args);

  if (filePath === undefined) {
    io.stderr(`pathkit coverage: missing <file> argument. ${usage}`);
    return 1;
  }
  if (tracesDir === undefined) {
    io.stderr(`pathkit coverage: missing required --traces <dir> argument. ${usage}`);
    return 1;
  }

  let functionName: string;
  try {
    if (requestedFunctionName !== undefined) {
      functionName = requestedFunctionName;
    } else {
      const functions = parseWorkflowFile(filePath);
      if (functions.length === 0) {
        io.stderr(`pathkit coverage: ${filePath} has no exported workflow functions.\n`);
        return 1;
      }
      if (functions.length > 1) {
        io.stderr(
          `pathkit coverage: ${filePath} has multiple exported workflow functions ` +
            `(${functions.map((f) => f.name).join(', ')}); pass --function <name> to pick one.\n`,
        );
        return 1;
      }
      functionName = functions[0]!.name;
    }
  } catch (err) {
    if (err instanceof PathKitError) {
      io.stderr(`pathkit coverage: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  let traceFilePaths: string[];
  try {
    traceFilePaths = listTraceFiles(tracesDir);
  } catch (err) {
    if (err instanceof PathKitError) {
      io.stderr(`pathkit coverage: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  let report: CoverageReport;
  try {
    report = mergeCoverageTraces(filePath, functionName, traceFilePaths, { allowStale });
  } catch (err) {
    if (err instanceof PathKitError) {
      io.stderr(`pathkit coverage: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  const output = json ? `${JSON.stringify(report, null, 2)}\n` : formatCoverageReportText(report);
  io.stdout(output);

  if (outPath !== undefined) {
    writeFileSync(outPath, output, 'utf8');
  }

  if (report.unmatchedTraces.length > 0) {
    io.stderr(
      `pathkit coverage: ${report.unmatchedTraces.length} trace file(s) could not be matched:\n` +
        report.unmatchedTraces.map((u) => `  - ${u.traceFilePath}: ${u.reason}\n`).join(''),
    );
  }

  if (clean) {
    for (const traceFilePath of traceFilePaths) {
      rmSync(traceFilePath, { force: true });
    }
  }

  return 0;
}

function formatCoverageReportText(report: CoverageReport): string {
  const totalPathsLine = report.truncated
    ? `Total paths: ${report.totalPaths}+ (truncated at maxPaths=${DEFAULT_MAX_PATHS})`
    : `Total paths: ${report.totalPaths}`;

  const lines = [
    `Workflow function: ${report.functionName}`,
    totalPathsLine,
    `Covered: ${report.coveredCount}/${report.totalPaths} (${report.percentage.toFixed(1)}%)`,
    '',
    'Covered paths:',
    ...(report.coveredPaths.length > 0 ? report.coveredPaths.map((p) => `  - ${p.description}`) : ['  (none)']),
    '',
    'Untested paths:',
    ...(report.untestedPaths.length > 0 ? report.untestedPaths.map((p) => `  - ${p.description}`) : ['  (none)']),
  ];
  return `${lines.join('\n')}\n`;
}

function parseCoverageArgs(args: string[]): CoverageArgs {
  let tracesDir: string | undefined;
  let functionName: string | undefined;
  let outPath: string | undefined;
  let json = false;
  let allowStale = false;
  let clean = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--traces') {
      tracesDir = args[++i];
    } else if (arg === '--function') {
      functionName = args[++i];
    } else if (arg === '--out') {
      outPath = args[++i];
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--allow-stale') {
      allowStale = true;
    } else if (arg === '--clean') {
      clean = true;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }

  return { filePath: positional[0], tracesDir, functionName, outPath, json, allowStale, clean };
}

interface ReportArgs {
  dir: string | undefined;
  tracesDir: string | undefined;
  outPath: string | undefined;
  json: boolean;
  noColor: boolean;
  allowStale: boolean;
}

function runReport(args: string[], io: CliIO): number {
  const usage = 'Usage: pathkit report <dir> --traces <dir> [--out <path>] [--json] [--no-color] [--allow-stale]\n';
  const { dir, tracesDir, outPath, json, noColor, allowStale } = parseReportArgs(args);

  if (dir === undefined) {
    io.stderr(`pathkit report: missing <dir> argument. ${usage}`);
    return 1;
  }
  if (tracesDir === undefined) {
    io.stderr(`pathkit report: missing required --traces <dir> argument. ${usage}`);
    return 1;
  }

  let discovered: ReturnType<typeof discoverWorkflows>;
  try {
    discovered = discoverWorkflows(dir);
  } catch (err) {
    if (err instanceof PathKitError) {
      io.stderr(`pathkit report: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (discovered.workflows.length === 0) {
    io.stderr(`pathkit report: no exported workflow functions found under ${dir}.\n`);
    return 1;
  }

  let report: ProjectReport;
  try {
    report = buildProjectReport(discovered.workflows, tracesDir, { allowStale });
  } catch (err) {
    if (err instanceof PathKitError) {
      io.stderr(`pathkit report: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  const colorEnabled = shouldColorize(io.isTTY, noColor);
  const output = json ? `${JSON.stringify(report, null, 2)}\n` : formatReportText(report, colorEnabled);
  io.stdout(output);

  if (outPath !== undefined) {
    // Always plain, uncolored text on disk, regardless of this run's own
    // terminal color state — a file is not a terminal. `--json` output has
    // no color to begin with, so it's written as-is.
    const fileOutput = json ? output : formatReportText(report, false);
    writeFileSync(outPath, fileOutput, 'utf8');
  }

  const warnings = [
    ...discovered.warnings.map((w) => `  - ${w.filePath}: ${w.error}`),
    ...report.rows.flatMap((row) => row.unmatchedTraces.map((u) => `  - ${u.traceFilePath}: ${u.reason}`)),
  ];
  if (warnings.length > 0) {
    io.stderr(`pathkit report: ${warnings.length} warning(s):\n${warnings.join('\n')}\n`);
  }

  return 0;
}

function formatReportText(report: ProjectReport, colorEnabled: boolean): string {
  const rowBlocks = report.rows.map((row) => formatReportRowText(row, colorEnabled));
  const missedCount = report.totalPaths - report.coveredCount;
  const totalLine =
    `${report.totalPaths} paths total · ${report.coveredCount} covered · ` +
    `${missedCount} missed · ${report.percentage.toFixed(1)}% project coverage`;

  return `${[...rowBlocks, totalLine].join('\n\n')}\n`;
}

function formatReportRowText(row: WorkflowReportRow, colorEnabled: boolean): string {
  const subtotalLine = row.truncated
    ? `${row.coveredCount}/${row.totalPaths}+ paths (truncated at maxPaths=${DEFAULT_MAX_PATHS}) · ${row.percentage.toFixed(1)}%`
    : `${row.coveredCount}/${row.totalPaths} paths · ${row.percentage.toFixed(1)}%`;

  const pathLines =
    row.paths.length > 0
      ? row.paths.map((p) => {
          const status = colorize(p.covered ? 'covered' : 'missed', p.covered ? 'covered' : 'missed', colorEnabled);
          return `  - ${p.description}: ${status}`;
        })
      : ['  (no declared paths)'];

  return [`${row.functionName} (${row.filePath})`, subtotalLine, ...pathLines].join('\n');
}

function parseReportArgs(args: string[]): ReportArgs {
  let tracesDir: string | undefined;
  let outPath: string | undefined;
  let json = false;
  let noColor = false;
  let allowStale = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--traces') {
      tracesDir = args[++i];
    } else if (arg === '--out') {
      outPath = args[++i];
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--no-color') {
      noColor = true;
    } else if (arg === '--allow-stale') {
      allowStale = true;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }

  return { dir: positional[0], tracesDir, outPath, json, noColor, allowStale };
}

function getPackageVersion(): string {
  // dist/cli.js sits one level below the package root, same depth as bin/pathkit.
  const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}
