import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { PathKitError } from './errors';
import { AnalyzePathListing } from './pathListing';
import { ProjectReport, WorkflowReportRow } from './reportAggregate';

export const DATA_STORE_PATH = '.pathkit/report-data.json';
export const HISTORY_PATH = '.pathkit/report-history.json';
export const DEFAULT_HTML_PATH = '.pathkit/report.html';

export interface WorkflowEntry {
  filePath: string;
  functionName: string;
  analysis?: { listing: AnalyzePathListing; updatedAt: string };
  coverage?: { row: WorkflowReportRow; updatedAt: string };
}

export interface ReportDataStore {
  workflows: Record<string, WorkflowEntry>;
}

export interface ReportHistoryEntry {
  timestamp: string;
  totalPaths: number;
  coveredCount: number;
  percentage: number;
}

const MAX_HISTORY_ENTRIES = 5;

/** Stable per-workflow key — `(filePath, functionName)`, not bare function name, since two different files can export same-named workflow functions. */
export function workflowKey(filePath: string, functionName: string): string {
  return `${filePath}::${functionName}`;
}

function getOrCreateEntry(store: ReportDataStore, filePath: string, functionName: string): WorkflowEntry {
  const key = workflowKey(filePath, functionName);
  return store.workflows[key] ?? { filePath, functionName };
}

/** Updates only the targeted workflow's `analysis` field, leaving every other entry (and that entry's own `coverage`, if any) untouched. */
export function mergeAnalysisEntry(
  store: ReportDataStore,
  filePath: string,
  functionName: string,
  listing: AnalyzePathListing,
): ReportDataStore {
  const key = workflowKey(filePath, functionName);
  const entry = getOrCreateEntry(store, filePath, functionName);

  return {
    workflows: {
      ...store.workflows,
      [key]: { ...entry, analysis: { listing, updatedAt: new Date().toISOString() } },
    },
  };
}

/** Updates every workflow present in a `report` run's result — both `analysis` (built fresh from the row's own path data) and `coverage`. Workflows not present in this run are left untouched. */
export function mergeReportData(store: ReportDataStore, report: ProjectReport): ReportDataStore {
  let result = store;
  const updatedAt = new Date().toISOString();

  for (const row of report.rows) {
    const key = workflowKey(row.filePath, row.functionName);
    const entry = getOrCreateEntry(result, row.filePath, row.functionName);
    const listing: AnalyzePathListing = {
      totalEnumerated: row.totalPaths,
      enumerationTruncated: row.truncated,
      entries: row.paths.map((p, i) => ({ index: i + 1, description: p.description })),
      omittedByLimit: 0,
    };

    result = {
      workflows: {
        ...result.workflows,
        [key]: { ...entry, analysis: { listing, updatedAt }, coverage: { row, updatedAt } },
      },
    };
  }

  return result;
}

/** Appends one history entry, dropping the oldest once there are more than `MAX_HISTORY_ENTRIES`. */
export function appendHistory(history: ReportHistoryEntry[], entry: ReportHistoryEntry): ReportHistoryEntry[] {
  const next = [...history, entry];
  return next.length > MAX_HISTORY_ENTRIES ? next.slice(next.length - MAX_HISTORY_ENTRIES) : next;
}

/** Display-only classification, deliberately separate from `reportAggregate.ts`'s `classifyCoverage` bucket (different thresholds, different purpose). */
export function priorityLabel(percentage: number): 'High' | 'Medium' | 'Low' {
  if (percentage < 50) return 'High';
  if (percentage <= 80) return 'Medium';
  return 'Low';
}

function readJsonOrDefault<T>(filePath: string, defaultValue: T): T {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultValue;
    }
    throw err;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PathKitError(`could not parse ${filePath} as JSON`);
  }
}

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function readDataStore(filePath: string): ReportDataStore {
  return readJsonOrDefault<ReportDataStore>(filePath, { workflows: {} });
}

export function writeDataStore(filePath: string, store: ReportDataStore): void {
  writeJson(filePath, store);
}

export function readHistory(filePath: string): ReportHistoryEntry[] {
  return readJsonOrDefault<ReportHistoryEntry[]>(filePath, []);
}

