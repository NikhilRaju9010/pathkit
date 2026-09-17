/**
 * G6's `__pathkitRace` helper is emitted as generated text inside an
 * instrumented file, not exported from `src/`. To unit-test its logic in
 * isolation (fast, no live Temporal run needed), this extracts the exact
 * source string PathKit generates and instantiates it directly.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { removeInstrumentedCopy, writeInstrumentedCopy } from '../src/instrument';

function loadPathkitRaceHelper(): (promises: Promise<unknown>[], labels: string[]) => Promise<string> {
  const filePath = path.join(__dirname, 'fixtures', 'm4', 'timeout-race.ts');
  const instrumentedPath = writeInstrumentedCopy(filePath, 'raceTimeoutWorkflow');
  try {
    const text = readFileSync(instrumentedPath, 'utf8');
    const match = /function __pathkitRace\(promises, labels\) \{[\s\S]*?\n\}/.exec(text);
    if (match === null) {
      throw new Error('Could not find the generated __pathkitRace helper in the instrumented file.');
    }
    return new Function(`${match[0]}; return __pathkitRace;`)() as (
      promises: Promise<unknown>[],
      labels: string[],
    ) => Promise<string>;
  } finally {
    removeInstrumentedCopy(instrumentedPath);
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('__pathkitRace — G6 (Gap 2): purely observational race wrapper', () => {
  it('resolves with the label of whichever promise settles first, matching a plain Promise.race', async () => {
    const pathkitRace = loadPathkitRaceHelper();
    const a = deferred<string>();
    const b = deferred<string>();

    const wrapped = pathkitRace([a.promise, b.promise], ['A', 'B']);
    const plain = Promise.race([a.promise, b.promise]);

    a.resolve('a-won');
    // b is never resolved in this test — a always wins.

    await expect(wrapped).resolves.toBe('A');
    await expect(plain).resolves.toBe('a-won');
  });

  it('tracks which side wins even when it is the second array element', async () => {
    const pathkitRace = loadPathkitRaceHelper();
    const a = deferred<string>();
    const b = deferred<string>();

    const wrapped = pathkitRace([a.promise, b.promise], ['A', 'B']);
    b.resolve('b-won');

    await expect(wrapped).resolves.toBe('B');
  });

  it('does not change which promise wins a real timing-based race (setTimeout vs immediate)', async () => {
    const pathkitRace = loadPathkitRaceHelper();
    const fast = Promise.resolve('fast');
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('slow'), 50));

    const wrappedWinner = await pathkitRace([fast, slow], ['fast-label', 'slow-label']);
    const plainWinner = await Promise.race([fast, slow]);

    expect(wrappedWinner).toBe('fast-label');
    expect(plainWinner).toBe('fast');
  });
});
