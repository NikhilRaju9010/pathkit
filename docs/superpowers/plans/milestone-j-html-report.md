# Milestone J — HTML Report (Analysis + Coverage Tabs)

## Context

Decided in planning (see project chat history): a project-level, self-
contained HTML file with two tabs — Analysis and Coverage/Report — that
regenerates whenever `analyze` or `report` is run. Locked-in specifics:

- Lives at `.pathkit/report.html`.
- No live server — static file, manual browser refresh after rerunning
  a command.
- Keeps a capped history (last 3–5 runs) so coverage trend over time is
  visible.
- Path IDs are numbered per-workflow and **shared between both tabs** —
  "Path 3 of workflowX" means the same path whether you're looking at
  Analysis or Coverage.
- Coverage tab shows a High/Medium/Low priority label per workflow,
  based on coverage %: <50% High, 50–80% Medium, >80% Low/Good.

This builds directly on Milestone I's `src/pathListing.ts`
(`buildPathListing`), which already produces the numbered,
presentation-agnostic path data the Analysis tab needs.

## Open design decisions (resolved here — flag if you'd choose differently)

1. **Two commands, one shared file.** `analyze <file> --html` and
   `report <dir> --traces <dir> --html` both write to the same
   `.pathkit/report.html`, but at different scopes:
   - `analyze --html` updates **only that one workflow's entry** in the
     Analysis tab. It does not touch the Coverage tab or other
     workflows' Analysis entries.
   - `report --html` is project-wide (it already discovers every
     workflow in the directory): it refreshes **both tabs** for every
     workflow it finds, and appends one new entry to the capped history.
   This means running `analyze --html` on a single file between
   `report` runs is a valid, useful workflow (quick check on one
   workflow) without invalidating the full project's last known
   Coverage tab.

2. **Persisted data store, separate from the HTML itself.** A JSON file,
   `.pathkit/report-data.json`, holds the current full state (per
   workflow: analysis entries, coverage entries if known, last-updated
   timestamp per workflow). Both commands read it, merge in their
   results (by workflow name — update matching entries, leave others
   untouched), write it back, then render `report.html` from the merged
   store. This is what makes "only touch what this command actually
   ran" possible instead of wiping unrelated data.

3. **History file.** `.pathkit/report-history.json`, capped at 5
   entries, each just `{ timestamp, totalPaths, coveredPaths,
   percentage }` — project-wide summary numbers only, not full path
   lists (keeps it lightweight). Only `report --html` appends to this
   (project-wide coverage is only known after a `report` run, not a
   single-file `analyze`).

## Requirements

1. New module `src/htmlReport.ts`:
   - Types for the persisted data store (`ReportDataStore`) and history
     (`ReportHistoryEntry[]`).
   - `mergeAnalysisEntry(store, workflowName, listing: AnalyzePathListing)`
     — updates one workflow's Analysis data in the store.
   - `mergeReportData(store, reportResult)` — updates all workflows'
     Analysis + Coverage data from a `report` run.
   - `appendHistory(history, summary)` — pushes one entry, drops oldest
     beyond 5.
   - `renderReportHtml(store, history): string` — produces the complete
     self-contained HTML (inline CSS/JS, no external requests, opens
     via double-click with no server).
   - Read/write helpers for `.pathkit/report-data.json` and
     `.pathkit/report-history.json` (create both if missing).

2. `src/cli.ts`:
   - Add `--html [path]` to `analyze` (default `.pathkit/report.html`
     if flag given with no path). On use: build the path listing as
     today, then also call the merge/render pipeline for just that
     workflow.
   - Add `--html [path]` to `report`. On use: after computing the
     normal report result, run the merge/render pipeline project-wide
     and append a history entry.
   - Update both usage strings.

3. **HTML content**, both tabs:
   - Header: last-updated timestamp, and a top summary strip
     (aggregate coverage %, workflow count) — highlighted/prominent.
   - History shown as a small trend (last up-to-5 runs' percentages) on
     the Coverage tab.
   - Analysis tab: per workflow, numbered path list (reusing the
     `AnalyzePathEntry` shape from `pathListing.ts` — same numbering a
     terminal `analyze` run would show).
   - Coverage tab: per workflow, the same numbered paths with
     covered/missed status, subtotal %, and the High/Medium/Low label.
   - Responsive layout (usable on a narrow window), plain HTML/CSS/JS —
     no framework, no external requests (matches PathKit's
     no-external-dependency posture elsewhere).
   - A workflow that only has Analysis data (never covered by a
     `report --html` run) shows in the Coverage tab as "not yet
     measured" rather than blank/missing.

4. `.pathkit/` additions (`report-data.json`, `report-history.json`,
   `report.html`) must already be gitignored — confirm, don't assume.

5. Tests: merge logic (analyze-only merge leaves other workflows
   untouched; report merge updates everything; history caps at 5 and
   drops oldest), and HTML generation (assert key content markers are
   present — workflow names, path counts, priority labels — not a full
   DOM/snapshot test, consistent with the project's existing test
   style).

## Files to change

- `src/htmlReport.ts` — new file, per Requirement 1.
- `src/cli.ts` — `--html` flag on both `analyze` and `report`, usage
  strings.
- `.gitignore` — confirm `.pathkit/` is covered.
- `test/htmlReport.test.ts` — new unit tests for merge/render logic.
- `test/cli.test.ts` — integration tests for `--html` on both commands.
- `README.md` — document `--html` on both commands with a real,
  verified example.
- `CLAUDE.md` — new Decisions Log entry.
- `package.json` — version bump.

## Verification / Definition of done

- TDD per task, project convention as in Milestone I.
- `npm run lint && npm run typecheck && npm test && npm run smoke` all
  green.
- Manually run `analyze --html` on one real workflow file, then
  `report --html` on the full Ameriprise workflows directory, and open
  the resulting `.pathkit/report.html` in an actual browser — paste
  back what you see (or a description plus the raw HTML's key sections)
  so this can be checked against the spec, not just trusted.
- Confirm via `git status --short` / `git log --oneline -3` before
  merging.
