import { IfStatement, Node } from 'ts-morph';
import { WorkflowFunctionNode } from './parser';

export interface ConditionBranch {
  kind: 'condition';
  location: { line: number; column: number };
  conditionText: string;
}

export type Branch = ConditionBranch;

/**
 * Detects if/else branch points in a workflow function body.
 *
 * `switch` statements are deliberately not detected in v1 (deferred scope
 * decision, see LIMITATIONS.md) — this is not an oversight, so no code here
 * walks into SwitchStatement nodes looking for branches.
 */
export function detectBranches(fn: WorkflowFunctionNode): Branch[] {
  const branches: Branch[] = [];
  const body = fn.getBody();
  if (body === undefined) {
    return branches;
  }

  body.forEachDescendant((node) => {
    if (Node.isIfStatement(node)) {
      branches.push(toConditionBranch(node));
    }
  });

  return branches;
}

function toConditionBranch(ifStatement: IfStatement): ConditionBranch {
  const sourceFile = ifStatement.getSourceFile();
  const { line, column } = sourceFile.getLineAndColumnAtPos(ifStatement.getStart());

  return {
    kind: 'condition',
    location: { line, column },
    conditionText: ifStatement.getExpression().getText(),
  };
}
