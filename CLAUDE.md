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

## 2026-09-16 — Syntax-validity check uses `Program.getSyntacticDiagnostics`, not `LanguageService`

M1 needed a way to detect "syntactically invalid TypeScript" and throw a clear error. `ts-morph`'s `LanguageService` has no `getSyntacticDiagnostics` method (that was an incorrect assumption in an early draft of `src/parser.ts`); `SourceFile.getPreEmitDiagnostics()` exists but returns *semantic* diagnostics too (type errors, unresolved imports), which would wrongly flag a syntactically valid file that imports `@temporalio/workflow` (needed from M3 onward) as broken, since that import can't resolve when a workflow file is parsed in isolation. The correct call is `project.getProgram().getSyntacticDiagnostics(sourceFile)`, which is syntax-only and won't false-positive on unresolved imports or type errors. `src/parser.ts` uses this exclusively for the "invalid syntax" check.

## 2026-09-16 — `demo/` manual check uses a throwaway script for M3–M6, not `pathkit analyze`

The plan's "manual step" for re-checking `demo/` files says to run `pathkit analyze` and paste the result into the Mermaid Live Editor — but that CLI command and Mermaid rendering don't exist until M7. For M3 through M6, the manual check instead uses a small scratch script (not part of the shipped package, not committed) that calls whatever library functions exist so far (`parseWorkflowFile`, `detectBranches`, etc.) directly against each `demo/` file and prints the raw result for visual inspection. Once M7 wires up the real `pathkit analyze` command and Mermaid output, the manual check switches to the originally planned Mermaid Live Editor workflow.

## 2026-09-16 — Activity-call recognition covers three same-file shapes, found by checking real code

Before writing M3's detector, real usage was checked directly: the SDK's own `proxyActivities` doc comments (in `node_modules/@temporalio/workflow/lib/workflow.d.ts`) show only the destructured form (`const { foo } = proxyActivities(...)`), but a search across all ~80 `workflows.ts` files in `temporalio/samples-typescript` found real production-style code using the whole-proxy-object form too (`const acts = proxyActivities(...); acts.foo()`, e.g. `worker-specific-task-queues/src/workflows.ts`, where the binding happens *inside* a function body, not just at top level). The SDK docs also show a third real shape: `foo.executeWithOptions(options, args)`, a per-call options override on a destructured activity function. `src/activityProxies.ts` recognizes all three. It does not recognize a proxy result re-destructured from an intermediate variable in a separate statement, or one passed into another function — see `LIMITATIONS.md`.

## 2026-09-16 — `condition()` has a built-in timeout form; `Promise.race` timers aren't restricted to activity calls

Checked before writing M4: `@temporalio/workflow`'s own `condition()` has three overloads — `condition(fn)` (wait only), `condition(fn, timeout)`, and `condition(fn, timeout, options)` — so a single detector marks a `condition()` call as a signal-wait branch and sets `hasTimeout` from the argument count, rather than treating the timeout form as a separate branch kind. Separately, real code search (`sleep-for-days/src/workflows.ts`: `Promise.race([sleep('30 days'), condition(() => isComplete)])`; `timer-examples/src/workflows.ts`: `Promise.race([processOrderPromise, sleep(ms)])`) showed the non-timer side of a `Promise.race` is not always an activity call — it can be a `condition()` call or an arbitrary promise variable. `src/timersAndSignals.ts` therefore only requires *one* race element to resolve to a `sleep()` call; it does not require or check the shape of the other elements. Refactored the shared "does this subtree contain a call matching X" traversal (used by both this and M3's try/catch detector) into `src/astUtils.ts`, and the shared "find the local name(s) a set of exports from a module are bound to" logic into `src/temporalImports.ts`, replacing `activityProxies.ts`'s original module-specific copy of that logic.

## 2026-09-16 — Graph construction is a single top-to-bottom statement walk, not built from the M2–M4 flat branch lists

The plan's M5 wording ("turn the ordered, possibly-nested branch list from M2–M4 into a directed graph") could be read as reassembling a graph from those detectors' flat output lists, but those lists (from `detectBranches`, `detectActivityTryCatchBranches`, `detectTimerAndSignalBranches`) don't carry parent/child nesting or sequencing information — only a location and a description. `src/graph.ts` instead walks each function's actual statement tree directly (via a `processStatements`/`processStatement` recursion threading an "open edges" frontier through sequential statements), calling the same underlying predicates (`isActivityCall`, `classifyTimerOrSignalCall`, etc.) at each relevant construct. This is the only way to get correct nesting (a branch's decision node hangs off its parent's specific edge) and correct loop back-edges. The M2–M4 detector functions are unchanged and still independently tested and used as-is; `graph.ts` is a new, independent consumer of the same lower-level predicates, not a caller of those four detector functions.

A retry loop's decision node gets exactly one labeled `"retry"` back-edge per path that falls through its body without an early `return`/`throw` — verified concretely on `demo/report-polling-workflow.ts`, whose two internal `if` checks (`status === 'complete'`, `status === 'failed'`) each independently reach either `End` (early return) or the loop's back-edge (falls through to retry), producing exactly the cycle the plan requires. Building the graph is a single linear pass over the statement tree regardless of any loop present — it never "runs" the loop — so there is no risk of this step itself hanging; that concern is deferred to M6's path enumeration, which is the milestone that actually walks the graph's paths.
