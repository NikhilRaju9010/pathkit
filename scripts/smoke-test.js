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
    if (!analyzeOutput.includes('flowchart TD')) {
      throw new SmokeTestFailure('`pathkit analyze` did not print Mermaid output as expected.');
    }
    console.log('  OK');

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
