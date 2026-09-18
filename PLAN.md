# PathKit v1 Build Plan

Static path/branch graph for Temporal TypeScript workflows (Gap 1 only — see `temporal-pathkit-idea.md` for the full two-gap vision; coverage tracking is deferred to a later plan).

Check off each milestone as it's completed, per its Definition of Done (full cumulative test suite green + CI green, `CLAUDE.md` Decisions Log updated if needed, `LIMITATIONS.md` updated if needed, `README.md` updated if needed, `demo/` manually re-checked from M3 onward, and this checkbox ticked).

- [x] **M0** — Project skeleton: TypeScript strict config, Jest + ts-jest, ESLint (required), CI, package hygiene, `CLAUDE.md`/`LIMITATIONS.md`/`PLAN.md`, `bin/pathkit --version`.
- [x] **M1** — Load and parse a single file with ts-morph; return only exported top-level functions (both `export async function` and `export const ... = async () =>` styles).
- [x] **M2** — Detect if/else branches; `switch` statements explicitly deferred and tested as a no-op.
- [x] **M3** — Detect try/catch around activity calls (same-file heuristic); start the `demo/` project.
- [x] **M4** — Detect `Promise.race` timeouts and `condition()` signal-waits.
- [x] **M5** — Build the graph structure, with explicit cycle handling for retry loops.
- [x] **M6** — Enumerate all Start→End paths, with loop-aware and hard-capped enumeration.
- [x] **M7** — Mermaid rendering, CLI wiring (`pathkit analyze`), CLI-level error-handling tests, docs finalization.

**v1 (Gap 1: static path/branch analysis) is complete as of M7.** Gap 2 (coverage tracking of which paths tests actually exercise) is intentionally out of scope here and belongs to a future plan — see `temporal-pathkit-idea.md`.

Full milestone details, the non-negotiable quality bar, and the verification approach for M0–M7 live in the plan document this file mirrors (kept outside the repo, in the Claude Code plan history). This file is the durable, human-readable checklist that travels with the repo itself.

## Gap 2 — Workflow path coverage tracking

Reuses the Gap 1 graph/path engine (`src/graph.ts`, `src/paths.ts`) to auto-instrument a copy of a workflow file with tracking calls at each branch point, run it for real under Temporal's `TestWorkflowEnvironment`, expose the recorded trace via a Temporal Query, and add a `pathkit coverage` CLI command that merges trace files from real test runs into a coverage percentage plus a named list of untested paths. Shipped as a subcommand of the existing `pathkit` binary — one package, one README, one CLI. Numbered `G0`–`G11` (including `G7b`) to stay clearly distinguished from Gap 1's `M0`–`M7`.

