import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { detectBranches } from '../src/branches';

const fixture = (name: string): string => path.join(__dirname, 'fixtures', 'm2', name);

function branchesOf(fixtureName: string): { kind: string; conditionText: string }[] {
  const [fn] = parseWorkflowFile(fixture(fixtureName));
  if (fn === undefined) {
    throw new Error(`fixture ${fixtureName} has no exported workflow function`);
  }
  return detectBranches(fn.node).map((b) => ({ kind: b.kind, conditionText: b.conditionText }));
}

describe('detectBranches', () => {
  it('detects a single if/else branch', () => {
    expect(branchesOf('simple-if-else.ts')).toEqual([{ kind: 'condition', conditionText: 'isHeads' }]);
  });

  it('detects an if with no else', () => {
    expect(branchesOf('if-no-else.ts')).toEqual([{ kind: 'condition', conditionText: 'input > 0' }]);
  });

  it('detects nested if/else branches in source order', () => {
    expect(branchesOf('nested-if-else.ts')).toEqual([
      { kind: 'condition', conditionText: 'input > 0' },
      { kind: 'condition', conditionText: 'input > 100' },
    ]);
  });

  it('returns an empty list for a function with no branches', () => {
    expect(branchesOf('no-branches.ts')).toEqual([]);
  });

  it('does not detect switch statements as branches (deliberately deferred)', () => {
    expect(branchesOf('switch-statement.ts')).toEqual([]);
  });

  it('reports a real line/column location for a detected branch', () => {
    const [fn] = parseWorkflowFile(fixture('simple-if-else.ts'));
    if (fn === undefined) {
      throw new Error('fixture has no exported workflow function');
    }
    const [branch] = detectBranches(fn.node);
    expect(branch).toBeDefined();
    expect(branch?.location.line).toBe(2);
    expect(branch?.location.column).toBeGreaterThan(0);
  });
});
