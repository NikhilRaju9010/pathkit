import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { computeSourceHash } from '../src/coverageReport';
import { buildWorkflowGraphWithNodeRefs } from '../src/graph';
import { parseWorkflowFile } from '../src/parser';

const BIN_PATH = path.join(__dirname, '..', 'bin', 'pathkit');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * `execFileSync` only exposes stderr via the thrown error on a non-zero
 * exit — on success it discards it entirely, which doesn't work for
 * commands (like `coverage`) that can print warnings to stderr on a
 * successful (exit 0) run. `spawnSync` captures both streams unconditionally
 * regardless of exit code.
 */
function runCliSubprocess(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [BIN_PATH, ...args], { encoding: 'utf8' });
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

describe('bin/pathkit CLI (real subprocess)', () => {
  it('--version prints the package version and exits 0', () => {
    const result = runCliSubprocess(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('a nonexistent file path prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm1', 'does-not-exist.ts')]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/not found/i);
  });

  it('a syntactically invalid TS file prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm1', 'invalid-syntax.ts')]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/invalid typescript syntax/i);
  });

  it('a file with zero exported functions prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm1', 'no-exported-functions.ts')]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/no exported workflow functions/i);
  });

  it('a valid file exits 0 with Mermaid output on stdout', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm5', 'retry-loop.ts')]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Workflow: retryLoopWorkflow');
    expect(result.stdout).toContain('flowchart TD');
    expect(result.stdout).toContain('Total paths: 3');
  });

  it('writes the report to disk when --out is passed', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pathkit-cli-test-'));
    const outPath = path.join(tmpDir, 'report.md');
    try {
      const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts'), '--out', outPath]);
      expect(result.exitCode).toBe(0);
      const written = readFileSync(outPath, 'utf8');
      expect(written).toContain('Workflow: simpleIfElse');
      expect(written).toContain('flowchart TD');
      expect(written).toBe(result.stdout);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('an unknown/missing command prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess([]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/unknown or missing command/i);
  });
});

