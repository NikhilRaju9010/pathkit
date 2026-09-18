import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { CallExpression, Node, SourceFile, Statement } from 'ts-morph';
import { PathKitError } from './errors';
import { buildWorkflowGraphWithNodeRefs, WorkflowGraph, WorkflowGraphNode } from './graph';
import { parseWorkflowFile, WorkflowFunctionNode } from './parser';

const INSTRUMENTED_SUFFIX = 'pathkit-instrumented.ts';
const TEMPORAL_WORKFLOW_MODULE = '@temporalio/workflow';

/**
 * A minimal, purely-observational `Promise.race` wrapper injected into an
 * instrumented file only when it actually contains a `Promise.race`
 * decision node. It resolves with whichever `labels[i]` corresponds to the
 * first input promise to settle — it never inspects or exposes the winning
 * promise's own resolved value, since the only supported usage (see
 * `raceEdit`) always discards that value anyway. Racing the same promises
 * wrapped in an extra `.then()` settles at the same "tick" as the original
 * promise, so it never changes which side of the race actually wins —
 * verified directly in `test/instrumentRaceHelper.test.ts`.
 */
const PATHKIT_RACE_HELPER_NAME = '__pathkitRace';
const PATHKIT_RACE_HELPER_SOURCE = `function ${PATHKIT_RACE_HELPER_NAME}(promises, labels) {
  return Promise.race(promises.map((p, i) => p.then(() => labels[i])));
}
`;

/**
 * Writes an instrumented copy of a workflow file as a sibling of the
 * original — same directory, not a temp directory elsewhere — because
 * Temporal Worker's `workflowsPath` bundling resolves the workflow file's
 * own relative imports from its own on-disk location; writing the copy
 * anywhere else would break those imports (see LIMITATIONS.md).
 *
 * The generated filename is `<sourceName>.<functionName>.<uniqueId>.pathkit-instrumented.ts`:
 * the function name is included because coverage tracking is per-function
 * and a single file can export more than one workflow function, and
 * `uniqueId` is a full, untruncated `crypto.randomUUID()` so that parallel
 * test workers or repeated runs never collide on the same filename.
 *
 * As of G3, the copy gets real tracking instrumentation for if/else
 * decision points only (a per-function trace array, a namespaced Query
 * exposing it, and a `push()` call in each branch arm) — try/catch,
 * Promise.race/condition(), and retry-loop decision points are left
 * untouched until later milestones (G5–G7).
 */
export function writeInstrumentedCopy(workflowFilePath: string, functionName: string): string {
  if (!existsSync(workflowFilePath)) {
    throw new PathKitError(`Workflow file not found: ${workflowFilePath}`);
  }

  const parsed = parseWorkflowFile(workflowFilePath);
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new PathKitError(`Workflow file ${workflowFilePath} has no exported function named ${functionName}`);
  }

  const originalText = fn.node.getSourceFile().getFullText();
  const instrumentedBody = instrumentText(originalText, fn.node, functionName);

  const instrumentedFilePath = instrumentedFilePathFor(workflowFilePath, functionName);
  const banner = generatedFileBanner(workflowFilePath, functionName);
  writeFileSync(instrumentedFilePath, banner + instrumentedBody, 'utf8');

  return instrumentedFilePath;
}

/** Deletes an instrumented copy. Never throws if the file is already gone. */
export function removeInstrumentedCopy(instrumentedFilePath: string): void {
  rmSync(instrumentedFilePath, { force: true });
}

export interface PrepareCoverageRunResult {
  instrumentedFilePath: string;
  /**
   * Deletes the instrumented copy. Safe to call more than once, and safe to
   * call even if the file was already removed some other way. Wire this
   * into your test framework's `afterEach`/`afterAll` (not just the end of
   * the happy path), so the instrumented sibling file is still cleaned up
   * even when a test throws or an assertion fails partway through.
   */
  cleanup: () => void;
}

