import { WorkflowGraph, WorkflowGraphNode } from './graph';

/**
 * Renders a workflow graph as Mermaid flowchart syntax. Verified against the
 * real `mermaid` package's own parser (not just eyeballed) for: quoted
 * rhombus/stadium labels containing parentheses, quotes, and a retry
 * back-edge cycle — see the manual verification notes in CLAUDE.md.
 */
export function renderMermaid(graph: WorkflowGraph): string {
  const lines: string[] = ['flowchart TD'];

  for (const node of graph.nodes) {
    lines.push(`  ${node.id}${renderNodeShape(node)}`);
  }

  for (const edge of graph.edges) {
    if (edge.label === '') {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} -->|${escapeMermaidText(edge.label)}| ${edge.to}`);
    }
  }

  return lines.join('\n');
}

function renderNodeShape(node: WorkflowGraphNode): string {
  const label = escapeMermaidText(node.label);
  if (node.kind === 'decision') {
    return `{"${label}"}`;
  }
  return `(["${label}"])`; // start and end both use a stadium shape
}

function escapeMermaidText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
