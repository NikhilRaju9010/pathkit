import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project } from 'ts-morph';
import { removeInstrumentedCopy, writeInstrumentedCopy } from '../src/instrument';
import { buildWorkflowGraph } from '../src/graph';
import { parseWorkflowFile } from '../src/parser';

/**
 * G3 is verified at the text/AST level only — re-parse the generated file
 * and assert syntactic validity plus correct scaffolding/edge indices. Live
 * Temporal execution starts at G4.
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

describe('writeInstrumentedCopy — G3 real if/else instrumentation (Gap 2)', () => {
  it('simple-if-else: pushes the correct true/false edge indices and is syntactically valid', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m2', 'simple-if-else.ts', 'simpleIfElse');
    try {
      assertSyntacticallyValid(instrumentedText);

      const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
      const fn = parseWorkflowFile(filePath).find((f) => f.name === 'simpleIfElse')!;
      const graph = buildWorkflowGraph(fn.node, 'simpleIfElse');
      const decisionId = graph.nodes.find((n) => n.kind === 'decision')!.id;
      const trueIdx = graph.edges.findIndex((e) => e.from === decisionId && e.label === 'true');
      const falseIdx = graph.edges.findIndex((e) => e.from === decisionId && e.label === 'false');

      expect(instrumentedText).toContain(`__pathkitTrace__simpleIfElse.push('${trueIdx}');`);
      expect(instrumentedText).toContain(`__pathkitTrace__simpleIfElse.push('${falseIdx}');`);
    } finally {
      cleanup();
    }
  });

  it('adds the defineQuery/setHandler import, trace array, query definition, and a setHandler call as the first statement', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m2', 'simple-if-else.ts', 'simpleIfElse');
    try {
      expect(instrumentedText).toContain("import { defineQuery, setHandler } from '@temporalio/workflow';");
      expect(instrumentedText).toContain('const __pathkitTrace__simpleIfElse: string[] = [];');
      expect(instrumentedText).toContain(
        "const __pathkit_coverage__simpleIfElse = defineQuery<string[]>('__pathkit_coverage__simpleIfElse');",
      );
      expect(instrumentedText).toContain(
        'setHandler(__pathkit_coverage__simpleIfElse, () => [...__pathkitTrace__simpleIfElse]);',
      );

      // The setHandler call must be the first statement in the function body,
      // i.e. it appears before both push() calls in source order.
      const setHandlerPos = instrumentedText.indexOf('setHandler(__pathkit_coverage__simpleIfElse');
      const firstPushPos = instrumentedText.indexOf('.push(');
      expect(setHandlerPos).toBeGreaterThan(-1);
      expect(setHandlerPos).toBeLessThan(firstPushPos);
    } finally {
      cleanup();
    }
  });

  it('nested-if-else (reusing Gap 1s M2 fixture): both decision nodes get distinct, correctly-indexed push calls', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m2', 'nested-if-else.ts', 'nestedIfElse');
    try {
      assertSyntacticallyValid(instrumentedText);

      const filePath = path.join(__dirname, 'fixtures', 'm2', 'nested-if-else.ts');
      const fn = parseWorkflowFile(filePath).find((f) => f.name === 'nestedIfElse')!;
      const graph = buildWorkflowGraph(fn.node, 'nestedIfElse');
      const decisionIds = graph.nodes.filter((n) => n.kind === 'decision').map((n) => n.id);
      expect(decisionIds).toHaveLength(2);

      const expectedIndices = new Set<number>();
      for (const id of decisionIds) {
        expectedIndices.add(graph.edges.findIndex((e) => e.from === id && e.label === 'true'));
        expectedIndices.add(graph.edges.findIndex((e) => e.from === id && e.label === 'false'));
      }
      expect(expectedIndices.size).toBe(4); // 2 decisions x 2 edges each, all distinct

      for (const idx of expectedIndices) {
        expect(instrumentedText).toContain(`__pathkitTrace__nestedIfElse.push('${idx}');`);
      }
      // Exactly 4 push calls total — no duplicates, nothing missed.
      expect(instrumentedText.match(/__pathkitTrace__nestedIfElse\.push\(/g)).toHaveLength(4);
    } finally {
      cleanup();
    }
  });

  it('if-no-else: synthesizes an empty else block carrying the false-edge push', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('m2', 'if-no-else.ts', 'ifNoElse');
    try {
      assertSyntacticallyValid(instrumentedText);
      expect(instrumentedText).toMatch(/}\s*else\s*{\s*__pathkitTrace__ifNoElse\.push\('\d+'\);\s*}/);
      // The original single trailing return, after the if, must survive untouched.
      expect(instrumentedText).toContain("return 'non-positive';");
    } finally {
      cleanup();
    }
  });

  it('braceless if/else (no blocks at all): wraps both arms in a block without changing behavior', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('g3', 'braceless-if-else.ts', 'bracelessIfElse');
    try {
      assertSyntacticallyValid(instrumentedText);
      expect(instrumentedText).toMatch(/if \(isHeads\) \{ __pathkitTrace__bracelessIfElse\.push\('\d+'\); return 'heads'; }/);
      expect(instrumentedText).toMatch(/else \{ __pathkitTrace__bracelessIfElse\.push\('\d+'\); return 'tails'; }/);
    } finally {
      cleanup();
    }
  });

  it('merges defineQuery/setHandler into an existing @temporalio/workflow named import instead of adding a duplicate one', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('g3', 'if-with-existing-import.ts', 'ifWithExistingImport');
    try {
      assertSyntacticallyValid(instrumentedText);
      const importLines = instrumentedText.split('\n').filter((line) => line.includes("from '@temporalio/workflow'"));
      expect(importLines).toHaveLength(1);
      expect(importLines[0]).toContain('proxyActivities');
      expect(importLines[0]).toContain('defineQuery');
      expect(importLines[0]).toContain('setHandler');
      // The original activity proxy binding must be untouched.
      expect(instrumentedText).toContain('const { doWork } = proxyActivities<{ doWork(): Promise<string> }>({');
    } finally {
      cleanup();
    }
  });

  it('merges into a multi-line named import that ends with a trailing comma before `}` (the default Prettier style) without producing a leading-comma syntax error', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('g3', 'if-with-trailing-comma-import.ts', 'ifWithTrailingCommaImport');
    try {
      assertSyntacticallyValid(instrumentedText);
      const importLines = instrumentedText.split('\n').filter((line) => line.includes("from '@temporalio/workflow'"));
      expect(importLines).toHaveLength(1);
      // The merged names must land right after the last existing element
      // (`proxyActivities`), not after its trailing comma — a `, defineQuery`
      // inserted right before the closing `}` in this format would produce
      // `proxyActivities,\n, defineQuery}`, a syntax error caught by
      // `assertSyntacticallyValid` above; this asserts the specific shape
      // that must NOT appear.
      expect(instrumentedText).not.toMatch(/,\s*\n\s*,\s*(defineQuery|setHandler)/);
      expect(instrumentedText).toContain('CancellationScope');
      expect(instrumentedText).toContain('isCancellation');
      expect(instrumentedText).toContain('proxyActivities');
      expect(instrumentedText).toContain('defineQuery');
      expect(instrumentedText).toContain('setHandler');
      // The original activity proxy binding must be untouched.
      expect(instrumentedText).toContain('const { doWork } = proxyActivities<{ doWork(): Promise<string> }>({');
    } finally {
      cleanup();
    }
  });

  it('a function with no branches at all still gets scaffolding but no push calls', () => {
    const { instrumentedText, cleanup } = instrumentAndRead('g2', 'workflow-with-import.ts', 'usesHelper');
    try {
      assertSyntacticallyValid(instrumentedText);
      expect(instrumentedText).toContain('const __pathkitTrace__usesHelper: string[] = [];');
      expect(instrumentedText).not.toMatch(/__pathkitTrace__usesHelper\.push\(/);
    } finally {
      cleanup();
    }
  });

  it('throws a clear PathKitError for a function with an implicit-return arrow body (no block to instrument)', () => {
    const filePath = path.join(__dirname, 'fixtures', 'g3', 'implicit-return.ts');
    expect(() => writeInstrumentedCopy(filePath, 'implicitReturn')).toThrow(/block body/i);
  });
});
