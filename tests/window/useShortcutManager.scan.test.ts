import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { generateId } from "../../src/utils/core/id";
import {
  useShortcutManager,
  type ScannedShortcut,
  type ShortcutInfo,
} from "../../src/hooks/window/useShortcutManager";

const harness = vi.hoisted(() => ({
  databases: { getAllDatabases: vi.fn().mockResolvedValue([]) },
  translate: (key: string, fallback?: string | { defaultValue?: string }) =>
    typeof fallback === "string" ? fallback : (fallback?.defaultValue ?? key),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: harness.translate }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { connections: [] } }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => harness.databases },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../src/utils/core/id", () => ({ generateId: vi.fn() }));

const key = "sortofremoteng-shortcuts";
const storage = new Map<string, string>();
const setItem = vi.fn((name: string, value: string) => {
  storage.set(name, value);
});
const getItem = vi.fn((name: string) => storage.get(name) ?? null);
const found = (
  name: string,
  overrides: Partial<ScannedShortcut> = {},
): ScannedShortcut => ({
  name,
  path: `C:\\Desktop\\${name}.lnk`,
  target: "C:\\App\\sortOfRemoteNG.exe",
  arguments: null,
  is_sortofremoteng: true,
  ...overrides,
});
const tracked = (path: string, id = "existing"): ShortcutInfo => ({
  id,
  path,
  name: "Existing",
  exists: true,
  createdAt: "2026-01-01T00:00:00Z",
});
let scanResults: ScannedShortcut[];

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  setItem.mockImplementation((name, value) => {
    storage.set(name, value);
  });
  getItem.mockImplementation((name) => storage.get(name) ?? null);
  vi.stubGlobal("localStorage", { getItem, setItem });
  vi.stubGlobal("__TAURI__", {});
  scanResults = [found("One"), found("Two"), found("Three")];
  let nextId = 0;
  vi.mocked(generateId).mockImplementation(() => `generated-${++nextId}`);
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (command) {
      case "get_desktop_path":
        return "C:\\Desktop";
      case "get_documents_path":
        return "C:\\Documents";
      case "get_appdata_path":
        return "C:\\AppData";
      case "scan_shortcuts":
        return scanResults;
      case "check_shortcut":
        return true;
      case "open_folder":
        return undefined;
      default:
        throw new Error(`Unexpected native call: ${command}`);
    }
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function scannedHook() {
  const hook = renderHook(() => useShortcutManager(true));
  await act(async () => {
    await hook.result.current.handleScanShortcuts();
  });
  setItem.mockClear();
  getItem.mockClear();
  return hook;
}

