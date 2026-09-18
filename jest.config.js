/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // test/fixtures/ can legitimately contain files named *.test.ts (e.g. h0's
  // discovery fixtures, which prove pathkit report's own test-file-skip
  // logic) — these are fixture data, never real Jest suites, and must not be
  // picked up by testMatch just because their name happens to match it.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/fixtures/'],
};
