import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionActivityLog,
  getSessionActivityLog,
  recordSessionActivity,
} from "../../src/utils/monitoring/sessionActivityLog";

const text = readFileSync(
  path.resolve("src/hooks/ssh/useWebTerminal.ts"),
  "utf8",
);
const source = ts.createSourceFile(
  "useWebTerminal.ts",
  text,
  ts.ScriptTarget.Latest,
  true,
);
/** Execute the actual callback, not a copied implementation. The terminal renderer
 * is deliberately outside this fixture; all network/storage effects are fakes. */
function callback(name: string, dependencies: Record<string, unknown>) {
  const matches: ts.ArrowFunction[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      const expression = node.initializer;
      if (
        !expression ||
        !ts.isCallExpression(expression) ||
        expression.expression.getText(source) !== "useCallback" ||
        !ts.isArrowFunction(expression.arguments[0])
      )
        throw new Error("Production callback structure changed");
      matches.push(expression.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (matches.length !== 1)
    throw new Error("Missing or ambiguous production callback");
  const js = ts.transpileModule(
    `const callback = ${matches[0].getText(source)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  return new Function(...Object.keys(dependencies), `${js}; return callback;`)(
    ...Object.values(dependencies),
  ) as (payload: unknown, review?: () => Promise<void>) => Promise<void>;
}
function fixture(name: "runScript" | "handleReplayMacro") {
  let active = true;
  const sessionRef = {
    current: {
      id: "session-a",
      connectionId: "connection-a",
      ownerDatabaseId: "db-a",
    },
  };
  const check = () => {
    if (!active) throw new Error("PRIVATE_OWNER_ERROR");
  };
  const invoke = vi.fn().mockResolvedValue({
    stdout: "PRIVATE_OUTPUT",
    stderr: "PRIVATE_STDERR",
    exitCode: 0,
  });
  const replay = vi.fn().mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const dependencies = {
    isSsh: true,
    sshSessionId: { current: "actor-a" },
    isSshReady: { current: true },
    isConnecting: { current: false },
    scriptRunBusyRef: { current: false },
    replayAbortRef: { current: null },
    sessionRef,
    settingsRef: {
      current: {
        sessionQuickActions: {},
        macros: { confirmBeforeReplay: true },
      },
    },
    captureQuickActionSession: () => {
      check();
      return check;
    },
    normalizeSessionQuickActions: () => ({ confirmBeforeScriptRun: true }),
    recordSessionActivity,
    invoke,
    macroService: { replayMacro: replay },
    addCommandHistoryEntry: vi.fn(),
    closeScriptSelector: vi.fn(),
    termRef: { current: null },
    safeWrite: vi.fn(),
    formatErrorDetails: () => ({ message: "PRIVATE_ERROR" }),
    toastRef: { current: { error: vi.fn() } },
    setShowMacroList: vi.fn(),
    setReplayingMacro: vi.fn(),
  };
  return {
    run: callback(name, dependencies),
    invoke,
    replay,
    confirm,
    sessionRef,
    revoke: () => {
      active = false;
    },
  };
}
beforeEach(() => {
  clearSessionActivityLog();
  vi.restoreAllMocks();
});
const script = {
  id: "script-a",
  name: "PRIVATE_NAME",
  script: "echo PRIVATE_CODE",
  language: "bash",
};
const macro = {
  id: "macro-a",
  name: "PRIVATE_NAME",
  steps: [{ command: "PRIVATE_COMMAND", delay: 0 }],
};
describe("actual SSH action callback activity producers", () => {
  it.each(["shell", "script", "nonzero", "transport"] as const)(
    "records %s evidence without payload, output or retries",
    async (mode) => {
      const f = fixture("runScript");
      if (mode === "nonzero")
        f.invoke.mockResolvedValue({
          stdout: "PRIVATE_OUTPUT",
          stderr: "PRIVATE_STDERR",
          exitCode: 1,
        });
      if (mode === "transport")
        f.invoke.mockRejectedValue(new Error("PRIVATE_TRANSPORT"));
      await f.run({
        ...script,
        script:
          mode === "shell"
            ? script.script
            : `${script.script}\necho PRIVATE_SECOND`,
      });
      expect(getSessionActivityLog().map((entry) => entry.code)).toEqual([
        mode === "shell"
          ? "dispatched"
          : mode === "script"
            ? "completed"
            : "failed",
        "started",
      ]);
      expect(f.invoke).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(getSessionActivityLog())).not.toContain("PRIVATE_");
    },
  );
  it.each(["cancel", "revoked", "review-changed"] as const)(
    "does not invent execution when %s prevents dispatch",
    async (mode) => {
      const f = fixture("runScript");
      if (mode === "cancel") f.confirm.mockReturnValue(false);
      if (mode === "revoked") f.revoke();
      await f.run(
        script,
        mode === "review-changed"
          ? async () => {
              throw new Error("PRIVATE_REVISION");
            }
          : undefined,
      );
      expect(f.invoke).not.toHaveBeenCalled();
      expect(getSessionActivityLog()).toHaveLength(0);
    },
  );
  it("keeps a late accepted dispatch attached to its original owner without replay", async () => {
    const f = fixture("runScript");
    let complete!: (value: unknown) => void;
    f.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const running = f.run(script);
    f.sessionRef.current = {
      id: "session-b",
      connectionId: "connection-a",
      ownerDatabaseId: "db-b",
    };
    f.revoke();
    complete(undefined);
    await running;
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(getSessionActivityLog().map((entry) => entry.code)).toEqual([
      "dispatched",
      "started",
    ]);
    expect(
      getSessionActivityLog().every((entry) => entry.databaseId === "db-a"),
    ).toBe(true);
  });
  it.each(["completed", "failed", "cancelled"] as const)(
    "records macro %s with no step values or duplicate replay",
    async (mode) => {
      const f = fixture("handleReplayMacro");
      if (mode === "failed")
        f.replay.mockRejectedValue(new Error("PRIVATE_FAILURE"));
      if (mode === "cancelled") f.confirm.mockReturnValue(false);
      await f.run(macro);
      expect(f.replay).toHaveBeenCalledTimes(mode === "cancelled" ? 0 : 1);
      expect(getSessionActivityLog().map((entry) => entry.code)).toEqual(
        mode === "cancelled" ? [] : [mode, "started"],
      );
      expect(JSON.stringify(getSessionActivityLog())).not.toContain("PRIVATE_");
    },
  );
});
