#!/usr/bin/env node
'use strict';

// Simulates a real downstream `npm install @nikhilrajutirlange/pathkit` and
// runs the installed CLI, so a bug like "a runtime dependency (ts-morph) was
// only listed under devDependencies" or "package.json's bin field points
// somewhere that doesn't exist in the published tarball" gets caught
// automatically, in CI, on every push — not by someone manually running
// commands against the source checkout, where devDependencies are already
// present in node_modules and would hide the bug.
//
// This intentionally does a real `npm install` from the packed tarball into
// a separate throwaway "consumer" project, which is the only way to
// accurately reproduce what a real downstream user gets: only this
// package's "dependencies" are installed, never its "devDependencies".

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

class SmokeTestFailure extends Error {}

function run(command, args, options) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

/** Runs the installed CLI binary, turning a crash into a clean SmokeTestFailure instead of a raw stack trace. */
function runInstalledCli(binPath, args) {
  try {
    return execFileSync(binPath, args, { encoding: 'utf8' });
  } catch (err) {
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : String(err.stderr ?? err.message);
    throw new SmokeTestFailure(`\`pathkit ${args.join(' ')}\` failed when run from the installed package:\n${stderr}`);
  }
}

/**
 * G10's real proof of Decision 1 (`@temporalio/client`/`@temporalio/worker`
 * stay in pathkit's own `devDependencies`, never `dependencies`): installs
 * those four `@temporalio/*` packages into the *same* throwaway consumer
 * project that only received pathkit's real `dependencies` above, then runs
 * a real end-to-end script that imports ONLY `prepareCoverageRun`/
 * `recordCoverageTrace` from the installed pathkit package and does its own
 * `Worker`/`TestWorkflowEnvironment`/`Client` orchestration using those
 * separately-installed packages — exactly the shape a real downstream
 * user's own test file would have. Also simulates a leftover instrumented
 * file from a "prior crashed run" to prove `prepareCoverageRun`'s
 * best-effort cleanup pass actually removes it.
 *
 * This is a plain Node script, not a real Jest suite — Jest/ts-jest/
 * typescript would need installing into the consumer project too, for no
 * real benefit over plain assertions that throw on failure (matching this
 * smoke-test script's own existing style throughout).
 */
function runCoverageHelperSmokeTest(consumerDir) {
  // The direct proof of Decision 1, in the right order to actually prove it:
  // require the installed package's main entry point (which pulls in
  // instrument.ts and coverageReport.ts) BEFORE any @temporalio/* package
  // is installed in this consumer project. If pathkit's own runtime code
  // ever accidentally needed one of them (the exact "ts-morph was wrongly a
  // devDependency" bug class), this would fail right here with a clear
  // "Cannot find module" error — installing @temporalio/* first, as the
  // later live end-to-end check needs to, would silently hide that bug.
  console.log("Requiring the installed package's main entry point (no @temporalio/* packages installed yet)...");
  let requireCheckOutput;
  try {
    requireCheckOutput = run(
      process.execPath,
      [
        '-e',
        "const m = require('@nikhilrajutirlange/pathkit'); " +
          "if (typeof m.prepareCoverageRun !== 'function' || typeof m.recordCoverageTrace !== 'function') " +
          "{ throw new Error('prepareCoverageRun/recordCoverageTrace are not exported as functions: ' + JSON.stringify(Object.keys(m))); } " +
          "console.log('OK');",
      ],
      { cwd: consumerDir },
    );
  } catch (err) {
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : String(err.stderr ?? err.message);
    throw new SmokeTestFailure(
      `Requiring the installed package failed before any @temporalio/* package was installed — this likely means ` +
        `pathkit's own runtime code now needs one of them at import time, which must stay a devDependency, not a ` +
        `dependency (see CLAUDE.md's Decision 1):\n${stderr}`,
    );
  }
  if (!requireCheckOutput.includes('OK')) {
    throw new SmokeTestFailure(`Requiring the installed package produced unexpected output:\n${requireCheckOutput}`);
  }
  console.log('  OK');

  console.log("Installing @temporalio/client, worker, testing, and workflow (this consumer project's own devDependencies)...");
  run(
    'npm',
    ['install', '@temporalio/client@^1.24.0', '@temporalio/worker@^1.24.0', '@temporalio/testing@^1.24.0', '@temporalio/workflow@^1.24.0'],
    { cwd: consumerDir, stdio: 'inherit' },
  );

  const workflowFilePath = path.join(consumerDir, 'sample-coverage-workflow.ts');
  fs.writeFileSync(
    workflowFilePath,
    "export async function sampleCoverageWorkflow(isHeads: boolean): Promise<string> {\n" +
      '  if (isHeads) {\n' +
      "    return 'yes';\n" +
      '  } else {\n' +
      "    return 'no';\n" +
      '  }\n' +
      '}\n',
  );

  const checkerScriptPath = path.join(consumerDir, 'coverage-helper-check.js');
  fs.writeFileSync(checkerScriptPath, buildCoverageHelperCheckerScript());

  console.log('Running the prepareCoverageRun/recordCoverageTrace end-to-end check from the installed package...');
  try {
    const output = execFileSync(process.execPath, [checkerScriptPath], { encoding: 'utf8', cwd: consumerDir });
    process.stdout.write(output);
  } catch (err) {
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : String(err.stderr ?? err.message);
    throw new SmokeTestFailure(`prepareCoverageRun/recordCoverageTrace end-to-end check failed:\n${stderr}`);
  }
  console.log('  OK');
}

