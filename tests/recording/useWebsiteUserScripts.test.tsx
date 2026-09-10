import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  owner: "db-a",
  accessible: true,
  settingsReady: true,
  desktop: true,
  load: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  accessListeners: new Set<
    (event: { databaseId: string; status: string }) => void
  >(),
  currentListeners: new Set<() => void>(),
  native: vi.fn(),
  manager: {} as Record<string, unknown>,
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settingsReady: h.settingsReady }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => h.manager },
  onDatabaseAccessChange: (
    fn: (event: { databaseId: string; status: string }) => void,
  ) => {
    h.accessListeners.add(fn);
    return () => h.accessListeners.delete(fn);
  },
}));
vi.mock("../../src/hooks/protocol/useWebAutomation", () => ({
  captureWebAutomationAccess: (owner: string) => {
    const captured = h.owner;
    return () => {
      if (!h.accessible || owner !== h.owner || captured !== h.owner)
        throw new Error("unavailable");
    };
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (h.desktop ? vi.fn() : null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.native }));
vi.mock("../../src/utils/recording/webAutomationLibrary", () => ({
  webAutomationStore: { load: h.load },
  saveWebAutomationItem: h.save,
  deleteWebAutomationItem: h.remove,
  WEB_AUTOMATION_STORE_KEY: "recording.web-automation.v1",
}));
import { useWebsiteUserScripts } from "../../src/hooks/recording/useWebsiteUserScripts";
const script = {
  id: "script-1",
  kind: "script" as const,
  name: "Fixture",
  description: "",
  code: "document.title",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const library = {
  version: 1,
  scripts: [script],
  macros: [{ id: "macro-preserved" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "db-a";
  h.accessible = true;
  h.settingsReady = true;
  h.desktop = true;
  h.accessListeners.clear();
  h.currentListeners.clear();
  h.manager = {
    getCurrentDatabase: () => ({ id: h.owner }),
    onCurrentDatabaseChange: (fn: () => void) => {
      h.currentListeners.add(fn);
      return () => h.currentListeners.delete(fn);
    },
  };
  h.load.mockResolvedValue({ value: library });
  h.native.mockResolvedValue(vi.fn());
  h.save.mockImplementation(async (item, expected, assertCurrent) => {
    assertCurrent();
    return { ...library, scripts: [item] };
  });
  h.remove.mockImplementation(async (expected, assertCurrent) => {
    assertCurrent();
    return { ...library, scripts: [] };
  });
});
describe("protected website userscript manager", () => {
  it("loads only when mounted and supplies the reviewed script plus owner guard to writes", async () => {
    expect(h.load).not.toHaveBeenCalled();
    const { result } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      expect(
        await result.current.save({ ...script, name: "Changed" }, script),
      ).toBe(true);
    });
    expect(h.save.mock.calls[0][1]).toBe(script);
    expect(h.save.mock.calls[0][2]).toBeTypeOf("function");
    expect(result.current.scripts[0].id).toBe(script.id);
  });
  it("refuses unavailable library without creating fallback data", async () => {
    h.load.mockRejectedValueOnce(new Error("locked"));
    const { result } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(result.current.error).toContain("unavailable"));
    expect(result.current.ready).toBe(false);
    expect(result.current.scripts).toEqual([]);
    expect(h.save).not.toHaveBeenCalled();
  });
  it("keeps app-wide library independent of database changes and suspension", async () => {
    const { result } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const save = result.current.save;
    act(() => {
      h.accessible = false;
      for (const fn of h.accessListeners)
        fn({ databaseId: "db-a", status: "suspended" });
    });
    h.accessible = true;
    await act(async () => {
      expect(await save(script, script)).toBe(true);
    });
    expect(result.current.scripts).toEqual([script]);
    expect(h.accessListeners.size).toBe(0);
    expect(h.currentListeners.size).toBe(0);
  });
  it("ignores a late load after global lock and permits only explicit fresh retry", async () => {
    let resolve!: (value: unknown) => void;
    h.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(h.load).toHaveBeenCalled());
    act(() => {
      h.native.mock.calls[h.native.mock.calls.length - 1][1]();
    });
    await act(async () => resolve({ value: library }));
    expect(result.current.scripts).toEqual([]);
    expect(result.current.ready).toBe(false);
    expect(result.current.diagnostic?.code).toBe("locked");
    await act(async () => result.current.reload());
    expect(result.current.ready).toBe(true);
    expect(result.current.scripts).toEqual([script]);
  });
  it("loads after normal settings hydration rather than permanently revoking access", async () => {
    h.settingsReady = false;
    const { result, rerender } = renderHook(() => useWebsiteUserScripts());
    expect(result.current.diagnostic?.code).toBe("initializing");
    expect(h.load).not.toHaveBeenCalled();
    h.settingsReady = true;
    rerender();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.scope).toEqual({ kind: "app" });
  });
  it("explains missing desktop bridge even when a database is open", async () => {
    h.desktop = false;
    const { result } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() =>
      expect(result.current.diagnostic?.code).toBe("desktop-required"),
    );
    expect(h.load).not.toHaveBeenCalled();
    expect(result.current.desktopAvailable).toBe(false);
  });
  it.each([
    ["Conflicting macro library variants require review", "recovery-required"],
    ["Invalid macro library envelope", "invalid-library"],
    ["command read_macro_library not found", "backend-unavailable"],
    ["Unlock encryption to read this macro library", "locked"],
    ["Cannot read macro library at PRIVATE_SOURCE_PATH", "storage-unavailable"],
  ])(
    "classifies %s without exposing raw native data",
    async (message, code) => {
      h.load.mockRejectedValueOnce(new Error(message));
      const { result } = renderHook(() => useWebsiteUserScripts());
      await waitFor(() => expect(result.current.diagnostic?.code).toBe(code));
      expect(result.current.error).not.toContain("PRIVATE_SOURCE_PATH");
      expect(h.save).not.toHaveBeenCalled();
    },
  );
  it("rejects a captured old review even after lock and a successful fresh retry", async () => {
    const { result } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const oldSave = result.current.save;
    act(() => h.native.mock.calls[h.native.mock.calls.length - 1][1]());
    await act(async () => result.current.reload());
    await act(async () => expect(await oldSave(script, script)).toBe(false));
    expect(h.save).not.toHaveBeenCalled();
  });
  it("cleans late native listener registration after unmount", async () => {
    let resolve!: (value: () => void) => void;
    h.native.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { unmount } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(h.native).toHaveBeenCalled());
    unmount();
    const off = vi.fn();
    await act(async () => resolve(off));
    expect(off).toHaveBeenCalledOnce();
    expect(h.currentListeners.size).toBe(0);
    expect(h.accessListeners.size).toBe(0);
  });
  it("keeps the ready editor mounted during a background store refresh", async () => {
    const { result } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(result.current.ready).toBe(true));
    let resolve!: (value: unknown) => void;
    h.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() =>
      window.dispatchEvent(
        new CustomEvent("sorng-app-data-store-changed", {
          detail: { key: "recording.web-automation.v1" },
        }),
      ),
    );
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    expect(result.current.ready).toBe(true);
    expect(result.current.scripts).toEqual([script]);
    await act(async () =>
      resolve({
        value: {
          ...library,
          scripts: [{ ...script, name: "Concurrent change" }],
        },
      }),
    );
    expect(result.current.ready).toBe(true);
    expect(result.current.scripts[0].name).toBe("Concurrent change");
  });
  it("recovers hydration during an in-flight write without a stuck busy flag", async () => {
    const { result, rerender } = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(result.current.ready).toBe(true));
    let resolve!: (value: typeof library) => void;
    h.save.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.save({ ...script, name: "Changed" }, script);
    });
    expect(result.current.busy).toBe(true);
    h.settingsReady = false;
    rerender();
    expect(result.current.busy).toBe(false);
    h.settingsReady = true;
    rerender();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      resolve(library);
      expect(await saving).toBe(false);
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.busy).toBe(false);
  });
});
