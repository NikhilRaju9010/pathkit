import { ForStatement, IfStatement, Node, Statement, TryStatement, WhileStatement } from 'ts-morph';
import { ActivityBindings, collectActivityBindings, isActivityCall } from './activityProxies';
import { containsCallMatching } from './astUtils';
import { WorkflowFunctionNode } from './parser';
import { classifyTimerOrSignalCall, TEMPORAL_WORKFLOW_MODULE, TimerOrSignalClassification } from './timersAndSignals';
import { collectLocalImportNames } from './temporalImports';

export type WorkflowGraphNodeKind = 'start' | 'end' | 'decision';

export interface WorkflowGraphNode {
  id: string;
  kind: WorkflowGraphNodeKind;
  label: string;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface WorkflowGraph {
  functionName: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  startNodeId: string;
  endNodeId: string;
}

/**
 * An edge whose `to` end isn't decided yet — it will be connected to
 * whatever comes next. `outcomeKey`, when present, is a stable
 * `${nodeId}#${originalLabel}` tag set once at creation (e.g. `n2#false`)
 * that survives unchanged as the object is threaded through
 * `processStatements`/`processStatement`, even across statements that don't
 * touch it. It exists because a retry loop's closing step
 * (`processLoop`'s `addEdge(edge.from, nodeId, 'retry')`) deliberately
 * overwrites whatever label an open edge arrived with — so a nested
 * decision's "false"/"success"/"timeout"/etc. continuation can end up
 * persisted in `graph.edges` labeled `'retry'` instead, if it happens to be
 * the edge that falls through to the very end of the loop body. Gap 1's own
 * rendering/path-enumeration is unaffected by this (a single combined
 * "retry" edge is exactly the semantics `mermaid.ts`/`paths.ts` want), but
 * Gap 2's instrumentation needs to find "the edge that resulted from this
 * specific if/try/race/condition outcome" regardless of what label it ended
 * up with — `outcomeEdgeIndex` (see `buildWorkflowGraphWithNodeRefs`)
 * resolves exactly that, keyed by `outcomeKey`.
 */
interface OpenEdge {
  from: string;
  label: string;
  outcomeKey?: string;
}

/**
 * Builds a directed graph of one workflow function's possible execution
 * paths from its already-parsed body, reusing the same activity/timer/signal
 * recognition as M2–M4. Only Temporal-relevant constructs become decision
 * nodes (an `if`, a try/catch around an activity call, a Promise.race
 * timeout, a condition() wait, or a while/for loop wrapping an activity
 * call) — everything else is walked over transparently, matching the same
 * "don't guess, either detect cleanly or don't detect at all" philosophy as
 * earlier milestones. See LIMITATIONS.md for what falls outside this.
 *
 * Node/edge creation order follows a single top-to-bottom, source-order walk
 * of the statement tree, so it is deterministic for a given input file.
 *
 * Loops that wrap an activity call become a real cycle in the graph: the
 * loop's decision node gets a labeled "retry" back-edge from wherever its
 * body falls through normally, rather than the body being unrolled or the
 * loop being dropped. Building the graph never executes or "runs" the loop,
 * so there is no risk of this construction step itself hanging — a loop
 * with any number of iterations is still just one pass over its body's
 * statements.
 */
export function buildWorkflowGraph(fn: WorkflowFunctionNode, functionName: string): WorkflowGraph {
  return buildWorkflowGraphWithNodeRefs(fn, functionName).graph;
}

/**
 * Same as {@link buildWorkflowGraph}, but also returns a map from each
 * decision node's id to the exact `ts-morph` AST node used to create it (an
 * `IfStatement`/`TryStatement`/`WhileStatement`/`ForStatement` for if/else,
 * try/catch, and loop decisions, or the matched `CallExpression` itself for
 * `Promise.race`/`condition()` decisions — the precise node Gap 2's
 * instrumentation needs to rewrite). `start`/`end` nodes have no entry.
 *
 * The returned `Node` references are only valid against the exact
 * `ts-morph` source `fn` was parsed from — they must never be reused after
 * that source has been mutated, or against a different parse of "the same"
 * file. Callers that need to instrument a copy of a workflow file must call
 * this function fresh against the copy's own parse, before inserting any
 * text into it (see LIMITATIONS.md).
 */
export function buildWorkflowGraphWithNodeRefs(
  fn: WorkflowFunctionNode,
  functionName: string,
): { graph: WorkflowGraph; nodeAstRefs: Map<string, Node>; outcomeEdgeIndex: Map<string, number> } {
  const sourceFile = fn.getSourceFile();
  const activityBindings = collectActivityBindings(sourceFile);
  const sleepNames = collectLocalImportNames(sourceFile, TEMPORAL_WORKFLOW_MODULE, new Set(['sleep']));
  const conditionNames = collectLocalImportNames(sourceFile, TEMPORAL_WORKFLOW_MODULE, new Set(['condition']));

  const builder = new GraphBuilder(activityBindings, sleepNames, conditionNames);
  const startId = builder.createNode('start', 'Start');

  const bodyStatements = getFunctionBodyStatements(fn);
  const finalFrontier = builder.processStatements(bodyStatements, [{ from: startId, label: '' }]);

  const graph = builder.finalize(functionName, startId, finalFrontier);
  return { graph, nodeAstRefs: builder.nodeAstRefs, outcomeEdgeIndex: builder.outcomeEdgeIndex };
}

function getFunctionBodyStatements(fn: WorkflowFunctionNode): Statement[] {
  const body = fn.getBody();
  if (body === undefined || !Node.isBlock(body)) {
    // `undefined` only occurs for a function-declaration overload with no
    // implementation; a non-block body is an arrow function's implicit
    // `() => expr` return, which has no statements (and thus no branches) to
    // walk. Both are treated as a function with an empty body.
    return [];
  }
  return body.getStatements();
}

function getBlockOrSingleStatement(statement: Statement): Statement[] {
  return Node.isBlock(statement) ? statement.getStatements() : [statement];
}

class GraphBuilder {
  private readonly nodes: WorkflowGraphNode[] = [];
  private readonly edges: WorkflowGraphEdge[] = [];
  private readonly terminalEdges: OpenEdge[] = [];
  /**
   * A stack of "edges that reached an unlabeled `break` statement," one
   * frame per loop currently being processed (innermost last). `break` has
   * no dedicated handling anywhere else in this file, so without this an
   * `if`'s branch containing only `break` was silently treated as an
   * ordinary statement with nothing branch-worthy in it — its open edge
   * fell through unchanged to the end of the loop body and was closed as a
   * `'retry'` back-edge exactly like a normal fall-through, indistinguishable
   * from a path that never broke out of the loop at all (see the fixed bug
   * this stack addresses in the "unlabeled `break` exits the loop" decision
   * log entry / LIMITATIONS.md). Each `processLoop` call pushes a fresh
   * frame before walking its own body and pops it after, so a `break` is
   * only ever captured by its nearest enclosing loop, matching real
   * JavaScript/TypeScript `break` semantics.
   */
  private readonly breakEdgeStack: OpenEdge[][] = [];
  private nextId = 0;
  readonly nodeAstRefs = new Map<string, Node>();
  readonly outcomeEdgeIndex = new Map<string, number>();

