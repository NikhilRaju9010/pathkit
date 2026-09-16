import { Node, TryStatement } from 'ts-morph';
import { ActivityBindings, collectActivityBindings, isActivityCall } from './activityProxies';
import { WorkflowFunctionNode } from './parser';

export interface TryCatchBranch {
  kind: 'tryCatch';
  location: { line: number; column: number };
}

/**
 * Detects try/catch blocks that wrap at least one recognized activity call,
 * treating each as a success/failure branch point. A try/catch around
 * unrelated code (no activity call inside it) is deliberately not flagged —
 * see the negative fixture in test/fixtures/m3.
 */
export function detectActivityTryCatchBranches(fn: WorkflowFunctionNode): TryCatchBranch[] {
  const branches: TryCatchBranch[] = [];
  const body = fn.getBody();
  if (body === undefined) {
    return branches;
  }

  const bindings = collectActivityBindings(fn.getSourceFile());

  body.forEachDescendant((node) => {
    if (Node.isTryStatement(node) && isActivityTryCatch(node, bindings)) {
      branches.push(toTryCatchBranch(node));
    }
  });

  return branches;
}

function isActivityTryCatch(tryStatement: TryStatement, bindings: ActivityBindings): boolean {
  if (tryStatement.getCatchClause() === undefined) {
    return false;
  }

  let foundActivityCall = false;
  tryStatement.getTryBlock().forEachDescendant((node, traversal) => {
    if (foundActivityCall) {
      traversal.stop();
      return;
    }
    if (Node.isCallExpression(node) && isActivityCall(node, bindings)) {
      foundActivityCall = true;
      traversal.stop();
    }
  });

  return foundActivityCall;
}

function toTryCatchBranch(tryStatement: TryStatement): TryCatchBranch {
  const sourceFile = tryStatement.getSourceFile();
  const { line, column } = sourceFile.getLineAndColumnAtPos(tryStatement.getStart());
  return { kind: 'tryCatch', location: { line, column } };
}
