# PathKit — Setup Guide

PathKit answers one question about a Temporal TypeScript workflow: **"which execution paths exist, and which ones do my tests actually exercise?"**

It has three commands:

| Command | What it does | Needs tests? |
| --- | --- | --- |
| `pathkit analyze <file>` | Lists every possible path through one workflow file (success, failure, retry, timeout, signal). | No |
| `pathkit coverage <file> --traces <dir>` | Shows which of those paths your tests actually ran, for one workflow function. | Yes (record traces first) |
| `pathkit report <dir> --traces <dir>` | Same, across **every** workflow in a folder, with a project-wide total. | Yes |

You can start with `analyze` in 2 minutes and add coverage later.

---

## 1. Requirements

- **Node 20 or newer.**
- A TypeScript project with Temporal workflows (`@temporalio/workflow`).
- **Only for coverage tracking:** your project must already have `@temporalio/worker`, `@temporalio/client` and `@temporalio/testing`, and a test runner such as Jest. PathKit does not install these; it was developed against `^1.24.0`.

## 2. Install

```bash
npm install -D @nikhilrajutirlange/pathkit
```

If that package is not on the npm registry yet, install from git. It builds itself on install:

```bash
npm install -D git+https://github.com/NikhilRaju9010/pathkit.git
```

(If the repo is private, you need read access to it.)

Check it works:

```bash
npx pathkit --version
```

## 3. One-time project setup

Add these two lines to your project's `.gitignore`. PathKit generates temporary files you should not commit:

```
*.pathkit-instrumented.ts
.pathkit/
```

That is the only required configuration. Everything else is optional (see section 8).

## 4. Step one: see all paths (`analyze`)

```bash
npx pathkit analyze src/workflows/orderWorkflow.ts
```

Output is a numbered list, one path per entry:

```
Workflow: orderProcessingWorkflow
Total paths: 3

  1. Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --failure--> End

  2. Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --success--> End

  3. Start -> if (input.amountCents <= 0) --true--> End
```

Useful flags:

