import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PathKitError } from './errors';

export const CONFIG_FILE_NAME = '.pathkitrc.json';

export interface PathKitConfig {
  workflowsDir?: string;
  traces?: string;
  out?: string;
  json?: boolean;
  noColor?: boolean;
  allowStale?: boolean;
  html?: boolean | string;
  include?: string[];
  exclude?: string[];
}

type KeyKind = 'string' | 'boolean' | 'boolean-or-string' | 'string-array';

const KEY_KINDS: Record<keyof PathKitConfig, KeyKind> = {
  workflowsDir: 'string',
  traces: 'string',
  out: 'string',
  json: 'boolean',
  noColor: 'boolean',
  allowStale: 'boolean',
  html: 'boolean-or-string',
  include: 'string-array',
  exclude: 'string-array',
};

const KIND_DESCRIPTIONS: Record<KeyKind, string> = {
  string: 'a string',
  boolean: 'a boolean',
  'boolean-or-string': 'a boolean or a string',
  'string-array': 'an array of strings',
};

function matchesKind(value: unknown, kind: KeyKind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'boolean-or-string':
      return typeof value === 'boolean' || typeof value === 'string';
    case 'string-array':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
  }
}

/**
 * Reads `.pathkitrc.json` from exactly `cwd` (never a parent directory).
 * An absent, empty, or whitespace-only file is an empty config. A broken file
 * or a wrong-typed known key throws `PathKitError` rather than silently
 * falling back to defaults; an unknown top-level key is reported through
 * `onWarning` (so a typo is visible) but does not fail the run.
 */
export function loadConfig(cwd: string, onWarning: (message: string) => void = () => {}): PathKitConfig {
  const filePath = join(cwd, CONFIG_FILE_NAME);
  if (!existsSync(filePath)) {
    return {};
  }

  const text = readFileSync(filePath, 'utf8');
  if (text.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PathKitError(`${CONFIG_FILE_NAME} is not valid JSON: ${detail}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PathKitError(`${CONFIG_FILE_NAME} must contain a JSON object at the top level.`);
  }

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(KEY_KINDS, key)) {
      onWarning(`unknown key "${key}" in ${CONFIG_FILE_NAME} (ignored)`);
      continue;
    }
    if (key === 'out' && value === null) {
      continue;
    }
    const kind = KEY_KINDS[key as keyof PathKitConfig];
    if (!matchesKind(value, kind)) {
      throw new PathKitError(`${CONFIG_FILE_NAME}: "${key}" must be ${KIND_DESCRIPTIONS[kind]}.`);
    }
    config[key] = value;
  }

  return config as PathKitConfig;
}