export function writeHistory(filePath: string, history: ReportHistoryEntry[]): void {
  writeJson(filePath, history);
}

/** Same 5-replacement HTML-entity escaping `src/mermaid.ts`'s `escapeMermaidText` already uses — correct for HTML text content too. Kept local (not shared/exported from `mermaid.ts`) to keep each module's escaping self-contained. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function latestUpdatedAt(store: ReportDataStore): string | undefined {
  const timestamps = Object.values(store.workflows)
    .flatMap((entry) => [entry.analysis?.updatedAt, entry.coverage?.updatedAt])
    .filter((t): t is string => t !== undefined);
  return timestamps.length === 0 ? undefined : timestamps.sort().at(-1);
}

function renderAnalysisPathList(entries: { index: number; description: string }[]): string {
  if (entries.length === 0) {
    return '<p class="empty">(no declared paths)</p>';
  }
  return `<ol class="path-list">${entries
    .map((e) => `<li><span class="path-index">${e.index}.</span> ${escapeHtml(e.description)}</li>`)
    .join('')}</ol>`;
}

function renderCoveragePathList(paths: WorkflowReportRow['paths']): string {
  if (paths.length === 0) {
    return '<p class="empty">(no declared paths)</p>';
  }
  return `<ol class="path-list">${paths
    .map(
      (p, i) =>
        `<li class="${p.covered ? 'covered' : 'missed'}"><span class="path-index">${i + 1}.</span> ${escapeHtml(
          p.description,
        )} <span class="status">${p.covered ? 'covered' : 'missed'}</span></li>`,
    )
    .join('')}</ol>`;
}

function renderAnalysisTab(store: ReportDataStore): string {
  const entries = Object.values(store.workflows);
  if (entries.length === 0) {
    return '<p class="empty">No workflows analyzed yet.</p>';
  }

  return entries
    .map((entry) => {
      if (entry.analysis === undefined) {
        return '';
      }
      return `<section class="workflow">
        <h3>${escapeHtml(entry.functionName)} <span class="file-path">(${escapeHtml(entry.filePath)})</span></h3>
        <p class="total">Total paths: ${entry.analysis.listing.totalEnumerated}</p>
        ${renderAnalysisPathList(entry.analysis.listing.entries)}
      </section>`;
    })
    .join('');
}

function renderCoverageTab(store: ReportDataStore): string {
  const entries = Object.values(store.workflows);
  if (entries.length === 0) {
    return '<p class="empty">No workflows reported yet.</p>';
  }

  return entries
    .map((entry) => {
      if (entry.coverage === undefined) {
        return `<section class="workflow">
          <h3>${escapeHtml(entry.functionName)} <span class="file-path">(${escapeHtml(entry.filePath)})</span></h3>
          <p class="not-measured">not yet measured</p>
        </section>`;
      }

      const { row } = entry.coverage;
      const priority = priorityLabel(row.percentage);
      return `<section class="workflow">
        <h3>${escapeHtml(entry.functionName)} <span class="file-path">(${escapeHtml(entry.filePath)})</span></h3>
        <p class="subtotal">${row.coveredCount}/${row.totalPaths} paths &middot; ${row.percentage.toFixed(1)}% &middot; <span class="priority priority-${priority.toLowerCase()}">${priority}</span></p>
        ${renderCoveragePathList(row.paths)}
      </section>`;
    })
    .join('');
}

function renderHistoryTrend(history: ReportHistoryEntry[]): string {
  if (history.length === 0) {
    return '<p class="empty">No history yet.</p>';
  }
  return `<ul class="history">${history
    .map((h) => `<li>${escapeHtml(h.timestamp)}: ${h.coveredCount}/${h.totalPaths} (${h.percentage.toFixed(1)}%)</li>`)
    .join('')}</ul>`;
}

/**
 * Renders the complete self-contained HTML report — inline CSS/JS, no
 * external requests (no CDN links, no fonts), openable directly via
 * double-click with no server. Both tabs number paths by their position in
 * each entry's already-ordered path list, which stays in sync between tabs
 * because both `mergeAnalysisEntry` (via `buildPathListing` with no limit)
 * and `mergeReportData` build their `analysis.listing` from the same
 * underlying declared-path order as `coverage.row.paths`.
 */
