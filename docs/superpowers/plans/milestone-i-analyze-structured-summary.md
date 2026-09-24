# Milestone I — Structured & Summarized `analyze` Output

## Context

`pathkit analyze` currently prints one `Start -> ... -> End` line per path,
in the order paths are enumerated, with no numbering, spacing, or grouping.
This is fine for small workflows (2–4 paths) but breaks down completely on
real-world workflows: a recent run against a production-style workflow
(`Ameriprise`) produced **2141 paths**, most sharing a 15–20-step common
prefix before diverging near the end. The current output is an unreadable
wall of near-duplicate lines.

This milestone fixes the *default* output's readability and adds an
explicit summary mode for large workflows. It does **not** touch the HTML
report (that's Milestone J, planned separately) — but the data structure
built here should be reusable by Milestone J, so do the formatting logic
as a separate step from the terminal-printing step (see Requirement 5).

## Goals

1. Default terminal output is numbered, evenly spaced, and easy to scan
   for small-to-medium workflows.
2. A new `--summary` flag prints only the workflow name and total path
   count — no per-path dump — for when a dev just wants the number.
3. A new `--limit <n>` flag caps how many path lines print by default,
   with a clear "... and N more paths (use --summary or increase --limit
   to see them)" message, so a 2000-path workflow doesn't flood the
   terminal unless the dev explicitly asks for it.
4. None of this changes `enumeratePathsWithEdgeIndices` or `describePath`
   (the shared exports `report`/`coverage` also use) — this is
   presentation-layer only, same constraint as the H-milestone work.

## Requirements

1. **Numbered, spaced default output.** Each path gets a number
   (`1.`, `2.`, ...), consistent indentation, and a blank line between
   entries so long path strings don't visually run together. Keep the
   existing `Workflow: <name>` / `Total paths: <n>` header.

2. **`--summary` flag.** When passed, skip the per-path list entirely —
   print only the workflow name and total path count. No traces are
   involved (this is still pre-test static analysis), so no
   covered/missed here.

3. **`--limit <n>` flag.** When passed (and `--summary` is not), print at
   most `n` path lines, then a one-line note showing how many more exist
   and how to see them. Default behavior with neither flag: print all
   paths as today, just better formatted (don't silently truncate by
   default — that would be a surprising behavior change).

4. **Don't touch `--mermaid`.** It should keep working exactly as it does
   now, unaffected by these new flags.

5. **Architecture**: extract the "turn an enumerated path list into
   display-ready lines" logic into its own function, separate from the
   function that writes to `process.stdout`. This is so Milestone J's
   HTML report can reuse the same formatting/numbering logic instead of
   reimplementing it. You don't need to build anything HTML-related now —
   just don't hard-code terminal-only concerns (color codes, line width)
   into the same function that produces the structured path data.

6. **Update usage strings and README.** The `analyze` usage line and the
   README's analyze section need to document `--summary` and `--limit`
   alongside the existing `--out` and `--mermaid`.

7. **Tests**: cover default output on a small workflow (existing demo
   files are fine), `--summary` output, and `--limit` truncation behavior
   (including the "N more paths" message) on a workflow with enough paths
   to trigger truncation.

## Definition of done (matches project convention)

- TDD: failing test → implement → pass → verify → commit, per task.
- `npm run lint && npm run typecheck && npm test && npm run smoke` all
  green.
- `CLAUDE.md` decision log updated.
- `README.md` analyze section updated with real, verified CLI output —
  not invented text.
- Show the actual terminal output of default, `--summary`, and `--limit`
  runs at the checkpoint, plus `git status --short` / `git log --oneline
  -3`, before merging.
