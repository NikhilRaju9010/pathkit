import { SourceFile } from 'ts-morph';

/**
 * Returns the local name each of `exportedNames` is bound to in this file,
 * for named imports from `moduleSpecifier` (accounting for `as` aliasing).
 * Only direct named imports are considered — no re-exports, no cross-file
 * resolution — consistent with PathKit's same-file syntactic heuristic.
 */
export function collectLocalImportNames(
  sourceFile: SourceFile,
  moduleSpecifier: string,
  exportedNames: ReadonlySet<string>,
): Set<string> {
  const localNames = new Set<string>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    if (importDecl.getModuleSpecifierValue() !== moduleSpecifier) continue;

    for (const namedImport of importDecl.getNamedImports()) {
      const importedName = namedImport.getName();
      if (exportedNames.has(importedName)) {
        localNames.add(namedImport.getAliasNode()?.getText() ?? importedName);
      }
    }
  }

  return localNames;
}