export function renderReportHtml(store: ReportDataStore, history: ReportHistoryEntry[]): string {
  const coveredWorkflows = Object.values(store.workflows).filter((e) => e.coverage !== undefined);
  const totalPaths = coveredWorkflows.reduce((sum, e) => sum + (e.coverage?.row.totalPaths ?? 0), 0);
  const coveredCount = coveredWorkflows.reduce((sum, e) => sum + (e.coverage?.row.coveredCount ?? 0), 0);
  const aggregatePercentage = totalPaths === 0 ? 0 : (coveredCount / totalPaths) * 100;
  const workflowCount = Object.keys(store.workflows).length;
  const lastUpdated = latestUpdatedAt(store);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PathKit report</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 1.5rem; max-width: 960px; margin: 0 auto; line-height: 1.5; }
  header { margin-bottom: 1.5rem; }
  .summary-strip { display: flex; flex-wrap: wrap; gap: 1rem; padding: 1rem; border: 1px solid #8884; border-radius: 8px; }
  .summary-strip .stat { font-size: 1.1rem; }
  .summary-strip .stat strong { font-size: 1.4rem; display: block; }
  .tabs { display: flex; gap: 0.5rem; margin: 1.5rem 0 1rem; }
  .tabs button { padding: 0.5rem 1rem; border: 1px solid #8884; border-radius: 6px; background: transparent; cursor: pointer; font-size: 1rem; }
  .tabs button.active { background: #4488ff33; font-weight: 600; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  section.workflow { margin-bottom: 1.5rem; padding: 1rem; border: 1px solid #8883; border-radius: 8px; }
  section.workflow h3 { margin: 0 0 0.5rem; }
  .file-path { font-weight: normal; opacity: 0.7; font-size: 0.85rem; }
  ol.path-list { padding-left: 1.5rem; }
  ol.path-list li { margin-bottom: 0.4rem; word-break: break-word; }
  .path-index { opacity: 0.6; }
  li.covered .status { color: #1a7f37; font-weight: 600; }
  li.missed .status { color: #cf222e; font-weight: 600; }
  .priority { font-weight: 600; padding: 0.1rem 0.5rem; border-radius: 4px; }
  .priority-high { background: #cf222e33; }
  .priority-medium { background: #d4a10633; }
  .priority-low { background: #1a7f3733; }
  .not-measured { opacity: 0.7; font-style: italic; }
  .history { list-style: none; padding: 0; font-size: 0.9rem; opacity: 0.85; }
  @media (max-width: 600px) { body { padding: 1rem; } .summary-strip { flex-direction: column; } }
</style>
</head>
<body>
<header>
  <h1>PathKit report</h1>
  <p class="last-updated">Last updated: ${lastUpdated === undefined ? 'never' : escapeHtml(lastUpdated)}</p>
  <div class="summary-strip">
    <div class="stat"><strong>${workflowCount}</strong> workflows</div>
    <div class="stat"><strong>${aggregatePercentage.toFixed(1)}%</strong> aggregate coverage</div>
    <div class="stat"><strong>${coveredCount}/${totalPaths}</strong> paths covered</div>
  </div>
</header>
<nav class="tabs">
  <button type="button" class="tab-button active" data-tab="analysis">Analysis</button>
  <button type="button" class="tab-button" data-tab="coverage">Coverage</button>
</nav>
<div id="analysis" class="tab-panel active">
  ${renderAnalysisTab(store)}
</div>
<div id="coverage" class="tab-panel">
  <h2>History</h2>
  ${renderHistoryTrend(history)}
  ${renderCoverageTab(store)}
</div>
<script>
  document.querySelectorAll('.tab-button').forEach(function (button) {
    button.addEventListener('click', function () {
      document.querySelectorAll('.tab-button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      button.classList.add('active');
      document.getElementById(button.dataset.tab).classList.add('active');
    });
  });
</script>
</body>
</html>
`;
}