  constructor(
    private readonly activityBindings: ActivityBindings,
    private readonly sleepNames: ReadonlySet<string>,
    private readonly conditionNames: ReadonlySet<string>,
  ) {}

  createNode(kind: WorkflowGraphNodeKind, label: string, astNode?: Node): string {
    const id = `n${this.nextId++}`;
    this.nodes.push({ id, kind, label });
    if (astNode !== undefined) {
      this.nodeAstRefs.set(id, astNode);
    }
    return id;
  }

  /** An open edge representing one of a decision node's own outcomes (e.g. `n2` true), tagged so it can be found later regardless of what label it's eventually persisted with. */
  private outcomeEdge(nodeId: string, label: string): OpenEdge {
    return { from: nodeId, label, outcomeKey: `${nodeId}#${label}` };
  }

  private addEdge(from: string, to: string, label: string, outcomeKey?: string): void {
    const index = this.edges.length;
    this.edges.push({ from, to, label });
    if (outcomeKey !== undefined) {
      this.outcomeEdgeIndex.set(outcomeKey, index);
    }
  }

  private connectAllTo(openEdges: OpenEdge[], to: string): void {
    for (const edge of openEdges) {
      this.addEdge(edge.from, to, edge.label, edge.outcomeKey);
    }
  }

  private routeToEnd(openEdges: OpenEdge[]): void {
    this.terminalEdges.push(...openEdges);
  }

