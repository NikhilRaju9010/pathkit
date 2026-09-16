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
});
