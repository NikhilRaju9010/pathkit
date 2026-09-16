# Contributing to PathKit

## Setup

```bash
npm install
```

## Development commands

- `npm test` — run the full Jest test suite (must always run every fixture from every milestone, not a subset)
- `npm run typecheck` — run `tsc --noEmit` in strict mode
- `npm run lint` — run ESLint
- `npm run build` — compile `src/` to `dist/`

All four must pass before a change is considered done. CI runs all of them plus `npm audit --audit-level=high` on every push and pull request.

## Code style

- TypeScript strict mode. No `any` unless truly unavoidable, and if used, a comment must explain why.
- Functions that touch a workflow file must fail with a clear thrown error message on bad input (missing file, invalid syntax, no exported functions) — never crash silently or guess.

## Commit messages

Prefix with `feat:` / `fix:` / `test:` / `docs:` / `chore:`, and reference the milestone number where relevant, e.g. `feat: detect if/else branches (M2)`.

## Project roadmap

See [PLAN.md](./PLAN.md) for the milestone-by-milestone build plan, and [LIMITATIONS.md](./LIMITATIONS.md) for patterns PathKit deliberately does not support.
