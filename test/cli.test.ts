import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
function runCliSubprocess(args: string[], options?: { cwd?: string }): CliResult {
  const result = spawnSync(process.execPath, [BIN_PATH, ...args], { encoding: 'utf8', cwd: options?.cwd });
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

  it('a valid file exits 0 with a numbered plain-text path list on stdout by default', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm5', 'retry-loop.ts')]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Workflow: retryLoopWorkflow');
    expect(result.stdout).toContain('Total paths: 3');
    expect(result.stdout).toContain(
      "  1. Start -> for (let attempt = 1; attempt <= maxAttempts; attempt++) --iterate--> if (status === 'complete') --retry--> for (let attempt = 1; attempt <= maxAttempts; attempt++) --exit--> End",
    );
    expect(result.stdout).toContain(
      "  2. Start -> for (let attempt = 1; attempt <= maxAttempts; attempt++) --iterate--> if (status === 'complete') --true--> End",
    );
    expect(result.stdout).toContain('  3. Start -> for (let attempt = 1; attempt <= maxAttempts; attempt++) --exit--> End');
    expect(result.stdout).not.toContain('flowchart TD');
  });

  it('a valid file with --mermaid exits 0 with Mermaid output on stdout', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm5', 'retry-loop.ts'), '--mermaid']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Workflow: retryLoopWorkflow');
    expect(result.stdout).toContain('Total paths: 3');
    expect(result.stdout).toContain('flowchart TD');
    expect(result.stdout).not.toContain('  1. Start');
  });

  it('writes the report to disk when --out is passed', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pathkit-cli-test-'));
    const outPath = path.join(tmpDir, 'report.md');
    try {
      const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts'), '--out', outPath]);
      expect(result.exitCode).toBe(0);
      const written = readFileSync(outPath, 'utf8');
      expect(written).toContain('Workflow: simpleIfElse');
      expect(written).toContain('  1. Start');
      expect(written).toBe(result.stdout);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--summary prints only the workflow name and total path count, no per-path list', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm5', 'retry-loop.ts'), '--summary']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Workflow: retryLoopWorkflow');
    expect(result.stdout).toContain('Total paths: 3');
    expect(result.stdout).not.toContain('Start ->');
    expect(result.stdout).not.toContain('1.');
  });

  it('--limit caps how many path lines print and shows a note with the omitted count', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'i0', 'many-paths.ts'), '--limit', '3']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Total paths: 8');
    expect(result.stdout).toContain('  1. Start');
    expect(result.stdout).toContain('  2. Start');
    expect(result.stdout).toContain('  3. Start');
    expect(result.stdout).not.toContain('  4. Start');
    expect(result.stdout).toContain('... and 5 more paths (use --summary or increase --limit to see them)');
  });

  it('--limit greater than or equal to the total path count prints every path with no omission note', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'i0', 'many-paths.ts'), '--limit', '100']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('  8. Start');
    expect(result.stdout).not.toContain('more paths');
  });

  it('--summary and --limit together prints the summary and warns on stderr that --limit was ignored', () => {
    const result = runCliSubprocess([
      'analyze',
      path.join(FIXTURES_DIR, 'i0', 'many-paths.ts'),
      '--summary',
      '--limit',
      '3',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Total paths: 8');
    expect(result.stdout).not.toContain('Start ->');
    expect(result.stderr).toMatch(/--limit ignored because --summary was passed/i);
  });

  it('an invalid --limit value prints a clear error and exits non-zero', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'i0', 'many-paths.ts'), '--limit', 'nope']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/invalid --limit value/i);
  });

  describe('--html', () => {
    let cwd: string;

    beforeEach(() => {
      cwd = mkdtempSync(path.join(tmpdir(), 'pathkit-analyze-html-test-'));
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    it('writes .pathkit/report.html and .pathkit/report-data.json relative to cwd, containing the workflow', () => {
      const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts'), '--html'], { cwd });
      expect(result.exitCode).toBe(0);

      const htmlPath = path.join(cwd, '.pathkit', 'report.html');
      expect(existsSync(htmlPath)).toBe(true);
      const html = readFileSync(htmlPath, 'utf8');
      expect(html).toContain('<html');
      expect(html).toContain('simpleIfElse');
      expect(html).toContain('Analysis');
      expect(html).toContain('Coverage');

      const dataPath = path.join(cwd, '.pathkit', 'report-data.json');
      expect(existsSync(dataPath)).toBe(true);
      const store = JSON.parse(readFileSync(dataPath, 'utf8')) as { workflows: Record<string, unknown> };
      expect(Object.keys(store.workflows)).toHaveLength(1);
    });

    it('a second --html run on a different file leaves the first file\'s entry in the store untouched', () => {
      runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts'), '--html'], { cwd });
      const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm2', 'no-branches.ts'), '--html'], { cwd });
      expect(result.exitCode).toBe(0);

      const dataPath = path.join(cwd, '.pathkit', 'report-data.json');
      const store = JSON.parse(readFileSync(dataPath, 'utf8')) as { workflows: Record<string, unknown> };
      expect(Object.keys(store.workflows)).toHaveLength(2);

      const html = readFileSync(path.join(cwd, '.pathkit', 'report.html'), 'utf8');
      expect(html).toContain('simpleIfElse');
      expect(html).toContain('noBranches');
    });

    it('--html <custom-path> writes the HTML there, while the JSON store stays at the fixed .pathkit/ location', () => {
      const result = runCliSubprocess(
        ['analyze', path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts'), '--html', 'out/mine.html'],
        { cwd },
      );
      expect(result.exitCode).toBe(0);
      expect(existsSync(path.join(cwd, 'out', 'mine.html'))).toBe(true);
      expect(existsSync(path.join(cwd, '.pathkit', 'report.html'))).toBe(false);
      expect(existsSync(path.join(cwd, '.pathkit', 'report-data.json'))).toBe(true);
    });
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

  function writeTrace(
    fileName: string,
    workflowFilePath: string,
    functionName: string,
    rawTrace: string[],
    overrides: Record<string, unknown> = {},
  ): void {
    const trace = {
      schemaVersion: 1,
      workflowFile: workflowFilePath,
      functionName,
      sourceHash: computeSourceHash(readFileSync(workflowFilePath, 'utf8')),
      recordedAt: new Date().toISOString(),
      rawTrace,
      ...overrides,
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

  it('accepts --no-color as a real flag, not mistaking it for <dir> when it comes first', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);

    const result = runCliSubprocess(['report', '--no-color', reportFixturesDir, '--traces', tracesDir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('covered');
    expect(result.stdout).toContain('missed');
  });

  it('a piped (non-TTY) subprocess run never emits raw ANSI escape bytes, --no-color or not', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);

    const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toMatch(/\[/);
  });

  it('NO_COLOR env var does not break parsing or output', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);

    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('covered');
      expect(result.stdout).toContain('missed');
      expect(result.stdout).not.toMatch(/\[/);
    } finally {
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
    }
  });

  it('writes the same plain-text report content to disk when --out is passed', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);
    const outPath = path.join(tracesDir, 'report.txt');

    const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir, '--out', outPath]);

    expect(result.exitCode).toBe(0);
    const written = readFileSync(outPath, 'utf8');
    expect(written).toBe(result.stdout);
    expect(written).toContain('orderWorkflow');
    expect(written).not.toMatch(/\[/); // no ANSI bytes, even though this run is never a real TTY anyway
  });

  it('writes the same serialized JSON to disk when --out is passed with --json', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);
    const outPath = path.join(tracesDir, 'report.json');

    const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir, '--json', '--out', outPath]);

    expect(result.exitCode).toBe(0);
    const written = readFileSync(outPath, 'utf8');
    expect(written).toBe(result.stdout);
    expect(JSON.parse(written)).toHaveProperty('totalPaths', 5);
  });

  it('reports a stale-sourceHash trace as unmatched by default, but matches it when --allow-stale is passed', () => {
    const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
    writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx], { sourceHash: 'not-the-real-hash' });

    const strict = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir]);
    expect(strict.exitCode).toBe(0);
    expect(strict.stdout).toContain('0/2 paths');
    expect(strict.stderr).toMatch(/could not be matched|sourceHash/i);

    const lenient = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir, '--allow-stale']);
    expect(lenient.exitCode).toBe(0);
    expect(lenient.stdout).toContain('1/2 paths');
  });

  describe('--html', () => {
    let cwd: string;

    beforeEach(() => {
      cwd = mkdtempSync(path.join(tmpdir(), 'pathkit-report-html-test-'));
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    it('refreshes both tabs for every discovered workflow and appends one history entry', () => {
      const trueIdx = outcomeIdx(orderWorkflowFilePath, 'orderWorkflow', 'if (isHeads)', 'true');
      writeTrace('trace-1.json', orderWorkflowFilePath, 'orderWorkflow', [trueIdx]);

      const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir, '--html'], { cwd });
      expect(result.exitCode).toBe(0);

      const html = readFileSync(path.join(cwd, '.pathkit', 'report.html'), 'utf8');
      expect(html).toContain('orderWorkflow');
      expect(html).toContain('pollingWorkflow');
      expect(html).toMatch(/High|Medium|Low/);
      expect(html).toContain('covered');
      expect(html).toContain('missed');

      const history = JSON.parse(readFileSync(path.join(cwd, '.pathkit', 'report-history.json'), 'utf8')) as unknown[];
      expect(history).toHaveLength(1);
    });

    it('composes with --json: both the JSON on stdout and the HTML file are produced', () => {
      const result = runCliSubprocess(['report', reportFixturesDir, '--traces', tracesDir, '--html', '--json'], { cwd });
      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      expect(existsSync(path.join(cwd, '.pathkit', 'report.html'))).toBe(true);
    });
  });
});

