import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  extractNativeCommandNames,
  reachableNativeHandlers,
} from "./nativeCommandInventory";

/**
 * Guards that every Tauri command the frontend invokes is registered by one of
 * the aggregate Rust handler lists.
 *
 * ## Why this is more than a string-literal grep
 *
 * The first version of this suite only recognised `invoke("literal")`, so two
 * unregistered commands shipped to HEAD behind indirection:
 *   - `proxmox_console_open` / `_send` / `_resize` / `_close` / `_list`, invoked
 *     through `export const PROXMOX_CONSOLE_*_COMMAND` constants.
 *   - `draytek_run_cli`, invoked from a hook and registered nowhere.
 * Both were caught by hand. This scanner therefore resolves indirect call sites.
 *
 * ## What it resolves
 *
 * Call sites — the callee is treated as Tauri's `invoke` when it is:
 *   - the bare identifier `invoke`;
 *   - an identifier bound by `import { invoke as x } from "@tauri-apps/api/core"`;
 *   - `ns.invoke(...)` where `ns` came from `import * as ns from "…/core"` or
 *     `const ns = await import("…/core")`;
 *   - an identifier destructured from `const { invoke } = await import("…/core")`.
 *
 * Command names — the first argument is resolved when it is:
 *   - a string literal (single/double quoted or an untagged template with no
 *     substitutions);
 *   - an identifier bound to a string-literal constant in the same file;
 *   - an identifier imported from another first-party module (relative paths and
 *     the `@/*` alias), including through `export { X } from …` and `export *`
 *     re-export barrels;
 *   - `OBJECT.key` where `OBJECT` is a string-valued object-literal constant,
 *     locally or imported the same way;
 *   - either arm of a `cond ? … : …` (both arms are reachable, so both are
 *     checked), recursively.
 * `as const`, `satisfies`, parentheses and `!` wrappers are unwrapped first.
 *
 * ## Explicit remaining boundaries
 *
 *   - Local/named imported forwarding wrappers are followed at finite callers.
 *     Their open string-parameter declarations remain in the reviewed inventory;
 *     this is not proof that an arbitrary future caller supplies a valid command.
 *   - Finite literal unions, templates, concatenation, conditional local constants
 *     and object lookups are evaluated without executing application code.
 *   - Constants re-exported through `export { default }` or namespace re-exports
 *     (`import * as m` then `m.CONST`).
 *   - Arbitrary object-method dispatch and injectable runtime callbacks retain
 *     explicit review rows; the scanner does not guess an object's identity.
 *   - `invoke` reached through an object that is not a plain identifier, e.g.
 *     `(window as any).__TAURI_INTERNALS__?.invoke(...)` in `ErrorBoundary`,
 *     which calls Tauri built-in plugin commands that no handler list owns.
 *
 * Unresolvable declarations are snapshot-guarded below, not silently ignored.
 * Registration is a source-level union, not proof of argument shape, live UI
 * reachability or state availability under every Cargo feature combination.
 */

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_ROOTS = ["src", "app"];
const FIXTURE_ROOT = "tests/ipc/fixtures/invokeRegistration";
const IGNORED_DIRECTORIES = new Set([
  ".next",
  "dist",
  "node_modules",
  "target",
]);
const MODULE_EXTENSIONS = [".ts", ".tsx"];
const TAURI_CORE_MODULES = new Set([
  "@tauri-apps/api",
  "@tauri-apps/api/core",
  "@tauri-apps/api/tauri",
]);

interface InvokeCall {
  /** Resolved Rust command name. */
  name: string;
  /** Repo-relative path of the call site. */
  file: string;
  line: number;
  /** How the name was recovered: `literal`, or `constant <expression>`. */
  via: string;
}

interface UnresolvedInvoke {
  /** Source text of the unresolved first argument. */
  expression: string;
  file: string;
  line: number;
}

interface ImportBinding {
  specifier: string;
  /** Name as exported by the target module. */
  imported: string;
}

interface ModuleFacts {
  /** Module-level `const NAME = "…"` and `NAME.key` from object literals. */
  constants: Map<string, string>;
  /** Same, but bound inside a nested scope — never visible to importers. */
  localConstants: Map<string, string>;
  /** Local name -> where it came from (imports and re-exports alike). */
  imports: Map<string, ImportBinding>;
  /** Specifiers of `export * from "…"` barrels. */
  starExports: string[];
  /** Identifiers that refer to Tauri's `invoke` in this file. */
  invokeNames: Set<string>;
  /** Identifiers that hold the Tauri core module namespace. */
  invokeNamespaces: Set<string>;
}

