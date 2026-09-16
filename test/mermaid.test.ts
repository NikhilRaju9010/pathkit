import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { buildWorkflowGraph } from '../src/graph';
import { renderMermaid } from '../src/mermaid';

describe('renderMermaid', () => {
  it('matches the known-good Mermaid output for the retry-loop fixture', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm5', 'retry-loop.ts');
    const [fn] = parseWorkflowFile(filePath);
    if (fn === undefined) {
      throw new Error('fixture has no exported function');
    }
    const graph = buildWorkflowGraph(fn.node, fn.name);
    expect(renderMermaid(graph)).toMatchSnapshot();
  });

  it('escapes special characters so the output stays valid Mermaid syntax', () => {
    const filePath = path.join(__dirname, 'fixtures', 'm2', 'simple-if-else.ts');
    const [fn] = parseWorkflowFile(filePath);
    if (fn === undefined) {
      throw new Error('fixture has no exported function');
    }
    const graph = buildWorkflowGraph(fn.node, fn.name);
    const text = renderMermaid(graph);
    expect(text.startsWith('flowchart TD')).toBe(true);
    expect(text).toContain('n0(["Start"])');
    expect(text).toContain('n1{"if (isHeads)"}');
  });
});
