import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { AnalyzePathListing } from '../src/pathListing';
import { ProjectReport, WorkflowReportRow } from '../src/reportAggregate';
import { NamedPathWithCoverage } from '../src/coverageReport';
import { PathKitError } from '../src/errors';
import {
  appendHistory,
  mergeAnalysisEntry,
  mergeReportData,
  priorityLabel,
  readDataStore,
  readHistory,
  ReportDataStore,
  ReportHistoryEntry,
  renderReportHtml,
  workflowKey,
  writeDataStore,
  writeHistory,
} from '../src/htmlReport';

function emptyStore(): ReportDataStore {
  return { workflows: {} };
}

function listing(entries: { index: number; description: string }[], totalEnumerated = entries.length): AnalyzePathListing {
  return { totalEnumerated, enumerationTruncated: false, entries, omittedByLimit: 0 };
}

function namedPath(description: string, covered: boolean): NamedPathWithCoverage {
  return { edgeIndices: [0], description, covered };
}

function row(overrides: Partial<WorkflowReportRow>): WorkflowReportRow {
  return {
    filePath: 'a.ts',
    functionName: 'workflowA',
    totalPaths: 2,
    coveredCount: 1,
    percentage: 50,
    bucket: 'partial',
    truncated: false,
    paths: [namedPath('Start -> End', true), namedPath('Start -> other -> End', false)],
    unmatchedTraces: [],
    ...overrides,
  };
}

function projectReport(rows: WorkflowReportRow[]): ProjectReport {
  const totalPaths = rows.reduce((sum, r) => sum + r.totalPaths, 0);
  const coveredCount = rows.reduce((sum, r) => sum + r.coveredCount, 0);
  return { rows, totalPaths, coveredCount, percentage: totalPaths === 0 ? 0 : (coveredCount / totalPaths) * 100, bucket: 'partial' };
}

describe('workflowKey', () => {
  it('combines filePath and functionName so two files with the same function name never collide', () => {
    expect(workflowKey('a.ts', 'run')).not.toBe(workflowKey('b.ts', 'run'));
    expect(workflowKey('a.ts', 'run')).toBe(workflowKey('a.ts', 'run'));
  });
});

describe('mergeAnalysisEntry', () => {
  it('adds a new workflow entry with only analysis data set', () => {
    const store = mergeAnalysisEntry(emptyStore(), 'a.ts', 'workflowA', listing([{ index: 1, description: 'Start -> End' }]));
    const key = workflowKey('a.ts', 'workflowA');
    expect(store.workflows[key]?.filePath).toBe('a.ts');
    expect(store.workflows[key]?.functionName).toBe('workflowA');
    expect(store.workflows[key]?.analysis?.listing.entries).toEqual([{ index: 1, description: 'Start -> End' }]);
    expect(store.workflows[key]?.coverage).toBeUndefined();
  });

  it('updates only the targeted workflow, leaving other entries (including their coverage data) untouched', () => {
    let store = mergeAnalysisEntry(emptyStore(), 'a.ts', 'workflowA', listing([{ index: 1, description: 'old' }]));
    store = mergeReportData(store, projectReport([row({ filePath: 'a.ts', functionName: 'workflowA' })]));
    store = mergeAnalysisEntry(store, 'b.ts', 'workflowB', listing([{ index: 1, description: 'b path' }]));

    const keyA = workflowKey('a.ts', 'workflowA');
    const keyB = workflowKey('b.ts', 'workflowB');
    expect(store.workflows[keyA]?.coverage?.row.coveredCount).toBe(1);
    expect(store.workflows[keyB]?.analysis?.listing.entries[0]?.description).toBe('b path');
    expect(store.workflows[keyB]?.coverage).toBeUndefined();
  });
});

describe('mergeReportData', () => {
  it('sets both analysis and coverage data for every workflow in the report', () => {
    const store = mergeReportData(emptyStore(), projectReport([row({})]));
    const key = workflowKey('a.ts', 'workflowA');
    expect(store.workflows[key]?.coverage?.row.coveredCount).toBe(1);
    expect(store.workflows[key]?.analysis?.listing.entries.map((e: { description: string }) => e.description)).toEqual([
      'Start -> End',
      'Start -> other -> End',
    ]);
  });

  it('leaves a workflow not present in this report run untouched', () => {
    let store = mergeAnalysisEntry(emptyStore(), 'c.ts', 'workflowC', listing([{ index: 1, description: 'c path' }]));
    store = mergeReportData(store, projectReport([row({ filePath: 'a.ts', functionName: 'workflowA' })]));

    const keyC = workflowKey('c.ts', 'workflowC');
    expect(store.workflows[keyC]?.analysis?.listing.entries[0]?.description).toBe('c path');
  });
});

