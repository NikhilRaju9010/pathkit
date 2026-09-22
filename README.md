# PathKit

Static path/branch graph analysis for Temporal TypeScript workflows.

PathKit parses a Temporal workflow file and maps every possible way it can execute — success, failure, retry, timeout, and signal branches — then prints the result as a numbered plain-text path list, or as a Mermaid diagram with `--mermaid`.

> **Status:** v0.4.0. Both planned pieces of PathKit are complete: static path/branch analysis for a single workflow file (if/else, try/catch around activities, `Promise.race` timeouts, `condition()` signal-waits, and retry loops), and workflow path **coverage tracking** (`prepareCoverageRun`/`recordCoverageTrace` record traces from your own Temporal test suite, and `pathkit coverage` reports on them). See [PLAN.md](./PLAN.md) for the full milestone history and [LIMITATIONS.md](./LIMITATIONS.md) for the honest list of known scope boundaries for both.

## Install

```bash
npm install -D @nikhilrajutirlange/pathkit
```

If the package isn't available on the npm registry yet (e.g. a pending npm account/OTP verification), install directly from git instead — a `prepare` script builds `dist/` automatically on install, so this works the same as a registry install:

```bash
npm install -D git+https://github.com/NikhilRaju9010/pathkit.git
```

This also works for local development: `git clone` the repo and run `npm install` inside it — `dist/` is built automatically, with no separate `npm run build` step required first.

## Usage

```bash
npx pathkit analyze <path-to-workflow-file.ts> [--out <path>] [--mermaid] [--summary] [--limit <n>] [--html [path]]
```

- Prints, for every exported workflow function in the file, its total path count and a numbered, evenly-spaced list of every possible execution path, in the same `Start -> ... -> End` style `pathkit coverage`/`pathkit report` already use. Pass `--mermaid` to print a Mermaid flowchart diagram instead.
- `--summary` skips the per-path list entirely and prints only the workflow name and total path count — useful when you just want the number for a large workflow.
- `--limit <n>` prints at most `n` path lines, followed by a note showing how many more paths exist. Without `--limit`, every path prints (this is unchanged from before). Passing `--summary` and `--limit` together prints the summary and a stderr warning that `--limit` was ignored, rather than silently dropping it.
- `--out <path>` writes the same report shown on stdout to disk (respecting `--summary`/`--limit` if passed).
- `--html [path]` also updates a self-contained, no-server HTML report (default `.pathkit/report.html`, or a custom path if given) with an Analysis tab and a Coverage tab — see "HTML report" below. Only this workflow's own entry is updated; other workflows already in the report are untouched.
- `pathkit --version` prints the installed version.

### Example

Given a workflow that polls a report job's status in a loop until it completes, fails, or a max attempt count is reached:

```ts
export async function reportPollingWorkflow(input: GenerateReportInput): Promise<string> {
  await startReportJob(input.reportId);

  for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) {
    const status = await checkReportJobStatus(input.reportId);

    if (status === 'complete') {
      return downloadReportResult(input.reportId);
    }
    if (status === 'failed') {
      return 'report generation failed';
    }

    await sleep('10 seconds');
  }

  return 'report generation timed out';
}
```

```bash
npx pathkit analyze demo/report-polling-workflow.ts
```

outputs:

```
Workflow: reportPollingWorkflow
Total paths: 4

  1. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --retry--> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --exit--> End

  2. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --true--> End

  3. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --true--> End

  4. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --exit--> End
```

Pass `--summary` for just the count, useful on a large workflow:

```bash
npx pathkit analyze demo/report-polling-workflow.ts --summary
```

outputs:

```
Workflow: reportPollingWorkflow
Total paths: 4
```

Pass `--limit <n>` to cap how many path lines print:

```bash
npx pathkit analyze demo/report-polling-workflow.ts --limit 2
```

outputs:

