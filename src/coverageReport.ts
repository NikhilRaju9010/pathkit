import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PathKitError } from './errors';
import { buildWorkflowGraphWithNodeRefs, WorkflowGraph } from './graph';
import { enumeratePathsWithEdgeIndices } from './paths';
import { parseWorkflowFile } from './parser';

/**
 * The on-disk shape of one recorded coverage trace (written by G10's
 * `recordCoverageTrace`, read here). `schemaVersion` is checked exactly —
 * an unrecognized version is reported as unmatched rather than guessed at.
 * `sourceHash` is a plain `sha256` hex digest of the *original* (not
 * instrumented) workflow file's full text at the moment the trace was
 * recorded, used to detect a trace recorded against a stale version of the
 * workflow (see `computeSourceHash` and the `allowStale` option below).
 */
export interface CoverageTraceFile {
  schemaVersion: 1;
  workflowFile: string;
  functionName: string;
  sourceHash: string;
  recordedAt: string;
  rawTrace: string[];
}

/** One declared path, named for human-readable reporting. */
export interface NamedPath {
  edgeIndices: number[];
  description: string;
}

/** A trace file that couldn't be counted as covering any declared path, with why. */
export interface UnmatchedTrace {
  traceFilePath: string;
  reason: string;
  rawTrace?: string[];
}

export interface CoverageReport {
  functionName: string;
  /** From `enumeratePathsWithEdgeIndices` — see its own doc comment for what this means (the graph's own `maxPaths` cap, not a trace-related limit). */
  truncated: boolean;
  totalPaths: number;
  coveredCount: number;
  /** 0–100. Always computed against `totalPaths`, which is exactly what's reported alongside it, so a `truncated` report's percentage is never presented as more complete than it is. */
  percentage: number;
  coveredPaths: NamedPath[];
  untestedPaths: NamedPath[];
  unmatchedTraces: UnmatchedTrace[];
}

export interface MergeCoverageTracesOptions {
  /**
   * When false (the default), a trace whose `sourceHash` doesn't match the
   * workflow file's current text is reported as unmatched rather than
   * compared — since the file may have changed in ways that invalidate the
   * trace's recorded edge indices. Set true to compare it anyway (e.g. when
   * you know the change was cosmetic — see LIMITATIONS.md for why
   * `sourceHash` can false-positive on a purely cosmetic change).
   */
  allowStale?: boolean;
}