describe('appendHistory', () => {
  const entry = (percentage: number): ReportHistoryEntry => ({
    timestamp: `2026-01-0${percentage}T00:00:00.000Z`,
    totalPaths: 10,
    coveredCount: percentage,
    percentage,
  });

  it('appends to a non-full history unchanged', () => {
    const result = appendHistory([entry(1), entry(2)], entry(3));
    expect(result.map((e: ReportHistoryEntry) => e.percentage)).toEqual([1, 2, 3]);
  });

  it('drops the oldest entry once history already has 5, keeping the newest 5', () => {
    const history = [entry(1), entry(2), entry(3), entry(4), entry(5)];
    const result = appendHistory(history, entry(6));
    expect(result).toHaveLength(5);
    expect(result.map((e: ReportHistoryEntry) => e.percentage)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('priorityLabel', () => {
  it('is High below 50%', () => {
    expect(priorityLabel(49)).toBe('High');
    expect(priorityLabel(0)).toBe('High');
  });

  it('is Medium from 50% through 80% inclusive', () => {
    expect(priorityLabel(50)).toBe('Medium');
    expect(priorityLabel(80)).toBe('Medium');
  });

  it('is Low above 80%', () => {
    expect(priorityLabel(81)).toBe('Low');
    expect(priorityLabel(100)).toBe('Low');
  });
});

describe('renderReportHtml', () => {
  it('includes workflow names, path descriptions, counts, priority labels, and "not yet measured" for analysis-only entries', () => {
    let store = mergeReportData(emptyStore(), projectReport([row({ filePath: 'a.ts', functionName: 'workflowA' })]));
    store = mergeAnalysisEntry(store, 'b.ts', 'workflowB', listing([{ index: 1, description: 'Start -> End' }]));

    const html = renderReportHtml(store, [{ timestamp: '2026-01-01T00:00:00.000Z', totalPaths: 2, coveredCount: 1, percentage: 50 }]);

    expect(html).toContain('<html');
    expect(html).toContain('workflowA');
    expect(html).toContain('workflowB');
    expect(html).toContain('Start -&gt; End');
    expect(html).toContain('Start -&gt; other -&gt; End');
    expect(html).toContain('not yet measured');
    expect(html).toMatch(/Medium|High|Low/);
    expect(html).not.toContain('<script src=');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('escapes HTML-significant characters in path descriptions', () => {
    const store = mergeAnalysisEntry(
      emptyStore(),
      'a.ts',
      'workflowA',
      listing([{ index: 1, description: `if (x < 1 && y > 0 && z !== "a" && w !== 'b')` }]),
    );
    const html = renderReportHtml(store, []);
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(html).not.toContain('!== "a"');
  });
});

describe('readDataStore / writeDataStore / readHistory / writeHistory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'pathkit-htmlreport-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readDataStore returns an empty store when the file does not exist', () => {
    const store = readDataStore(path.join(tmpDir, 'does-not-exist.json'));
    expect(store).toEqual({ workflows: {} });
  });

  it('writeDataStore then readDataStore round-trips, creating missing parent directories', () => {
    const storePath = path.join(tmpDir, 'nested', 'report-data.json');
    const store = mergeAnalysisEntry(emptyStore(), 'a.ts', 'workflowA', listing([{ index: 1, description: 'Start -> End' }]));
    writeDataStore(storePath, store);
    expect(readDataStore(storePath)).toEqual(store);
  });

  it('readDataStore throws a PathKitError on malformed JSON rather than silently defaulting', () => {
    const storePath = path.join(tmpDir, 'bad.json');
    writeFileSync(storePath, '{ not valid json', 'utf8');
    expect(() => readDataStore(storePath)).toThrow(PathKitError);
  });

  it('readHistory returns an empty array when the file does not exist', () => {
    expect(readHistory(path.join(tmpDir, 'does-not-exist.json'))).toEqual([]);
  });

  it('writeHistory then readHistory round-trips', () => {
    const historyPath = path.join(tmpDir, 'report-history.json');
    const history: ReportHistoryEntry[] = [{ timestamp: '2026-01-01T00:00:00.000Z', totalPaths: 4, coveredCount: 2, percentage: 50 }];
    writeHistory(historyPath, history);
    expect(readHistory(historyPath)).toEqual(history);
  });
});
