import { ArrayLiteralExpression, CallExpression, Node } from 'ts-morph';
import { containsCallMatching } from './astUtils';
import { WorkflowFunctionNode } from './parser';
import { collectLocalImportNames } from './temporalImports';

export interface RaceTimeoutBranch {
  kind: 'raceTimeout';
  location: { line: number; column: number };
}

export interface SignalWaitBranch {
  kind: 'signalWait';
  location: { line: number; column: number };
  hasTimeout: boolean;
}

export type TimerOrSignalBranch = RaceTimeoutBranch | SignalWaitBranch;

const TEMPORAL_WORKFLOW_MODULE = '@temporalio/workflow';

/**
 * Detects two Temporal-specific branch shapes, confirmed against real code
 * in temporalio/samples-typescript:
 *
 * - `Promise.race([..., sleep(ms)])` — a success-vs-timeout branch. Any
 *   element racing against a `sleep()` call counts; the other elements can
 *   be an activity call, a `condition()` call, or an arbitrary promise
 *   variable (all three appear in real samples), and are not required to be
 *   any particular shape.
 * - `condition(fn)` / `condition(fn, timeout)` — a signal-wait branch.
 *   `hasTimeout` reflects whether a timeout argument was passed, since that
 *   changes it from a single-outcome wait into a wait-vs-timeout branch.
 */
export function detectTimerAndSignalBranches(fn: WorkflowFunctionNode): TimerOrSignalBranch[] {
  const body = fn.getBody();
  if (body === undefined) {
    return [];
  }

  const sourceFile = fn.getSourceFile();
  const sleepNames = collectLocalImportNames(sourceFile, TEMPORAL_WORKFLOW_MODULE, new Set(['sleep']));
  const conditionNames = collectLocalImportNames(sourceFile, TEMPORAL_WORKFLOW_MODULE, new Set(['condition']));

  const branches: TimerOrSignalBranch[] = [];

  body.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    if (isPromiseRaceWithTimer(node, sleepNames)) {
      branches.push(toRaceTimeoutBranch(node));
    } else if (isConditionCall(node, conditionNames)) {
      branches.push(toSignalWaitBranch(node));
    }
  });

  return branches;
}

function isPromiseRaceWithTimer(call: CallExpression, sleepNames: ReadonlySet<string>): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;

  const target = callee.getExpression();
  if (!Node.isIdentifier(target) || target.getText() !== 'Promise' || callee.getName() !== 'race') {
    return false;
  }

  const [arg] = call.getArguments();
  if (arg === undefined || !Node.isArrayLiteralExpression(arg)) return false;

  return raceArrayHasTimer(arg, sleepNames);
}

function raceArrayHasTimer(array: ArrayLiteralExpression, sleepNames: ReadonlySet<string>): boolean {
  return array
    .getElements()
    .some((element) => containsCallMatching(element, (call) => isSleepCall(call, sleepNames)));
}

function isSleepCall(call: CallExpression, sleepNames: ReadonlySet<string>): boolean {
  const callee = call.getExpression();
  return Node.isIdentifier(callee) && sleepNames.has(callee.getText());
}

function isConditionCall(call: CallExpression, conditionNames: ReadonlySet<string>): boolean {
  const callee = call.getExpression();
  return Node.isIdentifier(callee) && conditionNames.has(callee.getText());
}

function toRaceTimeoutBranch(call: CallExpression): RaceTimeoutBranch {
  const { line, column } = call.getSourceFile().getLineAndColumnAtPos(call.getStart());
  return { kind: 'raceTimeout', location: { line, column } };
}

function toSignalWaitBranch(call: CallExpression): SignalWaitBranch {
  const { line, column } = call.getSourceFile().getLineAndColumnAtPos(call.getStart());
  return { kind: 'signalWait', location: { line, column }, hasTimeout: call.getArguments().length >= 2 };
}
