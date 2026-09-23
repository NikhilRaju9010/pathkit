# Milestone K — Project Config File (`.pathkitrc.json`)

## Context

Running `report` today means retyping the workflows directory, `--traces`
path, and (once workflows are split into tested/untested scope) an
`--include` list every single time. This milestone adds a project-root
config file so `pathkit report` alone can carry all of that — while
every individual flag can still override the config on a one-off basis,
and running with **no config file present must behave exactly as it does
today, with zero behavior change.**

This is `report`-only. `analyze` always takes one specific file named on
the command line, so a "default folder" concept doesn't apply to it —
out of scope for this milestone, not forgotten.

## Non-negotiable constraint

**Zero-config behavior must be byte-identical to pre-milestone behavior.**
Every existing `report` invocation, with no `.pathkitrc.json` present,
must produce identical output, identical required-flag errors (e.g. the
existing "missing required --traces" error), and identical exit codes.
This needs its own explicit regression test, not just "existing tests
still pass" — see Verification.

## Config schema

`.pathkitrc.json`, plain JSON, project root, read only from the exact
current working directory the command is run from (no searching parent
directories — matches the project's existing preference for simple,
predictable file discovery over "clever" resolution).

Full coverage — one key per existing `report` flag, plus `workflowsDir`
for the positional `<dir>` argument:

```json
{
  "workflowsDir": "packages/worker/src/workflows",
  "traces": ".pathkit/coverage",
  "out": null,
  "json": false,
  "noColor": false,
  "allowStale": false,
  "html": true,
  "include": ["orderFulfillmentWorkflow.ts", "paymentProcessingWorkflow.ts"],
  "exclude": []
}
```

All keys optional. An empty or missing file is valid and equivalent to
no config at all.

## Precedence rule

**CLI flag > config value > built-in default**, for every field,
including the positional `<dir>` and the currently-required `--traces`.
Concretely: `parseReportArgs` parses flags exactly as it does today
(unchanged), then a new merge step fills in any field left unset from
the loaded config, and only *after* that merge does the existing
required-argument check run (`<dir>` missing → same error as today;
`--traces` missing → same error as today) — so those errors only
disappear when the config genuinely supplies the value, never silently.

## Error handling

- **Malformed JSON** in `.pathkitrc.json` → throw a clear `PathKitError`
  naming the file and the parse error. Never silently fall back to
  defaults on a broken file — that would hide a real mistake.
- **Unknown top-level key** in the config → print a warning to stderr
  naming the unrecognized key, but don't fail the run. This is a
  deliberate fix for the "flag/config value silently swallowed" bug
  pattern already flagged twice earlier in this project's history — a
  typo like `"tracse"` must be visible, not silently ignored.
- **`include`/`exclude` entry matching nothing** in the discovered
  workflow set → warning on stderr naming the entry, run continues with
  whatever did match. Don't fail the whole report over one stale
  filename in the list.

## `include`/`exclude` matching semantics

Exact, case-sensitive match on the workflow file's **basename** (e.g.
`orderFulfillmentWorkflow.ts`) — not full path, not a glob pattern, not
the exported function name. This is the simplest, least-surprising
option, and avoids adding a glob-matching dependency (the project
currently has exactly one runtime dependency, `ts-morph` — keep it that
way). If both `include` and `exclude` are given, `include` is applied
first (keep only listed files), then `exclude` removes any of those.

`--include <file1,file2>` and `--exclude <file1,file2>` are also added
as `report` CLI flags directly (comma-separated), not just config-file
fields — for one-off scoping without editing the config.

## Architecture

Two new files:

- **`src/config.ts`** — `loadConfig(cwd: string): PathKitConfig` (empty
  object if file absent), parsing + the malformed-JSON error + the
  unknown-key warning. Pure, no CLI concerns.
- **`src/workflowFilter.ts`** — `filterWorkflows(discovered, include?,
  exclude?): { filtered: DiscoveredWorkflow[], unmatched: string[] }` —
  pure function, takes whatever `discoverWorkflows` already returns,
  applies the include-then-exclude basename matching, and reports which
  include/exclude entries matched nothing (for the warning).

**Research first, before writing code:** `cli.ts` has changed twice
already (Milestones I and J) — confirm the *current* real structure of
`parseReportArgs`/`runReport` and where `discoverWorkflows` is called,
rather than assuming line numbers from an earlier milestone's plan.

## CLI wiring

- `parseReportArgs`: add `--include`/`--exclude` flag parsing (existing
  loop pattern).
- Before the existing required-argument checks: load config, merge
  unset fields in from it, *then* run today's existing checks.
- After `discoverWorkflows` runs (existing call, unchanged): apply
  `filterWorkflows` using the merged include/exclude, print any
  "unmatched" warnings, then proceed with the existing `report`
  pipeline on the filtered set — unchanged from here on.
- Update `report`'s usage string with the new flags.

## Files to change

- `src/config.ts`, `src/workflowFilter.ts` — new, per above.
- `src/cli.ts` — merge step, `--include`/`--exclude` parsing, usage
  string.
- `test/config.test.ts`, `test/workflowFilter.test.ts` — new unit tests.
- `test/cli.test.ts` — integration tests, **including the zero-config
  regression test** (run an existing pre-milestone `report` invocation
  with no `.pathkitrc.json` present, assert output is unchanged).
- `README.md` — new config-file section, schema table, one real worked
  example.
- `CLAUDE.md` — Decisions Log entry (schema scope decision — full
  coverage over narrow — and the three error-handling decisions above).
- `LIMITATIONS.md` — no upward directory search; basename-only
  matching, no globs.
- `package.json` — version bump.

## Verification

- TDD per function, project convention.
- Two checkpoints, same pattern as Milestones I and J:
  - **(a)** `config.ts` + `workflowFilter.ts` and their full unit test
    suites, verified in isolation before touching `cli.ts` at all.
  - **(b)** CLI wiring, integration tests (including the zero-config
    regression test), docs.
- `npm run lint && npm run typecheck && npm test && npm run smoke` green
  at both checkpoints.
- Explicit zero-config regression check at checkpoint (b): run the exact
  same `report` command used in an earlier real verification (e.g.
  against the Ameriprise workflows directory) with no `.pathkitrc.json`
  present, and confirm the output matches what was verified before this
  milestone, not just "tests pass."
- Manual real-project check: create a real `.pathkitrc.json` (e.g.
  against the Ameriprise or sample project), run bare `pathkit report`
  with no flags, and paste the actual output showing it picked up the
  config — plus one CLI-flag-overrides-config example.
- `git status --short` / `git log --oneline -3` shown before merging.
