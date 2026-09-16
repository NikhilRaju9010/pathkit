import { existsSync } from 'node:fs';
import { ArrowFunction, FunctionDeclaration, Node, Project, SourceFile } from 'ts-morph';
import { PathKitError } from './errors';

/**
 * A workflow entry point can be written either as `export async function x() {}`
 * or `export const x = async () => {}` — both are common in real Temporal code.
 */
export type WorkflowFunctionNode = FunctionDeclaration | ArrowFunction;

export interface ParsedWorkflowFunction {
  name: string;
  node: WorkflowFunctionNode;
}

export function parseWorkflowFile(filePath: string): ParsedWorkflowFunction[] {
  if (!existsSync(filePath)) {
    throw new PathKitError(`Workflow file not found: ${filePath}`);
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Deliberately syntactic-only: semantic diagnostics (e.g. an unresolved
  // `@temporalio/workflow` import when analyzing a file in isolation) are not
  // syntax errors and must not be treated as one.
  const syntaxErrors = project.getProgram().getSyntacticDiagnostics(sourceFile);
  if (syntaxErrors.length > 0) {
    const details = syntaxErrors.map((diagnostic) => diagnosticMessageToString(diagnostic.getMessageText())).join('; ');
    throw new PathKitError(`Workflow file has invalid TypeScript syntax: ${filePath} (${details})`);
  }

  return collectExportedFunctions(sourceFile);
}

function diagnosticMessageToString(message: string | { getMessageText(): string }): string {
  return typeof message === 'string' ? message : message.getMessageText();
}

function collectExportedFunctions(sourceFile: SourceFile): ParsedWorkflowFunction[] {
  const results: ParsedWorkflowFunction[] = [];

  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName();
    if (name !== undefined) {
      results.push({ name, node: fn });
    }
  }

  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined && Node.isArrowFunction(initializer)) {
        results.push({ name: declaration.getName(), node: initializer });
      }
    }
  }

  return results.sort((a, b) => a.node.getStart() - b.node.getStart());
}
