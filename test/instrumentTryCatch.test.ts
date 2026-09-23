import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from 'ts-morph';
import { buildWorkflowGraph } from '../src/graph';
import { removeInstrumentedCopy, writeInstrumentedCopy } from '../src/instrument';
import { parseWorkflowFile } from '../src/parser';

/**
 * G5 is verified at the text/AST level only, same as G3 — no live Temporal
 * run needed here (that's `test/coverage-e2e.test.ts`).
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

describe('writeInstrumentedCopy — G5 real try/catch-around-activity instrumentation (Gap 2)', () => {
  it('pushes the success edge right before the try block ends, and the failure edge right after the catch block starts', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m3', 'try-catch-around-activity.ts', 'chargeCardWorkflow');
    try {
      assertSyntacticallyValid(instrumentedText);

      const filePath = path.join(__dirname, 'fixtures', 'm3', 'try-catch-around-activity.ts');
      const fn = parseWorkflowFile(filePath).find((f) => f.name === 'chargeCardWorkflow')!;
      const graph = buildWorkflowGraph(fn.node, 'chargeCardWorkflow');
      const decisionId = graph.nodes.find((n) => n.kind === 'decision')!.id;
      const successIdx = graph.edges.findIndex((e) => e.from === decisionId && e.label === 'success');
      const failureIdx = graph.edges.findIndex((e) => e.from === decisionId && e.label === 'failure');

      expect(instrumentedText).toContain(`__pathkitTrace__chargeCardWorkflow.push('${successIdx}');`);
      expect(instrumentedText).toContain(`__pathkitTrace__chargeCardWorkflow.push('${failureIdx}');`);

      // The success push must appear inside the try block, after the
      // activity call and before the closing brace; the failure push must
      // appear inside the catch block, before the "return" it contains.
      const activityCallPos = instrumentedText.indexOf('await chargeCard(accountId);');
      const successPushPos = instrumentedText.indexOf(`.push('${successIdx}')`);
      const catchPos = instrumentedText.indexOf('} catch (err) {');
      const failurePushPos = instrumentedText.indexOf(`.push('${failureIdx}')`);
      const failureReturnPos = instrumentedText.indexOf("return 'charge failed';");

      expect(activityCallPos).toBeLessThan(successPushPos);
      expect(successPushPos).toBeLessThan(catchPos);
      expect(catchPos).toBeLessThan(failurePushPos);
      expect(failurePushPos).toBeLessThan(failureReturnPos);
    } finally {
      cleanup();
    }
  });

  it('inserts the success push before a trailing `return`, not after it, so the push is actually reachable', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m3', 'try-catch-trailing-return.ts', 'chargeCardReturningDirectlyWorkflow');
    try {
      assertSyntacticallyValid(instrumentedText);

      const filePath = path.join(__dirname, 'fixtures', 'm3', 'try-catch-trailing-return.ts');
      const fn = parseWorkflowFile(filePath).find((f) => f.name === 'chargeCardReturningDirectlyWorkflow')!;
      const graph = buildWorkflowGraph(fn.node, 'chargeCardReturningDirectlyWorkflow');
      const decisionId = graph.nodes.find((n) => n.kind === 'decision')!.id;
      const successIdx = graph.edges.findIndex((e) => e.from === decisionId && e.label === 'success');

      const successPushText = `__pathkitTrace__chargeCardReturningDirectlyWorkflow.push('${successIdx}');`;
      const successPushPos = instrumentedText.indexOf(successPushText);
      const returnPos = instrumentedText.indexOf('return await chargeCard(accountId);');

      expect(successPushPos).toBeGreaterThan(-1);
      // The push must come BEFORE the return, not after it — inserted
      // after, it would be unreachable dead code and this try's "success"
      // outcome would never actually get recorded by a real test run.
      expect(successPushPos).toBeLessThan(returnPos);
      expect(instrumentedText).toContain(`${successPushText} return await chargeCard(accountId);`);
    } finally {
      cleanup();
    }
  });

  it('does not instrument a try/catch that is not recognized as wrapping an activity call', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m3', 'try-catch-non-activity.ts', 'parseInputWorkflow');
    try {
      assertSyntacticallyValid(instrumentedText);
      // Scaffolding is still added (the function has a try/catch, but it's
      // not a decision node at all per Gap 1), but there must be no push
      // calls, since there is nothing to instrument.
      expect(instrumentedText).toContain('const __pathkitTrace__parseInputWorkflow: string[] = [];');
      expect(instrumentedText).not.toMatch(/__pathkitTrace__parseInputWorkflow\.push\(/);
      expect(instrumentedText).toContain('return JSON.parse(rawInput) as number;');
    } finally {
      cleanup();
    }
  });

  it('composes correctly with if/else instrumentation in the same function (real demo/ shape)', () => {
    const demoFilePath = path.resolve(__dirname, '..', 'demo', 'order-processing-workflow.ts');
    const instrumentedPath = writeInstrumentedCopy(demoFilePath, 'orderProcessingWorkflow');
    try {
      const instrumentedText = fs.readFileSync(instrumentedPath, 'utf8');
      assertSyntacticallyValid(instrumentedText);

      const fn = parseWorkflowFile(demoFilePath).find((f) => f.name === 'orderProcessingWorkflow')!;
      const graph = buildWorkflowGraph(fn.node, 'orderProcessingWorkflow');
      const ifNode = graph.nodes.find((n) => n.label.startsWith('if ('))!;
      const tryNode = graph.nodes.find((n) => n.label === 'try/catch (activity)')!;

      const ifTrueIdx = graph.edges.findIndex((e) => e.from === ifNode.id && e.label === 'true');
      const ifFalseIdx = graph.edges.findIndex((e) => e.from === ifNode.id && e.label === 'false');
      const trySuccessIdx = graph.edges.findIndex((e) => e.from === tryNode.id && e.label === 'success');
      const tryFailureIdx = graph.edges.findIndex((e) => e.from === tryNode.id && e.label === 'failure');

      const traceVar = '__pathkitTrace__orderProcessingWorkflow';
      for (const idx of [ifTrueIdx, ifFalseIdx, trySuccessIdx, tryFailureIdx]) {
        expect(instrumentedText).toContain(`${traceVar}.push('${idx}');`);
      }
      // Exactly 4 pushes total: 2 for the if/else, 2 for the try/catch.
      expect(instrumentedText.match(new RegExp(`${traceVar}\\.push\\(`, 'g'))).toHaveLength(4);
    } finally {
      removeInstrumentedCopy(instrumentedPath);
    }
  });
});
