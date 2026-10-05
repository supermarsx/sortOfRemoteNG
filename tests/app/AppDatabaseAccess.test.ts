import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = ts.createSourceFile(
  "App.tsx",
  readFileSync(resolve("src/App.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let shell: ts.JsxElement;
function visit(node: ts.Node) {
  if (
    ts.isJsxElement(node) &&
    node.openingElement.attributes.properties.some(
      (attr) =>
        ts.isJsxAttribute(attr) &&
        attr.name.getText(source) === "data-testid" &&
        attr.initializer &&
        ts.isStringLiteral(attr.initializer) &&
        attr.initializer.text === "app-shell",
    )
  )
    shell = node;
  ts.forEachChild(node, visit);
}
visit(source);

describe("application database lock wiring", () => {
  it("passes the lock lifecycle fence into detached cleanup", async () => {
    const detached = ts.createSourceFile(
      "DetachedClient.tsx",
      readFileSync(resolve("app/detached/DetachedClient.tsx"), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(detached) === "clearViews" &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      )
        callback = node.initializer.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(detached);
    expect(callback).toBeDefined();
    const script = ts.transpileModule(
      `const cleanup = ${callback!.getText(detached)};`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.None,
        },
      },
    ).outputText;
    const dispatch = vi.fn();
    const closeCurrentDatabase = vi.fn().mockResolvedValue(undefined);
    const cleanup = new Function(
      "dispatch",
      "DatabaseManager",
      `${script}; return cleanup;`,
    )(dispatch, { getInstance: () => ({ closeCurrentDatabase }) });
    await cleanup(() => false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(closeCurrentDatabase).not.toHaveBeenCalled();
    await cleanup(() => true);
    expect(closeCurrentDatabase).toHaveBeenCalledWith("lock");
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_SESSIONS",
      payload: [],
    });
  });
  it("only lets the global encryption lock hide or disable the application shell", () => {
    expect(shell).toBeDefined();
    for (const name of ["hidden", "inert", "aria-hidden", "style"]) {
      const attr = shell.openingElement.attributes.properties.find(
        (prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === name,
      ) as ts.JsxAttribute;
      const expression = (attr.initializer as ts.JsxExpression).expression!;
      const script = ts.transpileModule(
        `const value = ${expression.getText(source)};`,
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.None,
          },
        },
      ).outputText;
      const evaluate = new Function(
        "globallyLocked",
        "databaseAccess",
        "appSettings",
        `${script}; return value;`,
      );
      for (const blocked of [true, false]) {
        const unlocked = evaluate(false, { blocked }, {});
        const locked = evaluate(true, { blocked }, {});
        if (name === "style") {
          expect(unlocked.display).toBeUndefined();
          expect(locked.display).toBe("none");
        } else {
          expect(unlocked).toBeFalsy();
          expect(locked).toBe(true);
        }
      }
    }
  });

  it("places the database status notice in the shell layout without a modal suspension screen", () => {
    expect(shell.getText(source)).toContain("<DatabaseAccessNotice");
    expect(source.text).not.toContain("DatabaseAccessSuspensionScreen");
  });

  it("keeps detached window contents available on database lock too", () => {
    const detached = ts.createSourceFile(
      "DetachedClient.tsx",
      readFileSync(resolve("app/detached/DetachedClient.tsx"), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let boundary: ts.Expression | undefined;
    const findBoundary = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(detached) === "DetachedSecurityBoundary"
      )
        boundary = node.initializer;
      ts.forEachChild(node, findBoundary);
    };
    findBoundary(detached);
    expect(boundary).toBeDefined();
    const markup = boundary!.getText(detached);
    expect(markup).toContain("!locked &&");
    expect(markup).toContain("<DatabaseAccessNotice");
    expect(markup).not.toContain("databaseAccess.blocked");
    expect(markup).not.toContain("DatabaseAccessSuspensionScreen");
  });
});
