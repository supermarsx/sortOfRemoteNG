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
function fixture(
  name: "runScript" | "handleReplayMacro",
  settings: { confirmScripts?: boolean; confirmMacros?: boolean } = {},
) {
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
  // The review step is the hook's one helper; the native box must stay unused.
  const confirm = vi.fn(async (_review: unknown) => true);
  const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const toastError = vi.fn();
  const closeScriptSelector = vi.fn();
  const closeScriptSelectorForRun = vi.fn();
  const setShowMacroList = vi.fn();
  const dependencies = {
    isSsh: true,
    sshSessionId: { current: "actor-a" },
    isSshReady: { current: true },
    isConnecting: { current: false },
    scriptRunBusyRef: { current: false },
    macroReplayBusyRef: { current: false },
    replayAbortRef: { current: null },
    sessionRef,
    settingsRef: {
      current: {
        sessionQuickActions: {},
        macros: { confirmBeforeReplay: settings.confirmMacros ?? true },
      },
    },
    captureQuickActionSession: () => {
      check();
      return check;
    },
    reviewScript: () => async () => {},
    reviewMacro: () => async () => {},
    normalizeSessionQuickActions: () => ({
      confirmBeforeScriptRun: settings.confirmScripts ?? true,
    }),
    confirmSshRun: confirm,
    recordSessionActivity,
    invoke,
    macroService: { replayMacro: replay },
    addCommandHistoryEntry: vi.fn(),
    closeScriptSelector,
    closeScriptSelectorForRun,
    termRef: { current: null },
    safeWrite: vi.fn(),
    formatErrorDetails: () => ({ message: "PRIVATE_ERROR" }),
    toastRef: { current: { error: toastError } },
    setShowMacroList,
    setReplayingMacro: vi.fn(),
  };
  return {
    run: callback(name, dependencies),
    invoke,
    replay,
    confirm,
    nativeConfirm,
    toastError,
    closeScriptSelector,
    closeScriptSelectorForRun,
    setShowMacroList,
    sessionRef,
    revoke: () => {
      active = false;
    },
  };
}
/** A review the test answers by hand, like a prompt the user is still reading. */
function pendingReview(confirm: ReturnType<typeof fixture>["confirm"]) {
  let answer!: (confirmed: boolean) => void;
  confirm.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  return { answer: (confirmed: boolean) => answer(confirmed) };
}
const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};
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
      expect(f.nativeConfirm).not.toHaveBeenCalled();
    },
  );
  it.each(["cancel", "revoked", "review-changed"] as const)(
    "does not invent execution when %s prevents dispatch",
    async (mode) => {
      const f = fixture("runScript");
      if (mode === "cancel") f.confirm.mockResolvedValue(false);
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
      expect(f.nativeConfirm).not.toHaveBeenCalled();
      // A cancel is silent; only a failed re-check tells the user.
      expect(f.toastError).toHaveBeenCalledTimes(mode === "cancel" ? 0 : 1);
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
    await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledOnce());
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
      if (mode === "cancelled") f.confirm.mockResolvedValue(false);
      await f.run(macro);
      expect(f.replay).toHaveBeenCalledTimes(mode === "cancelled" ? 0 : 1);
      expect(getSessionActivityLog().map((entry) => entry.code)).toEqual(
        mode === "cancelled" ? [] : [mode, "started"],
      );
      expect(JSON.stringify(getSessionActivityLog())).not.toContain("PRIVATE_");
      expect(f.nativeConfirm).not.toHaveBeenCalled();
    },
  );
});
describe("actual SSH action callbacks and the review step", () => {
  it.each(["one line", "several lines"] as const)(
    "sends exactly the script text that was reviewed (%s)",
    async (mode) => {
      const f = fixture("runScript");
      await f.run({
        ...script,
        script:
          mode === "one line"
            ? "#!/bin/sh\necho PRIVATE_CODE"
            : "#!/bin/sh\necho PRIVATE_CODE\necho PRIVATE_SECOND",
      });
      expect(f.confirm).toHaveBeenCalledOnce();
      const review = f.confirm.mock.calls[0][0] as {
        kind: string;
        script: { id: string };
        command: string;
      };
      expect(review.kind).toBe("script");
      expect(review.script).toMatchObject({ id: "script-a" });
      // The shebang line is not sent, so it is not reviewed either.
      expect(review.command).toBe(
        mode === "one line"
          ? "echo PRIVATE_CODE"
          : "echo PRIVATE_CODE\necho PRIVATE_SECOND",
      );
      expect(f.invoke.mock.calls).toEqual([
        mode === "one line"
          ? [
              "send_ssh_input",
              // The one addition is the Enter that runs the line.
              { sessionId: "actor-a", data: `${review.command}\n` },
            ]
          : [
              "execute_script",
              {
                sessionId: "actor-a",
                script: review.command,
                interpreter: "bash",
              },
            ],
      ]);
    },
  );
  it("sends the reviewed copy even if the caller's script object changes while the prompt is open", async () => {
    const f = fixture("runScript");
    const review = pendingReview(f.confirm);
    const mutable = { ...script };
    const running = f.run(mutable);
    await settle();
    mutable.script = "echo PRIVATE_SWAPPED";
    review.answer(true);
    await running;
    expect(f.invoke.mock.calls).toEqual([
      ["send_ssh_input", { sessionId: "actor-a", data: "echo PRIVATE_CODE\n" }],
    ]);
  });
  it.each(["runScript", "handleReplayMacro"] as const)(
    "%s sends nothing and records nothing until the review is answered",
    async (name) => {
      const f = fixture(name);
      const review = pendingReview(f.confirm);
      const running = f.run(name === "runScript" ? script : macro);
      await settle();
      expect(f.confirm).toHaveBeenCalledOnce();
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.replay).not.toHaveBeenCalled();
      expect(getSessionActivityLog()).toHaveLength(0);
      review.answer(true);
      await running;
      expect(
        (name === "runScript" ? f.invoke : f.replay).mock.calls,
      ).toHaveLength(1);
      expect(f.nativeConfirm).not.toHaveBeenCalled();
    },
  );
  it.each(["runScript", "handleReplayMacro"] as const)(
    "%s re-checks the session after the answer and sends nothing when it changed",
    async (name) => {
      const f = fixture(name);
      const review = pendingReview(f.confirm);
      const running = f.run(name === "runScript" ? script : macro);
      await settle();
      f.revoke();
      review.answer(true);
      await running;
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.replay).not.toHaveBeenCalled();
      expect(getSessionActivityLog()).toHaveLength(0);
      expect(f.toastError).toHaveBeenCalledOnce();
    },
  );
  it.each(["runScript", "handleReplayMacro"] as const)(
    "%s sends nothing when the review cannot be shown",
    async (name) => {
      const f = fixture(name);
      f.confirm.mockRejectedValue(new Error("PRIVATE_NO_PROMPT_HOST"));
      await f.run(name === "runScript" ? script : macro);
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.replay).not.toHaveBeenCalled();
      expect(getSessionActivityLog()).toHaveLength(0);
      expect(f.toastError).toHaveBeenCalledOnce();
      expect(JSON.stringify(f.toastError.mock.calls)).not.toContain("PRIVATE_");
    },
  );
  it("does not start a second script run while the first is being reviewed", async () => {
    const f = fixture("runScript");
    const review = pendingReview(f.confirm);
    const running = f.run(script);
    await settle();
    await f.run(script);
    expect(f.confirm).toHaveBeenCalledOnce();
    review.answer(false);
    await running;
    expect(f.invoke).not.toHaveBeenCalled();
    // The guard is released: the next run asks again.
    f.confirm.mockResolvedValue(true);
    await f.run(script);
    expect(f.confirm).toHaveBeenCalledTimes(2);
    expect(f.invoke).toHaveBeenCalledOnce();
  });
  it.each([
    ["runScript", { confirmScripts: false }],
    ["handleReplayMacro", { confirmMacros: false }],
  ] as const)(
    "%s runs without a review when its setting is off, as before",
    async (name, settings) => {
      const f = fixture(name, settings);
      await f.run(name === "runScript" ? script : macro);
      expect(f.confirm).not.toHaveBeenCalled();
      expect(f.nativeConfirm).not.toHaveBeenCalled();
      expect(
        (name === "runScript" ? f.invoke : f.replay).mock.calls,
      ).toHaveLength(1);
    },
  );
  it("closes the script picker once the re-checks have passed, before anything is sent, and only once", async () => {
    const f = fixture("runScript");
    let complete!: (value: unknown) => void;
    f.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const running = f.run(script);
    await vi.waitFor(() => expect(f.invoke).toHaveBeenCalledOnce());
    // The remote run has not answered yet and the picker is already closed.
    expect(f.closeScriptSelectorForRun).toHaveBeenCalledOnce();
    expect(f.confirm.mock.invocationCallOrder[0]).toBeLessThan(
      f.closeScriptSelectorForRun.mock.invocationCallOrder[0],
    );
    expect(
      f.closeScriptSelectorForRun.mock.invocationCallOrder[0],
    ).toBeLessThan(f.invoke.mock.invocationCallOrder[0]);
    complete(undefined);
    await running;
    // Not closed again when the run ends: a picker reopened meanwhile stays.
    expect(f.closeScriptSelectorForRun).toHaveBeenCalledOnce();
    expect(f.closeScriptSelector).not.toHaveBeenCalled();
  });
  it.each([
    "a cancel",
    "a session that changed during the review",
    "a library entry that changed during the review",
  ] as const)(
    "keeps the script picker open when %s stops the run",
    async (mode) => {
      const f = fixture("runScript");
      if (mode === "a cancel") {
        f.confirm.mockResolvedValue(false);
        await f.run(script);
      } else if (mode === "a session that changed during the review") {
        const review = pendingReview(f.confirm);
        const running = f.run(script);
        await settle();
        f.revoke();
        review.answer(true);
        await running;
      } else {
        await f.run(script, async () => {
          throw new Error("PRIVATE_REVISION");
        });
      }
      expect(f.confirm).toHaveBeenCalledOnce();
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.closeScriptSelectorForRun).not.toHaveBeenCalled();
      expect(f.closeScriptSelector).not.toHaveBeenCalled();
    },
  );
  it("closes the script picker before sending when no review is required, too", async () => {
    const f = fixture("runScript", { confirmScripts: false });
    await f.run(script);
    expect(f.closeScriptSelectorForRun).toHaveBeenCalledOnce();
    expect(
      f.closeScriptSelectorForRun.mock.invocationCallOrder[0],
    ).toBeLessThan(f.invoke.mock.invocationCallOrder[0]);
    expect(f.closeScriptSelector).not.toHaveBeenCalled();
  });
  it("closes the macro list before the review, so it cannot cover the prompt", async () => {
    const f = fixture("handleReplayMacro");
    await f.run(macro);
    expect(f.setShowMacroList).toHaveBeenCalledWith(false);
    expect(f.setShowMacroList.mock.invocationCallOrder[0]).toBeLessThan(
      f.confirm.mock.invocationCallOrder[0],
    );
    const review = f.confirm.mock.calls[0][0] as {
      kind: string;
      macro: { id: string };
    };
    expect(review.kind).toBe("macro");
    // The replay receives the reviewed copy, not the caller's object.
    expect(f.replay.mock.calls[0][1]).toBe(review.macro);
    expect(review.macro).toEqual(macro);
    expect(review.macro).not.toBe(macro);
  });
});