/**
 * The developer-facing entry point for coverage tracking: instruments a
 * fresh copy of `functionName` in `workflowFilePath` (see
 * `writeInstrumentedCopy`) and returns its path plus a `cleanup()` to
 * remove it again. This — together with `recordCoverageTrace` — is
 * PathKit's entire public, `@temporalio/*`-import-free surface for this
 * feature; actually running the instrumented copy through a real
 * `TestWorkflowEnvironment`/`Worker` and querying its trace is up to your
 * own test, using whatever `@temporalio/testing`/`@temporalio/worker`
 * version your project already depends on (see README.md for a full
 * worked example, including a landmine worth knowing about: a Query must
 * be issued while the Worker is still polling — one issued after your test
 * has stopped the Worker will hang forever).
 *
 * Before writing the new instrumented copy, this does a best-effort pass
 * removing any stale `<sourceName>.<functionName>.*.pathkit-instrumented.ts`
 * files left behind in the same directory by a prior crashed run (one that
 * never reached its own `cleanup()`). This is purely to avoid disk clutter,
 * not a correctness requirement — the fresh copy's filename is always
 * unique on its own via `crypto.randomUUID()` — so a failure to remove a
 * stale file (e.g. it's locked by another concurrent test run) is silently
 * ignored rather than blocking this run.
 */
export function prepareCoverageRun(workflowFilePath: string, functionName: string): PrepareCoverageRunResult {
  removeStaleInstrumentedCopies(workflowFilePath, functionName);
  const instrumentedFilePath = writeInstrumentedCopy(workflowFilePath, functionName);
  return {
    instrumentedFilePath,
    cleanup: () => removeInstrumentedCopy(instrumentedFilePath),
  };
}

function removeStaleInstrumentedCopies(workflowFilePath: string, functionName: string): void {
  const dir = path.dirname(workflowFilePath);
  const sourceName = path.basename(workflowFilePath, path.extname(workflowFilePath));
  const prefix = `${sourceName}.${functionName}.`;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // best-effort — if we can't even list the directory, just proceed
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(`.${INSTRUMENTED_SUFFIX}`)) continue;
    try {
      rmSync(path.join(dir, entry), { force: true });
    } catch {
      // best-effort — a stale file we can't remove doesn't block writing a
      // new one, since the new filename's uniqueness never depends on this.
    }
  }
}

function instrumentedFilePathFor(workflowFilePath: string, functionName: string): string {
  const dir = path.dirname(workflowFilePath);
  const sourceName = path.basename(workflowFilePath, path.extname(workflowFilePath));
  const uniqueId = randomUUID();
  return path.join(dir, `${sourceName}.${functionName}.${uniqueId}.${INSTRUMENTED_SUFFIX}`);
}

function generatedFileBanner(workflowFilePath: string, functionName: string): string {
  const sourceFileName = path.basename(workflowFilePath);
  return (
    `// AUTO-GENERATED by pathkit coverage — safe to delete, do not edit.\n` +
    `// Instrumented copy of ${sourceFileName} (function: ${functionName}).\n\n`
  );
}

/** A pending change to the original file's text, applied as plain string splicing (see `applyEdits`). */
interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Resolves the `graph.edges` array index for a specific decision node's
 * outcome (e.g. node `n2`'s `'false'` outcome), via the `outcomeEdgeIndex`
 * map returned by `buildWorkflowGraphWithNodeRefs` — never by searching
 * `graph.edges` for a matching `label` directly. A retry loop's closing step
 * can silently overwrite an outcome's persisted label to `'retry'` (see the
 * `OpenEdge` doc comment in `graph.ts`), so label-based lookup is unsafe for
 * any decision that might be nested inside one; `outcomeEdgeIndex` is keyed
 * by the outcome's *original* identity and stays correct regardless of what
 * label the edge ends up with.
 */
function resolveOutcomeIndex(outcomeEdgeIndex: ReadonlyMap<string, number>, nodeId: string, outcome: string): number {
  const key = `${nodeId}#${outcome}`;
  const index = outcomeEdgeIndex.get(key);
  if (index === undefined) {
    throw new PathKitError(`Internal error: no persisted edge found for decision node ${nodeId}'s "${outcome}" outcome.`);
  }
  return index;
}

