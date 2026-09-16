// 12 independent, non-early-returning if/else pairs => 2^12 = 4096 distinct
// paths, comfortably past the default maxPaths cap of 2000. Exists to prove
// enumeratePaths() truncates rather than hanging or exhausting memory on a
// large *acyclic* graph too, not just a cyclic one.
export async function combinatorialExplosionWorkflow(
  c1: boolean,
  c2: boolean,
  c3: boolean,
  c4: boolean,
  c5: boolean,
  c6: boolean,
  c7: boolean,
  c8: boolean,
  c9: boolean,
  c10: boolean,
  c11: boolean,
  c12: boolean,
): Promise<string> {
  let result = '';
  if (c1) { result += 'A'; } else { result += 'a'; }
  if (c2) { result += 'B'; } else { result += 'b'; }
  if (c3) { result += 'C'; } else { result += 'c'; }
  if (c4) { result += 'D'; } else { result += 'd'; }
  if (c5) { result += 'E'; } else { result += 'e'; }
  if (c6) { result += 'F'; } else { result += 'f'; }
  if (c7) { result += 'G'; } else { result += 'g'; }
  if (c8) { result += 'H'; } else { result += 'h'; }
  if (c9) { result += 'I'; } else { result += 'i'; }
  if (c10) { result += 'J'; } else { result += 'j'; }
  if (c11) { result += 'K'; } else { result += 'k'; }
  if (c12) { result += 'L'; } else { result += 'l'; }
  return result;
}