const sourceTextCache = new Map<string, string | null>();
const sourceFileCache = new Map<string, ts.SourceFile | null>();
const moduleFactsCache = new Map<string, ModuleFacts>();

function readSource(file: string): string | null {
  const cached = sourceTextCache.get(file);
  if (cached !== undefined) return cached;

  let text: string | null = null;
  try {
    if (fs.statSync(file).isFile()) text = fs.readFileSync(file, "utf8");
  } catch {
    text = null;
  }
  sourceTextCache.set(file, text);
  return text;
}

function parseFile(file: string): ts.SourceFile | null {
  const cached = sourceFileCache.get(file);
  if (cached !== undefined) return cached;

  const text = readSource(file);
  const sourceFile =
    text === null
      ? null
      : ts.createSourceFile(
          file,
          text,
          ts.ScriptTarget.Latest,
          true,
          file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
  sourceFileCache.set(file, sourceFile);
  return sourceFile;
}

function walkFiles(
  root: string,
  predicate: (file: string) => boolean,
): string[] {
  const start = path.join(PROJECT_ROOT, root);
  if (!fs.existsSync(start)) return [];

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }

      const file = path.join(dir, entry.name);
      if (predicate(file)) files.push(file);
    }
  };

  walk(start);
  return files;
}

function isFrontendSource(file: string): boolean {
  return (
    /\.(ts|tsx)$/.test(file) &&
    !/\.test\.(ts|tsx)$/.test(file) &&
    !file.endsWith(".d.ts")
  );
}

/** Strip `(x)`, `x as T`, `x satisfies T` and `x!` wrappers. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** Specifier of `import("…")` / `await import("…")`, else null. */
function dynamicImportSpecifier(expression: ts.Expression): string | null {
  const inner = unwrap(expression);
  const call = ts.isAwaitExpression(inner) ? unwrap(inner.expression) : inner;
  if (
    ts.isCallExpression(call) &&
    call.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const [specifier] = call.arguments;
    if (specifier && ts.isStringLiteralLike(specifier)) return specifier.text;
  }
  return null;
}

function propertyKey(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function recordConstants(
  declaration: ts.VariableDeclaration,
  target: Map<string, string>,
): void {
  if (!declaration.initializer || !ts.isIdentifier(declaration.name)) return;

  const value = unwrap(declaration.initializer);
  if (ts.isStringLiteralLike(value)) {
    target.set(declaration.name.text, value.text);
    return;
  }

  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = propertyKey(property.name);
      if (!key) continue;
      const propertyValue = unwrap(property.initializer);
      if (ts.isStringLiteralLike(propertyValue)) {
        target.set(`${declaration.name.text}.${key}`, propertyValue.text);
      }
    }
  }
}

function recordTauriBinding(
  declaration: ts.VariableDeclaration,
  facts: ModuleFacts,
): boolean {
  if (!declaration.initializer) return false;
  const specifier = dynamicImportSpecifier(declaration.initializer);
  if (!specifier || !TAURI_CORE_MODULES.has(specifier)) return false;

  if (ts.isIdentifier(declaration.name)) {
    facts.invokeNamespaces.add(declaration.name.text);
    return true;
  }

  if (ts.isObjectBindingPattern(declaration.name)) {
    for (const element of declaration.name.elements) {
      const exported =
        element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : ts.isIdentifier(element.name)
            ? element.name.text
            : null;
      if (exported === "invoke" && ts.isIdentifier(element.name)) {
        facts.invokeNames.add(element.name.text);
      }
    }
    return true;
  }

  return false;
}

function collectImportDeclaration(
  statement: ts.ImportDeclaration,
  facts: ModuleFacts,
): void {
  if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return;
  const specifier = statement.moduleSpecifier.text;
  const isTauriCore = TAURI_CORE_MODULES.has(specifier);
  const bindings = statement.importClause?.namedBindings;
  if (!bindings) return;

  if (ts.isNamespaceImport(bindings)) {
    if (isTauriCore) facts.invokeNamespaces.add(bindings.name.text);
    return;
  }

  for (const element of bindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    facts.imports.set(element.name.text, { specifier, imported });
    if (isTauriCore && imported === "invoke") {
      facts.invokeNames.add(element.name.text);
    }
  }
}

