import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  library: {} as any,
  snapshot: { revision: 1, ready: true, locked: false, error: null },
  open: vi.fn(),
  save: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  desktop: true,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => f.desktop }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: f.open, save: f.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: f.stat,
  readTextFile: f.read,
  writeTextFile: f.write,
}));
vi.mock("../../src/hooks/icons/useIconLibrary", () => ({
  useIconLibrary: () => f.library,
}));
vi.mock("../../src/utils/icons/iconLibraryRuntime", () => ({
  getIconLibrarySnapshot: () => f.snapshot,
}));
import { useIconExplorer } from "../../src/hooks/icons/useIconExplorer";
beforeEach(() => {
  f.library = {
    entries: [],
    ready: true,
    accessEpoch: 1,
    discardImport: vi.fn(),
    locked: false,
    error: null,
    previewImport: vi.fn().mockReturnValue({
      id: "preview",
      entries: [],
      conflicts: [],
      warnings: [],
    }),
    applyImport: vi.fn().mockResolvedValue(undefined),
    exportPack: vi.fn().mockReturnValue('{"icons":[]}'),
    exportSvg: vi.fn().mockReturnValue("<svg/>"),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
    deleteCustom: vi.fn().mockResolvedValue(undefined),
  };
  f.snapshot = { revision: 1, ready: true, locked: false, error: null };
  f.desktop = true;
  f.open.mockReset().mockResolvedValue(null);
  f.save.mockReset().mockResolvedValue(null);
  f.stat.mockReset().mockResolvedValue({ isFile: true, size: 12 });
  f.read.mockReset().mockResolvedValue("<svg/>");
  f.write.mockReset().mockResolvedValue(undefined);
});
describe("Icon Explorer explicit file operations", () => {
  it("rejects stale delete confirmation using the current runtime epoch without waiting for rerender", async () => {
    const { result } = renderHook(() => useIconExplorer());
    f.snapshot.revision = 2;
    await act(async () => result.current.deleteCustom(["custom-key"], 1));
    expect(f.library.deleteCustom).not.toHaveBeenCalled();
    expect(result.current.error).toContain("access changed");
  });
  it("deletes only explicitly reviewed keys when the captured epoch remains current", async () => {
    const { result } = renderHook(() => useIconExplorer());
    await act(async () => result.current.deleteCustom(["custom-key"], 1));
    expect(f.library.deleteCustom).toHaveBeenCalledWith(["custom-key"]);
  });
  it.each([2, 3])(
    "invalidates displayed import review after library or batched lock/unlock epoch %s",
    async (revision) => {
      f.open.mockResolvedValue("fixture.svg");
      const { result, rerender } = renderHook(() => useIconExplorer());
      await act(async () => result.current.importFile());
      const previousApply = result.current.applyImport;
      expect(result.current.preview).not.toBeNull();
      f.snapshot.revision = revision;
      f.library.accessEpoch = revision;
      rerender();
      expect(result.current.preview).toBeNull();
      expect(f.library.discardImport).toHaveBeenCalledOnce();
      expect(result.current.message).toContain("Choose the file again");
      await act(async () => previousApply({}));
      expect(f.library.applyImport).not.toHaveBeenCalled();
    },
  );
  it("discards private import candidates on cancellation and unmount", async () => {
    f.open.mockResolvedValue("fixture.svg");
    const { result, unmount } = renderHook(() => useIconExplorer());
    await act(async () => result.current.importFile());
    act(() => result.current.dismissImport());
    expect(f.library.discardImport).toHaveBeenCalledOnce();
    await act(async () => result.current.importFile());
    unmount();
    expect(f.library.discardImport).toHaveBeenCalledTimes(2);
    expect(f.library.applyImport).not.toHaveBeenCalled();
  });
  it("does nothing on Open/Save cancellation and reports no success", async () => {
    const { result } = renderHook(() => useIconExplorer());
    await act(async () => {
      await result.current.importFile();
      await result.current.exportIcons(["monitor"], "svg");
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.library.previewImport).not.toHaveBeenCalled();
    expect(result.current.message).toBeNull();
  });
  it.each([
    ["huge.svg", 65537, "64 KiB"],
    ["huge.json", 1048577, "1 MiB"],
  ])("refuses oversized %s before reading", async (file, size, label) => {
    f.open.mockResolvedValue(file);
    f.stat.mockResolvedValue({ isFile: true, size });
    const { result } = renderHook(() => useIconExplorer());
    await act(async () => result.current.importFile());
    expect(f.read).not.toHaveBeenCalled();
    expect(result.current.error).toContain(label);
  });
  it("previews a native selected SVG and only persists after explicit apply", async () => {
    f.open.mockResolvedValue("fixture.svg");
    const { result } = renderHook(() => useIconExplorer());
    await act(async () => result.current.importFile());
    expect(f.library.previewImport).toHaveBeenCalledWith(
      "<svg/>",
      "svg",
      "fixture",
    );
    expect(f.library.applyImport).not.toHaveBeenCalled();
    await act(async () => result.current.applyImport({}));
    expect(f.library.applyImport).toHaveBeenCalledOnce();
    expect(result.current.preview).toBeNull();
  });
  it("retains an import review and displays persistence failures", async () => {
    f.open.mockResolvedValue("fixture.svg");
    f.library.applyImport.mockRejectedValue(new Error("Settings write failed"));
    const { result } = renderHook(() => useIconExplorer());
    await act(async () => result.current.importFile());
    await act(async () => result.current.applyImport({}));
    expect(result.current.preview?.id).toBe("preview");
    expect(result.current.error).toBe("Settings write failed");
  });
  it("writes only the chosen format to the explicitly selected Save path", async () => {
    f.save.mockResolvedValue("chosen.svg");
    const { result } = renderHook(() => useIconExplorer());
    await act(async () => result.current.exportIcons(["monitor"], "svg"));
    expect(f.library.exportSvg).toHaveBeenCalledWith("monitor");
    expect(f.write).toHaveBeenCalledWith("chosen.svg", "<svg/>");
    expect(result.current.message).toContain("Exported 1 icon as SVG");
  });
  it("refuses a late Save after a lock/unlock epoch change even when currently ready", async () => {
    let resolve!: (value: string) => void;
    f.save.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useIconExplorer());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.exportIcons(["monitor"], "svg");
    });
    f.snapshot.revision += 2;
    await act(async () => {
      resolve("late.svg");
      await pending;
    });
    expect(f.write).not.toHaveBeenCalled();
    expect(result.current.error).toContain("access changed");
  });
  it("coalesces rapid repeated file operations and refuses late work after unmount", async () => {
    let resolve!: (value: string) => void;
    f.open.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const { result, unmount } = renderHook(() => useIconExplorer());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.importFile();
      void result.current.importFile();
    });
    expect(f.open).toHaveBeenCalledOnce();
    unmount();
    await act(async () => {
      resolve("late.svg");
      await pending;
    });
    expect(f.read).not.toHaveBeenCalled();
  });
});