function instrumentText(originalText: string, fn: WorkflowFunctionNode, functionName: string): string {
  const sourceFile = fn.getSourceFile();
  const body = fn.getBody();
  if (body === undefined || !Node.isBlock(body)) {
    throw new PathKitError(
      `Cannot instrument function "${functionName}": it must have a block body ({ ... }) to be instrumented, ` +
        `not an implicit-return arrow function.`,
    );
  }

  const { graph, nodeAstRefs, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn, functionName);
  const traceVarName = `__pathkitTrace__${functionName}`;
  const queryVarName = `__pathkit_coverage__${functionName}`;

  const edits: TextEdit[] = [
    ...ifElseEdits(graph, nodeAstRefs, outcomeEdgeIndex, traceVarName),
    ...tryCatchEdits(graph, nodeAstRefs, outcomeEdgeIndex, traceVarName),
    ...raceAndConditionEdits(graph, nodeAstRefs, outcomeEdgeIndex, traceVarName),
    ...retryLoopEdits(graph, nodeAstRefs, outcomeEdgeIndex, traceVarName),
    setHandlerEdit(body, traceVarName, queryVarName),
    ...scaffoldEdits(sourceFile, traceVarName, queryVarName, needsRaceHelper(graph)),
  ];

  return applyEdits(originalText, edits);
}

/**
 * One edit per if/else arm (2 edits per if-decision node): a `push()` call
 * for the "true" edge as the first statement of the `then` arm, and one for
 * the "false" edge as the first statement of the `else` arm — synthesizing
 * an empty `else { ... }` if none exists. The edge index baked into each
 * push call is resolved via `outcomeEdgeIndex` (see `resolveOutcomeIndex`),
 * not by searching for a `'true'`/`'false'`-labeled edge directly, since a
 * retry loop nesting this `if` can overwrite that label with `'retry'`.
 */
function ifElseEdits(
  graph: WorkflowGraph,
  nodeAstRefs: Map<string, Node>,
  outcomeEdgeIndex: ReadonlyMap<string, number>,
  traceVarName: string,
): TextEdit[] {
  const edits: TextEdit[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== 'decision') continue;
    const astNode = nodeAstRefs.get(node.id);
    if (astNode === undefined || !Node.isIfStatement(astNode)) continue; // a different decision kind, not this milestone's concern yet

    const trueIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'true');
    const falseIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'false');

    edits.push(armEdit(astNode.getThenStatement(), pushStatement(traceVarName, trueIdx)));

    const elseStatement = astNode.getElseStatement();
    const falsePush = pushStatement(traceVarName, falseIdx);
    if (elseStatement === undefined) {
      const pos = astNode.getThenStatement().getEnd();
      edits.push({ start: pos, end: pos, text: ` else { ${falsePush} }` });
    } else {
      edits.push(armEdit(elseStatement, falsePush));
    }
  }

  return edits;
}

/**
 * Inserts a push call as the first statement of an if/else arm. A `Block`
 * arm (`{ ... }`) gets the push inserted right after its opening brace. A
 * non-`Block` arm — a single bare statement (`if (x) return 'a';`), or a
 * nested `if` for an `else if (...)` chain — is wrapped in a new block
 * (`{ push(...); <original arm> }`), which is syntactically valid and
 * behaviorally identical to the original, uniformly covering both cases.
 */
function armEdit(arm: Node, pushText: string): TextEdit {
  if (Node.isBlock(arm)) {
    const pos = arm.getStart() + 1;
    return { start: pos, end: pos, text: ` ${pushText}` };
  }
  return { start: arm.getStart(), end: arm.getEnd(), text: `{ ${pushText} ${arm.getText()} }` };
}

/**
 * One edit per try/catch-around-activity decision node: a `push()` for the
 * "success" edge as the LAST statement of the `try` block (reached only if
 * nothing in it threw), and a `push()` for the "failure" edge as the FIRST
 * statement of the `catch` block. Graph.ts only creates this decision node
 * when a `catchClause` is present (see LIMITATIONS.md for the narrower
 * "success" caveat when the try body branches internally with an early
 * return before its last statement).
 */