export function computeSourceHash(sourceText: string): string {
  return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

/**
 * Merges one or more recorded coverage trace files (see `CoverageTraceFile`)
 * against the full set of statically-declared paths for one workflow
 * function, producing a `CoverageReport`.
 *
 * Each raw trace is first collapsed (see `collapseRepeatedEdges`) to undo
 * retry-loop iteration before being compared against a declared path by
 * exact edge-index sequence — never by label text, since two different
 * decision points can share a label (e.g. two unrelated `if`s both having a
 * `"true"` edge). A trace that can't be read, has an unrecognized
 * `schemaVersion`, has a stale `sourceHash` (unless `allowStale` is set), or
 * doesn't correspond to any currently-declared path at all is reported in
 * `unmatchedTraces`, never silently dropped or force-matched. A trace file
 * recorded for a different function is silently skipped (not an error — a
 * trace directory commonly holds traces for many functions at once).
 */
export function mergeCoverageTraces(
  workflowFilePath: string,
  functionName: string,
  traceFilePaths: readonly string[],
  options: MergeCoverageTracesOptions = {},
): CoverageReport {
  const allowStale = options.allowStale ?? false;

  const parsed = parseWorkflowFile(workflowFilePath);
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new PathKitError(`Workflow file ${workflowFilePath} has no exported function named ${functionName}`);
  }

  const { graph, outcomeEdgeIndex } = buildWorkflowGraphWithNodeRefs(fn.node, functionName);
  const { paths: declaredPaths, truncated } = enumeratePathsWithEdgeIndices(graph);
  const instrumentedIndices = new Set(outcomeEdgeIndex.values());

  // Only edges that are some decision's own tracked outcome can ever appear
  // in a raw trace (they're the only ones a push() call is inserted for) —
  // every declared path also contains the plain, never-instrumented ''
  // connector edge from Start, which must be filtered out before comparing
  // a declared path's edge sequence against a real recorded trace.
  const matchableSequences = declaredPaths.map((p) =>
    p.edgeIndices.filter((idx) => instrumentedIndices.has(idx)).map(String),
  );

  const currentSourceHash = computeSourceHash(readFileSync(workflowFilePath, 'utf8'));
  const covered = new Set<number>();
  const unmatchedTraces: UnmatchedTrace[] = [];

  for (const traceFilePath of traceFilePaths) {
    let traceFile: CoverageTraceFile;
    try {
      traceFile = JSON.parse(readFileSync(traceFilePath, 'utf8')) as CoverageTraceFile;
    } catch (err) {
      unmatchedTraces.push({ traceFilePath, reason: `Could not read or parse trace file: ${(err as Error).message}` });
      continue;
    }

    if (traceFile.schemaVersion !== 1) {
      unmatchedTraces.push({
        traceFilePath,
        reason: `Unsupported trace schemaVersion: ${JSON.stringify(traceFile.schemaVersion)} (expected 1).`,
      });
      continue;
    }
    if (traceFile.functionName !== functionName) {
      continue; // a trace for a different function — not an error, just not relevant to this report
    }
    if (traceFile.sourceHash !== currentSourceHash && !allowStale) {
      unmatchedTraces.push({
        traceFilePath,
        reason:
          `This trace was recorded against a different version of "${workflowFilePath}" (sourceHash mismatch). ` +
          `Re-record it, or pass allowStale to compare anyway.`,
        rawTrace: traceFile.rawTrace,
      });
      continue;
    }

    const collapsed = collapseRepeatedEdges(traceFile.rawTrace);
    const matchIndex = matchableSequences.findIndex((seq) => arraysEqual(seq, collapsed));
    if (matchIndex === -1) {
      unmatchedTraces.push({
        traceFilePath,
        reason: 'This trace does not correspond to any currently-declared path.',
        rawTrace: traceFile.rawTrace,
      });
      continue;
    }
    covered.add(matchIndex);
  }

  const toNamedPath = (index: number): NamedPath => ({
    edgeIndices: declaredPaths[index]!.edgeIndices,
    description: describePath(graph, declaredPaths[index]!.edgeIndices),
  });

  const coveredPaths = [...covered].sort((a, b) => a - b).map(toNamedPath);
  const untestedPaths = declaredPaths
    .map((_, index) => index)
    .filter((index) => !covered.has(index))
    .map(toNamedPath);

  const totalPaths = declaredPaths.length;
  return {
    functionName,
    truncated,
    totalPaths,
    coveredCount: covered.size,
    percentage: totalPaths === 0 ? 0 : (covered.size / totalPaths) * 100,
    coveredPaths,
    untestedPaths,
    unmatchedTraces,
  };
}

/**
 * Undoes retry-loop iteration in a raw runtime trace so it can be compared
 * against a declared path, which (per `paths.ts`) never reuses the same
 * edge twice. Whenever an edge index repeats, this rewinds — discarding
 * everything recorded since (and including) its first occurrence — and
 * keeps going from the repeat, so only the *most recent* pass through any
 * cycle survives. This needs no special knowledge of which edges are
 * "loop" edges: in the constructs Gap 1 currently models, the only way the
 * same push() call site fires more than once in one execution is a loop
 * iterating, so any repeated edge index is, by construction, a cycle.
 *
 * A concrete consequence, documented in LIMITATIONS.md: a raw trace that
 * retried one or more times and then reached a *different* outcome than
 * the loop's own "exit" edge (e.g. it eventually succeeded) collapses down
 * to exactly the same declared path as an execution that never retried at
 * all — Gap 1's own graph has no declared path that represents "retried,
 * then succeeded" as distinct from "succeeded immediately", since a
 * declared path can only take the loop's back-edge once, and taking it at
 * all forces the very next hop to be the loop's "exit" edge, not back into
 * the body. This collapsing is honest about that limit rather than
 * inventing a path that doesn't exist in the graph: it only ever discards
 * *how many times* a cycle repeated, never invents a match that isn't
 * really a valid walk through the graph.
 */
function collapseRepeatedEdges(rawTrace: readonly string[]): string[] {
  const collapsed: string[] = [];
  const positionOf = new Map<string, number>();

  for (const edgeIndex of rawTrace) {
    const priorPosition = positionOf.get(edgeIndex);
    if (priorPosition !== undefined) {
      collapsed.length = priorPosition;
      for (const [key, pos] of positionOf) {
        if (pos >= priorPosition) positionOf.delete(key);
      }
    }
    positionOf.set(edgeIndex, collapsed.length);
    collapsed.push(edgeIndex);
  }

  return collapsed;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function describePath(graph: WorkflowGraph, edgeIndices: readonly number[]): string {
  const labelOf = (nodeId: string): string => graph.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;

  let description = labelOf(graph.startNodeId);
  for (const index of edgeIndices) {
    const edge = graph.edges[index]!;
    const arrow = edge.label === '' ? ' -> ' : ` --${edge.label}--> `;
    description += `${arrow}${labelOf(edge.to)}`;
  }
  return description;
}
