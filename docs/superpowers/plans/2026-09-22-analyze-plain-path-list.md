# `pathkit analyze` Default Output: Plain Path List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `pathkit analyze`'s default terminal output from a Mermaid flowchart to a plain numbered path list (reusing the existing `describePath` formatter), moving the Mermaid diagram behind a new `--mermaid` flag.

**Architecture:** `runAnalyze` in `src/cli.ts` currently builds a graph, enumerates paths (for the count only), renders Mermaid, and always prints the Mermaid block. It changes to always enumerate paths *with edge indices* (`enumeratePathsWithEdgeIndices`, already exported by `src/paths.ts`), and to format the report body two ways depending on a new `--mermaid` boolean flag parsed alongside the existing `--out`: default → a numbered list of `describePath(graph, path.edgeIndices)` strings; `--mermaid` → the existing `renderMermaid(graph)` fenced block, byte-for-byte the same as today's only output. No changes to `src/parser.ts`, `src/graph.ts`, or `src/paths.ts` — this is output formatting only in `src/cli.ts`, plus doc/usage-string updates.

**Tech Stack:** TypeScript, ts-morph, Jest/ts-jest, npm.

**Spec:** This plan's own header + the user's request (reproduced below) is the spec; there is no separate spec doc.

> Change `pathkit analyze`'s default terminal output from a Mermaid flowchart to a plain numbered path list, matching the visual style of `pathkit report`'s path lines. Reuse `describePath` (no new path-formatting logic). Number each path and print the total path count, same as today's "Total paths: N". Move Mermaid behind a new `--mermaid` flag, kept available. Update the `analyze` usage string and README's analyze example. Don't touch the parser or path-enumeration logic — output formatting only.

## Global Constraints

- Reuse `describePath` (exported from `src/paths.ts`) for path text — do not write new path-formatting logic.
- Do not modify `src/parser.ts`, `src/graph.ts`, or `src/paths.ts`. All enumeration/formatting functions used here (`enumeratePathsWithEdgeIndices`, `describePath`, `buildWorkflowGraph`, `renderMermaid`) already exist and are already exported.
- `--mermaid` output must remain byte-identical to today's current default output (same `Workflow: <name>` / `Total paths: N[+ (truncated...)]` header lines, same fenced ` ```mermaid ` block).
- Keep the existing "one block per exported function, joined by `\n`" structure and the existing `--out` write-to-disk behavior — both are untouched, orthogonal concerns.
- Follow this project's existing CLI conventions exactly (see `src/cli.ts`'s `coverage`/`report` commands): flags parsed in the command's own manual arg parser, `PathKitError` is the only caught error type, usage strings list every flag.

---

## File Structure

- **Modify:** `src/cli.ts` — `parseAnalyzeArgs` gains a `mermaid: boolean` field; `runAnalyze` branches on it; both usage-string occurrences of the `analyze` command gain `[--mermaid]`.
- **Modify:** `test/cli.test.ts` — update the two existing `analyze` subprocess tests that assert on Mermaid-specific output (they now test the *new default*, plain-list, behavior), and add one new test asserting `--mermaid` still produces the old Mermaid output.
- **Modify:** `README.md` — the `analyze` usage line (~line 26), its description bullet (~line 29), and the worked example's output block (~lines 58-85), replaced with the plain-list default output plus a short `--mermaid` addendum.

No new files.

---

### Task 1: Switch `runAnalyze`'s default output to a numbered plain path list, add `--mermaid`

**Files:**
- Modify: `src/cli.ts:1-115` (imports, `runAnalyze`, `parseAnalyzeArgs`, and the two `analyze` usage-string lines at `src/cli.ts:47` and `src/cli.ts:58`)
- Test: `test/cli.test.ts` (the `describe('bin/pathkit CLI (real subprocess)', ...)` block, `test/cli.test.ts:55-76`)

