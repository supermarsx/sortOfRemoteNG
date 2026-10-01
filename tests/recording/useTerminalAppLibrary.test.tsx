import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalAppLibrary } from "../../src/hooks/recording/useTerminalAppLibrary";
import type {
  AutomationFamily,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../src/types/recording/automationLibrary";
import { defaultScripts } from "../../src/data/defaultScripts";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../src/utils/storage/appDataJsonStore";
import { TERMINAL_MACROS_STORE_KEY } from "../../src/utils/recording/terminalMacroPersistence";

const h = vi.hoisted(() => ({
  ready: true,
  settingsReady: true,
  accessEpoch: 1,
  databaseScope: null as { databaseId: string; generation: number } | null,
  read: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../../src/hooks/recording/useAutomationLibraryApi", () => ({
  useAutomationLibraryApi: () => ({
    ...h,
    api: { read: h.read, apply: h.apply },
    diagnostic: null,
  }),
}));
const macro = {
  id: "recorded",
  name: "Recorded",
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
  steps: [{ command: "pwd", delayMs: 0, sendNewline: true }],
};
let scripts: typeof defaultScripts;
let macros: (typeof macro)[];
const snapshot = (scope: AutomationScope, family: AutomationFamily) => ({
  scope,
  family,
  receipt: crypto.randomUUID(),
  entries: structuredClone(family === "terminal-script" ? scripts : macros).map(
    (payload) => ({ family, payload }),
  ),
});
beforeEach(() => {
  vi.resetAllMocks();
  h.ready = h.settingsReady = true;
  h.accessEpoch = 1;
  h.databaseScope = null;
  scripts = [structuredClone(defaultScripts[0])];
  macros = [{ ...structuredClone(macro), id: "existing" }];
  h.read.mockImplementation(async (scope, family) => snapshot(scope, family));
  h.apply.mockImplementation(async (reviewed, changes) => {
    expect(reviewed.scope).toEqual({ kind: "app" });
    macros.push(
      ...changes.map(
        (change: { entry: { payload: typeof macro } }) => change.entry.payload,
      ),
    );
    return snapshot(reviewed.scope, reviewed.family);
  });
});
describe("app-wide terminal toolbar library", () => {
  it("loads app entries without an open database and never reads an implicit database scope", async () => {
    const view = renderHook(() => useTerminalAppLibrary(true));
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
    expect(view.result.current.available).toBe(true);
    expect(view.result.current.scripts).toEqual(scripts);
    for (const databaseId of ["a", "b"]) {
      h.databaseScope = { databaseId, generation: 2 };
      view.rerender();
      expect(view.result.current.macros).toEqual(macros);
      await act(() => view.result.current.refresh());
    }
    expect(h.read.mock.calls.every(([scope]) => scope.kind === "app")).toBe(
      true,
    );
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("waits for settings and app access, without requiring a database", async () => {
    h.ready = h.settingsReady = false;
    const view = renderHook(() => useTerminalAppLibrary(true));
    expect(view.result.current.available).toBe(false);
    expect(h.read).not.toHaveBeenCalled();
    h.settingsReady = true;
    view.rerender();
    expect(h.read).not.toHaveBeenCalled();
    h.ready = true;
    view.rerender();
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
  });
  it("does not populate bundled or database entries when the protected app read fails", async () => {
    h.read.mockRejectedValue(new Error("App library locked SECRET_PATH"));
    const view = renderHook(() => useTerminalAppLibrary(true));
    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(view.result.current.error).toContain("Unlock app encryption");
    expect(view.result.current.error).not.toContain("SECRET_PATH");
    expect(view.result.current.scripts).toEqual([]);
    expect(view.result.current.macros).toEqual([]);
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("appends a recording to app storage after a database switch or close", async () => {
    h.databaseScope = { databaseId: "a", generation: 1 };
    const view = renderHook(() => useTerminalAppLibrary(true));
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
    const save = view.result.current.captureMacroSave();
    h.databaseScope = { databaseId: "b", generation: 2 };
    view.rerender();
    h.databaseScope = null;
    view.rerender();
    await act(() => save(macro));
    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "app" },
        family: "terminal-macro",
      }),
      [
        {
          operation: "put",
          entry: { family: "terminal-macro", payload: macro },
        },
      ],
    );
    expect(view.result.current.macros).toEqual([
      { ...macro, id: "existing" },
      macro,
    ]);
  });
  it("refuses to overwrite an existing macro identity", async () => {
    const view = renderHook(() => useTerminalAppLibrary(true));
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
    await expect(
      view.result.current.captureMacroSave()({ ...macro, id: "existing" }),
    ).rejects.toThrow("already exists");
    expect(h.apply).not.toHaveBeenCalled();
  });
  it.each(["lock", "disable", "unmount"])(
    "invalidates captured saves and reviews on app %s",
    async (change) => {
      const view = renderHook(({ enabled }) => useTerminalAppLibrary(enabled), {
        initialProps: { enabled: true },
      });
      await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
      const save = view.result.current.captureMacroSave();
      const review = view.result.current.reviewMacro(
        view.result.current.macros[0],
      );
      if (change === "lock") {
        h.ready = false;
        h.accessEpoch++;
        view.rerender({ enabled: true });
        expect(view.result.current.macros).toEqual([]);
        h.ready = true;
        view.rerender({ enabled: true });
        await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
      } else if (change === "disable") view.rerender({ enabled: false });
      else view.unmount();
      await expect(save(macro)).rejects.toThrow("access changed");
      await expect(review()).rejects.toThrow("access changed");
      expect(h.apply).not.toHaveBeenCalled();
    },
  );
  it("refuses a recording save if app access changes during its read", async () => {
    const view = renderHook(() => useTerminalAppLibrary(true));
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
    let resolve!: (value: AutomationLibrarySnapshot) => void;
    h.read.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = view.result.current.captureMacroSave()(macro);
    h.accessEpoch++;
    view.rerender();
    await act(async () => {
      const rejection = expect(pending).rejects.toThrow("access changed");
      resolve(
        snapshot(
          { kind: "app" },
          "terminal-macro",
        ) as AutomationLibrarySnapshot,
      );
      await rejection;
    });
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("revalidates reviewed payloads and rejects changes or removal from the app library", async () => {
    const view = renderHook(() => useTerminalAppLibrary(true));
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
    const checkMacro = view.result.current.reviewMacro(
      view.result.current.macros[0],
    );
    const checkScript = view.result.current.reviewScript(
      view.result.current.scripts[0],
    );
    await expect(checkMacro()).resolves.toBeUndefined();
    await expect(checkScript()).resolves.toBeUndefined();
    macros[0].steps[0].command = "whoami";
    scripts[0].script = "whoami";
    await expect(checkMacro()).rejects.toThrow("saved macro changed");
    await expect(checkScript()).rejects.toThrow("saved script changed");
    macros = [];
    scripts = [];
    await expect(checkMacro()).rejects.toThrow("saved macro changed");
    await expect(checkScript()).rejects.toThrow("saved script changed");
  });
  it("refreshes when app storage changes without writing or changing scope", async () => {
    const view = renderHook(() => useTerminalAppLibrary(true));
    await waitFor(() => expect(view.result.current.macros).toHaveLength(1));
    macros.push(structuredClone(macro));
    act(() =>
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: TERMINAL_MACROS_STORE_KEY },
        }),
      ),
    );
    await waitFor(() => expect(view.result.current.macros).toHaveLength(2));
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.read.mock.calls.every(([scope]) => scope.kind === "app")).toBe(
      true,
    );
  });
});
