import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface InvokeCall {
  name: string;
  file: string;
  line: number;
}

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const FRONTEND_ROOTS = ["src", "app"];

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
        if ([".next", "dist", "node_modules", "target"].includes(entry.name)) {
          continue;
        }
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

function collectFrontendInvokes(): InvokeCall[] {
  return FRONTEND_ROOTS.flatMap((root) =>
    walkFiles(
      root,
      (file) =>
        /\.(ts|tsx)$/.test(file) &&
        !/\.test\.(ts|tsx)$/.test(file) &&
        !file.endsWith(".d.ts"),
    ),
  ).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const calls: InvokeCall[] = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "invoke" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(
          node.arguments[0].getStart(sf),
        );
        calls.push({
          name: node.arguments[0].text,
          file: path.relative(PROJECT_ROOT, file),
          line: line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
    return calls;
  });
}

function collectRegisteredCommands(): Set<string> {
  const rustFiles = [
    ...walkFiles("src-tauri/crates", (file) => /handler\.rs$/.test(file)),
    ...walkFiles(
      "src-tauri/src",
      (file) => path.basename(file) === "invoke_handler.rs",
    ),
  ];

  const registered = new Set<string>();
  for (const file of rustFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/"([a-zA-Z0-9_:\-|]+)"/g)) {
      registered.add(match[1]);
    }
  }
  return registered;
}

describe("frontend invoke registrations", () => {
  it("uses only Rust commands registered by the aggregate handlers", () => {
    const registered = collectRegisteredCommands();
    const missing = collectFrontendInvokes().filter(
      (call) => !registered.has(call.name),
    );

    expect(
      missing.map((call) => `${call.name} at ${call.file}:${call.line}`),
    ).toEqual([]);
  });
});
