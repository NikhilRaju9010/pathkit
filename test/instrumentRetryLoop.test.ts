import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from 'ts-morph';
import { buildWorkflowGraphWithNodeRefs } from '../src/graph';
import { removeInstrumentedCopy, writeInstrumentedCopy } from '../src/instrument';
import { parseWorkflowFile } from '../src/parser';

/**
 * G7 is verified at the text/AST level only, same as G3/G5/G6 — the live
 * Temporal proof lives in `test/coverage-e2e.test.ts`.
 */

function instrumentAndRead(
  milestone: string,
  fileName: string,
  functionName: string,
): { instrumentedText: string; cleanup: () => void } {
  const filePath = path.join(__dirname, 'fixtures', milestone, fileName);
  const instrumentedPath = writeInstrumentedCopy(filePath, functionName);
  const instrumentedText = fs.readFileSync(instrumentedPath, 'utf8');
  return { instrumentedText, cleanup: () => removeInstrumentedCopy(instrumentedPath) };
}

function assertSyntacticallyValid(instrumentedText: string): void {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.createSourceFile('instrumented-check.ts', instrumentedText);
  const diagnostics = project.getProgram().getSyntacticDiagnostics(sourceFile);
  expect(diagnostics.map((d) => d.getMessageText())).toEqual([]);
}

function outcomeIdx(filePath: string, functionName: string, decisionLabelPrefix: string, outcome: string): number {
  const fn = parseWorkflowFile(filePath).find((f) => f.name === functionName)!;
  const { graph, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn.node, functionName);
  const decisionId = graph.nodes.find((n) => n.label.startsWith(decisionLabelPrefix))!.id;
  const idx = outcomeEdgeIndex.get(`${decisionId}#${outcome}`);
  if (idx === undefined) throw new Error(`no outcome edge for ${decisionId}#${outcome}`);
  return idx;
}

describe('writeInstrumentedCopy — G7 real retry-loop instrumentation (Gap 2)', () => {
  it('pushes the iterate edge as the first statement of the loop body, and the exit edge right after the loop', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m5', 'retry-loop.ts', 'retryLoopWorkflow');
    try {
      assertSyntacticallyValid(instrumentedText);

      const filePath = path.join(__dirname, 'fixtures', 'm5', 'retry-loop.ts');
      const iterateIdx = outcomeIdx(filePath, 'retryLoopWorkflow', 'for (', 'iterate');
      const exitIdx = outcomeIdx(filePath, 'retryLoopWorkflow', 'for (', 'exit');

      expect(instrumentedText).toContain(
        `attempt++) { __pathkitTrace__retryLoopWorkflow.push('${iterateIdx}');\n    const status`,
      );
      expect(instrumentedText).toMatch(
        new RegExp(`}\\s*__pathkitTrace__retryLoopWorkflow\\.push\\('${exitIdx}'\\);\\s*\\n\\s*return 'timed out';`),
      );
    } finally {
      cleanup();
    }
  });

  it('this is by design: a multi-iteration raw trace would contain the repeated iterate push, not a separate one per iteration count', () => {
    // No live execution here (that's the e2e suite) — this just documents,
    // via a text-level assertion, that there is exactly ONE push call site
    // for 'iterate' in the generated source, even though it fires multiple
    // times at runtime across repeated loop iterations.
    const { instrumentedText, cleanup } = instrumentAndRead('m5', 'retry-loop.ts', 'retryLoopWorkflow');
    try {
      const matches = instrumentedText.match(/__pathkitTrace__retryLoopWorkflow\.push\(/g);
      // if (2: true+false) + loop (2: iterate+exit) = 4 push call sites.
      expect(matches).toHaveLength(4);
    } finally {
      cleanup();
    }
  });

  it('composes correctly with nested if/else falling through to the loop end (real demo/ shape, two if checks per iteration)', () => {
    const filePath = path.resolve(__dirname, '..', 'demo', 'report-polling-workflow.ts');
    const instrumentedPath = writeInstrumentedCopy(filePath, 'reportPollingWorkflow');
    try {
      const instrumentedText = fs.readFileSync(instrumentedPath, 'utf8');
      assertSyntacticallyValid(instrumentedText);

      const traceVar = '__pathkitTrace__reportPollingWorkflow';
      // if #1 (2) + if #2 (2) + loop (2: iterate+exit) = 6 push call sites.
      // Both ifs' "false" continuations fall through toward the loop's end
      // (if #2's directly, if #1's via if #2) — exactly the shape that
      // silently broke before outcomeEdgeIndex existed.
      expect(instrumentedText.match(new RegExp(`${traceVar}\\.push\\(`, 'g'))).toHaveLength(6);

      const fn = parseWorkflowFile(filePath).find((f) => f.name === 'reportPollingWorkflow')!;
      const { graph, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn.node, 'reportPollingWorkflow');
      const decisionIds = graph.nodes.filter((n) => n.kind === 'decision').map((n) => n.id);
      const seenIndices = new Set<number>();
      for (const id of decisionIds) {
        for (const [key, idx] of outcomeEdgeIndex) {
          if (key.startsWith(`${id}#`)) seenIndices.add(idx);
        }
      }
      // Every outcome-edge index actually appears as a push literal.
      for (const idx of seenIndices) {
        expect(instrumentedText).toContain(`${traceVar}.push('${idx}');`);
      }
    } finally {
      removeInstrumentedCopy(instrumentedPath);
    }
  });
});