function collectExportDeclaration(
  statement: ts.ExportDeclaration,
  facts: ModuleFacts,
): void {
  if (
    !statement.moduleSpecifier ||
    !ts.isStringLiteralLike(statement.moduleSpecifier)
  ) {
    return;
  }
  const specifier = statement.moduleSpecifier.text;

  if (!statement.exportClause) {
    facts.starExports.push(specifier);
    return;
  }
  if (!ts.isNamedExports(statement.exportClause)) return;

  for (const element of statement.exportClause.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    facts.imports.set(element.name.text, { specifier, imported });
  }
}

function collectModuleFacts(file: string): ModuleFacts {
  const cached = moduleFactsCache.get(file);
  if (cached) return cached;

  const facts: ModuleFacts = {
    constants: new Map(),
    localConstants: new Map(),
    imports: new Map(),
    starExports: [],
    // Historic behaviour: a bare `invoke(...)` counts even in files that do not
    // import it directly (re-exports, test shims).
    invokeNames: new Set(["invoke"]),
    invokeNamespaces: new Set(),
  };
  // Seed the cache before recursing so import cycles terminate.
  moduleFactsCache.set(file, facts);

  const sourceFile = parseFile(file);
  if (!sourceFile) return facts;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      collectImportDeclaration(statement, facts);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      collectExportDeclaration(statement, facts);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (recordTauriBinding(declaration, facts)) continue;
        recordConstants(declaration, facts.constants);
      }
    }
  }

  // Second pass over every scope: nested `const CMD = "…"` bindings and the
  // `const core = await import("@tauri-apps/api/core")` form, which almost
  // always appears inside a function body.
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && !recordTauriBinding(node, facts)) {
      recordConstants(node, facts.localConstants);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return facts;
}

function resolveModule(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = path.join(PROJECT_ROOT, "src", specifier.slice(2));
  } else {
    return null;
  }

  const candidates = [
    base,
    ...MODULE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...MODULE_EXTENSIONS.map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ];
  for (const candidate of candidates) {
    if (readSource(candidate) !== null) return candidate;
  }
  return null;
}

/**
 * Resolve `name` (optionally `OBJECT.key`) to a string literal, following
 * imports and re-export barrels. `allowLocal` is only true for the file that
 * holds the call site; importers cannot see another module's nested bindings.
 */