/** Generates the plain-Node checker script run inside the consumer project (see `runCoverageHelperSmokeTest`). */
function buildCoverageHelperCheckerScript() {
  return `
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareCoverageRun, recordCoverageTrace } = require('@nikhilrajutirlange/pathkit');
const { TestWorkflowEnvironment } = require('@temporalio/testing');
const { Worker } = require('@temporalio/worker');

(async () => {
  const workflowFilePath = path.join(__dirname, 'sample-coverage-workflow.ts');

  // Simulate a leftover instrumented file from a prior crashed run that
  // never reached its own cleanup() — prepareCoverageRun's best-effort
  // cleanup pass must remove this before writing its own fresh copy.
  const staleFilePath = path.join(
    __dirname,
    'sample-coverage-workflow.sampleCoverageWorkflow.deadbeef-0000-0000-0000-000000000000.pathkit-instrumented.ts',
  );
  fs.writeFileSync(staleFilePath, '// stale leftover from a prior crashed run\\n');

  const { instrumentedFilePath, cleanup } = prepareCoverageRun(workflowFilePath, 'sampleCoverageWorkflow');

  if (fs.existsSync(staleFilePath)) {
    throw new Error('prepareCoverageRun did not remove the stale leftover instrumented file');
  }

  const testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  let trace;
  try {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'smoke-test-tq',
      workflowsPath: instrumentedFilePath,
    });

    const handle = await testEnv.client.workflow.start('sampleCoverageWorkflow', {
      workflowId: 'smoke-test-wf-' + crypto.randomUUID(),
      taskQueue: 'smoke-test-tq',
      args: [true],
    });

    // The query must be issued while the Worker is still polling (see
    // README.md) — issuing it after runUntil() resolves hangs forever.
    trace = await worker.runUntil(async () => {
      await handle.result();
      return handle.query('__pathkit_coverage__sampleCoverageWorkflow');
    });
  } finally {
    await testEnv.teardown();
  }

  if (!Array.isArray(trace) || trace.length !== 1) {
    throw new Error('Unexpected coverage trace: ' + JSON.stringify(trace));
  }

  const traceDir = path.join(__dirname, '.pathkit-smoke-traces');
  const traceFilePath = recordCoverageTrace(traceDir, workflowFilePath, 'sampleCoverageWorkflow', trace);
  if (!fs.existsSync(traceFilePath)) {
    throw new Error('recordCoverageTrace did not write a trace file');
  }
  const written = JSON.parse(fs.readFileSync(traceFilePath, 'utf8'));
  if (written.functionName !== 'sampleCoverageWorkflow' || written.rawTrace.length !== 1) {
    throw new Error('Unexpected trace file contents: ' + JSON.stringify(written));
  }

  cleanup();
  if (fs.existsSync(instrumentedFilePath)) {
    throw new Error('cleanup() did not remove the instrumented file');
  }

  console.log('prepareCoverageRun/recordCoverageTrace end-to-end check passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
}

function main() {
  console.log('Building...');
  run('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'inherit' });

  console.log('Packing...');
  const packOutputRaw = run('npm', ['pack', '--json'], { cwd: projectRoot });
  const [packInfo] = JSON.parse(packOutputRaw);
  const tarballPath = path.join(projectRoot, packInfo.filename);

  const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathkit-smoke-consumer-'));

  try {
    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'pathkit-smoke-consumer', version: '0.0.0', private: true }, null, 2),
    );

    console.log(`Installing packed tarball into a clean consumer project (${consumerDir})...`);
    run('npm', ['install', tarballPath], { cwd: consumerDir, stdio: 'inherit' });

    const binPath = path.join(consumerDir, 'node_modules', '.bin', 'pathkit');
    if (!fs.existsSync(binPath)) {
      throw new SmokeTestFailure(`expected an installed CLI binary at ${binPath}, but it does not exist.`);
    }

    console.log('Running `pathkit --version` from the installed package...');
    const versionOutput = runInstalledCli(binPath, ['--version']).trim();
    if (!/^\d+\.\d+\.\d+$/.test(versionOutput)) {
      throw new SmokeTestFailure(`\`pathkit --version\` printed "${versionOutput}", which doesn't look like a version.`);
    }
    console.log(`  OK (${versionOutput})`);

    const sampleWorkflowPath = path.join(consumerDir, 'sample-workflow.ts');
    fs.writeFileSync(
      sampleWorkflowPath,
      "export async function sampleWorkflow(flag: boolean): Promise<string> {\n  if (flag) {\n    return 'yes';\n  }\n  return 'no';\n}\n",
    );

    console.log('Running `pathkit analyze` on a sample workflow from the installed package...');
    const analyzeOutput = runInstalledCli(binPath, ['analyze', sampleWorkflowPath]);
    if (!analyzeOutput.includes('1. Start')) {
      throw new SmokeTestFailure('`pathkit analyze` did not print the default plain-text path list as expected.');
    }
    console.log('  OK');

    console.log('Running `pathkit analyze --mermaid` on a sample workflow from the installed package...');
    const analyzeMermaidOutput = runInstalledCli(binPath, ['analyze', sampleWorkflowPath, '--mermaid']);
    if (!analyzeMermaidOutput.includes('flowchart TD')) {
      throw new SmokeTestFailure('`pathkit analyze --mermaid` did not print Mermaid output as expected.');
    }
    console.log('  OK');

    runCoverageHelperSmokeTest(consumerDir);

    console.log('\nSMOKE TEST PASSED — the published package layout works end to end.');
  } finally {
    fs.rmSync(consumerDir, { recursive: true, force: true });
    fs.rmSync(tarballPath, { force: true });
  }
}

try {
  main();
} catch (err) {
  if (err instanceof SmokeTestFailure) {
    console.error(`\nSMOKE TEST FAILED: ${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
