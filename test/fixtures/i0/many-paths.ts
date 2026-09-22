// 3 independent, non-early-returning if/else pairs => 2^3 = 8 distinct paths,
// well under the maxPaths cap. Exists as a clean, uncapped fixture for
// --limit display-truncation tests, unconfused with enumeratePaths()'s own
// maxPaths truncation (which test/fixtures/m6/pathological-explosion.ts
// already covers).
export async function manyPathsWorkflow(c1: boolean, c2: boolean, c3: boolean): Promise<string> {
  let result = '';
  if (c1) { result += 'A'; } else { result += 'a'; }
  if (c2) { result += 'B'; } else { result += 'b'; }
  if (c3) { result += 'C'; } else { result += 'c'; }
  return result;
}