**Interfaces:**
- Consumes (all pre-existing, no changes needed to their own files):
  - `enumeratePathsWithEdgeIndices(graph: WorkflowGraph, maxPaths?: number): { paths: { labels: string[]; edgeIndices: number[] }[]; truncated: boolean }` — `src/paths.ts`
  - `describePath(graph: WorkflowGraph, edgeIndices: readonly number[]): string` — `src/paths.ts`
  - `buildWorkflowGraph(node, name): WorkflowGraph` — `src/graph.ts` (already imported in `cli.ts`)
  - `renderMermaid(graph): string` — `src/mermaid.ts` (already imported in `cli.ts`)
  - `DEFAULT_MAX_PATHS` — `src/paths.ts` (already imported in `cli.ts`)
- Produces: `runAnalyze`'s stdout/file contract, consumed only by `bin/pathkit` and `test/cli.test.ts` (no other module calls `runAnalyze` directly).

- [ ] **Step 1: Write the failing tests in `test/cli.test.ts`**

  Replace the existing `'a valid file exits 0 with Mermaid output on stdout'` test (`test/cli.test.ts:55-61`) with a test for the new default, and add a new test right after it for `--mermaid`. Also update the `--out` test (`test/cli.test.ts:63-76`) to assert on the new default plain-list content instead of `'flowchart TD'`.

  ```ts
  it('a valid file exits 0 with a numbered plain-text path list on stdout by default', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm5', 'retry-loop.ts')]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Workflow: retryLoopWorkflow');
    expect(result.stdout).toContain('Total paths: 3');
    expect(result.stdout).toContain(
      "  1. Start -> for (let attempt = 1; attempt <= maxAttempts; attempt++) --iterate--> if (status === 'complete') --retry--> for (let attempt = 1; attempt <= maxAttempts; attempt++) --exit--> End",
    );
    expect(result.stdout).toContain(
      "  2. Start -> for (let attempt = 1; attempt <= maxAttempts; attempt++) --iterate--> if (status === 'complete') --true--> End",
    );
    expect(result.stdout).toContain('  3. Start -> for (let attempt = 1; attempt <= maxAttempts; attempt++) --exit--> End');
    expect(result.stdout).not.toContain('flowchart TD');
  });

  it('a valid file with --mermaid exits 0 with Mermaid output on stdout', () => {
    const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm5', 'retry-loop.ts'), '--mermaid']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Workflow: retryLoopWorkflow');
    expect(result.stdout).toContain('Total paths: 3');
    expect(result.stdout).toContain('flowchart TD');
    expect(result.stdout).not.toContain('  1. Start');
  });
  ```

  And update the `--out` test body (`test/cli.test.ts:63-76`) — replace its two `flowchart TD` references:

  ```ts
  it('writes the report to disk when --out is passed', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pathkit-cli-test-'));
    const outPath = path.join(tmpDir, 'report.md');
    try {
      const result = runCliSubprocess(['analyze', path.join(FIXTURES_DIR, 'm2', 'simple-if-else.ts'), '--out', outPath]);
      expect(result.exitCode).toBe(0);
      const written = readFileSync(outPath, 'utf8');
      expect(written).toContain('Workflow: simpleIfElse');
      expect(written).toContain('  1. Start');
      expect(written).toBe(result.stdout);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npm test -- test/cli.test.ts -t "analyze"`
  Expected: the new `'--mermaid'` test and the rewritten default/`--out` tests FAIL — the default test fails because stdout still contains `flowchart TD` (and lacks `1. Start`); the `--mermaid` test fails because `runAnalyze` doesn't recognize `--mermaid` (it's silently ignored as a no-op today — the assertions on `Total paths: 3` and `flowchart TD` still pass by coincidence since Mermaid is the *current* default, but this is expected and fine since the two tests are meant to converge after Step 3, not diverge at this checkpoint — the important RED signal is the default-output test).

