import * as path from 'node:path';
import { discoverWorkflows } from '../src/discovery';
import { PathKitError } from '../src/errors';

const fixtureDir = path.join(__dirname, 'fixtures', 'h0');
const relativeTo = (absolutePath: string): string => path.relative(process.cwd(), absolutePath);

describe('discoverWorkflows', () => {
  it('finds every exported function across a nested directory tree, sorted deterministically', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows).toEqual([
      { filePath: relativeTo(path.join(fixtureDir, 'nested', 'deep', 'report.ts')), functionName: 'reportWorkflow' },
      { filePath: relativeTo(path.join(fixtureDir, 'workflows', 'order.ts')), functionName: 'orderWorkflow' },
    ]);
  });

  it('skips files under node_modules', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows.some((w) => w.functionName === 'shouldNeverBeDiscovered')).toBe(false);
  });

  it('skips generated *.pathkit-instrumented.ts leftover files', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows.some((w) => w.filePath.includes('pathkit-instrumented'))).toBe(false);
  });

  it('skips *.test.ts files and files under __tests__ directories', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows.some((w) => w.filePath.includes('order.test.ts'))).toBe(false);
    expect(result.workflows.some((w) => w.filePath.includes('__tests__'))).toBe(false);
  });

  it('silently produces no rows for a file with zero exported functions', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows.some((w) => w.filePath.includes('types.ts'))).toBe(false);
    expect(result.warnings.some((warning) => warning.filePath.includes('types.ts'))).toBe(false);
  });

  it('reports an invalid-syntax file as a warning instead of throwing', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(() => discoverWorkflows(fixtureDir)).not.toThrow();
    const brokenWarning = result.warnings.find((warning) => warning.filePath.includes('broken.ts'));
    expect(brokenWarning).toBeDefined();
    expect(brokenWarning?.error).toMatch(/invalid TypeScript syntax/i);
  });

  it('ignores non-.ts files', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows.some((w) => w.filePath.includes('readme.md'))).toBe(false);
  });

  it('ignores .d.ts declaration files, wherever they live', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows.some((w) => w.filePath.endsWith('.d.ts'))).toBe(false);
  });

  it('skips dist, build, coverage, and .git directories', () => {
    const result = discoverWorkflows(fixtureDir);

    expect(result.workflows.some((w) => w.filePath.includes(`${path.sep}dist${path.sep}`))).toBe(false);
    expect(result.workflows.some((w) => w.filePath.includes(`${path.sep}build${path.sep}`))).toBe(false);
    expect(result.workflows.some((w) => w.filePath.includes(`${path.sep}coverage${path.sep}`))).toBe(false);
    expect(result.workflows.some((w) => w.filePath.includes('.git'))).toBe(false);
  });

  it('throws a clear PathKitError for a nonexistent directory', () => {
    const missingDir = path.join(fixtureDir, 'does-not-exist');
    expect(() => discoverWorkflows(missingDir)).toThrow(PathKitError);
    expect(() => discoverWorkflows(missingDir)).toThrow(/not found/i);
  });

  it('throws a clear PathKitError when dir actually points at a file', () => {
    const aFile = path.join(fixtureDir, 'types.ts');
    expect(() => discoverWorkflows(aFile)).toThrow(PathKitError);
    expect(() => discoverWorkflows(aFile)).toThrow(/not a directory/i);
  });
});
