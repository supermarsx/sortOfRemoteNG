import type { BrowserScript } from "../../types/recording/webAutomation";

const MAX_BYTES = 64 * 1024;
const bounded = (value: string) =>
  new TextEncoder().encode(value).length <= MAX_BYTES;

/** Local, lazy syntax transpilation only. This is not a semantic type/security check. */
export async function prepareWebsiteScript(
  script: Pick<BrowserScript, "code" | "language">,
): Promise<string> {
  if (!bounded(script.code))
    throw new Error("Website scripts are limited to 64 KiB.");
  if (script.language === undefined || script.language === "javascript")
    return script.code;
  if (script.language !== "typescript")
    throw new Error("Unsupported website script language.");

  // Never import the compiler from app startup or the JavaScript execution path.
  const ts = await import("typescript");
  const source = ts.createSourceFile(
    "website-script.ts",
    script.code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  let unsupported = false;
  const visit = (node: import("typescript").Node, inFunction = false) => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isImportTypeNode(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node) ||
      node.kind === ts.SyntaxKind.ExportKeyword ||
      ts.isModuleDeclaration(node) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))) ||
      (ts.isIdentifier(node) && ["exports", "module"].includes(node.text)) ||
      (!inFunction &&
        (ts.isAwaitExpression(node) ||
          (ts.isForOfStatement(node) && node.awaitModifier)))
    )
      unsupported = true;
    const nested = inFunction || ts.isFunctionLike(node);
    ts.forEachChild(node, (child) => visit(child, nested));
  };
  visit(source);
  if (
    unsupported ||
    source.referencedFiles.length ||
    source.typeReferenceDirectives.length ||
    source.libReferenceDirectives.length
  )
    throw new Error(
      "Website TypeScript must be standalone: modules, imports/exports, references, namespaces, CommonJS and top-level await are unsupported.",
    );
  const result = ts.transpileModule(script.code, {
    fileName: "website-script.ts",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      noEmitOnError: true,
      sourceMap: false,
      inlineSourceMap: false,
      removeComments: true,
    },
  });
  const failure = result.diagnostics?.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (failure) {
    const position = source.getLineAndCharacterOfPosition(failure.start ?? 0);
    // Do not interpolate source or compiler messages which may quote secret text.
    throw new Error(
      `TypeScript syntax error TS${failure.code} at line ${position.line + 1}, column ${position.character + 1}. Nothing was run.`,
    );
  }
  if (!bounded(result.outputText))
    throw new Error(
      "Compiled website JavaScript exceeds 64 KiB. Nothing was run.",
    );
  return result.outputText;
}