function resolveConstant(
  file: string,
  name: string,
  allowLocal: boolean,
  seen: Set<string>,
): string | null {
  const key = `${file}\u0000${name}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const facts = collectModuleFacts(file);
  const own =
    facts.constants.get(name) ??
    (allowLocal ? facts.localConstants.get(name) : undefined);
  if (own !== undefined) return own;

  const [head, ...rest] = name.split(".");
  const binding = facts.imports.get(head);
  if (binding) {
    const target = resolveModule(file, binding.specifier);
    if (target) {
      const resolved = resolveConstant(
        target,
        [binding.imported, ...rest].join("."),
        false,
        seen,
      );
      if (resolved !== null) return resolved;
    }
  }

  for (const specifier of facts.starExports) {
    const target = resolveModule(file, specifier);
    if (!target) continue;
    const resolved = resolveConstant(target, name, false, seen);
    if (resolved !== null) return resolved;
  }

  return null;
}

interface ArgumentResolution {
  resolved: Array<{ name: string; via: string }>;
  unresolved: string[];
}

type BoundExpression = { file: string; value: ts.Expression };
type ArgumentBindings = Map<string, BoundExpression>;

/** Lexical lookup: an identically named const in another callback is not evidence. */
function lexicalValue(
  node: ts.Node,
  name: string,
): ts.Expression | ts.TypeNode | undefined {
  for (
    let scope: ts.Node | undefined = node.parent;
    scope;
    scope = scope.parent
  ) {
    if (ts.isFunctionLike(scope)) {
      const parameter = scope.parameters.find(
        (entry) => ts.isIdentifier(entry.name) && entry.name.text === name,
      );
      if (parameter) return parameter.type ?? parameter.initializer;
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name
          )
            return declaration.initializer;
        }
      }
    }
  }
  return undefined;
}

/** Bounded finite expression evaluation; it never executes application code. */
function finiteValues(
  file: string,
  expression: ts.Node,
  bindings: ArgumentBindings = new Map(),
  seen = new Set<ts.Node>(),
): string[] | null {
  if (seen.has(expression) || seen.size > 64) return null;
  const nextSeen = new Set(seen).add(expression);
  const value = ts.isExpression(expression) ? unwrap(expression) : expression;
  const resolve = (child: ts.Node) =>
    finiteValues(file, child, bindings, nextSeen);
  const combine = (
    left: string[] | null,
    right: string[] | null,
  ): string[] | null =>
    left && right && left.length * right.length <= 256
      ? left.flatMap((a) => right.map((b) => a + b))
      : null;
  if (ts.isStringLiteralLike(value)) return [value.text];
  if (ts.isLiteralTypeNode(value)) return resolve(value.literal);
  if (ts.isUnionTypeNode(value)) {
    const parts = value.types.map(resolve);
    return parts.every((part) => part !== null)
      ? [...new Set(parts.flat() as string[])]
      : null;
  }
  if (ts.isConditionalExpression(value)) {
    const left = resolve(value.whenTrue),
      right = resolve(value.whenFalse);
    return left && right ? [...new Set([...left, ...right])] : null;
  }
  if (ts.isIdentifier(value)) {
    const bound = bindings.get(value.text);
    if (bound)
      return finiteValues(bound.file, bound.value, new Map(), nextSeen);
    const local = lexicalValue(value, value.text);
    if (local) return resolve(local);
    const constant = resolveConstant(file, value.text, false, new Set());
    return constant === null ? null : [constant];
  }
  if (ts.isTemplateExpression(value)) {
    let result: string[] | null = [value.head.text];
    for (const span of value.templateSpans)
      result = combine(combine(result, resolve(span.expression)), [
        span.literal.text,
      ]);
    return result;
  }
  if (
    ts.isBinaryExpression(value) &&
    value.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return combine(resolve(value.left), resolve(value.right));
  if (
    ts.isPropertyAccessExpression(value) ||
    ts.isElementAccessExpression(value)
  ) {
    const base = value.expression;
    const keys = ts.isPropertyAccessExpression(value)
      ? [value.name.text]
      : value.argumentExpression && resolve(value.argumentExpression);
    if (ts.isIdentifier(base) && keys) {
      const bound = bindings.get(base.text);
      const objectValue = bound?.value ?? lexicalValue(base, base.text);
      const object =
        objectValue && ts.isExpression(objectValue)
          ? unwrap(objectValue)
          : undefined;
      if (object && ts.isObjectLiteralExpression(object)) {
        const parts = keys.map((key) => {
          const property = object.properties.find(
            (entry) =>
              ts.isPropertyAssignment(entry) && propertyKey(entry.name) === key,
          );
          return property && ts.isPropertyAssignment(property)
            ? finiteValues(
                bound?.file ?? file,
                property.initializer,
                new Map(),
                nextSeen,
              )
            : null;
        });
        return parts.every((part) => part !== null)
          ? (parts.flat() as string[])
          : null;
      }
    }
  }
  return null;
}

interface Wrapper {
  fn: ts.FunctionLikeDeclaration;
  expression: ts.Expression;
}
function referencesParameter(
  expression: ts.Node,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): boolean {
  const names = new Set(
    parameters.flatMap((parameter) =>
      ts.isIdentifier(parameter.name) ? [parameter.name.text] : [],
    ),
  );
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}
const wrapperCache = new Map<string, Map<string, Wrapper[]>>();
function localWrappers(file: string): Map<string, Wrapper[]> {
  const cached = wrapperCache.get(file);
  if (cached) return cached;
  const wrappers = new Map<string, Wrapper[]>();
  wrapperCache.set(file, wrappers);
  const source = parseFile(file);
  if (!source) return wrappers;
  const facts = collectModuleFacts(file);
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      isInvokeCallee(node.expression, facts) &&
      node.arguments[0]
    ) {
      // Walk through argumentless callbacks (Promise.all/settle/etc.) to the
      // parameter owner, but never infer unrelated property-call identities.
      for (
        let ancestor: ts.Node | undefined = node.parent;
        ancestor;
        ancestor = ancestor.parent
      ) {
        if (!ts.isFunctionLike(ancestor) || !ancestor.parameters.length)
          continue;
        let named: ts.Node = ancestor;
        while (
          named.parent &&
          (ts.isCallExpression(named.parent) ||
            ts.isParenthesizedExpression(named.parent))
        )
          named = named.parent;
        const owner = ts.isVariableDeclaration(named.parent)
          ? named.parent
          : ancestor;
        const name =
          "name" in owner &&
          owner.name &&
          ts.isIdentifier(owner.name as ts.Node)
            ? (owner.name as ts.Identifier).text
            : null;
        if (
          name &&
          referencesParameter(node.arguments[0], ancestor.parameters)
        ) {
          const list = wrappers.get(name) ?? [];
          list.push({
            fn: ancestor as ts.FunctionLikeDeclaration,
            expression: node.arguments[0],
          });
          wrappers.set(name, list);
        }
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return wrappers;
}

function resolveWrapper(
  file: string,
  name: string,
  seen = new Set<string>(),
): { file: string; entries: Wrapper[] } | null {
  const key = `${file}:${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const local = localWrappers(file).get(name);
  if (local) return { file, entries: local };
  const facts = collectModuleFacts(file);
  const binding = facts.imports.get(name);
  if (binding) {
    const target = resolveModule(file, binding.specifier);
    if (target) return resolveWrapper(target, binding.imported, seen);
  }
  for (const specifier of facts.starExports) {
    const target = resolveModule(file, specifier);
    const resolved = target && resolveWrapper(target, name, seen);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Recover the command name(s) a first argument can carry. Both arms of a
 * `cond ? "a" : "b"` are treated as reachable, because both are.
 */
function resolveCommandArgument(
  file: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  inConditional = false,
): ArgumentResolution {
  const value = unwrap(expression);
  const suffix = inConditional ? " in conditional" : "";

  if (ts.isStringLiteralLike(value)) {
    return {
      resolved: [{ name: value.text, via: `literal${suffix}` }],
      unresolved: [],
    };
  }

  if (ts.isConditionalExpression(value)) {
    const whenTrue = resolveCommandArgument(
      file,
      value.whenTrue,
      sourceFile,
      true,
    );
    const whenFalse = resolveCommandArgument(
      file,
      value.whenFalse,
      sourceFile,
      true,
    );
    return {
      resolved: [...whenTrue.resolved, ...whenFalse.resolved],
      unresolved: [...whenTrue.unresolved, ...whenFalse.unresolved],
    };
  }

  const reference = ts.isIdentifier(value)
    ? value.text
    : ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
      ? `${value.expression.text}.${value.name.text}`
      : null;
  if (reference) {
    const head = ts.isIdentifier(value)
      ? value
      : ts.isPropertyAccessExpression(value)
        ? value.expression
        : null;
    const hasLexicalBinding =
      head &&
      ts.isIdentifier(head) &&
      lexicalValue(head, head.text) !== undefined;
    // A parameter/local declaration shadows a module/import constant even
    // when its value cannot be resolved. Never fall back to that other value.
    const finite = hasLexicalBinding ? finiteValues(file, value) : null;
    if (hasLexicalBinding) {
      return finite
        ? {
            resolved: finite.map((name) => ({
              name,
              via:
                finite.length === 1
                  ? `constant ${reference}${suffix}`
                  : `finite ${reference}${suffix}`,
            })),
            unresolved: [],
          }
        : { resolved: [], unresolved: [value.getText(sourceFile)] };
    }
    const name = resolveConstant(file, reference, false, new Set());
    if (name !== null) {
      return {
        resolved: [{ name, via: `constant ${reference}${suffix}` }],
        unresolved: [],
      };
    }
  }

  const finite = finiteValues(file, value);
  if (finite)
    return {
      resolved: finite.map((name) => ({
        name,
        via: `finite ${value.getText(sourceFile)}`,
      })),
      unresolved: [],
    };

  return {
    resolved: [],
    unresolved: [
      sourceFile.text.slice(value.getStart(sourceFile), value.end).trim(),
    ],
  };
}

function isInvokeCallee(callee: ts.Expression, facts: ModuleFacts): boolean {
  if (ts.isIdentifier(callee)) return facts.invokeNames.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "invoke" &&
    ts.isIdentifier(callee.expression) &&
    facts.invokeNamespaces.has(callee.expression.text)
  );
}

function collectInvokes(roots: string[]): {
  calls: InvokeCall[];
  unresolved: UnresolvedInvoke[];
} {
  const calls: InvokeCall[] = [];
  const unresolved: UnresolvedInvoke[] = [];

  const files = roots.flatMap((root) => walkFiles(root, isFrontendSource));
  for (const file of files) {
    // A call to `invoke` necessarily contains this identifier. Avoid building a
    // full TypeScript AST for the large majority of frontend files that cannot
    // contribute a command registration.
    const text = readSource(file);
    if (text === null) continue;

    const sourceFile = parseFile(file);
    if (!sourceFile) continue;
    const facts = collectModuleFacts(file);
    const relative = path
      .relative(PROJECT_ROOT, file)
      .split(path.sep)
      .join("/");

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && isInvokeCallee(node.expression, facts)) {
        const [argument] = node.arguments;
        if (argument) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(
              argument.getStart(sourceFile),
            ).line + 1;
          const resolution = resolveCommandArgument(file, argument, sourceFile);

          for (const entry of resolution.resolved) {
            calls.push({ ...entry, file: relative, line });
          }
          for (const expression of resolution.unresolved) {
            unresolved.push({ expression, file: relative, line });
          }
        }
      } else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression)
      ) {
        const wrapper = resolveWrapper(file, node.expression.text);
        if (wrapper) {
          for (const entry of wrapper.entries) {
            const bindings: ArgumentBindings = new Map();
            entry.fn.parameters.forEach((parameter, index) => {
              if (ts.isIdentifier(parameter.name) && node.arguments[index])
                bindings.set(parameter.name.text, {
                  file,
                  value: node.arguments[index],
                });
            });
            const values = finiteValues(
              wrapper.file,
              entry.expression,
              bindings,
            );
            if (values)
              for (const name of values)
                calls.push({
                  name,
                  file: relative,
                  line:
                    sourceFile.getLineAndCharacterOfPosition(
                      node.getStart(sourceFile),
                    ).line + 1,
                  via: `wrapper ${node.expression.text}`,
                });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return { calls, unresolved };
}

function collectRegisteredCommands(): {
  registered: Map<string, string[]>;
  handlerFiles: string[];
} {
  const rustFiles = reachableNativeHandlers(PROJECT_ROOT);

  const registered = new Map<string, string[]>();
  const handlerFiles: string[] = [];
  for (const file of rustFiles) {
    const relative = path
      .relative(PROJECT_ROOT, file)
      .split(path.sep)
      .join("/");
    handlerFiles.push(relative);
    const text = fs.readFileSync(file, "utf8");
    for (const name of extractNativeCommandNames(text)) {
      const owners = registered.get(name);
      if (owners) owners.push(relative);
      else registered.set(name, [relative]);
    }
  }
  return { registered, handlerFiles };
}

describe("frontend invoke registrations", () => {
  // Parses every frontend .ts/.tsx with the TypeScript compiler and scans the
  // Rust handler files; runtime scales with repo size, so allow generous
  // headroom over vitest's 5s default (slower CI runners were timing out).
  it("uses only Rust commands registered by the aggregate handlers", () => {
    const { registered, handlerFiles } = collectRegisteredCommands();
    const { calls, unresolved } = collectInvokes(FRONTEND_ROOTS);
    if (process.env.IPC_INVENTORY) {
      const referenced = new Set(calls.map((call) => call.name));
      const groups = handlerFiles.map((handler) => {
        const commands = [...registered]
          .filter(([, owners]) => owners.includes(handler))
          .map(([name]) => name)
          .sort();
        const withoutReference = commands.filter(
          (name) => !referenced.has(name),
        );
        return {
          handler,
          registered: commands.length,
          withoutReference: withoutReference.length,
          ...(process.env.IPC_INVENTORY === "full"
            ? { commands, nativeOnlyReview: withoutReference }
            : {}),
        };
      });
      console.info(
        JSON.stringify(
          {
            calls: calls.length,
            names: referenced.size,
            nativeNames: registered.size,
            groups,
            unresolved,
          },
          null,
          2,
        ),
      );
    }

    const missing = calls
      .filter((call) => !registered.has(call.name))
      .map(
        (call) =>
          `${call.name} — invoked at ${call.file}:${call.line} (${call.via}) — registered in none of the ${handlerFiles.length} handler lists`,
      );

    expect(
      missing,
      `Handler lists searched:\n  ${handlerFiles.join("\n  ")}\n` +
        "Add the command to the crate's `*_handler.rs` list (and to the aggregate `src-tauri/src/invoke_handler.rs` if that crate is wired there).",
    ).toEqual([]);
  }, 30000);

  // Self-test: proves the resolver above can actually see through constants, so
  // a future refactor cannot silently reduce this suite to a literal grep.
  // The fixtures live outside `src`/`app` and are never part of the real scan.
  it("resolves commands invoked through constants, not just string literals", () => {
    const { calls, unresolved } = collectInvokes([FIXTURE_ROOT]);

    expect(new Set(calls.map((call) => `${call.name} <- ${call.via}`))).toEqual(
      new Set([
        "fixture_literal_command <- literal",
        "fixture_local_const_command <- constant FIXTURE_LOCAL_COMMAND",
        "fixture_imported_command <- constant FIXTURE_IMPORTED_COMMAND",
        "fixture_barrel_command <- constant FIXTURE_BARREL_COMMAND",
        "fixture_renamed_command <- constant FIXTURE_RENAMED_COMMAND",
        "fixture_object_command <- constant FIXTURE_COMMANDS.close",
        "fixture_aliased_invoke_command <- literal",
        "fixture_namespace_command <- literal",
        "fixture_conditional_command <- literal in conditional",
        "fixture_local_const_command <- constant FIXTURE_LOCAL_COMMAND in conditional",
      ]),
    );

    // Genuinely dynamic call sites stay visible as unresolved rather than being
    // silently dropped or mistaken for a command name.
    expect(unresolved.map((entry) => entry.expression)).toEqual(["command"]);
    expect(calls.map((call) => call.name)).not.toContain("command");
  });

  it("checks finite templates, unions, lexical constants, maps and imported wrappers", () => {
    const { calls, unresolved } = collectInvokes([
      "tests/ipc/fixtures/finiteInvokes",
    ]);
    expect(new Set(calls.map((call) => call.name))).toEqual(
      new Set([
        "fixture_first",
        "fixture_second",
        "fixture_start",
        "fixture_stop",
        "fixture_map_start",
        "fixture_map_stop",
        "fixture_imported_wrapper",
        "fixture_other_scope",
        "fixture_module_command",
        "fixture_shadowed_missing",
      ]),
    );
    expect(unresolved.map((call) => call.expression)).toEqual([
      "CMD",
      "command",
      "command",
    ]);
  });

  it("requires review when a new open-ended invoke boundary appears", () => {
    const { unresolved } = collectInvokes(FRONTEND_ROOTS);
    const actual = [
      ...new Set(
        unresolved.map((entry) => `${entry.file}: ${entry.expression}`),
      ),
    ].sort();
    // These are forwarding declarations, not ignored command names. Finite
    // local/imported callers are checked above; injectable object runtimes and
    // open string APIs still require behavioral contract tests.
    const expected = [
      "src/hooks/idrac/useIdracManager.ts: cmd",
      "src/hooks/protocol/useDocker.ts: cmd",
      "src/hooks/proxmox/useProxmox.ts: cmd",
      "src/hooks/session/useSessionDetach.ts: command",
      "src/hooks/ssh/useYubiKey.ts: command",
      "src/hooks/sync/useBackupStatus.ts: command",
      "src/hooks/sync/useWindowsBackup.ts: cmd",
      "src/hooks/updater/useUpdater.ts: command",
      "src/hooks/windows/useWinmgmtSession.ts: command",
      "src/utils/auth/trustStore.ts: command",
      "src/utils/rdp/rdpBinaryIpcPreflight.ts: command",
      "src/utils/rdp/rdpFrameDeliveryChannel.ts: command",
      "src/utils/security/managementInvoke.ts: command",
      "src/utils/services/whatsappService.ts: cmd",
      "src/utils/session/bmcRuntimeAdapters.ts: commands.dashboard",
      "src/utils/session/bmcRuntimeAdapters.ts: commands.storageControllers",
      "src/utils/session/bmcRuntimeAdapters.ts: commands.virtualDisks",
      "src/utils/session/bmcRuntimeAdapters.ts: commands.physicalDisks",
      "src/utils/session/bmcRuntimeAdapters.ts: commands.firmwareInventory",
      "src/utils/session/cloudRuntimeAdapters.ts: command",
      "src/utils/session/cloudRuntimeInventoryAdapters.ts: command",
    ].sort();
    expect(actual).toEqual(expected);
  }, 30000);
});