describe('bin/pathkit report — .pathkitrc.json (Milestone K, real subprocess)', () => {
  const repoRoot = path.join(__dirname, '..');
  const h3Dir = path.join(FIXTURES_DIR, 'h3');
  const k0TracesDir = path.join(FIXTURES_DIR, 'k0', 'traces');
  const goldenDir = path.join(FIXTURES_DIR, 'k0', 'golden');

  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'pathkit-rc-test-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeRc = (config: unknown): void =>
    writeFileSync(path.join(cwd, '.pathkitrc.json'), typeof config === 'string' ? config : JSON.stringify(config));

  describe('zero-config regression: byte-identical to pre-milestone output', () => {
    // Golden files in test/fixtures/k0/golden/ were captured from the build
    // *before* any Milestone K change to src/cli.ts, run from the repo root.
    const cases: Array<[string, string[]]> = [
      ['text', ['report', 'test/fixtures/h3', '--traces', 'test/fixtures/k0/traces']],
      ['json', ['report', 'test/fixtures/h3', '--traces', 'test/fixtures/k0/traces', '--json']],
      ['no-traces', ['report', 'test/fixtures/h3']],
      ['no-dir', ['report', '--traces', 'test/fixtures/k0/traces']],
      ['bad-dir', ['report', 'test/fixtures/does-not-exist', '--traces', 'test/fixtures/k0/traces']],
      ['bad-traces', ['report', 'test/fixtures/h3', '--traces', 'test/fixtures/k0/nope']],
    ];

    it('runs in a directory with no .pathkitrc.json', () => {
      expect(existsSync(path.join(repoRoot, '.pathkitrc.json'))).toBe(false);
    });

    it.each(cases)('%s: stdout, stderr and exit code match the golden files exactly', (name, args) => {
      const result = runCliSubprocess(args, { cwd: repoRoot });
      expect(result.stdout).toBe(readFileSync(path.join(goldenDir, `${name}.out`), 'utf8'));
      expect(result.stderr).toBe(readFileSync(path.join(goldenDir, `${name}.err`), 'utf8'));
      expect(result.exitCode).toBe(Number(readFileSync(path.join(goldenDir, `${name}.exit`), 'utf8').trim()));
    });
  });

  it('a bare `pathkit report` picks up workflowsDir and traces from the config', () => {
    writeRc({ workflowsDir: h3Dir, traces: k0TracesDir });
    const result = runCliSubprocess(['report'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('5 paths total · 1 covered · 4 missed · 20.0% project coverage');
  });

  it('a CLI --traces flag overrides the config value', () => {
    writeRc({ workflowsDir: h3Dir, traces: path.join(cwd, 'does-not-exist') });
    const result = runCliSubprocess(['report', '--traces', k0TracesDir], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('1 covered');
  });

  it('a CLI positional <dir> overrides the config workflowsDir', () => {
    writeRc({ workflowsDir: path.join(cwd, 'does-not-exist'), traces: k0TracesDir });
    const result = runCliSubprocess(['report', h3Dir], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('5 paths total');
  });

  it('config supplying only one of the required values still yields the existing missing-argument error', () => {
    writeRc({ workflowsDir: h3Dir });
    const noTraces = runCliSubprocess(['report'], { cwd });
    expect(noTraces.exitCode).toBe(1);
    expect(noTraces.stderr).toContain('missing required --traces <dir> argument');

    writeRc({ traces: k0TracesDir });
    const noDir = runCliSubprocess(['report'], { cwd });
    expect(noDir.exitCode).toBe(1);
    expect(noDir.stderr).toContain('missing <dir> argument');
  });

  it('config json:true switches the output to JSON', () => {
    writeRc({ workflowsDir: h3Dir, traces: k0TracesDir, json: true });
    const result = runCliSubprocess(['report'], { cwd });
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as { totalPaths: number }).totalPaths).toBe(5);
  });

  it('config out writes the report to that path (relative to cwd)', () => {
    writeRc({ workflowsDir: h3Dir, traces: k0TracesDir, out: 'report.txt' });
    const result = runCliSubprocess(['report'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(cwd, 'report.txt'), 'utf8')).toBe(result.stdout);
  });

  it('config include keeps only the listed files', () => {
    writeRc({ workflowsDir: h3Dir, traces: k0TracesDir, include: ['order-workflow.ts'] });
    const result = runCliSubprocess(['report'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('orderWorkflow');
    expect(result.stdout).not.toContain('pollingWorkflow');
    expect(result.stdout).toContain('2 paths total · 1 covered');
  });

  it('a CLI --include flag overrides config include', () => {
    writeRc({ workflowsDir: h3Dir, traces: k0TracesDir, include: ['order-workflow.ts'] });
    const result = runCliSubprocess(['report', '--include', 'polling-workflow.ts'], { cwd });
    expect(result.stdout).toContain('pollingWorkflow');
    expect(result.stdout).not.toContain('orderWorkflow');
  });

  it('--include and --exclude work as plain CLI flags with no config, comma-separated', () => {
    const inc = runCliSubprocess(['report', h3Dir, '--traces', k0TracesDir, '--include', 'order-workflow.ts,polling-workflow.ts'], { cwd });
    expect(inc.stdout).toContain('5 paths total');
    const exc = runCliSubprocess(['report', h3Dir, '--traces', k0TracesDir, '--exclude', 'polling-workflow.ts'], { cwd });
    expect(exc.stdout).toContain('2 paths total');
    expect(exc.stdout).not.toContain('pollingWorkflow');
  });

  it('warns on stderr, without failing, when an include or exclude entry matches nothing', () => {
    const result = runCliSubprocess(
      ['report', h3Dir, '--traces', k0TracesDir, '--include', 'order-workflow.ts,ghost.ts', '--exclude', 'phantom.ts'],
      { cwd },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('ghost.ts');
    expect(result.stderr).toContain('phantom.ts');
    expect(result.stdout).toContain('orderWorkflow');
  });

  it('reports the existing "no exported workflow functions" error when the filter removes everything', () => {
    const result = runCliSubprocess(['report', h3Dir, '--traces', k0TracesDir, '--include', 'ghost.ts'], { cwd });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no exported workflow functions found');
  });

  it('fails clearly, naming the file, on a malformed config — never falling back to defaults', () => {
    writeRc('{ "traces": ');
    const result = runCliSubprocess(['report', h3Dir, '--traces', k0TracesDir], { cwd });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('.pathkitrc.json');
    expect(result.stderr).toContain('not valid JSON');
  });

  it('fails clearly on a wrong-typed config value', () => {
    writeRc({ include: 'order-workflow.ts' });
    const result = runCliSubprocess(['report', h3Dir, '--traces', k0TracesDir], { cwd });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('"include" must be an array of strings');
  });

  it('warns on stderr about an unknown config key (visible, not swallowed) but still runs', () => {
    writeRc({ workflowsDir: h3Dir, tracse: k0TracesDir, traces: k0TracesDir });
    const result = runCliSubprocess(['report'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('unknown key "tracse"');
    expect(result.stdout).toContain('5 paths total');
  });

  it('ignores a .pathkitrc.json in a parent directory (cwd only, no upward search)', () => {
    writeRc({ workflowsDir: h3Dir, traces: k0TracesDir });
    const child = path.join(cwd, 'child');
    mkdirSync(child);
    const result = runCliSubprocess(['report'], { cwd: child });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('missing <dir> argument');
  });

  it('does not affect analyze or coverage (report-only)', () => {
    writeRc('{ malformed');
    const result = runCliSubprocess(['analyze', path.join(h3Dir, 'order-workflow.ts')], { cwd });
    expect(result.exitCode).toBe(0);
  });
});