function tryCatchEdits(
  graph: WorkflowGraph,
  nodeAstRefs: Map<string, Node>,
  outcomeEdgeIndex: ReadonlyMap<string, number>,
  traceVarName: string,
): TextEdit[] {
  const edits: TextEdit[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== 'decision') continue;
    const astNode = nodeAstRefs.get(node.id);
    if (astNode === undefined || !Node.isTryStatement(astNode)) continue; // a different decision kind

    const catchClause = astNode.getCatchClause();
    if (catchClause === undefined) {
      throw new PathKitError(`Internal error: try/catch decision node ${node.id} has no catch clause.`);
    }
    const successIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'success');
    const failureIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'failure');

    const tryBlock = astNode.getTryBlock();
    const successPos = tryBlock.getEnd() - 1; // right before the try block's closing `}`
    edits.push({ start: successPos, end: successPos, text: `${pushStatement(traceVarName, successIdx)} ` });

    const catchBlock = catchClause.getBlock();
    const failurePos = catchBlock.getStart() + 1; // right after the catch block's opening `{`
    edits.push({ start: failurePos, end: failurePos, text: ` ${pushStatement(traceVarName, failureIdx)}` });
  }

  return edits;
}

/**
 * One edit pair per retry-loop decision node: a `push()` for the "iterate"
 * edge as the first statement of the loop body, and a `push()` for the
 * "exit" edge immediately after the whole loop statement. Deliberately no
 * separate push for the "retry" back-edge itself — a second (or third, ...)
 * pass through the loop body re-executes the same "iterate" push, so a
 * multi-iteration run's raw trace naturally contains the repeated pattern
 * (`['<iterateIdx>', '<iterateIdx>', ..., '<exitIdx or something else>']`)
 * without any extra instrumentation. This is by design, not an oversight —
 * it's exactly the "a retry happened" signal `enumeratePaths` already
 * collapses a loop's back-edge into (see LIMITATIONS.md and G8, which
 * defines how a raw multi-iteration trace gets normalized back down to a
 * single declared path).
 */
function retryLoopEdits(
  graph: WorkflowGraph,
  nodeAstRefs: Map<string, Node>,
  outcomeEdgeIndex: ReadonlyMap<string, number>,
  traceVarName: string,
): TextEdit[] {
  const edits: TextEdit[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== 'decision') continue;
    const astNode = nodeAstRefs.get(node.id);
    if (astNode === undefined || !(Node.isWhileStatement(astNode) || Node.isForStatement(astNode))) continue; // a different decision kind

    const iterateIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'iterate');
    const exitIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'exit');

    const loopBody = astNode.getStatement();
    edits.push(armEdit(loopBody, pushStatement(traceVarName, iterateIdx)));

    const exitPos = astNode.getEnd();
    edits.push({ start: exitPos, end: exitPos, text: ` ${pushStatement(traceVarName, exitIdx)}` });
  }

  return edits;
}

function needsRaceHelper(graph: WorkflowGraph): boolean {
  return graph.nodes.some((n) => n.label === 'Promise.race (timeout)');
}

/**
 * One edit per `Promise.race`/`condition()` decision node. Because graph.ts
 * dispatches `if`/`try`/`while`/`for` statements to their own handlers
 * *before* ever checking a statement for a race/condition call (see
 * `graph.ts`'s `processStatement`), a call embedded in one of those
 * constructs' own test expression never becomes a `Promise.race`/`condition()`
 * decision node in the first place — it's absorbed into an ordinary `if`
 * decision (already handled by `ifElseEdits`) or a transparent loop. The
 * only statement shapes that can actually reach this function are "plain"
 * ones (an expression statement or a variable declaration) — so the
 * supported shapes below are deliberately narrower than the plan's original
 * "any if/while condition" wording, and are grounded in what graph.ts can
 * actually produce, not just what Gap 1 can detect (see LIMITATIONS.md).
 */
