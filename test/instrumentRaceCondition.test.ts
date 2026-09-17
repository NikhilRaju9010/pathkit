import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from 'ts-morph';
import { buildWorkflowGraph } from '../src/graph';
import { removeInstrumentedCopy, writeInstrumentedCopy } from '../src/instrument';
import { parseWorkflowFile } from '../src/parser';

/**
 * G6 is verified at the text/AST level only, same as G3/G5 — the live
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

function edgeIndexOf(filePath: string, functionName: string, decisionLabel: string, edgeLabel: string): number {
  const fn = parseWorkflowFile(filePath).find((f) => f.name === functionName)!;
  const graph = buildWorkflowGraph(fn.node, functionName);
  const decisionId = graph.nodes.find((n) => n.label === decisionLabel)!.id;
  return graph.edges.findIndex((e) => e.from === decisionId && e.label === edgeLabel);
}

describe('writeInstrumentedCopy — G6 real Promise.race/condition() instrumentation (Gap 2)', () => {
  it('Promise.race: rewrites a bare discarded-value statement to push the winning label via __pathkitRace', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m4', 'timeout-race.ts', 'raceTimeoutWorkflow');
    try {
      assertSyntacticallyValid(instrumentedText);
      expect(instrumentedText).toContain('function __pathkitRace(promises, labels) {');

      const filePath = path.join(__dirname, 'fixtures', 'm4', 'timeout-race.ts');
      const successIdx = edgeIndexOf(filePath, 'raceTimeoutWorkflow', 'Promise.race (timeout)', 'success');
      const timeoutIdx = edgeIndexOf(filePath, 'raceTimeoutWorkflow', 'Promise.race (timeout)', 'timeout');

      expect(instrumentedText).toContain(
        `__pathkitTrace__raceTimeoutWorkflow.push(await __pathkitRace([processOrderPromise, sleep(timeoutMs)], ` +
          `['${successIdx}', '${timeoutIdx}']));`,
      );
    } finally {
      cleanup();
    }
  });

  it('condition() (no timeout): pushes the signaled edge unconditionally right after the statement', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m4', 'signal-condition.ts', 'signalConditionWorkflow');
    try {
      assertSyntacticallyValid(instrumentedText);
      expect(instrumentedText).not.toContain('__pathkitRace'); // no race in this function, helper omitted

      const filePath = path.join(__dirname, 'fixtures', 'm4', 'signal-condition.ts');
      const signaledIdx = edgeIndexOf(filePath, 'signalConditionWorkflow', 'condition()', 'signaled');

      expect(instrumentedText).toContain(
        `await condition(() => approved); __pathkitTrace__signalConditionWorkflow.push('${signaledIdx}');`,
      );
    } finally {
      cleanup();
    }
  });

  it('condition() (with timeout): branches on the captured variable to push signaled vs timedOut', () => {
    const { instrumentedText, cleanup } = instrumentAndRead(
      'm4',
      'signal-condition.ts',
      'signalConditionWithTimeoutWorkflow',
    );
    try {
      assertSyntacticallyValid(instrumentedText);

      const filePath = path.join(__dirname, 'fixtures', 'm4', 'signal-condition.ts');
      const signaledIdx = edgeIndexOf(filePath, 'signalConditionWithTimeoutWorkflow', 'condition() (with timeout)', 'signaled');
      const timedOutIdx = edgeIndexOf(filePath, 'signalConditionWithTimeoutWorkflow', 'condition() (with timeout)', 'timedOut');

      expect(instrumentedText).toContain(
        `const metBeforeTimeout = await condition(() => approved, '1 hour'); ` +
          `if (metBeforeTimeout) { __pathkitTrace__signalConditionWithTimeoutWorkflow.push('${signaledIdx}'); } ` +
          `else { __pathkitTrace__signalConditionWithTimeoutWorkflow.push('${timedOutIdx}'); }`,
      );
    } finally {
      cleanup();
    }
  });

  it('composes correctly with if/else and try/catch in the same function (combined-nested fixture)', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m4', 'combined-nested.ts', 'combinedWorkflow');
    try {
      assertSyntacticallyValid(instrumentedText);
      const traceVar = '__pathkitTrace__combinedWorkflow';
      // if/else (2 push call sites, one per arm) + Promise.race (1 site — the
      // winning label is resolved at runtime, not chosen between two source
      // sites) + try/catch (2 sites) + condition() (1 site) = 6 push sites.
      expect(instrumentedText.match(new RegExp(`${traceVar}\\.push\\(`, 'g'))).toHaveLength(6);
    } finally {
      cleanup();
    }
  });

  it('Promise.race: refuses to instrument a race whose result is assigned to a variable', () => {
    const filePath = path.join(__dirname, 'fixtures', 'g6', 'race-result-assigned.ts');
    expect(() => writeInstrumentedCopy(filePath, 'raceResultAssigned')).toThrow(
      /Cannot instrument this Promise\.race usage.*value-discarding statement/s,
    );
  });

  it('condition() (with timeout): refuses to instrument a bare discarded-value statement', () => {
    const filePath = path.join(__dirname, 'fixtures', 'g6', 'condition-timeout-discarded.ts');
    expect(() => writeInstrumentedCopy(filePath, 'conditionTimeoutDiscarded')).toThrow(
      /Cannot instrument this condition\(\) \(with timeout\) usage.*captured into its own variable declaration/s,
    );
  });
});