describe('bin/pathkit coverage (real subprocess)', () => {
  // Every test here uses its own freshly-created temp directory — never a
  // path resembling the real project's .pathkit/coverage/ — since --clean
  // performs a real destructive delete and must never risk a real directory.
  let tracesDir: string;

  beforeEach(() => {
    tracesDir = mkdtempSync(path.join(tmpdir(), 'pathkit-coverage-cli-test-'));
  });

  afterEach(() => {
    rmSync(tracesDir, { recursive: true, force: true });
  });

  function writeTrace(fileName: string, workflowFilePath: string, functionName: string, rawTrace: string[]): string {
    const trace = {
      schemaVersion: 1,
      workflowFile: workflowFilePath,
      functionName,
      sourceHash: computeSourceHash(readFileSync(workflowFilePath, 'utf8')),
      recordedAt: new Date().toISOString(),
      rawTrace,
    };
    const filePath = path.join(tracesDir, fileName);
    writeFileSync(filePath, JSON.stringify(trace), 'utf8');
    return filePath;
  }

  it('prints a human-readable text report by default', () => {
    const workflowFilePath = path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts');
    writeTrace('trace-1.json', workflowFilePath, 'simpleIfElse', ['1']);

    const result = runCliSubprocess(['coverage', workflowFilePath, '--traces', tracesDir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Workflow function: simpleIfElse');
    expect(result.stdout).toContain('Total paths: 2');
    expect(result.stdout).toContain('Covered: 1/2 (50.0%)');
    expect(result.stdout).toContain('Covered paths:');
    expect(result.stdout).toContain('Untested paths:');
  });

  it('prints the serialized CoverageReport when --json is passed', () => {
    const workflowFilePath = path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts');
    writeTrace('trace-1.json', workflowFilePath, 'simpleIfElse', ['1']);

    const result = runCliSubprocess(['coverage', workflowFilePath, '--traces', tracesDir, '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { functionName: string; coveredCount: number; totalPaths: number };
    expect(parsed.functionName).toBe('simpleIfElse');
    expect(parsed.coveredCount).toBe(1);
    expect(parsed.totalPaths).toBe(2);
  });

  it('writes the same report content to disk when --out is passed', () => {
    const workflowFilePath = path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts');
    writeTrace('trace-1.json', workflowFilePath, 'simpleIfElse', ['1']);
    const outPath = path.join(tracesDir, 'report.txt');

    const result = runCliSubprocess(['coverage', workflowFilePath, '--traces', tracesDir, '--out', outPath]);

    expect(result.exitCode).toBe(0);
    const written = readFileSync(outPath, 'utf8');
    expect(written).toBe(result.stdout);
    expect(written).toContain('Workflow function: simpleIfElse');
  });

  it('deletes every trace file in the directory when --clean is passed', () => {
    const workflowFilePath = path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts');
    writeTrace('trace-1.json', workflowFilePath, 'simpleIfElse', ['1']);
    writeTrace('trace-2.json', workflowFilePath, 'simpleIfElse', ['2']);

    const result = runCliSubprocess(['coverage', workflowFilePath, '--traces', tracesDir, '--clean']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Covered: 2/2 (100.0%)'); // report is built before cleaning
    expect(readdirSync(tracesDir)).toEqual([]);
    expect(existsSync(tracesDir)).toBe(true); // the directory itself is left in place, only its files are removed
  });

  it('prints unmatched-trace warnings to stderr even in --json mode, without failing the command', () => {
    const workflowFilePath = path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts');
    writeTrace('trace-1.json', workflowFilePath, 'simpleIfElse', ['999']); // no such declared path

    const result = runCliSubprocess(['coverage', workflowFilePath, '--traces', tracesDir, '--json']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/could not be matched/i);
    const parsed = JSON.parse(result.stdout) as { unmatchedTraces: unknown[] };
    expect(parsed.unmatchedTraces).toHaveLength(1);
  });

  it('requires --function when the workflow file has more than one exported function', () => {
    const workflowFilePath = path.join(FIXTURES_DIR, 'm3', 'try-catch-around-activity.ts');

    const result = runCliSubprocess(['coverage', workflowFilePath, '--traces', tracesDir]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/multiple exported workflow functions/i);
  });

  it('a missing --traces directory prints a clear error and exits non-zero', () => {
    const workflowFilePath = path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts');
    const result = runCliSubprocess(['coverage', workflowFilePath, '--traces', path.join(tracesDir, 'does-not-exist')]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/could not read traces directory/i);
  });
});

describe('bin/pathkit report (real subprocess)', () => {
  const reportFixturesDir = path.join(FIXTURES_DIR, 'h3');
  const orderWorkflowFilePath = path.join(reportFixturesDir, 'order-workflow.ts');

  let tracesDir: string;

  beforeEach(() => {
    tracesDir = mkdtempSync(path.join(tmpdir(), 'pathkit-report-cli-test-'));
  });

  afterEach(() => {
    rmSync(tracesDir, { recursive: true, force: true });
  });

  function writeTrace(fileName: string, workflowFilePath: string, functionName: string, rawTrace: string[]): void {
    const trace = {
      schemaVersion: 1,
      workflowFile: workflowFilePath,
      functionName,
      sourceHash: computeSourceHash(readFileSync(workflowFilePath, 'utf8')),
      recordedAt: new Date().toISOString(),
      rawTrace,
    };
    writeFileSync(path.join(tracesDir, fileName), JSON.stringify(trace), 'utf8');
  }

  function outcomeIdx(filePath: string, functionName: string, decisionLabel: string, outcome: string): string {
    const fn = parseWorkflowFile(filePath).find((f) => f.name === functionName)!;
    const { graph, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn.node, functionName);
    const decisionId = graph.nodes.find((n) => n.label === decisionLabel)!.id;
    const idx = outcomeEdgeIndex.get(`${decisionId}#${outcome}`);
    if (idx === undefined) throw new Error(`no outcome edge for ${decisionId}#${outcome}`);
    return String(idx);
  }

  it('lists every declared path per workflow, marked covered/missed, plus per-workflow and project-wide totals', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);
    // pollingWorkflow gets zero traces — fully untested.

    const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('orderWorkflow');
    expect(result.stdout).toContain('1/2 paths');
    expect(result.stdout).toContain('50.0%');
    expect(result.stdout).toContain('covered');
    expect(result.stdout).toContain('missed');
    expect(result.stdout).toContain('pollingWorkflow');
    expect(result.stdout).toContain('0/3 paths');
    // project-wide total: 1 covered / 5 total (2 + 3) paths
    expect(result.stdout).toContain('5 paths total');
    expect(result.stdout).toContain('1 covered');
    expect(result.stdout).toContain('4 missed');
    expect(result.stdout).toContain('20.0% project coverage');
  });

  it('prints the serialized ProjectReport when --json is passed', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);

    const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir, '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { totalPaths: number; coveredCount: number; rows: unknown[] };
    expect(parsed.totalPaths).toBe(5);
    expect(parsed.coveredCount).toBe(1);
    expect(parsed.rows).toHaveLength(2);
  });

  it('missing <dir> argument prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['report', '--traces', tracesDir]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/missing <dir>/i);
  });

  it('missing --traces argument prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['report', reportFixturesDir]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/missing required --traces/i);
  });

  it('a <dir> that is actually a file prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['report', orderWorkflowFilePath, '--traces', tracesDir]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/not a directory/i);
  });

  it('a nonexistent <dir> prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['report', path.join(reportFixturesDir, 'does-not-exist'), '--traces', tracesDir]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/directory not found/i);
  });
});
