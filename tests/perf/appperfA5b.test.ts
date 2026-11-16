import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SERIAL_FAVORITES_STORAGE_KEY,
  loadSerialFavorites,
  saveSerialFavorites,
  toggleSerialFavorite,
} from "../../src/utils/serial/serialFavorites";

describe("serial favorites parse memo", () => {
  beforeEach(() => localStorage.clear());

  it("parses once per distinct raw value and keeps array identity", () => {
    saveSerialFavorites("c1", [{ kind: "script", id: "a" }]);
    const parse = vi.spyOn(JSON, "parse");
    const first = loadSerialFavorites("c1");
    for (let i = 0; i < 50; i++) loadSerialFavorites("c1");
    expect(parse).toHaveBeenCalledTimes(1);
    expect(loadSerialFavorites("c1")).toBe(first);
    parse.mockRestore();
  });

  it("reparses after any write, including external ones", () => {
    saveSerialFavorites("c1", [{ kind: "script", id: "a" }]);
    expect(loadSerialFavorites("c1")).toHaveLength(1);
    toggleSerialFavorite("c1", { kind: "macro", id: "m" });
    expect(loadSerialFavorites("c1")).toHaveLength(2);
    localStorage.setItem(SERIAL_FAVORITES_STORAGE_KEY, "{}");
    expect(loadSerialFavorites("c1")).toEqual([]);
  });
});

describe("file transfer progress persistence throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does at most one save per 500 ms for a 100-event burst", async () => {
    const { FileTransferService } =
      await import("../../src/utils/file-transfer/fileTransferService");
    const svc = new FileTransferService() as any;
    const save = vi.spyOn(svc, "saveSession").mockResolvedValue(undefined);
    const session = { id: "t1", progress: 0 };
    for (let i = 0; i < 100; i++) svc.scheduleProgressSave(session);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("discovery history reopen", () => {
  it("shows the last stored list on first render of a reopened hook", async () => {
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useDiscoveryScanHistory } =
      await import("../../src/hooks/network/useDiscoveryScanHistory");
    const store = await import("../../src/utils/discovery/scanHistory");
    await store.clearDiscoveryScans();
    const first = renderHook(() => useDiscoveryScanHistory());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    const reopened = renderHook(() => useDiscoveryScanHistory());
    expect(reopened.result.current.loading).toBe(false);
    await store.clearDiscoveryScans();
    expect(store.getCachedDiscoveryScans()).toBeNull();
  });
});
