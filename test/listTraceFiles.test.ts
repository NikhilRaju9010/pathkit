import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PathKitError } from '../src/errors';
import { listTraceFiles } from '../src/coverageReport';

describe('listTraceFiles', () => {
  let tracesDir: string;

  beforeEach(() => {
    tracesDir = mkdtempSync(path.join(tmpdir(), 'pathkit-h1-'));
  });

  afterEach(() => {
    rmSync(tracesDir, { recursive: true, force: true });
  });

  it('lists every *.json file in the directory as a full path', () => {
    writeFileSync(path.join(tracesDir, 'a.json'), '{}');
    writeFileSync(path.join(tracesDir, 'b.json'), '{}');
    writeFileSync(path.join(tracesDir, 'notes.txt'), 'ignore me');

    const result = listTraceFiles(tracesDir).sort();

    expect(result).toEqual([path.join(tracesDir, 'a.json'), path.join(tracesDir, 'b.json')].sort());
  });

  it('returns an empty array for a directory with no trace files', () => {
    expect(listTraceFiles(tracesDir)).toEqual([]);
  });

  it('throws a clear PathKitError when the directory cannot be read', () => {
    const missingDir = path.join(tracesDir, 'does-not-exist');
    expect(() => listTraceFiles(missingDir)).toThrow(PathKitError);
    expect(() => listTraceFiles(missingDir)).toThrow(/could not read traces directory/i);
  });
});
