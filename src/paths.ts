import { WorkflowGraph } from './graph';

/** An ordered sequence of edge labels from Start to End. */
export type WorkflowPath = string[];

export interface PathEnumerationResult {
  paths: WorkflowPath[];
  /**
   * True if enumeration stopped after hitting `maxPaths` before exhausting
   * every possible path — `paths` is a partial, non-exhaustive list in that
   * case. Rendering this as a "N+ paths (truncated)" message is a CLI-level
   * concern (M7), not this function's.
   */
  truncated: boolean;
}

export const DEFAULT_MAX_PATHS = 2000;

interface IndexedEdge {
  to: string;
  label: string;
  index: number;
}

/**
 * Enumerates every distinct Start-to-End path through a workflow graph, in
 * deterministic order (edges are followed in the order they were created —
 * see graph.ts).
 *
 * M5's graphs can contain cycles (retry loops), so naive enumeration could
 * recurse forever. The fix used here: a single path may never traverse the
 * same edge twice. Since the graph has finitely many edges, this bounds
 * every path's length by the edge count, guaranteeing termination — no
 * separate "is this a back-edge" detection is needed. Concretely, this means
 * a loop's "retry" back-edge can be taken once per path (producing one
 * representative "retry was taken" path) but not repeatedly (which would
 * otherwise produce one path per possible iteration count, i.e. infinitely
 * many for an unbounded retry loop). For an acyclic graph this constraint
 * never actually triggers, since a plain depth-first walk never revisits an
 * edge anyway — so path counts for M2-M4's fixtures are unaffected.
 *
 * `maxPaths` (default `DEFAULT_MAX_PATHS`) is a hard cap applied regardless
 * of whether the graph is cyclic — a large acyclic graph (many independent
 * if/else branches multiplying combinatorially) can also produce more paths
 * than anyone needs enumerated. Enumeration stops as soon as the cap is
 * reached, rather than continuing and discarding the excess.
 */
export function enumeratePaths(graph: WorkflowGraph, maxPaths: number = DEFAULT_MAX_PATHS): PathEnumerationResult {
  const { paths, truncated } = enumerateIndexedPaths(graph, maxPaths);
  return { paths: paths.map((indices) => indices.map((i) => graph.edges[i]!.label)), truncated };
}

/** One declared Start-to-End path, as both its edge labels (same as `WorkflowPath`) and the underlying `graph.edges` indices that produced them. */
export interface PathWithEdgeIndices {
  labels: string[];
  edgeIndices: number[];
}

export interface PathEnumerationWithEdgeIndicesResult {
  paths: PathWithEdgeIndices[];
  truncated: boolean;
}

/**
 * Same enumeration as {@link enumeratePaths}, but each path also carries the
 * `graph.edges` array indices it's made of, not just their labels — needed
 * by Gap 2's coverage matching (`coverageReport.ts`) to compare a real
 * execution trace (recorded by edge index, not label text — two different
 * decision points can share a label like `"true"`) against a declared path
 * precisely.
 */
export function enumeratePathsWithEdgeIndices(
  graph: WorkflowGraph,
  maxPaths: number = DEFAULT_MAX_PATHS,
): PathEnumerationWithEdgeIndicesResult {
  const { paths, truncated } = enumerateIndexedPaths(graph, maxPaths);
  return {
    paths: paths.map((edgeIndices) => ({ edgeIndices, labels: edgeIndices.map((i) => graph.edges[i]!.label) })),
    truncated,
  };
}

function enumerateIndexedPaths(graph: WorkflowGraph, maxPaths: number): { paths: number[][]; truncated: boolean } {
  const edgesByFrom = groupEdgesByFromNode(graph);

  const paths: number[][] = [];
  let truncated = false;
  const usedEdgeIndices = new Set<number>();
  const indicesSoFar: number[] = [];

  function visit(nodeId: string): void {
    if (truncated) return;

    if (nodeId === graph.endNodeId) {
      paths.push([...indicesSoFar]);
      if (paths.length >= maxPaths) {
        truncated = true;
      }
      return;
    }

    for (const edge of edgesByFrom.get(nodeId) ?? []) {
      if (truncated) return;
      if (usedEdgeIndices.has(edge.index)) continue;

      usedEdgeIndices.add(edge.index);
      indicesSoFar.push(edge.index);

      visit(edge.to);

      indicesSoFar.pop();
      usedEdgeIndices.delete(edge.index);
    }
  }

  visit(graph.startNodeId);

  return { paths, truncated };
}

/**
 * Renders one declared path (as returned by {@link enumeratePathsWithEdgeIndices})
 * as a human-readable `Start -> ... --label--> ... -> End` chain, using each
 * node's own graph label (e.g. an `if`'s condition text). Shared by Gap 2's
 * `coverageReport.ts` (per-path descriptions in a `CoverageReport`) and Gap
 * 3's `report` command, so both ever produce path descriptions the same way.
 */
export function describePath(graph: WorkflowGraph, edgeIndices: readonly number[]): string {
  const labelOf = (nodeId: string): string => graph.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;

  let description = labelOf(graph.startNodeId);
  for (const index of edgeIndices) {
    const edge = graph.edges[index]!;
    const arrow = edge.label === '' ? ' -> ' : ` --${edge.label}--> `;
    description += `${arrow}${labelOf(edge.to)}`;
  }
  return description;
}

function groupEdgesByFromNode(graph: WorkflowGraph): Map<string, IndexedEdge[]> {
  const edgesByFrom = new Map<string, IndexedEdge[]>();
  graph.edges.forEach((edge, index) => {
    const existing = edgesByFrom.get(edge.from);
    const indexedEdge: IndexedEdge = { to: edge.to, label: edge.label, index };
    if (existing === undefined) {
      edgesByFrom.set(edge.from, [indexedEdge]);
    } else {
      existing.push(indexedEdge);
    }
  });
  return edgesByFrom;
}
