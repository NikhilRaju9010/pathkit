import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { detectBranches } from '../src/branches';
import { detectActivityTryCatchBranches } from '../src/activityTryCatch';
import { detectTimerAndSignalBranches, TimerOrSignalBranch } from '../src/timersAndSignals';

const fixture = (name: string): string => path.join(__dirname, 'fixtures', 'm4', name);

function branchesOf(fixtureName: string, functionName: string): TimerOrSignalBranch[] {
  const parsed = parseWorkflowFile(fixture(fixtureName));
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new Error(`fixture ${fixtureName} has no exported function named ${functionName}`);
  }
  return detectTimerAndSignalBranches(fn.node);
}

describe('detectTimerAndSignalBranches', () => {
  it('detects a Promise.race([activityPromise, sleep(ms)]) timeout branch', () => {
    const branches = branchesOf('timeout-race.ts', 'raceTimeoutWorkflow');
    expect(branches).toEqual([{ kind: 'raceTimeout', location: expect.any(Object) }]);
  });

  it('detects a condition() signal-wait branch with no timeout', () => {
    const branches = branchesOf('signal-condition.ts', 'signalConditionWorkflow');
    expect(branches).toEqual([{ kind: 'signalWait', location: expect.any(Object), hasTimeout: false }]);
  });

  it('detects a condition(fn, timeout) signal-wait branch and marks hasTimeout true', () => {
    const branches = branchesOf('signal-condition.ts', 'signalConditionWithTimeoutWorkflow');
    expect(branches).toEqual([{ kind: 'signalWait', location: expect.any(Object), hasTimeout: true }]);
  });

  it('finds a race (nested in an if) and a signal-wait (after a try/catch) together, in source order, without crashing', () => {
    const branches = branchesOf('combined-nested.ts', 'combinedWorkflow');
    expect(branches.map((b) => b.kind)).toEqual(['raceTimeout', 'signalWait']);
  });

  it('does not interfere with if/else or activity try/catch detection on the same combined fixture', () => {
    const parsed = parseWorkflowFile(fixture('combined-nested.ts'));
    const fn = parsed.find((f) => f.name === 'combinedWorkflow');
    if (fn === undefined) {
      throw new Error('fixture has no combinedWorkflow export');
    }
    expect(detectBranches(fn.node).map((b) => b.conditionText)).toEqual(['useRace']);
    expect(detectActivityTryCatchBranches(fn.node)).toHaveLength(1);
  });

  it('reports a real line/column location for a detected branch', () => {
    const [branch] = branchesOf('timeout-race.ts', 'raceTimeoutWorkflow');
    expect(branch).toBeDefined();
    expect(branch?.location.line).toBeGreaterThan(0);
    expect(branch?.location.column).toBeGreaterThan(0);
  });
});
