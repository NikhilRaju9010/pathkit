import { CallExpression, Node, SourceFile } from 'ts-morph';

export interface ActivityBindings {
  /** Local names bound directly to activity functions via destructuring, e.g. `const { foo } = proxyActivities(...)`. */
  destructuredNames: Set<string>;
  /** Local names bound to a whole proxy object, e.g. `const acts = proxyActivities(...)`, called as `acts.foo()`. */
  proxyObjectNames: Set<string>;
}

const PROXY_ACTIVITY_FUNCTION_NAMES = new Set(['proxyActivities', 'proxyLocalActivities']);

/**
 * Finds the local names bound to `proxyActivities()` / `proxyLocalActivities()`
 * results anywhere in a file (not just top-level — real code sometimes binds a
 * proxy inside a function body, e.g. inside a retry loop). This is PathKit's
 * same-file syntactic heuristic (see LIMITATIONS.md): only a call to a name
 * imported from '@temporalio/workflow' in the same file is recognized, and
 * only local destructuring/assignment is traced — no cross-file type
 * resolution and no attempt to resolve what `A` in `proxyActivities<A>()`
 * actually is.
 */
export function collectActivityBindings(sourceFile: SourceFile): ActivityBindings {
  const localProxyFactoryNames = collectLocalProxyFactoryNames(sourceFile);

  const destructuredNames = new Set<string>();
  const proxyObjectNames = new Set<string>();

  if (localProxyFactoryNames.size === 0) {
    return { destructuredNames, proxyObjectNames };
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return;

    const initializer = node.getInitializer();
    if (initializer === undefined || !Node.isCallExpression(initializer)) return;

    const callee = initializer.getExpression();
    if (!Node.isIdentifier(callee) || !localProxyFactoryNames.has(callee.getText())) return;

    const nameNode = node.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        destructuredNames.add(element.getName());
      }
    } else if (Node.isIdentifier(nameNode)) {
      proxyObjectNames.add(nameNode.getText());
    }
  });

  return { destructuredNames, proxyObjectNames };
}

function collectLocalProxyFactoryNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    if (importDecl.getModuleSpecifierValue() !== '@temporalio/workflow') continue;

    for (const namedImport of importDecl.getNamedImports()) {
      const importedName = namedImport.getName();
      if (PROXY_ACTIVITY_FUNCTION_NAMES.has(importedName)) {
        const localName = namedImport.getAliasNode()?.getText() ?? importedName;
        names.add(localName);
      }
    }
  }

  return names;
}

export function isActivityCall(call: CallExpression, bindings: ActivityBindings): boolean {
  const callee = call.getExpression();

  if (Node.isIdentifier(callee)) {
    return bindings.destructuredNames.has(callee.getText());
  }

  if (Node.isPropertyAccessExpression(callee)) {
    const target = callee.getExpression();
    if (!Node.isIdentifier(target)) return false;

    // `acts.foo()` — a call through a whole proxy object.
    if (bindings.proxyObjectNames.has(target.getText())) return true;

    // `foo.executeWithOptions(options, args)` — the SDK's documented way to
    // override options for one call to a destructured activity function.
    if (bindings.destructuredNames.has(target.getText()) && callee.getName() === 'executeWithOptions') {
      return true;
    }

    return false;
  }

  return false;
}
