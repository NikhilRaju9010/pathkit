# PathKit

Static path/branch graph analysis for Temporal TypeScript workflows.

PathKit parses a Temporal workflow file and maps every possible way it can execute — success, failure, retry, timeout, and signal branches — then renders the result as a Mermaid diagram.

> **Status:** early development (v0.1.0). The CLI currently only supports `pathkit --version`. Branch detection and graph generation are not implemented yet — see [PLAN.md](./PLAN.md) for the milestone roadmap and [LIMITATIONS.md](./LIMITATIONS.md) for known scope boundaries.

## Install

```bash
npm install -D @nikhilrajutirlange/pathkit
```

## Usage

```bash
npx pathkit --version
```

Full `pathkit analyze <file>` usage and example output will be documented here once implemented (see PLAN.md, milestone M7).

## Supported Temporal SDK version

Developed and tested against `@temporalio/workflow` and `@temporalio/testing` `^1.24.0`.

## Scope

PathKit v1 analyzes **one workflow file at a time**. It does not follow imports across files and does not do cross-project type resolution. See [LIMITATIONS.md](./LIMITATIONS.md) for the full list of known scope boundaries.

## License

MIT — see [LICENSE](./LICENSE).
