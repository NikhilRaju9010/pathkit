import { CallExpression, Node } from 'ts-morph';

/**
 * Returns true if `root` itself, or any descendant of it, is a call
 * expression matching `predicate`. Used by the try/catch and timer/signal
 * detectors to check "does this subtree contain a call to X" without
 * duplicating the same descend-and-stop-early traversal in each one.
 */
export function containsCallMatching(root: Node, predicate: (call: CallExpression) => boolean): boolean {
  if (Node.isCallExpression(root) && predicate(root)) {
    return true;
  }

  let found = false;
  root.forEachDescendant((node, traversal) => {
    if (found) {
      traversal.stop();
      return;
    }
    if (Node.isCallExpression(node) && predicate(node)) {
      found = true;
      traversal.stop();
    }
  });

  return found;
}
