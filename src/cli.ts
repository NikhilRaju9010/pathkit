import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorkflowGraph } from './graph';
import { PathKitError } from './errors';
import { renderMermaid } from './mermaid';
import { ParsedWorkflowFunction, parseWorkflowFile } from './parser';
import { DEFAULT_MAX_PATHS, enumeratePaths } from './paths';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/**
 * Runs the CLI given argv (already stripped of `node`/script name) and I/O
 * sinks, returning the process exit code. Kept as a plain function (not
 * wired directly to `process`) so it can be exercised directly in tests as
 * well as from `bin/pathkit`.
 */
export function runCli(argv: string[], io: CliIO): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    io.stdout(`${getPackageVersion()}\n`);
    return 0;
  }

  const [command, ...rest] = argv;

  if (command === 'analyze') {
    return runAnalyze(rest, io);
  }

  io.stderr('pathkit: unknown or missing command. Supported: --version, analyze <file> [--out <path>]\n');
  return 1;
}

function runAnalyze(args: string[], io: CliIO): number {
  const { filePath, outPath } = parseAnalyzeArgs(args);

  if (filePath === undefined) {
    io.stderr('pathkit analyze: missing <file> argument. Usage: pathkit analyze <file> [--out <path>]\n');
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
      const pathResult = enumeratePaths(graph);
      const mermaidText = renderMermaid(graph);
      const totalPathsLine = pathResult.truncated
        ? `Total paths: ${pathResult.paths.length}+ (truncated at maxPaths=${DEFAULT_MAX_PATHS})`
        : `Total paths: ${pathResult.paths.length}`;

      return `Workflow: ${fn.name}\n${totalPathsLine}\n\n\`\`\`mermaid\n${mermaidText}\n\`\`\`\n`;
    })
    .join('\n');

  io.stdout(report);

  if (outPath !== undefined) {
    writeFileSync(outPath, report, 'utf8');
  }

  return 0;
}

function parseAnalyzeArgs(args: string[]): { filePath: string | undefined; outPath: string | undefined } {
  let outPath: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      outPath = args[i + 1];
      i++;
    } else {
      const value = args[i];
      if (value !== undefined) positional.push(value);
    }
  }

  return { filePath: positional[0], outPath };
}

function getPackageVersion(): string {
  // dist/cli.js sits one level below the package root, same depth as bin/pathkit.
  const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}