| Flag | Effect |
| --- | --- |
| `--summary` | Only the workflow name and total path count. Best for big workflows. |
| `--limit <n>` | Print at most `n` paths, plus a "... and N more" note. |
| `--mermaid` | Print a Mermaid diagram instead (paste into https://mermaid.live). |
| `--out <path>` | Also write exactly what was printed to a file. |
| `--html [path]` | Write a shareable HTML report (default `.pathkit/report.html`). |

What PathKit detects: `if/else`, `try/catch` around activity calls, `Promise.race` with a `sleep()` timer, `condition()` signal-waits, and `while`/`for` retry loops. Only **exported** functions in the file are analyzed.

## 5. Step two: record which paths your tests run (`coverage`)

PathKit works on a **copy** of your workflow with tracking added. Your own test runs that copy against a real Temporal test server, then saves what happened.

Add a test like this (Jest shown). Replace names and paths with yours:

```ts
import { prepareCoverageRun, recordCoverageTrace } from '@nikhilrajutirlange/pathkit';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

describe('orderProcessingWorkflow coverage', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);
  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('records the paths this run takes', async () => {
    const workflowFilePath = require.resolve('../src/workflows/orderWorkflow');
    const { instrumentedFilePath, cleanup } = prepareCoverageRun(workflowFilePath, 'orderProcessingWorkflow');
    try {
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'coverage-test',
        workflowsPath: instrumentedFilePath, // the COPY, not your original file
        activities: { /* your real or mocked activities */ },
      });

      const handle = await testEnv.client.workflow.start('orderProcessingWorkflow', {
        workflowId: 'coverage-test-1',
        taskQueue: 'coverage-test',
        args: [/* your input */],
      });

      // Query INSIDE runUntil — see "Rules" below.
      const rawTrace = await worker.runUntil(async () => {
        await handle.result();
        return handle.query('__pathkit_coverage__orderProcessingWorkflow');
      });

      recordCoverageTrace('.pathkit/coverage', workflowFilePath, 'orderProcessingWorkflow', rawTrace);
    } finally {
      cleanup(); // always delete the generated copy, even if the test fails
    }
  }, 60_000);
});
```

The query name is always `__pathkit_coverage__<functionName>`.

Run your tests as normal. Each run writes one JSON file into `.pathkit/coverage/`. Then:

```bash
npx pathkit coverage src/workflows/orderWorkflow.ts --traces .pathkit/coverage
```

```
Workflow function: orderProcessingWorkflow
Total paths: 3
Covered: 1/3 (33.3%)

Covered paths:
  - Start -> if (input.amountCents <= 0) --true--> End

Untested paths:
  - Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --failure--> End
  - Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --success--> End
```

To cover more paths, write more test cases (for example one where an activity rejects) that each call `recordCoverageTrace`.

Flags: `--function <name>` (needed if the file exports several workflows), `--json`, `--out <path>`, `--allow-stale`, `--clean` (deletes the trace files after reporting).

### Rules for the test (these cause the most confusing failures)

1. **Query inside `runUntil`, never after it.** Once `runUntil` finishes, the worker stops and a later query hangs forever with no error.
2. **Make a failing activity fail fast.** Temporal retries activities forever by default. To test the failure path, set `retry: { maximumAttempts: 1 }` in that workflow's `proxyActivities(...)` options, or the test will hang.
3. **Keep timer durations short in tests** (a few hundred milliseconds, like `'200ms'`). Long timers such as `'1 hour'` have caused intermittent hangs when several tests share one test environment. Use valid duration strings (`'100ms'`, not `'10 millis'`).
4. **One `prepareCoverageRun` call covers one function.** For a file with several exported workflows, do one call and one `recordCoverageTrace` per function.
5. **Always use `cleanup()` in `finally`.**
6. **Run `pathkit` from the same folder your tests ran in.** `'.pathkit/coverage'` is relative to the test process's working directory.

## 6. Step three: whole-project view (`report`)

```bash
npx pathkit report src/workflows --traces .pathkit/coverage
```

```
orderProcessingWorkflow (src/workflows/orderWorkflow.ts)
1/3 paths · 33.3%
  - Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --failure--> End: missed
  - Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --success--> End: missed
  - Start -> if (input.amountCents <= 0) --true--> End: covered

3 paths total · 1 covered · 2 missed · 33.3% project coverage
```

It scans the folder recursively and skips `node_modules`, `dist`, `build`, `coverage`, `.git`, `test`/`__tests__` folders, `*.test.ts`/`*.spec.ts` and `.d.ts` files. Colors ("covered" green, "missed" red) show only in a real terminal; use `--no-color` or the `NO_COLOR` env var to turn them off. Piped output is always plain text.

Flags: `--json`, `--out <path>`, `--no-color`, `--allow-stale`, `--html [path]`, `--include a.ts,b.ts`, `--exclude a.ts,b.ts`.

## 7. Optional: shareable HTML report

```bash
npx pathkit analyze src/workflows/orderWorkflow.ts --html
npx pathkit report src/workflows --traces .pathkit/coverage --html
```

Both write to `.pathkit/report.html` (a single self-contained file with an Analysis tab and a Coverage tab). Open it in a browser or send it to a teammate. Running either command again merges into the same report.

## 8. Optional: stop retyping flags (`.pathkitrc.json`)

Create `.pathkitrc.json` **in the folder you run `pathkit` from** (it is not searched for in parent folders):

```json
{
  "workflowsDir": "src/workflows",
  "traces": ".pathkit/coverage",
  "html": true,
  "include": ["orderWorkflow.ts", "paymentWorkflow.ts"]
}
```

Now `npx pathkit report` alone is enough.

| Key | Same as flag |
| --- | --- |
| `workflowsDir` | the folder argument |
| `traces` | `--traces` |
| `out` | `--out` |
| `json`, `noColor`, `allowStale` | `--json`, `--no-color`, `--allow-stale` |
| `html` | `--html` (`true`, `false`, or a path) |
| `include`, `exclude` | `--include`, `--exclude` |

- **Priority:** a flag you type beats the config file, which beats the default.
- **`include`/`exclude`** match the exact file name (like `orderWorkflow.ts`), case-sensitive. No folders, no wildcards, no function names.
- The config only affects `report`. `analyze` and `coverage` ignore it.
- A boolean set to `true` in the config can't be switched off by a flag for one run. Edit the file instead.

## 9. Errors and what to do

PathKit prints `pathkit <command>: <message>` and exits with code 1 for real errors.

| Message (or symptom) | Cause | Fix |
| --- | --- | --- |
| `missing <file> argument` / `missing <dir> argument` | No path given. | Pass the file or folder, or set `workflowsDir` in `.pathkitrc.json`. |
| `missing required --traces <dir> argument` | `coverage`/`report` need the trace folder. | Add `--traces .pathkit/coverage` or set `traces` in the config. |
| `Workflow file not found: ...` | Wrong path. | Check the path and your working directory. |
| `Directory not found: ...` / `Not a directory: ...` | `report` was given a bad folder. | Pass an existing folder, not a file. |
| `Workflow file has invalid TypeScript syntax: ...` | The file doesn't parse. | Fix the syntax error shown in the message. |
| `... has no exported workflow functions to analyze` | Nothing is `export`ed. | Only exported top-level functions are analyzed; export the workflow. |
| `... has multiple exported workflow functions (a, b); pass --function <name>` | `coverage` needs to know which one. | Add `--function a`. |
| `Workflow file ... has no exported function named X` | Typo in the function name. | Use the exact exported name. |
| `no exported workflow functions found under <dir>` | Empty scan, or `include` filtered everything out. | Check the folder and `include`/`exclude`. |
| `could not read traces directory ...` | The trace folder doesn't exist yet. | Run your coverage tests first so `.pathkit/coverage` is created. |
| `.pathkitrc.json is not valid JSON: ...` | Broken config. PathKit will **not** fall back to defaults. | Fix the JSON (no trailing commas, no comments). |
| `.pathkitrc.json: "include" must be an array of strings.` | Wrong value type for a known key. | Match the types in section 8. |
| `unknown key "tracse" in .pathkitrc.json (ignored)` | Typo in a config key. A warning only. | Fix the spelling. |
| `--include/--exclude entry "x.ts" matched no discovered workflow file.` | Stale or misspelled file name. A warning only. | Fix or remove the entry. |
| `invalid --limit value: ...` | `--limit` needs a positive whole number. | e.g. `--limit 20`. |
| `--limit ignored because --summary was passed.` | Both flags together. A note only. | Use one or the other. |
| `Cannot instrument: ... doesn't use named imports` (or "no named imports to merge into") | Your workflow imports `@temporalio/workflow` as `import * as wf` or as a bare `import '...'`. | Use named imports: `import { proxyActivities } from '@temporalio/workflow'`. |
| `Cannot instrument function "x": it must have a block body ({ ... })` | Arrow function with an implicit return (`async () => expr`). | Give it a `{ ... }` body. |
| `Cannot instrument this condition() (with timeout) usage ...` | `condition(fn, timeout)` result isn't stored in its own variable. | Write `const ok = await condition(fn, timeout);`. |
| `Cannot instrument this Promise.race usage ...` | The race result is used or assigned. | Use a bare statement: `await Promise.race([...]);`. |

### Warnings about trace files (printed on stderr, never fatal)

| Message | Meaning | Fix |
| --- | --- | --- |
| `... sourceHash mismatch. Re-record it, or pass allowStale ...` | The workflow file changed after the trace was recorded. Even a comment or formatting edit counts. | Re-run the tests, or pass `--allow-stale` for a cosmetic-only change. |
| `This trace does not correspond to any currently-declared path.` | The recorded run doesn't match any path PathKit knows. | Usually the workflow changed, or a known limit applies (section 10). Re-record first. |
| `Could not read or parse trace file: ...` | Corrupt or non-trace JSON in the trace folder. | Delete that file. |
| `Unsupported trace schemaVersion ...` | A trace from a different PathKit version. | Re-record it. |

### Tests hang or time out

Almost always one of: the query was issued after `runUntil` finished (rule 1), a failing activity retries forever (rule 2), or a long timer (rule 3). The first run of `TestWorkflowEnvironment` also downloads a test-server binary (~80 MB), so allow a generous `beforeAll` timeout (120 seconds).

## 10. Things to know (honest limits)

- Analysis is **one file at a time**. It does not follow imports or `executeChild` into other workflow files.
- `Promise.all` / `Promise.allSettled` and `switch` are not treated as branches. A workflow that only branches that way shows one path.
- `try/catch` counts as a branch only when it wraps an activity call.
- A retry loop counts as "retried" or "not". It doesn't count individual retries, so "succeeded on attempt 1" and "succeeded on attempt 3" look identical.
- A `return someActivity();` inside `try` **without `await`** records "success" even when the activity fails, because the `catch` can never run there. Add the `await`.
- A decision nested inside a `try` block, with more code after it, can fail to match its path (a known open bug). Those traces show up as "does not correspond to any currently-declared path".
- Very large workflows are capped at 2000 paths; the output says `(truncated at maxPaths=2000)`.
- `pathkit coverage` and `report` **always exit 0** unless there is a real error, so there is no built-in "fail below X%". To gate a CI build, read the `--json` output and check `percentage` yourself.
- Trace files pile up in `.pathkit/coverage` until you delete them (`coverage --clean`, or delete the folder).

The full, detailed list is in `LIMITATIONS.md` in the PathKit repo.

## 11. Quick reference

```bash
npm install -D @nikhilrajutirlange/pathkit         # install
npx pathkit analyze <file> [--summary|--limit N|--mermaid|--html|--out P]
npx pathkit coverage <file> --traces .pathkit/coverage [--function F] [--json] [--clean]
npx pathkit report <dir> --traces .pathkit/coverage [--include a.ts] [--exclude b.ts] [--html] [--json]
```

Generated files (all safe to delete, all gitignored): `*.pathkit-instrumented.ts` next to your workflows while a test runs, and everything under `.pathkit/` (traces, HTML report, report data).
