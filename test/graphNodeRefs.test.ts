import * as path from 'node:path';
import { Node } from 'ts-morph';
import { parseWorkflowFile } from '../src/parser';
import { buildWorkflowGraph, buildWorkflowGraphWithNodeRefs, WorkflowGraph } from '../src/graph';

type NodeRefsResult = ReturnType<typeof buildWorkflowGraphWithNodeRefs>;

function nodeRefsOf(milestone: string, fileName: string, functionName: string): NodeRefsResult {
  const filePath = path.join(__dirname, 'fixtures', milestone, fileName);
  const parsed = parseWorkflowFile(filePath);
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new Error(`fixture ${milestone}/${fileName} has no exported function named ${functionName}`);
  }
  return buildWorkflowGraphWithNodeRefs(fn.node, fn.name);
}

describe('buildWorkflowGraphWithNodeRefs — G1 (Gap 2)', () => {
  it('maps a flat if/else decision node id to its real IfStatement AST node', () => {
    const { graph, nodeAstRefs } = nodeRefsOf('m2', 'simple-if-else.ts', 'simpleIfElse');
    const decisionNode = graph.nodes.find((n) => n.kind === 'decision');
    expect(decisionNode).toBeDefined();

    const astNode = nodeAstRefs.get(decisionNode!.id);
    expect(astNode).toBeDefined();
    expect(astNode!.getKindName()).toBe('IfStatement');
    expect(Node.isIfStatement(astNode!) && astNode!.getExpression().getText()).toBe('isHeads');
  });

  it('maps both decision node ids in a nested if/else to their own distinct IfStatement nodes', () => {
    const { graph, nodeAstRefs } = nodeRefsOf('m2', 'nested-if-else.ts', 'nestedIfElse');
    const decisionNodes = graph.nodes.filter((n) => n.kind === 'decision');
    expect(decisionNodes).toHaveLength(2);

    const outer = decisionNodes[0]!;
    const inner = decisionNodes[1]!;
    const outerAst = nodeAstRefs.get(outer.id);
    const innerAst = nodeAstRefs.get(inner.id);
    expect(outerAst).toBeDefined();
    expect(innerAst).toBeDefined();
    expect(Node.isIfStatement(outerAst!) && outerAst!.getExpression().getText()).toBe('input > 0');
    expect(Node.isIfStatement(innerAst!) && innerAst!.getExpression().getText()).toBe('input > 100');
    expect(outerAst).not.toBe(innerAst);
  });

  it('has no node-ref entry for start/end nodes', () => {
    const { graph, nodeAstRefs } = nodeRefsOf('m2', 'simple-if-else.ts', 'simpleIfElse');
    const startNode = graph.nodes.find((n) => n.kind === 'start')!;
    const endNode = graph.nodes.find((n) => n.kind === 'end')!;
    expect(nodeAstRefs.has(startNode.id)).toBe(false);
    expect(nodeAstRefs.has(endNode.id)).toBe(false);
  });

  it('buildWorkflowGraph returns exactly the same graph as the .graph half of buildWorkflowGraphWithNodeRefs', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'nested-if-else.ts');
    const fn = parseWorkflowFile(filePath).find((f) => f.name === 'nestedIfElse')!;
    const plain: WorkflowGraph = buildWorkflowGraph(fn.node, fn.name);
    const { graph: withRefs } = buildWorkflowGraphWithNodeRefs(fn.node, fn.name);
    expect(plain).toEqual(withRefs);
  });

  describe('outcomeEdgeIndex (added while fixing a G7 regression)', () => {
    it('resolves a flat if-decision\'s true/false outcomes to the edges actually labeled true/false', () => {
      const { graph, outcomeEdgeIndex } = nodeRefsOf('m2', 'simple-if-else.ts', 'simpleIfElse');
      const decisionId = graph.nodes.find((n) => n.kind === 'decision')!.id;

      const trueIdx = outcomeEdgeIndex.get(`${decisionId}#true`);
      const falseIdx = outcomeEdgeIndex.get(`${decisionId}#false`);
      expect(trueIdx).toBeDefined();
      expect(falseIdx).toBeDefined();
      expect(graph.edges[trueIdx!]).toEqual({ from: decisionId, to: expect.any(String), label: 'true' });
      expect(graph.edges[falseIdx!]).toEqual({ from: decisionId, to: expect.any(String), label: 'false' });
    });

    it("resolves an if's false outcome correctly even when a retry loop overwrites its persisted edge label to 'retry'", () => {
      // test/fixtures/m5/retry-loop.ts: an if with no else, whose only
      // statement is an early `return`, falls through (on the false path)
      // straight to the end of the retry loop's body — graph.ts's own retry
      // back-edge closing overwrites that edge's label from 'false' to
      // 'retry' (see graph.ts's OpenEdge doc comment), which is exactly the
      // scenario outcomeEdgeIndex exists to resolve correctly regardless.
      const { graph, nodeAstRefs, outcomeEdgeIndex } = nodeRefsOf('m5', 'retry-loop.ts', 'retryLoopWorkflow');
      const ifNode = graph.nodes.find((n) => n.label.startsWith('if ('))!;
      expect(nodeAstRefs.get(ifNode.id)).toBeDefined();

      const falseIdx = outcomeEdgeIndex.get(`${ifNode.id}#false`);
      expect(falseIdx).toBeDefined();

      const resolvedEdge = graph.edges[falseIdx!]!;
      expect(resolvedEdge.from).toBe(ifNode.id);
      // The whole point: this edge's *persisted* label is 'retry', not
      // 'false' — a naive `graph.edges.find(e => e.label === 'false')`
      // lookup would find nothing for this if-node at all.
      expect(resolvedEdge.label).toBe('retry');
    });

    it('resolves a retry loop\'s own iterate/exit outcomes correctly', () => {
      const { graph, outcomeEdgeIndex } = nodeRefsOf('m5', 'retry-loop.ts', 'retryLoopWorkflow');
      const loopNode = graph.nodes.find((n) => n.label.startsWith('for ('))!;

      const iterateIdx = outcomeEdgeIndex.get(`${loopNode.id}#iterate`);
      const exitIdx = outcomeEdgeIndex.get(`${loopNode.id}#exit`);
      expect(iterateIdx).toBeDefined();
      expect(exitIdx).toBeDefined();
      expect(graph.edges[iterateIdx!]!.from).toBe(loopNode.id);
      expect(graph.edges[exitIdx!]!.from).toBe(loopNode.id);
    });
  });
});