describe("shortcut scan result management", () => {
  it("keeps only app shortcuts and deduplicates Windows path casing/separators", async () => {
    scanResults = [
      found("One"),
      found("Duplicate", { path: "c:/desktop/ONE.lnk" }),
      found("Other app", { is_sortofremoteng: false }),
    ];
    const { result } = await scannedHook();
    expect(result.current.scannedShortcuts.map((item) => item.name)).toEqual([
      "One",
    ]);
  });

  it("supports per-row, select-all-visible, global select-all, and clear selection", async () => {
    const { result } = await scannedHook();
    act(() => result.current.selectAllScanned([scanResults[0].path]));
    expect([...result.current.selectedScannedPaths]).toEqual([
      scanResults[0].path,
    ]);
    act(() => result.current.selectAllScanned([scanResults[2].path]));
    expect(result.current.selectedScannedPaths.size).toBe(2);
    act(() => result.current.toggleScannedSelection(scanResults[0].path));
    expect([...result.current.selectedScannedPaths]).toEqual([
      scanResults[2].path,
    ]);
    act(() => result.current.selectAllScanned());
    expect(result.current.selectedScannedPaths.size).toBe(3);
    act(() => result.current.clearScannedSelection());
    expect(result.current.selectedScannedPaths.size).toBe(0);
  });

  it("imports selected findings in one read/merge/write, preserving a newer tracked list", async () => {
    const { result } = await scannedHook();
    const external = tracked("C:\\Other\\Existing.lnk");
    storage.set(key, JSON.stringify([external]));
    act(() => {
      result.current.toggleScannedSelection(scanResults[0].path);
      result.current.toggleScannedSelection(scanResults[2].path);
      result.current.handleImportSelectedScanned();
    });
    expect(getItem).toHaveBeenCalledExactlyOnceWith(key);
    expect(setItem).toHaveBeenCalledTimes(1);
    const persisted: ShortcutInfo[] = JSON.parse(storage.get(key)!);
    expect(persisted.map((item) => item.path)).toEqual([
      external.path,
      scanResults[0].path,
      scanResults[2].path,
    ]);
    expect(new Set(persisted.map((item) => item.id)).size).toBe(3);
    expect(result.current.scannedShortcuts).toEqual([scanResults[1]]);
    expect(result.current.selectedScannedPaths.size).toBe(0);
    expect(
      vi.mocked(invoke).mock.calls.map(([command]) => command),
    ).not.toContain("create_desktop_shortcut");
  });

  it("imports all with collision-safe IDs and reports already-tracked paths", async () => {
    const { result } = await scannedHook();
    storage.set(
      key,
      JSON.stringify([tracked("c:/desktop/ONE.lnk", "same-id")]),
    );
    vi.mocked(generateId).mockReturnValue("same-id");
    act(() => result.current.handleImportAllScanned());
    const persisted: ShortcutInfo[] = JSON.parse(storage.get(key)!);
    expect(persisted.map((item) => item.id)).toEqual([
      "same-id",
      "same-id-1",
      "same-id-2",
    ]);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(result.current.statusMessage).toContain(
      "Imported 2 shortcut(s); 1 already tracked",
    );
    expect(result.current.scannedShortcuts).toEqual([]);
  });

  it("does not conflate distinct case-sensitive POSIX paths", async () => {
    scanResults = [
      found("Upper", { path: "/home/user/App.desktop" }),
      found("Lower", { path: "/home/user/app.desktop" }),
    ];
    const { result } = await scannedHook();
    act(() => result.current.handleImportAllScanned());
    expect(JSON.parse(storage.get(key)!)).toHaveLength(2);
  });

  it("repeated import clicks cannot duplicate entries or lose earlier imported entries", async () => {
    const { result } = await scannedHook();
    act(() => {
      result.current.handleImportScannedShortcut(scanResults[0]);
      result.current.handleImportScannedShortcut(scanResults[1]);
      result.current.handleImportAllScanned();
      result.current.handleImportAllScanned();
    });
    const persisted: ShortcutInfo[] = JSON.parse(storage.get(key)!);
    expect(persisted.map((item) => item.path)).toEqual(
      scanResults.map((item) => item.path),
    );
    expect(new Set(persisted.map((item) => item.id)).size).toBe(3);
    expect(setItem).toHaveBeenCalledTimes(3);
  });

  it("parses quoted collection/connection metadata without executing anything", async () => {
    scanResults = [
      found("Quoted", {
        arguments: '--collection "collection one" --connection=connection-two',
      }),
    ];
    const { result } = await scannedHook();
    act(() => result.current.handleImportAllScanned());
    expect(result.current.shortcuts[0]).toMatchObject({
      collectionId: "collection one",
      connectionId: "connection-two",
    });
  });

  it("retains every finding, selected path and old tracked entry on storage write failure", async () => {
    const { result } = await scannedHook();
    const previous = JSON.stringify([tracked("C:\\Existing.lnk")]);
    storage.set(key, previous);
    act(() => result.current.selectAllScanned());
    setItem.mockImplementationOnce(() => {
      throw new Error("storage quota exceeded");
    });
    act(() => result.current.handleImportSelectedScanned());
    expect(storage.get(key)).toBe(previous);
    expect(result.current.scannedShortcuts).toEqual(scanResults);
    expect(result.current.selectedScannedPaths.size).toBe(3);
    expect(result.current.errorMessage).toContain("storage quota exceeded");
    expect(result.current.scanActionsBusy).toBe(false);
    act(() => result.current.handleImportSelectedScanned());
    expect(JSON.parse(storage.get(key)!)).toHaveLength(4);
  });

  it("does not overwrite malformed persisted data during import", async () => {
    const { result } = await scannedHook();
    storage.set(key, '{"not":"a list"}');
    act(() => result.current.selectAllScanned());
    act(() => result.current.handleImportSelectedScanned());
    expect(setItem).not.toHaveBeenCalled();
    expect(result.current.scannedShortcuts).toHaveLength(3);
    expect(result.current.selectedScannedPaths.size).toBe(3);
    expect(result.current.errorMessage).toContain("invalid");
  });

  it("discard selected, one row, and all only remove findings, never files or tracked records", async () => {
    const { result } = await scannedHook();
    const previous = JSON.stringify([tracked("C:\\Existing.lnk")]);
    storage.set(key, previous);
    vi.mocked(invoke).mockClear();
    act(() => {
      result.current.toggleScannedSelection(scanResults[0].path);
      result.current.handleDiscardSelectedScanned();
    });
    expect(result.current.scannedShortcuts).toEqual(scanResults.slice(1));
    expect(result.current.selectedScannedPaths.size).toBe(0);
    act(() => result.current.handleDiscardScannedShortcut(scanResults[1].path));
    expect(result.current.scannedShortcuts).toEqual([scanResults[2]]);
    act(() => result.current.handleDiscardAllScanned());
    expect(result.current.scannedShortcuts).toEqual([]);
    expect(result.current.statusMessage).toBe(
      "Discarded 1 scan result(s). No shortcut files were deleted.",
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(storage.get(key)).toBe(previous);
  });

  it("guards repeat scans and all result actions while a re-scan is pending", async () => {
    const { result } = await scannedHook();
    act(() => result.current.selectAllScanned());
    let finish!: (value: ScannedShortcut[]) => void;
    const pending = new Promise<ScannedShortcut[]>((resolve) => {
      finish = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "scan_shortcuts" ? pending : "C:\\Desktop",
    );
    let scanning!: Promise<void>;
    await act(async () => {
      scanning = result.current.handleScanShortcuts();
    });
    expect(result.current.scanActionsBusy).toBe(true);
    await act(async () => {
      await result.current.handleScanShortcuts();
      result.current.handleImportAllScanned();
      result.current.handleDiscardAllScanned();
      result.current.clearScannedSelection();
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(result.current.scannedShortcuts).toHaveLength(3);
    expect(result.current.selectedScannedPaths.size).toBe(3);
    await act(async () => {
      finish([found("Fresh")]);
      await scanning;
    });
    expect(result.current.scannedShortcuts.map((item) => item.name)).toEqual([
      "Fresh",
    ]);
    expect(result.current.selectedScannedPaths.size).toBe(0);
  });

  it("a late initial existence check cannot overwrite a newly imported tracked list", async () => {
    storage.set(key, JSON.stringify([tracked("C:\\Existing.lnk")]));
    const originalInvoke = vi.mocked(invoke).getMockImplementation()!;
    let finish!: (exists: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (command, args, options) =>
      command === "check_shortcut"
        ? pending
        : originalInvoke(command, args, options),
    );
    const { result } = await scannedHook();
    act(() => result.current.handleImportAllScanned());
    expect(result.current.shortcuts).toHaveLength(4);
    await act(async () => finish(true));
    expect(result.current.shortcuts).toHaveLength(4);
    expect(JSON.parse(storage.get(key)!)).toHaveLength(4);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["C:\\Desktop\\One.lnk", "C:\\Desktop"],
    ["C:\\One.lnk", "C:\\"],
    ["/home/user/One.desktop", "/home/user"],
    ["/One.desktop", "/"],
    ["\\\\server\\share\\One.lnk", "\\\\server\\share"],
  ])("reveals the correct parent of %s", async (path, parent) => {
    const { result } = await scannedHook();
    await act(async () => result.current.openShortcutLocation(path));
    expect(invoke).toHaveBeenCalledWith("open_folder", { path: parent });
  });
});