  finalize(functionName: string, startNodeId: string, finalFrontier: OpenEdge[]): WorkflowGraph {
    const endNodeId = this.createNode('end', 'End');
    for (const edge of [...this.terminalEdges, ...finalFrontier]) {
      this.addEdge(edge.from, endNodeId, edge.label, edge.outcomeKey);
    }
    return { functionName, nodes: this.nodes, edges: this.edges, startNodeId, endNodeId };
  }

  processStatements(statements: Statement[], frontier: OpenEdge[]): OpenEdge[] {
    let current = frontier;
    for (const statement of statements) {
      if (current.length === 0) {
        // Every preceding path already terminated (return/throw) — the rest
        // of this block is unreachable, so stop without adding nodes for it.
        break;
      }
      current = this.processStatement(statement, current);
    }
    return current;
  }

  private processStatement(statement: Statement, frontier: OpenEdge[]): OpenEdge[] {
    if (Node.isBlock(statement)) {
      return this.processStatements(statement.getStatements(), frontier);
    }
    if (Node.isIfStatement(statement)) {
      return this.processIf(statement, frontier);
    }
    if (Node.isTryStatement(statement)) {
      return this.processTry(statement, frontier);
    }
    if (Node.isWhileStatement(statement) || Node.isForStatement(statement)) {
      return this.processLoop(statement, frontier);
    }
    if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) {
      this.routeToEnd(frontier);
      return [];
    }
    if (Node.isBreakStatement(statement) && statement.getLabel() === undefined && this.breakEdgeStack.length > 0) {
      // An unlabeled `break` exits the nearest enclosing loop rather than
      // falling through to the rest of the loop body — capture the current
      // frontier on that loop's stack frame (merged into its `'exit'` outcome
      // by `processLoop`) instead of letting it fall through and get closed
      // as a `'retry'` back-edge like ordinary fall-through would. A labeled
      // `break` (out of scope) and a bare `break` outside any loop this
      // builder is tracking both fall through to the default "plain
      // statement" handling below, unchanged from prior behavior.
      const currentLoopBreakEdges = this.breakEdgeStack[this.breakEdgeStack.length - 1];
      if (currentLoopBreakEdges !== undefined) {
        currentLoopBreakEdges.push(...frontier);
      }
      return [];
    }

    const classified = this.classifyStatement(statement);
    if (classified === undefined) {
      return frontier; // a plain statement with nothing branch-worthy in it
    }
    const { classification, call } = classified;
    if (classification.kind === 'raceTimeout') {
      const nodeId = this.createNode('decision', 'Promise.race (timeout)', call);
      this.connectAllTo(frontier, nodeId);
      return [this.outcomeEdge(nodeId, 'success'), this.outcomeEdge(nodeId, 'timeout')];
    }
    const nodeId = this.createNode(
      'decision',
      classification.hasTimeout ? 'condition() (with timeout)' : 'condition()',
      call,
    );
    this.connectAllTo(frontier, nodeId);
    return classification.hasTimeout
      ? [this.outcomeEdge(nodeId, 'signaled'), this.outcomeEdge(nodeId, 'timedOut')]
      : [this.outcomeEdge(nodeId, 'signaled')];
  }

  private classifyStatement(
    statement: Statement,
  ): { classification: TimerOrSignalClassification; call: Node } | undefined {
    let result: { classification: TimerOrSignalClassification; call: Node } | undefined;
    statement.forEachDescendant((node, traversal) => {
      if (result !== undefined) {
        traversal.stop();
        return;
      }
      if (Node.isCallExpression(node)) {
        const classification = classifyTimerOrSignalCall(node, this.sleepNames, this.conditionNames);
        if (classification !== undefined) {
          result = { classification, call: node };
          traversal.stop();
        }
      }
    });
    return result;
  }

  private processIf(ifStatement: IfStatement, frontier: OpenEdge[]): OpenEdge[] {
    const nodeId = this.createNode('decision', `if (${ifStatement.getExpression().getText()})`, ifStatement);
    this.connectAllTo(frontier, nodeId);

    const thenExit = this.processStatements(getBlockOrSingleStatement(ifStatement.getThenStatement()), [
      this.outcomeEdge(nodeId, 'true'),
    ]);

    const elseStatement = ifStatement.getElseStatement();
    const elseExit =
      elseStatement === undefined
        ? [this.outcomeEdge(nodeId, 'false')]
        : this.processStatements(getBlockOrSingleStatement(elseStatement), [this.outcomeEdge(nodeId, 'false')]);

    return [...thenExit, ...elseExit];
  }