```
Workflow: reportPollingWorkflow
Total paths: 4

  1. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --retry--> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --exit--> End

  2. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --true--> End

  ... and 2 more paths (use --summary or increase --limit to see them)
```

Pass `--mermaid` to get a Mermaid flowchart diagram instead:

```bash
npx pathkit analyze demo/report-polling-workflow.ts --mermaid
```

outputs:

````
Workflow: reportPollingWorkflow
Total paths: 4

```mermaid
flowchart TD
  n0(["Start"])
  n1{"for (let attempt = 1; attempt &lt;= input.maxPollAttempts; attempt++)"}
  n2{"if (status === &#39;complete&#39;)"}
  n3{"if (status === &#39;failed&#39;)"}
  n4(["End"])
  n0 --> n1
  n1 -->|iterate| n2
  n2 -->|false| n3
  n3 -->|retry| n1
  n2 -->|true| n4
  n3 -->|true| n4
  n1 -->|exit| n4
```
````

Paste the fenced ` ```mermaid ` block into the [Mermaid Live Editor](https://mermaid.live) or a GitHub/GitLab markdown file to view the diagram — note the `retry` edge looping back to the polling decision node, representing the loop's retry behavior as a single labeled cycle rather than unrolling every possible iteration count.

More example workflows (order processing, a retry/poll loop, a signal-driven approval flow) are in [`demo/`](./demo).

## Coverage tracking

`pathkit coverage` reports which of a workflow function's statically-declared paths your tests actually exercised, by merging recorded trace files against the same path list `analyze` computes. Two small helper functions — `prepareCoverageRun` and `recordCoverageTrace` — produce those trace files from your own Temporal test suite; see "Recording traces from your own tests" below.

```bash
npx pathkit coverage <path-to-workflow-file.ts> --traces <dir> [--function <name>] [--out <path>] [--json] [--allow-stale] [--clean]
```

- `--traces <dir>` (required) — a directory of `*.json` trace files (see the trace schema in `src/coverageReport.ts`'s `CoverageTraceFile`).
- `--function <name>` — which exported function to report on; only needed if the file exports more than one.
- Prints a human-readable text report by default: total paths, covered count and percentage, and named lists of covered/untested paths. `--json` prints the full `CoverageReport` structure instead, for scripts/CI.
- `--out <path>` also writes the exact same report content to disk.
- `--allow-stale` compares a trace against the workflow's current source even if its recorded `sourceHash` doesn't match (e.g. after a purely cosmetic edit — see [LIMITATIONS.md](./LIMITATIONS.md)).
- `--clean` deletes every trace file in `--traces <dir>` after printing the report — a deliberate, explicit cleanup step, not automatic.
- A trace that can't be matched to any declared path (unreadable, wrong schema version, stale, or genuinely unmatched) is reported as a warning on stderr and in the JSON output's `unmatchedTraces` — never silently dropped, and never fails the command.

### Example

Given `demo/order-processing-workflow.ts` and one recorded trace showing its rejection branch was tested:

```bash
npx pathkit coverage demo/order-processing-workflow.ts --traces .pathkit/coverage/
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

### Recording traces from your own tests

PathKit ships two small functions — `prepareCoverageRun` and `recordCoverageTrace` — that are the entire public surface for this half of the feature. Neither one imports anything from `@temporalio/*`: `prepareCoverageRun` only writes an instrumented copy of your workflow file, and `recordCoverageTrace` only writes a trace JSON file. Running the instrumented copy through a real Temporal Worker is up to your own test, using whatever `@temporalio/worker`/`@temporalio/testing`/`@temporalio/client` version your project already depends on.

