import * as path from 'node:path';
import { DiscoveredWorkflow } from './discovery';

export interface FilterResult {
  filtered: DiscoveredWorkflow[];
  /** Include/exclude entries that matched no discovered workflow file. */
  unmatched: string[];
}

/**
 * Scopes discovered workflows by exact, case-sensitive file basename (no
 * paths, no globs, not function names). `include` is applied first, then
 * `exclude`. Both are checked for unmatched entries against the full
 * discovered set, so an exclude naming a file `include` already dropped is
 * not falsely reported as stale.
 */
export function filterWorkflows(
  discovered: DiscoveredWorkflow[],
  include: string[] = [],
  exclude: string[] = [],
): FilterResult {
  const basenames = new Set(discovered.map((w) => path.basename(w.filePath)));
  const unmatched = [...include, ...exclude].filter((entry) => !basenames.has(entry));

  const includeSet = new Set(include);
  const excludeSet = new Set(exclude);
  const filtered = discovered.filter((w) => {
    const base = path.basename(w.filePath);
    if (includeSet.size > 0 && !includeSet.has(base)) return false;
    return !excludeSet.has(base);
  });

  return { filtered, unmatched };
}
