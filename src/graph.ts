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

/** An edge whose `to` end isn't decided yet — it will be connected to whatever comes next. */
interface OpenEdge {
  from: string;
  label: string;
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
): { graph: WorkflowGraph; nodeAstRefs: Map<string, Node> } {
  const sourceFile = fn.getSourceFile();
  const activityBindings = collectActivityBindings(sourceFile);
  const sleepNames = collectLocalImportNames(sourceFile, TEMPORAL_WORKFLOW_MODULE, new Set(['sleep']));
  const conditionNames = collectLocalImportNames(sourceFile, TEMPORAL_WORKFLOW_MODULE, new Set(['condition']));

  const builder = new GraphBuilder(activityBindings, sleepNames, conditionNames);
  const startId = builder.createNode('start', 'Start');

  const bodyStatements = getFunctionBodyStatements(fn);
  const finalFrontier = builder.processStatements(bodyStatements, [{ from: startId, label: '' }]);

  const graph = builder.finalize(functionName, startId, finalFrontier);
  return { graph, nodeAstRefs: builder.nodeAstRefs };
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
  private nextId = 0;
  readonly nodeAstRefs = new Map<string, Node>();

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

  private addEdge(from: string, to: string, label: string): void {
    this.edges.push({ from, to, label });
  }

  private connectAllTo(openEdges: OpenEdge[], to: string): void {
    for (const edge of openEdges) {
      this.addEdge(edge.from, to, edge.label);
    }
  }

  private routeToEnd(openEdges: OpenEdge[]): void {
    this.terminalEdges.push(...openEdges);
  }

  finalize(functionName: string, startNodeId: string, finalFrontier: OpenEdge[]): WorkflowGraph {
    const endNodeId = this.createNode('end', 'End');
    for (const edge of [...this.terminalEdges, ...finalFrontier]) {
      this.addEdge(edge.from, endNodeId, edge.label);
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

    const classified = this.classifyStatement(statement);
    if (classified === undefined) {
      return frontier; // a plain statement with nothing branch-worthy in it
    }
    const { classification, call } = classified;
    if (classification.kind === 'raceTimeout') {
      const nodeId = this.createNode('decision', 'Promise.race (timeout)', call);
      this.connectAllTo(frontier, nodeId);
      return [
        { from: nodeId, label: 'success' },
        { from: nodeId, label: 'timeout' },
      ];
    }
    const nodeId = this.createNode(
      'decision',
      classification.hasTimeout ? 'condition() (with timeout)' : 'condition()',
      call,
    );
    this.connectAllTo(frontier, nodeId);
    return classification.hasTimeout
      ? [
          { from: nodeId, label: 'signaled' },
          { from: nodeId, label: 'timedOut' },
        ]
      : [{ from: nodeId, label: 'signaled' }];
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
      { from: nodeId, label: 'true' },
    ]);

    const elseStatement = ifStatement.getElseStatement();
    const elseExit =
      elseStatement === undefined
        ? [{ from: nodeId, label: 'false' }]
        : this.processStatements(getBlockOrSingleStatement(elseStatement), [{ from: nodeId, label: 'false' }]);

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

    const successExit = this.processStatements(tryBlock.getStatements(), [{ from: nodeId, label: 'success' }]);
    // isActivityTryCatch being true guarantees catchClause is defined.
    const failureExit = this.processStatements(catchClause.getBlock().getStatements(), [
      { from: nodeId, label: 'failure' },
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
      // once, with no cycle modeled.
      return this.processStatements(bodyStatements, frontier);
    }

    const nodeId = this.createNode('decision', describeLoop(loopStatement), loopStatement);
    this.connectAllTo(frontier, nodeId);

    const bodyExit = this.processStatements(bodyStatements, [{ from: nodeId, label: 'iterate' }]);
    for (const edge of bodyExit) {
      // Every path that falls through the loop body normally (i.e. didn't
      // already return/throw) goes back to try again — the labeled back-edge
      // the plan requires, regardless of what the body's own last branch's
      // edge label was.
      this.addEdge(edge.from, nodeId, 'retry');
    }

    return [{ from: nodeId, label: 'exit' }];
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

