import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScriptManager } from "../../src/hooks/recording/useScriptManager";
import { useMacroManager } from "../../src/hooks/recording/useMacroManager";
import type {
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../src/types/recording/automationLibrary";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  apply: vi.fn(),
  ready: true,
  settingsReady: true,
  accessEpoch: 1,
  databaseRevision: 0,
  databaseScope: { databaseId: "a", generation: 1 } as {
    databaseId: string;
    generation: number;
  } | null,
}));
vi.mock("../../src/hooks/recording/useAutomationLibraryApi", () => ({
  useAutomationLibraryApi: () => ({
    ...h,
    api: { read: h.read, apply: h.apply },
    diagnostic: null,
    retry: vi.fn(),
  }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({
  loadRecordings: vi.fn().mockResolvedValue([]),
}));
const snapshot = (scope: AutomationScope, family: string) => ({
  scope,
  family,
  receipt: crypto.randomUUID(),
  entries: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  h.ready = h.settingsReady = true;
  h.accessEpoch = 1;
  h.databaseRevision = 0;
  h.databaseScope = { databaseId: "a", generation: 1 };
  h.read.mockImplementation(async (scope, family) => snapshot(scope, family));
  h.apply.mockImplementation(async (reviewed, changes) => ({
    ...reviewed,
    entries: changes.map((change: { entry: unknown }) => change.entry),
  }));
});
function useManager(family: "terminal-script" | "terminal-macro") {
  const scripts = useScriptManager(vi.fn(), family === "terminal-script");
  const macros = useMacroManager(family === "terminal-macro");
  return family === "terminal-script"
    ? {
        ...scripts,
        draftVisible: scripts.isEditing,
        begin: () => {
          scripts.handleNewScript();
        },
        edit: () => {
          scripts.setEditName("Database script");
          scripts.setEditScript("pwd");
        },
        save: scripts.handleSaveScript,
      }
    : {
        ...macros,
        draftVisible: !!macros.draft,
        begin: macros.handleNewMacro,
        edit: () => {},
        save: () => macros.saveEntry(macros.draft!),
      };
}
describe.each(["terminal-script", "terminal-macro"] as const)(
  "%s app-wide default and optional database scope",
  (family) => {
    async function openDatabase() {
      const view = renderHook(() => useManager(family));
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      act(() =>
        view.result.current.changeScope({ kind: "database", databaseId: "a" }),
      );
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      return view;
    }
    it("waits for startup access and loads app-wide without an open database or writes", async () => {
      h.ready = false;
      h.settingsReady = false;
      h.databaseScope = null;
      const view = renderHook(() => useManager(family));
      expect(view.result.current.scope).toEqual({ kind: "app" });
      expect(view.result.current.available).toBe(false);
      expect(h.read).not.toHaveBeenCalled();
      h.ready = true;
      view.rerender();
      expect(h.read).not.toHaveBeenCalled();
      h.settingsReady = true;
      view.rerender();
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      expect(h.read).toHaveBeenCalledExactlyOnceWith({ kind: "app" }, family);
      expect(h.apply).not.toHaveBeenCalled();
    });
    it("defaults to app-wide with a database open and saves there only on request", async () => {
      const view = renderHook(() => useManager(family));
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      expect(view.result.current.scope).toEqual({ kind: "app" });
      expect(h.read).toHaveBeenCalledExactlyOnceWith({ kind: "app" }, family);
      expect(h.apply).not.toHaveBeenCalled();
      act(() => view.result.current.begin());
      act(() => view.result.current.edit());
      await act(async () => {
        expect(await view.result.current.save()).toBe(true);
      });
      expect(h.apply).toHaveBeenCalledOnce();
      expect(h.apply.mock.calls[0][0].scope).toEqual({ kind: "app" });
    });
    it("keeps app-wide drafts while databases open, switch, and close without writing", async () => {
      h.databaseScope = null;
      const view = renderHook(() => useManager(family));
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      act(() => view.result.current.begin());
      act(() => view.result.current.edit());
      for (const databaseScope of [
        { databaseId: "a", generation: 1 },
        { databaseId: "b", generation: 2 },
        null,
      ]) {
        h.databaseScope = databaseScope;
        h.databaseRevision++;
        view.rerender();
        expect(view.result.current.scope).toEqual({ kind: "app" });
        expect(view.result.current.draftVisible).toBe(true);
      }
      expect(h.read).toHaveBeenCalledExactlyOnceWith({ kind: "app" }, family);
      expect(h.apply).not.toHaveBeenCalled();
    });
    it("saves to an explicitly selected database and can return to app-wide", async () => {
      const view = await openDatabase();
      expect(h.apply).not.toHaveBeenCalled();
      act(() => view.result.current.begin());
      act(() => view.result.current.edit());
      await act(async () => {
        expect(await view.result.current.save()).toBe(true);
      });
      expect(h.apply.mock.calls[0][0].scope).toEqual({
        kind: "database",
        databaseId: "a",
      });
      act(() => view.result.current.changeScope({ kind: "app" }));
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      expect(h.read).toHaveBeenLastCalledWith({ kind: "app" }, family);
      expect(h.apply).toHaveBeenCalledTimes(1);
      expect(view.result.current.scope).toEqual({ kind: "app" });
    });
    it("rejects a pending save after switching databases and resumes the new owner's read", async () => {
      const view = await openDatabase();
      act(() => view.result.current.begin());
      act(() => view.result.current.edit());
      let resolve!: (value: unknown) => void;
      h.read.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      let pending!: Promise<boolean>;
      act(() => {
        pending = view.result.current.save();
      });
      h.databaseScope = { databaseId: "b", generation: 2 };
      view.rerender();
      expect(view.result.current.draftVisible).toBe(false);
      expect(view.result.current.scope).toEqual({
        kind: "database",
        databaseId: "b",
      });
      await act(async () => {
        resolve(
          snapshot(
            { kind: "database", databaseId: "a" },
            family,
          ) as AutomationLibrarySnapshot,
        );
        expect(await pending).toBe(false);
      });
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      expect(h.read).toHaveBeenLastCalledWith(
        { kind: "database", databaseId: "b" },
        family,
      );
      expect(h.apply).not.toHaveBeenCalled();
    });
    it("masks drafts on lock and rejects retained save callbacks after unlock", async () => {
      const view = await openDatabase();
      h.read.mockClear();
      act(() => view.result.current.begin());
      act(() => view.result.current.edit());
      const oldSave = view.result.current.save;
      h.databaseScope = null;
      view.rerender();
      expect(view.result.current.draftVisible).toBe(false);
      expect(view.result.current.available).toBe(false);
      h.databaseScope = { databaseId: "a", generation: 3 };
      view.rerender();
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      await act(async () => {
        expect(await oldSave()).toBe(false);
      });
      expect(h.apply).not.toHaveBeenCalled();
      expect(
        h.read.mock.calls.every(([scope]) => scope.kind === "database"),
      ).toBe(true);
    });
  },
);
