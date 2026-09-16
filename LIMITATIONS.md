# Known Limitations

PathKit is a static analysis tool. Rather than silently guessing at code it can't reliably interpret, it aims to either detect a pattern correctly or clearly not detect it at all. This file tracks the boundaries of what v1 supports, updated as each milestone is built.

## Scope boundaries (by design, not bugs)

- **Single-file analysis only.** PathKit analyzes one workflow file at a time, passed directly on the CLI. It does not follow imports, does not resolve helper functions defined in other files, and does not do cross-project type resolution. A workflow that splits its logic across multiple files will only show the branches visible in the file actually analyzed.

- **Activity-call detection is a same-file syntactic heuristic, not type resolution.** A call is treated as "an activity call" when it can be traced, within the same file, back to a local `proxyActivities()` / `proxyLocalActivities()` result (e.g. `const acts = proxyActivities<T>(...); acts.foo()`). PathKit does not use the TypeScript type checker to resolve the activity interface across files — only the local call-site pattern is recognized. A call to an activity proxy that was created in a different file, passed in as a parameter, or produced by a wrapper function will not be recognized as an activity call in v1.

## Patterns not yet evaluated

Entries below are added as each detection milestone is built, reflecting real gaps discovered during implementation (not written speculatively ahead of time).
