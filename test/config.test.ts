import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILE_NAME, loadConfig } from '../src/config';
import { PathKitError } from '../src/errors';

describe('loadConfig', () => {
  let dir: string;
  let warnings: string[];
  const warn = (msg: string): void => {
    warnings.push(msg);
  };
  const writeConfig = (text: string): void => writeFileSync(join(dir, CONFIG_FILE_NAME), text, 'utf8');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pathkit-config-'));
    warnings = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns an empty config, with no warnings, when the file is absent', () => {
    expect(loadConfig(dir, warn)).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('treats an empty or whitespace-only file as an empty config', () => {
    writeConfig('');
    expect(loadConfig(dir, warn)).toEqual({});
    writeConfig('  \n\t\n');
    expect(loadConfig(dir, warn)).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('parses the full schema', () => {
    const full = {
      workflowsDir: 'src/workflows',
      traces: '.pathkit/coverage',
      out: 'report.txt',
      json: true,
      noColor: true,
      allowStale: true,
      html: 'out/report.html',
      include: ['a.ts', 'b.ts'],
      exclude: ['c.ts'],
    };
    writeConfig(JSON.stringify(full));
    expect(loadConfig(dir, warn)).toEqual(full);
    expect(warnings).toEqual([]);
  });

  it('accepts a partial config', () => {
    writeConfig('{"traces": "t"}');
    expect(loadConfig(dir, warn)).toEqual({ traces: 't' });
  });

  it('treats out: null as unset', () => {
    writeConfig('{"out": null, "traces": "t"}');
    expect(loadConfig(dir, warn)).toEqual({ traces: 't' });
  });

  it('accepts html as a boolean or a string', () => {
    writeConfig('{"html": true}');
    expect(loadConfig(dir, warn)).toEqual({ html: true });
    writeConfig('{"html": false}');
    expect(loadConfig(dir, warn)).toEqual({ html: false });
    writeConfig('{"html": "x.html"}');
    expect(loadConfig(dir, warn)).toEqual({ html: 'x.html' });
  });

  it('throws a PathKitError naming the file for malformed JSON', () => {
    writeConfig('{ "traces": ');
    expect(() => loadConfig(dir, warn)).toThrow(PathKitError);
    expect(() => loadConfig(dir, warn)).toThrow(/\.pathkitrc\.json/);
    expect(() => loadConfig(dir, warn)).toThrow(/not valid JSON/);
  });

  it.each(['[]', '"str"', 'null', '42'])('throws a PathKitError when the top level is not an object (%s)', (text) => {
    writeConfig(text);
    expect(() => loadConfig(dir, warn)).toThrow(PathKitError);
    expect(() => loadConfig(dir, warn)).toThrow(/JSON object/);
  });

  it('warns about an unknown key by name but still returns the known keys', () => {
    writeConfig('{"tracse": "typo", "traces": "t"}');
    expect(loadConfig(dir, warn)).toEqual({ traces: 't' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"tracse"');
    expect(warnings[0]).toContain('.pathkitrc.json');
  });

  it('warns once per unknown key', () => {
    writeConfig('{"a": 1, "b": 2}');
    loadConfig(dir, warn);
    expect(warnings).toHaveLength(2);
  });

  it.each([
    ['traces', '{"traces": 5}', /"traces".*string/],
    ['workflowsDir', '{"workflowsDir": true}', /"workflowsDir".*string/],
    ['out', '{"out": 1}', /"out".*string/],
    ['json', '{"json": "yes"}', /"json".*boolean/],
    ['noColor', '{"noColor": 1}', /"noColor".*boolean/],
    ['allowStale', '{"allowStale": "x"}', /"allowStale".*boolean/],
    ['html', '{"html": 3}', /"html".*boolean or a string/],
    ['include', '{"include": "a.ts"}', /"include".*array of strings/],
    ['include entries', '{"include": ["a.ts", 2]}', /"include".*array of strings/],
    ['exclude', '{"exclude": {}}', /"exclude".*array of strings/],
  ])('throws a PathKitError for a wrong-typed %s', (_name, text, pattern) => {
    writeConfig(text);
    expect(() => loadConfig(dir, warn)).toThrow(PathKitError);
    expect(() => loadConfig(dir, warn)).toThrow(pattern);
  });
});
