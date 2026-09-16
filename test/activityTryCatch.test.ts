import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { detectActivityTryCatchBranches } from '../src/activityTryCatch';

const fixture = (name: string): string => path.join(__dirname, 'fixtures', 'm3', name);

function tryCatchBranchesOf(fixtureName: string, functionName: string): { kind: string }[] {
  const parsed = parseWorkflowFile(fixture(fixtureName));
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new Error(`fixture ${fixtureName} has no exported function named ${functionName}`);
  }
  return detectActivityTryCatchBranches(fn.node).map((b) => ({ kind: b.kind }));
}

describe('detectActivityTryCatchBranches', () => {
  it('flags a try/catch that wraps a destructured activity call', () => {
    expect(tryCatchBranchesOf('try-catch-around-activity.ts', 'chargeCardWorkflow')).toEqual([{ kind: 'tryCatch' }]);
  });

  it('flags a try/catch that wraps a call on a proxy object (const acts = proxyActivities(...))', () => {
    expect(tryCatchBranchesOf('try-catch-around-activity.ts', 'chargeCardViaObjectWorkflow')).toEqual([
      { kind: 'tryCatch' },
    ]);
  });

  it('flags a try/catch that wraps a .executeWithOptions() override call on a destructured activity', () => {
    expect(tryCatchBranchesOf('try-catch-around-activity.ts', 'chargeCardWithOverrideWorkflow')).toEqual([
      { kind: 'tryCatch' },
    ]);
  });

  it('does NOT flag a try/catch that wraps unrelated code, even in a file with an activity proxy', () => {
    expect(tryCatchBranchesOf('try-catch-non-activity.ts', 'parseInputWorkflow')).toEqual([]);
  });

  it('flags both try/catch blocks in a real trimmed sample from temporalio/samples-typescript', () => {
    expect(tryCatchBranchesOf('real-saga-trimmed.ts', 'openAccount')).toEqual([{ kind: 'tryCatch' }, { kind: 'tryCatch' }]);
  });

  it('reports a real line/column location for a detected try/catch branch', () => {
    const parsed = parseWorkflowFile(fixture('try-catch-around-activity.ts'));
    const fn = parsed.find((f) => f.name === 'chargeCardWorkflow');
    if (fn === undefined) {
      throw new Error('fixture has no chargeCardWorkflow export');
    }
    const [branch] = detectActivityTryCatchBranches(fn.node);
    expect(branch).toBeDefined();
    expect(branch?.location.line).toBeGreaterThan(0);
    expect(branch?.location.column).toBeGreaterThan(0);
  });
});
