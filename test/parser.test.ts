import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { PathKitError } from '../src/errors';

const fixture = (name: string): string => path.join(__dirname, 'fixtures', 'm1', name);

describe('parseWorkflowFile', () => {
  it('recognizes an exported function declaration as a workflow entry point', () => {
    const result = parseWorkflowFile(fixture('function-declaration.ts'));
    expect(result.map((f) => f.name)).toEqual(['orderWorkflow']);
  });

  it('recognizes an exported const arrow function as a workflow entry point', () => {
    const result = parseWorkflowFile(fixture('arrow-function.ts'));
    expect(result.map((f) => f.name)).toEqual(['orderWorkflow']);
  });

  it('returns no functions when nothing in the file is an exported function', () => {
    const result = parseWorkflowFile(fixture('no-exported-functions.ts'));
    expect(result).toEqual([]);
  });

  it('throws a clear error for a nonexistent file path', () => {
    const missingPath = fixture('does-not-exist.ts');
    expect(() => parseWorkflowFile(missingPath)).toThrow(PathKitError);
    expect(() => parseWorkflowFile(missingPath)).toThrow(/not found/i);
  });

  it('throws a clear error for syntactically invalid TypeScript', () => {
    const invalidPath = fixture('invalid-syntax.ts');
    expect(() => parseWorkflowFile(invalidPath)).toThrow(PathKitError);
    expect(() => parseWorkflowFile(invalidPath)).toThrow(/invalid TypeScript syntax/i);
  });
});