```ts
import { prepareCoverageRun, recordCoverageTrace } from '@nikhilrajutirlange/pathkit';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

describe('reportPollingWorkflow coverage', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await testEnv.teardown();
  });

  it('records which paths a passing test actually exercised', async () => {
    const workflowFilePath = require.resolve('../src/workflows/report-polling-workflow');
    const { instrumentedFilePath, cleanup } = prepareCoverageRun(workflowFilePath, 'reportPollingWorkflow');

    // Recommended: wire cleanup() into afterEach/afterAll too, not just the
    // end of the happy path below — the instrumented sibling file must
    // still be removed even if this test throws or an assertion fails
    // partway through.
    try {
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: 'coverage-test',
        workflowsPath: instrumentedFilePath, // the instrumented copy, not the original file
      });

      const handle = await testEnv.client.workflow.start('reportPollingWorkflow', {
        workflowId: 'coverage-test-1',
        taskQueue: 'coverage-test',
        args: [{ reportId: 'r1', maxPollAttempts: 5 }],
      });

      // IMPORTANT: query the coverage trace from *inside* runUntil, while
      // the Worker is still polling. runUntil stops the Worker as soon as
      // its callback's promise resolves, and a Query issued after that has
      // no Worker left to compute it — it will hang forever, not error.
      const rawTrace = await worker.runUntil(async () => {
        await handle.result();
        return handle.query('__pathkit_coverage__reportPollingWorkflow');
      });

      recordCoverageTrace('.pathkit/coverage', workflowFilePath, 'reportPollingWorkflow', rawTrace);
    } finally {
      cleanup();
    }
  });
});
```

Run this test as part of your normal suite (as many times, across as many test cases, as you like — `recordCoverageTrace` always writes a uniquely-named file, so parallel test workers and repeated runs never collide), then run `pathkit coverage` against the same `.pathkit/coverage` directory to see the combined report.

## Combined report (`pathkit report`)

`pathkit coverage` reports on one workflow function at a time. `pathkit report` recursively scans a whole directory for workflow files and combines `analyze`'s path list with `coverage`'s trace matching into one project-wide view: every declared path for every exported workflow function found, each marked covered or missed, with a per-workflow subtotal and a project-wide total.

```bash
npx pathkit report <dir> --traces <dir> [--out <path>] [--json] [--no-color] [--allow-stale] [--html [path]]
```

- `<dir>` is scanned recursively for `*.ts` files, skipping `node_modules`, `dist`, `build`, `coverage`, and `.git` directories, `.d.ts` declaration files, generated `*.pathkit-instrumented.ts` files, and test files (`*.test.ts`/`*.spec.ts`, or anything under a `__tests__`/`test` directory). Every exported function found in every matched file is treated as one workflow.
- `--traces <dir>` (required) is the same trace directory `pathkit coverage` reads — one shared directory works for every workflow's traces at once, since each trace file already self-identifies its function.
- `--out <path>` also writes the report to disk — always as plain, uncolored text (or plain JSON with `--json`), regardless of whether the terminal run itself showed color.
- `--json` prints the full aggregated report structure instead of the text format, for scripts/CI.
- Individual path lines are colored green (`covered`) / red (`missed`) when stdout is a real terminal. Color is automatically disabled when piped (e.g. `pathkit report ... > out.txt`), when the `NO_COLOR` env var is set to any non-empty value, or when `--no-color` is passed — piped/non-color output always reads as plain text with the literal words "covered"/"missed", never raw ANSI codes. Only individual path lines are colored; per-workflow and project-wide total lines are always plain.
- `--allow-stale` compares a trace against a workflow's current source even if its recorded `sourceHash` doesn't match, same as `pathkit coverage --allow-stale`.
- `--html [path]` refreshes the same HTML report `analyze --html` writes to — both its Analysis and Coverage tabs, for every workflow this run discovered — and appends one entry to the report's history trend. See "HTML report" below.
- A file that fails to parse, or a trace that can't be matched to any declared path, is reported as a warning on stderr — never silently dropped, and never a hard failure of the whole command.

### Example

Given a small project with two workflow files:

