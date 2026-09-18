/**
 * PathKit's public library surface. Deliberately minimal and free of any
 * `@temporalio/*` import: it only ever writes an instrumented copy of a
 * workflow file (`prepareCoverageRun`) and reads/writes trace JSON files
 * (`recordCoverageTrace`) — the actual `Worker`/`TestWorkflowEnvironment`
 * orchestration is entirely up to your own test, using packages your own
 * project already depends on. See README.md's "Coverage tracking" section
 * for a full worked example.
 */
export { prepareCoverageRun, PrepareCoverageRunResult } from './instrument';
export { recordCoverageTrace } from './coverageReport';
