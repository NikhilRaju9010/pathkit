import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { parseWorkflowFile } from './parser';
import { PathKitError } from './errors';

export interface DiscoveredWorkflow {
  filePath: string;
  functionName: string;
}

export interface DiscoverySkipWarning {
  filePath: string;
  error: string;
}

export interface DiscoveryResult {
  workflows: DiscoveredWorkflow[];
  warnings: DiscoverySkipWarning[];
}

const TEST_FILE_PATTERN = /\.(test|spec)\.ts$/;
const SKIP_DIR_NAMES = new Set(['node_modules', '__tests__', 'test', 'dist', 'build', 'coverage', '.git']);

export function discoverWorkflows(dir: string): DiscoveryResult {
  if (!existsSync(dir)) {
    throw new PathKitError(`Directory not found: ${dir}`);
  }
  if (!statSync(dir).isDirectory()) {
    throw new PathKitError(`Not a directory: ${dir}`);
  }

  const workflows: DiscoveredWorkflow[] = [];
  const warnings: DiscoverySkipWarning[] = [];

  for (const absoluteFilePath of walk(dir)) {
    let functions;
    try {
      functions = parseWorkflowFile(absoluteFilePath);
    } catch (error) {
      const message = error instanceof PathKitError ? error.message : String(error);
      warnings.push({ filePath: path.relative(process.cwd(), absoluteFilePath), error: message });
      continue;
    }

    for (const fn of functions) {
      workflows.push({
        filePath: path.relative(process.cwd(), absoluteFilePath),
        functionName: fn.name,
      });
    }
  }

  workflows.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.functionName.localeCompare(b.functionName));
  warnings.sort((a, b) => a.filePath.localeCompare(b.filePath));

  return { workflows, warnings };
}

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    if (entry.name.endsWith('.pathkit-instrumented.ts')) continue;
    if (TEST_FILE_PATTERN.test(entry.name)) continue;

    yield path.join(dir, entry.name);
  }
}