function raceAndConditionEdits(
  graph: WorkflowGraph,
  nodeAstRefs: Map<string, Node>,
  outcomeEdgeIndex: ReadonlyMap<string, number>,
  traceVarName: string,
): TextEdit[] {
  const edits: TextEdit[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== 'decision') continue;
    const astNode = nodeAstRefs.get(node.id);
    if (astNode === undefined || !Node.isCallExpression(astNode)) continue; // if/try/loop, handled elsewhere

    const statement = astNode.getFirstAncestor((a): a is Statement => Node.isStatement(a));
    if (statement === undefined) {
      throw new PathKitError(`Internal error: could not find the enclosing statement for decision node ${node.id}.`);
    }

    if (node.label === 'Promise.race (timeout)') {
      edits.push(raceEdit(node, outcomeEdgeIndex, astNode, statement, traceVarName));
    } else {
      edits.push(...conditionEdit(node, outcomeEdgeIndex, astNode, statement, traceVarName));
    }
  }

  return edits;
}

/**
 * Supported shape: a bare, value-discarding statement — `await Promise.race([...]);`
 * with nothing else consuming the result. Rewrites the whole statement into
 * a single push of the winning label, via the `__pathkitRace` helper. Any
 * other usage (assigned, returned, or embedded in a larger expression) fails
 * loudly rather than guessing how to preserve the discarded winning value.
 */
function raceEdit(
  node: WorkflowGraphNode,
  outcomeEdgeIndex: ReadonlyMap<string, number>,
  call: CallExpression,
  statement: Statement,
  traceVarName: string,
): TextEdit {
  assertBareDiscardedStatement(statement, call, 'Promise.race');

  const successIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'success');
  const timeoutIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'timeout');

  const raceArgs = call.getArguments()[0];
  if (raceArgs === undefined) {
    throw new PathKitError(`Internal error: Promise.race call at decision node ${node.id} has no array argument.`);
  }

  const replacement =
    `${traceVarName}.push(await ${PATHKIT_RACE_HELPER_NAME}(${raceArgs.getText()}, ` +
    `['${successIdx}', '${timeoutIdx}']));`;

  return { start: statement.getStart(), end: statement.getEnd(), text: replacement };
}

/**
 * `condition(fn)` (no timeout) has exactly one possible outcome — it blocks
 * until signaled, so any statement shape is fine; the push is simply
 * inserted right after, with no need to inspect a value at all.
 *
 * `condition(fn, timeout)` (with timeout) has two outcomes that can only be
 * told apart by its boolean return value, so the supported shape is
 * narrower: it must be captured into its own variable declaration
 * (`const x = await condition(fn, timeout);`), and the push branches on that
 * variable's name right after the declaration.
 */
function conditionEdit(
  node: WorkflowGraphNode,
  outcomeEdgeIndex: ReadonlyMap<string, number>,
  call: CallExpression,
  statement: Statement,
  traceVarName: string,
): TextEdit[] {
  const hasTimeout = node.label === 'condition() (with timeout)';
  const pos = statement.getEnd();

  if (!hasTimeout) {
    const signaledIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'signaled');
    return [{ start: pos, end: pos, text: ` ${pushStatement(traceVarName, signaledIdx)}` }];
  }

  const signaledIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'signaled');
  const timedOutIdx = resolveOutcomeIndex(outcomeEdgeIndex, node.id, 'timedOut');

  if (!Node.isVariableStatement(statement)) {
    throw new PathKitError(
      `Cannot instrument this condition() (with timeout) usage: it must be captured into its own variable ` +
        `declaration (e.g. "const x = await condition(fn, timeout);") — see LIMITATIONS.md.`,
    );
  }
  const declarations = statement.getDeclarationList().getDeclarations();
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (declaration === undefined) {
    throw new PathKitError(
      `Cannot instrument this condition() (with timeout) usage: expected exactly one variable declaration, ` +
        `found ${declarations.length} — see LIMITATIONS.md.`,
    );
  }
  let initializer = declaration.getInitializer();
  if (initializer !== undefined && Node.isAwaitExpression(initializer)) {
    initializer = initializer.getExpression();
  }
  if (initializer !== call) {
    throw new PathKitError(
      `Cannot instrument this condition() (with timeout) usage: the declared variable must be initialized ` +
        `directly from the condition() call — see LIMITATIONS.md.`,
    );
  }

  const varName = declaration.getName();
  const signaledPush = pushStatement(traceVarName, signaledIdx);
  const timedOutPush = pushStatement(traceVarName, timedOutIdx);
  return [{ start: pos, end: pos, text: ` if (${varName}) { ${signaledPush} } else { ${timedOutPush} }` }];
}

