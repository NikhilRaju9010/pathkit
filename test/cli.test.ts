import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const BIN_PATH = path.join(__dirname, '..', 'bin', 'pathkit');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCliSubprocess(args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [BIN_PATH, ...args], { encoding: 'utf8' });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const execErr = err as { status: number | null; stdout: string; stderr: string };
    return { exitCode: execErr.status ?? 1, stdout: execErr.stdout, stderr: execErr.stderr };
  }
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
