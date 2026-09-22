import { WorkflowGraph } from './graph';
import { describePath, PathEnumerationWithEdgeIndicesResult } from './paths';

/** One numbered, display-ready path entry — no terminal formatting (spacing, color) baked in. */
export interface AnalyzePathEntry {
  index: number;
  description: string;
}

export interface AnalyzePathListing {
  /** How many paths `enumeratePathsWithEdgeIndices` actually returned (itself capped by `maxPaths`). */
  totalEnumerated: number;
  /** `enumeratePathsWithEdgeIndices`'s own `truncated` flag, passed through unchanged. */
  enumerationTruncated: boolean;
  /** Entries to display, sliced to `limit` if one was given. */
  entries: AnalyzePathEntry[];
  /** How many enumerated paths were left out of `entries` because of `limit`; 0 if no limit applied. */
  omittedByLimit: number;
}

/**
 * Turns an enumerated path list into structured, display-ready data — no
 * string joining, numbering prefix style, spacing, or color, so a future
 * consumer (e.g. an HTML report) can render the same data its own way
 * instead of reimplementing this. `pathkit analyze`'s CLI-level renderer
 * (`renderPathListingText` in `cli.ts`) is the first, terminal-specific
 * consumer of this data.
 */
export function buildPathListing(
  graph: WorkflowGraph,
  pathResult: PathEnumerationWithEdgeIndicesResult,
  limit?: number,
): AnalyzePathListing {
  const shownCount = limit === undefined ? pathResult.paths.length : Math.min(limit, pathResult.paths.length);

  const entries: AnalyzePathEntry[] = pathResult.paths.slice(0, shownCount).map((p, i) => ({
    index: i + 1,
    description: describePath(graph, p.edgeIndices),
  }));

  return {
    totalEnumerated: pathResult.paths.length,
    enumerationTruncated: pathResult.truncated,
    entries,
    omittedByLimit: pathResult.paths.length - shownCount,
  };
}