function assertBareDiscardedStatement(statement: Statement, call: Node, kindLabel: string): void {
  if (!Node.isExpressionStatement(statement)) {
    throw new PathKitError(
      `Cannot instrument this ${kindLabel} usage: only a bare, value-discarding statement ` +
        `(e.g. "await ${kindLabel}(...);") is supported yet — see LIMITATIONS.md.`,
    );
  }
  let expr: Node = statement.getExpression();
  if (Node.isAwaitExpression(expr)) {
    expr = expr.getExpression();
  }
  if (expr !== call) {
    throw new PathKitError(
      `Cannot instrument this ${kindLabel} usage: its result must be discarded directly ` +
        `(e.g. "await ${kindLabel}(...);"), not combined with other code — see LIMITATIONS.md.`,
    );
  }
}

function pushStatement(traceVarName: string, edgeIndex: number): string {
  return `${traceVarName}.push('${edgeIndex}');`;
}

/** Registers the coverage query as the very first statement of the function body. */
function setHandlerEdit(body: Node, traceVarName: string, queryVarName: string): TextEdit {
  const pos = body.getStart() + 1;
  return { start: pos, end: pos, text: ` setHandler(${queryVarName}, () => [...${traceVarName}]);` };
}

/**
 * Module-level scaffolding: the `defineQuery`/`setHandler` import (merged
 * into an existing `@temporalio/workflow` named import if present, else a
 * new import statement) and the per-function trace array + query
 * definition, inserted right after the last import (or at the top of the
 * file if there are none).
 */
function scaffoldEdits(sourceFile: SourceFile, traceVarName: string, queryVarName: string, includeRaceHelper: boolean): TextEdit[] {
  const edits: TextEdit[] = [];
  const neededNamedImports = ['defineQuery', 'setHandler'];
  const moduleScaffoldText =
    `\nconst ${traceVarName}: string[] = [];\n` +
    `const ${queryVarName} = defineQuery<string[]>('${queryVarName}');\n` +
    (includeRaceHelper ? PATHKIT_RACE_HELPER_SOURCE : '');

  const existingImport = sourceFile
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === TEMPORAL_WORKFLOW_MODULE);

  if (existingImport === undefined) {
    const importText = `import { ${neededNamedImports.join(', ')} } from '${TEMPORAL_WORKFLOW_MODULE}';\n`;
    edits.push({ start: 0, end: 0, text: importText + moduleScaffoldText });
    return edits;
  }

  const namedBindings = existingImport.getImportClause()?.getNamedBindings();
  if (namedBindings !== undefined && !Node.isNamedImports(namedBindings)) {
    throw new PathKitError(
      `Cannot instrument: the existing "${TEMPORAL_WORKFLOW_MODULE}" import doesn't use named imports ` +
        `(e.g. \`import * as workflow from '${TEMPORAL_WORKFLOW_MODULE}'\`), which isn't supported yet.`,
    );
  }

  const existingNames = new Set((namedBindings?.getElements() ?? []).map((el) => el.getName()));
  const missingNames = neededNamedImports.filter((n) => !existingNames.has(n));

  if (missingNames.length > 0) {
    if (namedBindings === undefined) {
      throw new PathKitError(
        `Cannot instrument: the existing "${TEMPORAL_WORKFLOW_MODULE}" import has no named imports to merge into ` +
          `(e.g. a bare \`import '${TEMPORAL_WORKFLOW_MODULE}'\`), which isn't supported yet.`,
      );
    }
    const pos = namedBindings.getEnd() - 1; // right before the closing `}`
    edits.push({ start: pos, end: pos, text: `, ${missingNames.join(', ')}` });
  }

  const scaffoldAnchor = existingImport.getEnd();
  edits.push({ start: scaffoldAnchor, end: scaffoldAnchor, text: moduleScaffoldText });

  return edits;
}

/** Applies edits by plain string splicing, in descending-position order so earlier offsets stay valid. */
function applyEdits(originalText: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = originalText;
  for (const edit of sorted) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
