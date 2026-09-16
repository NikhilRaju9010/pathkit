# CLAUDE.md

**Before doing anything else in this repo, read [PLAN.md](./PLAN.md) and [LIMITATIONS.md](./LIMITATIONS.md) in full, then summarize the current status (which milestone is complete, which is next, and any open limitation) before starting new work.**

## Project summary

PathKit is a TypeScript CLI tool that statically analyzes a Temporal workflow file, finds every possible execution branch (if/else, try/catch around activities, `Promise.race` timeouts, `condition()` signal-waits, retry loops), builds a graph of every possible path through the workflow, and renders it as a Mermaid diagram. v1 covers this analysis only ("Gap 1" in `temporal-pathkit-idea.md`); coverage tracking of which paths tests actually exercise ("Gap 2") is deliberately out of scope for v1 and deferred to a later plan.

## Locked architecture decisions

- **AST tooling:** `ts-morph`, not the raw TypeScript compiler API — chosen for a friendlier surface given the project author has limited coding experience.
- **Test framework:** Jest (with `ts-jest`), matching Temporal SDK's own testing conventions.
- **Package manager:** npm.
- **Scope:** single-file analysis only — no cross-file import resolution, no cross-project type resolution. See `LIMITATIONS.md`.
- **Activity-call detection:** a same-file syntactic heuristic (trace a call back to a local `proxyActivities()`/`proxyLocalActivities()` result), not TypeScript type-checker resolution. See `LIMITATIONS.md`.
- **Function scope:** only **exported** top-level functions in a file are treated as workflow entry points; non-exported helpers are ignored.
- **`switch` statements:** deliberately deferred out of v1 branch detection (M2); not detected as branch points.
- **Determinism:** node/edge/path ordering must be identical across runs on the same input (source-order AST traversal).
- **Cycles:** retry loops produce a labeled back-edge in the graph, not infinite unrolling; path enumeration treats a loop as "taken once" vs. "not taken" and enforces a hard `maxPaths` cap.
- **Temporal SDK version pinned for development:** `@temporalio/workflow` and `@temporalio/testing` `^1.24.0`. (Note: there is no `@temporalio/sdk` package — an earlier plan draft referenced it incorrectly.)
- **TypeScript version pinned:** `^6.0.3`, not the newer `7.x` line, because `ts-jest@29` and `@typescript-eslint@8` do not yet support TypeScript 7.

## Decisions Log

<!-- Append dated entries here whenever an architecture decision or approach changes during a milestone. Format: `## YYYY-MM-DD — <short title>` followed by what changed and why. -->
