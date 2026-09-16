# PathKit v1 Build Plan

Static path/branch graph for Temporal TypeScript workflows (Gap 1 only — see `temporal-pathkit-idea.md` for the full two-gap vision; coverage tracking is deferred to a later plan).

Check off each milestone as it's completed, per its Definition of Done (full cumulative test suite green + CI green, `CLAUDE.md` Decisions Log updated if needed, `LIMITATIONS.md` updated if needed, `README.md` updated if needed, `demo/` manually re-checked from M3 onward, and this checkbox ticked).

- [x] **M0** — Project skeleton: TypeScript strict config, Jest + ts-jest, ESLint (required), CI, package hygiene, `CLAUDE.md`/`LIMITATIONS.md`/`PLAN.md`, `bin/pathkit --version`.
- [x] **M1** — Load and parse a single file with ts-morph; return only exported top-level functions (both `export async function` and `export const ... = async () =>` styles).
- [x] **M2** — Detect if/else branches; `switch` statements explicitly deferred and tested as a no-op.
- [ ] **M3** — Detect try/catch around activity calls (same-file heuristic); start the `demo/` project.
- [ ] **M4** — Detect `Promise.race` timeouts and `condition()` signal-waits.
- [ ] **M5** — Build the graph structure, with explicit cycle handling for retry loops.
- [ ] **M6** — Enumerate all Start→End paths, with loop-aware and hard-capped enumeration.
- [ ] **M7** — Mermaid rendering, CLI wiring (`pathkit analyze`), CLI-level error-handling tests, docs finalization.

Full milestone details, the non-negotiable quality bar, and the verification approach live in the plan document this file mirrors (kept outside the repo, in the Claude Code plan history). This file is the durable, human-readable checklist that travels with the repo itself.