Two consequential decisions were locked in before any milestone started (full reasoning in `CLAUDE.md`'s Decisions Log):
- `@temporalio/client`/`@temporalio/worker` live in `devDependencies` only — PathKit's shipped code never runs a live Temporal Worker/Client itself; only the end user's own test file does, using packages their own project already supplies. PathKit ships two Temporal-import-free helper functions (`prepareCoverageRun`, `recordCoverageTrace`, from G10) instead.
- Graph-to-AST-location mapping is an additive, non-serialized node-ref side-channel (`buildWorkflowGraphWithNodeRefs`) rather than a fragile `{line, column}` field or a second, independently-drifting AST walk.

Confirmed defaults: trace files live at `.pathkit/coverage/*.json` (gitignored, no config file); `pathkit coverage` is report-only in this pass (no `--min-coverage` threshold); an unmatched trace is a loud warning, not a hard failure; one `prepareCoverageRun` call tracks exactly one named function per file.

- [x] **G0** — Dependency placement (`@temporalio/client`/`@temporalio/worker` to devDependencies) and naming conventions (instrumented sibling suffix, trace directory) decided and recorded; no user-visible feature yet.
- [x] **G1** — `buildWorkflowGraphWithNodeRefs`: additive graph-to-AST-location mapping in `src/graph.ts`, non-breaking.
- [x] **G2** — Instrumented sibling copy with unmodified text, unique concurrency-safe filenames, written next to the original file (relative-import landmine).
- [x] **G3** — Real instrumentation: if/else branches, per-function trace-array state, namespaced Query — verified at the text/AST level only.
- [x] **G4** — First real end-to-end proof: trivial if/else + zero-branch fixture run through `TestWorkflowEnvironment` + `Worker`, queried, trace asserted. First milestone with a live Temporal dependency and test-server binary download (CI caching added here).
- [x] **G5** — Extend real instrumentation to try/catch-around-activity.
- [x] **G6** — Extend real instrumentation to `Promise.race` timeouts and `condition()`; includes a race-neutrality test proving tracking never changes which side wins.
- [x] **G7** — Extend real instrumentation to retry loops (iterate/retry/exit edges). Also fixed a structural `graph.ts` issue (an `outcomeEdgeIndex` map) affecting every prior milestone's instrumentation when nested inside a retry loop — see CLAUDE.md.
- [x] **G7b** — Combined/nested construct proof: if/else nested inside a retry loop, matching `demo/report-polling-workflow.ts`'s real shape. Scoped down from a full milestone during execution: G7 itself already found/fixed the composition bug and text-level-proved this exact shape, so G7b closed the one remaining gap (live execution of the two-if demo shape) with a single e2e test reusing that fixture directly — no new fixture file.
- [x] **G8** — Trace file format (with `sourceHash`) + offline merge/matching logic, including multi-loop collapsing, zero-branch, and `maxPaths`-truncation fixtures.
- [x] **G9** — `pathkit coverage` CLI command (text/`--json` output, `--out`, `--clean`, `--allow-stale`). Version bump (new CLI-facing behavior). Also fixed a real gap in `test/cli.test.ts`'s subprocess harness (`execFileSync` → `spawnSync`), since the old one discarded stderr on a successful exit.
- [x] **G10** — Developer-facing test-helper API (`prepareCoverageRun`, `recordCoverageTrace`) and extended smoke test proving the dependency-placement decision for real. Version bump (new public API surface). Fixed a smoke-test ordering bug (found before it ever ran) that would have silently failed to catch the exact bug class it was meant to guard against.
- [x] **G11** — Final polish: consolidated `LIMITATIONS.md` section, `README.md` "Coverage tracking" section, `demo/` walkthrough, clean full-suite run from a fresh clone.

**Gap 2 (workflow path coverage tracking) is complete as of G11**, alongside Gap 1's own completion at M7 — both pieces of PathKit's originally-planned scope (`temporal-pathkit-idea.md`) are now shipped. The final `demo/` walkthrough ran `pathkit analyze` (4 total paths for `demo/report-polling-workflow.ts`) followed by two real `prepareCoverageRun`/`recordCoverageTrace` executions through a live `TestWorkflowEnvironment` (one succeeding immediately, one failing immediately) and `pathkit coverage` against the resulting traces, reporting `2/4 (50.0%)` with the correct two paths named as covered and the correct two named as untested.

Full milestone details (files touched, visible result, Definition of Done per milestone) live in the plan document this section mirrors (kept in the Claude Code plan history, `i-want-to-build-sprightly-valiant.md`).

## Gap 3 — Combined multi-file paths + coverage report

Adds a new `pathkit report <dir> --traces <dir>` command that recursively scans a
directory for workflow files and, for every exported function found, lists
every statically-declared path (reusing Gap 1's `enumeratePathsWithEdgeIndices`
unchanged) marked covered/missed against real coverage data (reusing Gap 2's
`mergeCoverageTraces` unchanged, including its already-strict
edge-index-identity matching — no design change needed there), with a
per-workflow subtotal and a project-wide total. `analyze` and `coverage`
themselves are left completely unchanged. Numbered `H0`–`H6` to stay clearly
distinguished from Gap 1's `M0`–`M7` and Gap 2's `G0`–`G11`. Full milestone
details and design rationale live in the plan document this section mirrors
(`i-want-to-add-serialized-brooks.md`, kept in the Claude Code plan history).

- [x] **H0** — `src/discovery.ts`'s `discoverWorkflows(dir)`: recursive directory scan finding every exported function across every matched workflow file, skipping `node_modules`/`test`/`__tests__`/`dist`/`build`/`coverage`/`.git` directories, generated `*.pathkit-instrumented.ts` files, `.d.ts` declaration files, and test files (`*.test.ts`/`*.spec.ts`); a file with zero exported functions produces no rows silently, an unparseable file is reported as a warning rather than aborting the scan. Also fixed a real bug found by running it against PathKit's own compiled `dist/` output: `.d.ts` files were matching the `.ts` filter and producing 22 false-positive "workflows" from ambient declarations — see CLAUDE.md. Library-only, no CLI wiring yet.
- [ ] **H1** — Promote `describePath` from `coverageReport.ts` (private) to `paths.ts` (exported); extract `cli.ts`'s trace-directory-listing snippet into a shared `listTraceFiles` helper.
- [ ] **H2** — `classifyCoverage` (one shared percentage/bucket function) and `buildProjectReport`, composing `discoverWorkflows` + `mergeCoverageTraces` + `describePath` into a plain-data pipeline. Library-only, no CLI yet.
- [ ] **H3** — Plain-text (and `--json`) `pathkit report` CLI command, no color yet.
- [ ] **H4** — Color support (`isTTY`/`NO_COLOR`/`--no-color`), wired into `report`'s formatter only.
- [ ] **H5** — `--out`, `--allow-stale`, doc finalization, version bump.
- [ ] **H6** — Final `demo/` walkthrough + full-suite verification (documentation only, no `src/` changes).