```
$ npx pathkit report demo/ --traces .pathkit/coverage/
orderProcessingWorkflow (demo/order-processing-workflow.ts)
1/3 paths · 33.3%
  - Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --failure--> End: missed
  - Start -> if (input.amountCents <= 0) --false--> try/catch (activity) --success--> End: missed
  - Start -> if (input.amountCents <= 0) --true--> End: covered

reportPollingWorkflow (demo/report-polling-workflow.ts)
2/4 paths · 50.0%
  - Start -> for (...) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --retry--> for (...) --exit--> End: missed
  - Start -> for (...) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --true--> End: covered
  - Start -> for (...) --iterate--> if (status === 'complete') --true--> End: covered
  - Start -> for (...) --exit--> End: missed

7 paths total · 3 covered · 4 missed · 42.9% project coverage
```

Full path listings can get long for a project with hundreds of paths across many workflows — a `--summary` flag to collapse to workflow-level totals only is a deliberately deferred future addition, not part of this first pass (see [LIMITATIONS.md](./LIMITATIONS.md)).

## HTML report

Pass `--html` to `analyze` or `report` to also update a self-contained, no-server HTML report at `.pathkit/report.html` (or a custom path with `--html <path>`) — open it directly in a browser (double-click, no server needed; it makes no external requests). It has two tabs:

- **Analysis** — every workflow's numbered declared-path list, the same data `analyze`'s own terminal output shows.
- **Coverage** — the same numbered paths marked covered/missed, a subtotal, and a High/Medium/Low priority label (`<50%` High, `50–80%` Medium, `>80%` Low), plus a trend of the last up-to-5 `report --html` runs' project-wide coverage.

Path numbers are the same in both tabs for the same workflow, so "path 3" means the same thing whether you're looking at Analysis or Coverage.

The two commands update different scopes of the same report:

- `analyze <file> --html` updates only that file's workflow(s) in the **Analysis** tab. It never touches the Coverage tab or other workflows' entries — a quick single-file check between full `report` runs doesn't invalidate the rest of the report.
- `report <dir> --traces <dir> --html` is project-wide: it refreshes **both tabs** for every workflow it discovers, and appends one entry to the history trend.

A workflow that's only ever been seen by `analyze --html` (never by a `report --html` run) shows "not yet measured" in the Coverage tab rather than 0% or blank.

Both commands persist their data in `.pathkit/report-data.json` (and `report --html` also updates `.pathkit/report-history.json`) — gitignored, internal state that both commands read and merge into, always at that fixed location even if `--html <path>` points the rendered HTML file itself somewhere else.

```bash
npx pathkit report demo/ --traces .pathkit/coverage/ --html
```

writes/updates `.pathkit/report.html` with all of `demo/`'s workflows, covered/missed per path, and a coverage-trend history entry.

## What PathKit detects (v1)

- `if`/`else` branches
- `try`/`catch` blocks that wrap a recognized activity call
- `Promise.race([..., sleep(ms)])` success-vs-timeout races
- `condition(fn[, timeout])` signal-waits
- `while`/`for` loops that wrap a recognized activity call (represented as a labeled `retry` cycle, not unrolled)

`switch` statements and a few other patterns are deliberately out of scope for v1 — see [LIMITATIONS.md](./LIMITATIONS.md) for the full, honest list of what isn't detected and why.

## Supported Temporal SDK version

Developed and tested against `@temporalio/workflow`, `@temporalio/testing`, `@temporalio/worker`, and `@temporalio/client` `^1.24.0`. None of these are runtime dependencies of the published package — PathKit's own code never imports any of them, and `prepareCoverageRun`/`recordCoverageTrace` work against whatever `@temporalio/*` version your own project already has installed.

## Scope

PathKit v1 analyzes **one workflow file at a time**. It does not follow imports across files and does not do cross-project type resolution. See [LIMITATIONS.md](./LIMITATIONS.md) for the full list of known scope boundaries.

## License

MIT — see [LICENSE](./LICENSE).
