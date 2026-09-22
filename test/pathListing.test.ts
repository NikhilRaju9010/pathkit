import * as path from 'node:path';
import { parseWorkflowFile } from '../src/parser';
import { buildWorkflowGraph } from '../src/graph';
import { enumeratePathsWithEdgeIndices } from '../src/paths';
import { WorkflowGraph } from '../src/graph';
import { buildPathListing } from '../src/pathListing';
import { PathEnumerationWithEdgeIndicesResult } from '../src/paths';

function pathResultOf(
  milestone: string,
  fileName: string,
  functionName: string,
): { graph: WorkflowGraph; pathResult: PathEnumerationWithEdgeIndicesResult } {
  const filePath = path.join(__dirname, 'fixtures', milestone, fileName);
  const parsed = parseWorkflowFile(filePath);
  const fn = parsed.find((f) => f.name === functionName);
  if (fn === undefined) {
    throw new Error(`fixture ${milestone}/${fileName} has no exported function named ${functionName}`);
  }
  const graph = buildWorkflowGraph(fn.node, fn.name);
  return { graph, pathResult: enumeratePathsWithEdgeIndices(graph) };
}

describe('buildPathListing', () => {
  it('with no limit, includes every enumerated path as a numbered entry with no omissions', () => {
    const { graph, pathResult } = pathResultOf('m2', 'simple-if-else.ts', 'simpleIfElse');
    const listing = buildPathListing(graph, pathResult);

    expect(listing.totalEnumerated).toBe(2);
    expect(listing.enumerationTruncated).toBe(false);
    expect(listing.omittedByLimit).toBe(0);
    expect(listing.entries).toEqual([
      { index: 1, description: 'Start -> if (isHeads) --true--> End' },
      { index: 2, description: 'Start -> if (isHeads) --false--> End' },
    ]);
  });

  it('with a limit smaller than the total, truncates entries and reports how many were omitted', () => {
    const { graph, pathResult } = pathResultOf('i0', 'many-paths.ts', 'manyPathsWorkflow');
    const listing = buildPathListing(graph, pathResult, 3);

    expect(listing.totalEnumerated).toBe(8);
    expect(listing.entries).toHaveLength(3);
    expect(listing.entries.map((e: { index: number }) => e.index)).toEqual([1, 2, 3]);
    expect(listing.omittedByLimit).toBe(5);
  });

  it('with a limit greater than or equal to the total, includes everything and omits nothing', () => {
    const { graph, pathResult } = pathResultOf('m2', 'simple-if-else.ts', 'simpleIfElse');
    const listing = buildPathListing(graph, pathResult, 10);

    expect(listing.entries).toHaveLength(2);
    expect(listing.omittedByLimit).toBe(0);
  });

  it('surfaces enumeratePathsWithEdgeIndices\'s own truncated flag unchanged', () => {
    const { graph, pathResult } = pathResultOf('m6', 'pathological-explosion.ts', 'combinatorialExplosionWorkflow');
    const listing = buildPathListing(graph, pathResult);

    expect(listing.enumerationTruncated).toBe(true);
    expect(listing.totalEnumerated).toBe(2000);
  });
});