- [ ] **Step 3: Implement in `src/cli.ts`**

  Update the imports at the top of `src/cli.ts` (currently `import { DEFAULT_MAX_PATHS, enumeratePaths } from './paths';`):

  ```ts
  import { DEFAULT_MAX_PATHS, describePath, enumeratePathsWithEdgeIndices } from './paths';
  ```

  (`enumeratePaths` is no longer used by `cli.ts` once this change lands — confirm nothing else in the file still calls it before deleting it from the import list.)

  Replace `runAnalyze` (`src/cli.ts:54-98`):

  ```ts
  function runAnalyze(args: string[], io: CliIO): number {
    const { filePath, outPath, mermaid } = parseAnalyzeArgs(args);

    if (filePath === undefined) {
      io.stderr('pathkit analyze: missing <file> argument. Usage: pathkit analyze <file> [--out <path>] [--mermaid]\n');
      return 1;
    }

    let functions: ParsedWorkflowFunction[];
    try {
      functions = parseWorkflowFile(filePath);
    } catch (err) {
      if (err instanceof PathKitError) {
        io.stderr(`pathkit analyze: ${err.message}\n`);
        return 1;
      }
      throw err;
    }

    if (functions.length === 0) {
      io.stderr(`pathkit analyze: ${filePath} has no exported workflow functions to analyze.\n`);
      return 1;
    }

    const report = functions
      .map((fn) => {
        const graph = buildWorkflowGraph(fn.node, fn.name);
        const pathResult = enumeratePathsWithEdgeIndices(graph);
        const totalPathsLine = pathResult.truncated
          ? `Total paths: ${pathResult.paths.length}+ (truncated at maxPaths=${DEFAULT_MAX_PATHS})`
          : `Total paths: ${pathResult.paths.length}`;

        if (mermaid) {
          const mermaidText = renderMermaid(graph);
          return `Workflow: ${fn.name}\n${totalPathsLine}\n\n\`\`\`mermaid\n${mermaidText}\n\`\`\`\n`;
        }

        const pathLines = pathResult.paths
          .map((p, i) => `  ${i + 1}. ${describePath(graph, p.edgeIndices)}`)
          .join('\n');

        return `Workflow: ${fn.name}\n${totalPathsLine}\n\n${pathLines}\n`;
      })
      .join('\n');

    io.stdout(report);

    if (outPath !== undefined) {
      writeFileSync(outPath, report, 'utf8');
    }

    return 0;
  }
  ```

  Replace `parseAnalyzeArgs` (`src/cli.ts:100-115`):

  ```ts
  function parseAnalyzeArgs(args: string[]): { filePath: string | undefined; outPath: string | undefined; mermaid: boolean } {
    let outPath: string | undefined;
    let mermaid = false;
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--out') {
        outPath = args[i + 1];
        i++;
      } else if (args[i] === '--mermaid') {
        mermaid = true;
      } else {
        const value = args[i];
        if (value !== undefined) positional.push(value);
      }
    }

    return { filePath: positional[0], outPath, mermaid };
  }
  ```

  Update the top-level unknown-command usage string (`src/cli.ts:47`):

  ```ts
      '  analyze <file> [--out <path>] [--mermaid]\n' +
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npm test -- test/cli.test.ts`
  Expected: PASS — all `analyze` tests (including the untouched error-case tests at `test/cli.test.ts:37-53`, which don't reference Mermaid at all and are unaffected) plus the full pre-existing `coverage`/`report` suites in the same file, since nothing else in `cli.ts` was touched.

- [ ] **Step 5: Run the full project verification**

  Run: `npm run lint && npm run typecheck && npm test`
  Expected: all clean. (Skip `npm run smoke` for this task — no dependency or public-API-surface change; run it once at the end in Task 2 alongside the doc update, per the project's own established "verification pass at the end of a milestone" pattern.)

- [ ] **Step 6: Commit**

  ```bash
  git add src/cli.ts test/cli.test.ts
  git commit -m "Default pathkit analyze output to a plain numbered path list, move Mermaid behind --mermaid"
  ```

---

### Task 2: Update README's `analyze` usage line, description, and worked example

**Files:**
- Modify: `README.md:26` (usage line), `README.md:29` (description bullet), `README.md:58-85` (worked example output block)

**Interfaces:**
- Consumes: Task 1's shipped `--mermaid` flag and plain-list default output — this task only transcribes real CLI output, it doesn't call any code directly itself.
- Produces: nothing consumed elsewhere — this is the last task.

- [ ] **Step 1: Update the usage line and description bullet**

  `README.md:26`, currently:

  ```bash
  npx pathkit analyze <path-to-workflow-file.ts> [--out <path>]
  ```

  becomes:

  ```bash
  npx pathkit analyze <path-to-workflow-file.ts> [--out <path>] [--mermaid]
  ```

  `README.md:29`, currently:

  ```
  - Prints, for every exported workflow function in the file, its total path count and a Mermaid flowchart diagram of every possible execution path.
  ```

  becomes:

  ```
  - Prints, for every exported workflow function in the file, its total path count and a numbered list of every possible execution path, in the same `Start -> ... -> End` style `pathkit coverage`/`pathkit report` already use. Pass `--mermaid` to print a Mermaid flowchart diagram instead.
  ```

- [ ] **Step 2: Regenerate the real example output and replace the worked-example block**

  Run: `node bin/pathkit analyze demo/report-polling-workflow.ts` (after Task 1's build) and confirm the output matches exactly:

  ```
  Workflow: reportPollingWorkflow
  Total paths: 4

    1. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --retry--> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --exit--> End
    2. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --false--> if (status === 'failed') --true--> End
    3. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --iterate--> if (status === 'complete') --true--> End
    4. Start -> for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) --exit--> End
  ```

  (Already verified against the real built CLI during planning — this step is a re-confirmation after Task 1's implementation, not a first discovery.)

  Replace `README.md:58-85` (the ` ```bash npx pathkit analyze demo/report-polling-workflow.ts ``` ` block through the closing "Paste the fenced..." paragraph) with:

  ````markdown
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
  ````

  (Keep the existing `More example workflows...` paragraph immediately after, unchanged.)

- [ ] **Step 3: Manually verify the README's example renders correctly**

  Run `node bin/pathkit analyze demo/report-polling-workflow.ts` and `node bin/pathkit analyze demo/report-polling-workflow.ts --mermaid`, diff each against the corresponding block just pasted into `README.md`, confirm byte-for-byte match (aside from the surrounding fenced-code-block wrapper).

- [ ] **Step 4: Run full verification**

  Run: `npm run lint && npm run typecheck && npm test && npm run smoke`
  Expected: all clean (no `src/` changes in this task, so this is confirming Task 1's change plus the README edit together leave the project green).

- [ ] **Step 5: Commit**

  ```bash
  git add README.md
  git commit -m "Update README analyze docs for the new default plain path list and --mermaid flag"
  ```

---

## Self-Review

**1. Spec coverage:**
- "Reuse `describePath`, no new path-formatting logic" → Task 1 Step 3, `describePath` imported and called directly, no new formatter written. ✅
- "Number each path (1, 2, 3, ...) and print total path count" → Task 1 Step 3, `${i + 1}. ${describePath(...)}` plus the existing `Total paths: N[+ (truncated...)]` line, kept verbatim from the current code. ✅
- "Move Mermaid behind `--mermaid`, keep it available" → Task 1 Step 3, `mermaid` boolean branch, `renderMermaid`/fenced-block logic moved unchanged into that branch. ✅
- "Update the `analyze` usage string" → Task 1 Step 3 (`src/cli.ts:47` and the `missing <file>` error message at `src/cli.ts:58`, both usage-string occurrences). ✅
- "Update README's analyze example (line ~26 and ~59)" → Task 2, all three spots (usage line, description bullet, worked example). ✅
- "Don't touch the parser or path-enumeration logic" → confirmed: no edits to `src/parser.ts`/`src/graph.ts`/`src/paths.ts` anywhere in this plan; `cli.ts` only swaps which already-exported `paths.ts` function it calls. ✅

**2. Placeholder scan:** No TBD/TODO markers; every step has literal code or literal doc text, not a description of intent.

**3. Type consistency:** `parseAnalyzeArgs` return type gains `mermaid: boolean`, destructured identically in `runAnalyze` (`const { filePath, outPath, mermaid } = parseAnalyzeArgs(args);`) — consistent across both edits in Task 1 Step 3.
