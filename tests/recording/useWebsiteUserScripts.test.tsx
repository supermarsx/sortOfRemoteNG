import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  owner: "db-a",
  accessible: true,
  settingsReady: true,
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
  getInvoke: async () => vi.fn(),
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
  it("clears library and rejects captured save after DB suspension and unlock", async () => {
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
      expect(await save(script, script)).toBe(false);
    });
    expect(result.current.scripts).toEqual([]);
    expect(h.save).not.toHaveBeenCalled();
  });
  it("ignores a late load from the old owner and clears on global lock", async () => {
    let resolve!: (value: unknown) => void;
    h.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useWebsiteUserScripts());
    act(() => {
      h.owner = "db-b";
      for (const fn of h.currentListeners) fn();
    });
    await act(async () => resolve({ value: library }));
    expect(result.current.scripts).toEqual([]);
    expect(result.current.ready).toBe(false);
    const second = renderHook(() => useWebsiteUserScripts());
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    act(() => h.native.mock.calls[h.native.mock.calls.length - 1][1]());
    expect(second.result.current.scripts).toEqual([]);
    expect(second.result.current.ready).toBe(false);
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
});