  private processTry(tryStatement: TryStatement, frontier: OpenEdge[]): OpenEdge[] {
    const tryBlock = tryStatement.getTryBlock();
    const catchClause = tryStatement.getCatchClause();
    const isActivityTryCatch =
      catchClause !== undefined && containsCallMatching(tryBlock, (call) => isActivityCall(call, this.activityBindings));

    if (!isActivityTryCatch) {
      // Not a recognized branch (see LIMITATIONS.md): treated as transparent,
      // assuming the try block succeeds. The catch block's contents are not
      // explored — this mirrors M3's detector, which doesn't flag this
      // try/catch as a branch either.
      return this.processStatements(tryBlock.getStatements(), frontier);
    }

    const nodeId = this.createNode('decision', 'try/catch (activity)', tryStatement);
    this.connectAllTo(frontier, nodeId);

    const successExit = this.processStatements(tryBlock.getStatements(), [this.outcomeEdge(nodeId, 'success')]);
    // isActivityTryCatch being true guarantees catchClause is defined.
    const failureExit = this.processStatements(catchClause.getBlock().getStatements(), [
      this.outcomeEdge(nodeId, 'failure'),
    ]);

    return [...successExit, ...failureExit];
  }

  private processLoop(loopStatement: WhileStatement | ForStatement, frontier: OpenEdge[]): OpenEdge[] {
    const bodyStatements = getBlockOrSingleStatement(loopStatement.getStatement());
    const isRetryLoop = bodyStatements.some((statement) =>
      containsCallMatching(statement, (call) => isActivityCall(call, this.activityBindings)),
    );

    if (!isRetryLoop) {
      // A loop with no activity call isn't a "retry loop" in the sense this
      // tool cares about (see LIMITATIONS.md); walked through transparently,
      // once, with no cycle modeled. Still push/pop a break-edge frame so an
      // unlabeled `break` inside it merges back with whatever comes after the
      // loop, instead of an outer loop (if any) wrongly capturing it.
      this.breakEdgeStack.push([]);
      const exit = this.processStatements(bodyStatements, frontier);
      const breakEdges = this.breakEdgeStack.pop() ?? [];
      return [...exit, ...breakEdges];
    }

    const nodeId = this.createNode('decision', describeLoop(loopStatement), loopStatement);
    this.connectAllTo(frontier, nodeId);

    this.breakEdgeStack.push([]);
    const bodyExit = this.processStatements(bodyStatements, [this.outcomeEdge(nodeId, 'iterate')]);
    const breakEdges = this.breakEdgeStack.pop() ?? [];
    for (const edge of bodyExit) {
      // Every path that falls through the loop body normally (i.e. didn't
      // already return/throw) goes back to try again — the labeled back-edge
      // the plan requires, regardless of what the body's own last branch's
      // edge label was. `edge.outcomeKey` is still propagated here (not
      // dropped): if a nested decision's own continuation (e.g. an inner
      // if's "false" edge) happens to be what falls through to here, this is
      // the point where that continuation is actually closed into a real
      // edge — its `outcomeKey` must still resolve to *this* edge's index,
      // even though the label persisted for it is `'retry'`, not the
      // nested decision's own outcome label (see the `OpenEdge` doc comment).
      this.addEdge(edge.from, nodeId, 'retry', edge.outcomeKey);
    }

    // An unlabeled `break` captured on this loop's stack frame exits the
    // loop the same way falling out of the loop condition does, so it's
    // merged with the loop's own `'exit'` outcome edge here rather than
    // being closed as a `'retry'` back-edge like normal body fall-through.
    return [this.outcomeEdge(nodeId, 'exit'), ...breakEdges];
  }
}

function describeLoop(loopStatement: WhileStatement | ForStatement): string {
  if (Node.isWhileStatement(loopStatement)) {
    return `while (${loopStatement.getExpression().getText()})`;
  }
  const initializer = loopStatement.getInitializer()?.getText() ?? '';
  const condition = loopStatement.getCondition()?.getText() ?? '';
  const incrementor = loopStatement.getIncrementor()?.getText() ?? '';
  return `for (${initializer}; ${condition}; ${incrementor})`;
}

