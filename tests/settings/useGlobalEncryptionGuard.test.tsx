import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalEncryptionGuard } from "../../src/hooks/settings/useGlobalEncryptionGuard";
import {
  executeMainGlobalLock,
  GLOBAL_LOCK_REQUEST,
} from "../../src/utils/security/globalEncryptionLock";
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../src/types/encryption/encryption";
const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  invalidate: vi.fn(),
  invoke: vi.fn(),
  emitTo: vi.fn(),
  status: {
    unlocked: true,
    vaultHasMasterDek: true,
    passwordWrapPresent: false,
  },
}));
vi.mock("../../src/hooks/settings/useEncryption", () => ({
  useEncryption: () => ({ status: mocks.status }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => manager },
}));
const manager = { invalidatePendingDatabaseOperations: mocks.invalidate };
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    mocks.events.set(name, callback);
    return () => {
      mocks.events.delete(name);
    };
  }),
  emitTo: mocks.emitTo,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.clear();
  mocks.status = {
    unlocked: true,
    vaultHasMasterDek: true,
    passwordWrapPresent: false,
  };
  mocks.invoke.mockResolvedValue(undefined);
});
describe("Global storage lock guard", () => {
  it("does not let deferred locked status undo a newer unlock event", async () => {
    const { result, rerender } = renderHook(() =>
      useGlobalEncryptionGuard({
        clearViews: vi.fn().mockResolvedValue(undefined),
      }),
    );
    await waitFor(() =>
      expect(mocks.events.has(ENCRYPTION_EVENT_UNLOCKED)).toBe(true),
    );
    act(() => mocks.events.get(ENCRYPTION_EVENT_LOCKED)?.({ payload: {} }));
    mocks.status = { ...mocks.status, unlocked: false };
    rerender();
    expect(result.current).toBe(true);
    act(() => mocks.events.get(ENCRYPTION_EVENT_UNLOCKED)?.({ payload: {} }));
    rerender();
    expect(result.current).toBe(false);
    mocks.status = { ...mocks.status, unlocked: true };
    rerender();
    expect(result.current).toBe(false);
    mocks.status = { ...mocks.status, unlocked: false };
    rerender();
    expect(result.current).toBe(false);
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
  it("fences synchronously and blocks the UI on a native event until explicit unlock", async () => {
    const clearViews = vi.fn().mockResolvedValue(undefined);
    const { result, rerender, unmount } = renderHook(() =>
      useGlobalEncryptionGuard({ clearViews }),
    );
    await waitFor(() =>
      expect(mocks.events.has(ENCRYPTION_EVENT_LOCKED)).toBe(true),
    );
    act(() => mocks.events.get(ENCRYPTION_EVENT_LOCKED)?.({ payload: {} }));
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(clearViews).toHaveBeenCalledOnce();
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      clearViews.mock.invocationCallOrder[0],
    );
    expect(result.current).toBe(true);
    mocks.status = { ...mocks.status };
    rerender();
    expect(result.current).toBe(true);
    act(() => mocks.events.get(ENCRYPTION_EVENT_UNLOCKED)?.({ payload: {} }));
    expect(result.current).toBe(false);
    unmount();
    expect(mocks.events.size).toBe(0);
  });
  it("holds flush and sensitive-view shutdown before invalidation and native lock", async () => {
    const order: string[] = [];
    mocks.invalidate.mockImplementation(() => order.push("invalidate"));
    const flushCurrent = vi.fn(async () => {
      order.push("flush");
    });
    const prepareViews = vi.fn(async () => {
      order.push("prepare");
    });
    const clearViews = vi.fn(async () => {
      order.push("clear");
    });
    renderHook(() =>
      useGlobalEncryptionGuard({
        primary: true,
        flushCurrent,
        prepareViews,
        clearViews,
      }),
    );
    await act(async () =>
      executeMainGlobalLock(async () => {
        order.push("native");
      }),
    );
    expect(order.slice(0, 6)).toEqual([
      "flush",
      "prepare",
      "flush",
      "invalidate",
      "clear",
      "native",
    ]);
  });
  it("does not drop keys or call native lock when a pending save fails", async () => {
    const clearViews = vi.fn();
    const nativeLock = vi.fn();
    renderHook(() =>
      useGlobalEncryptionGuard({
        primary: true,
        flushCurrent: vi.fn().mockRejectedValue(new Error("Save failed")),
        clearViews,
      }),
    );
    await expect(executeMainGlobalLock(nativeLock)).rejects.toThrow(
      "Save failed",
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(clearViews).not.toHaveBeenCalled();
    expect(nativeLock).not.toHaveBeenCalled();
  });
  it("deduplicates matching detached requests and acknowledges the requesting window", async () => {
    renderHook(() =>
      useGlobalEncryptionGuard({
        primary: true,
        flushCurrent: vi.fn().mockResolvedValue(undefined),
        clearViews: vi.fn().mockResolvedValue(undefined),
      }),
    );
    await waitFor(() =>
      expect(mocks.events.has(GLOBAL_LOCK_REQUEST)).toBe(true),
    );
    const payload = {
      requestId: "request-1",
      windowLabel: "detached-1",
      reason: "manual",
    };
    await act(async () => {
      mocks.events.get(GLOBAL_LOCK_REQUEST)?.({ payload });
      mocks.events.get(GLOBAL_LOCK_REQUEST)?.({ payload });
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("encryption_lock", {
      reason: "manual",
    });
    expect(mocks.emitTo).toHaveBeenCalledWith(
      "detached-1",
      expect.any(String),
      { requestId: "request-1", error: undefined },
    );
  });
});
