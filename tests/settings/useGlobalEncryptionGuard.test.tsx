import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalEncryptionGuard } from "../../src/hooks/settings/useGlobalEncryptionGuard";
import {
  executeMainGlobalLock,
  executeGlobalLock,
  GLOBAL_LOCK_REQUEST,
} from "../../src/utils/security/globalEncryptionLock";
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../src/types/encryption/encryption";
import { withDatabaseMutation } from "../../src/utils/connection/databaseActions";
import { clearGlobalLockViews } from "../../src/utils/security/clearGlobalLockViews";
const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  invalidate: vi.fn(),
  invoke: vi.fn(),
  emitTo: vi.fn(),
  policy: { enabled: true, lockOnIdle: true, timeoutMinutes: 15 },
  status: {
    unlocked: true,
    vaultHasMasterDek: true,
    passwordWrapPresent: false,
  },
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settingsReady: true,
    settings: { autoLock: mocks.policy },
  }),
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
  mocks.policy = { enabled: true, lockOnIdle: true, timeoutMinutes: 15 };
  mocks.status = {
    unlocked: true,
    vaultHasMasterDek: true,
    passwordWrapPresent: false,
  };
  mocks.invoke.mockResolvedValue(undefined);
});
describe("Global storage lock guard", () => {
  it.each(["queued", "flush", "prepare", "final-flush"])(
    "cancels automatic locking disabled during %s before invalidating access",
    async (phase) => {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = vi.fn();
      let flushes = 0;
      const pause = () => {
        entered();
        return blocked;
      };
      const clearViews = vi.fn();
      const native = vi.fn();
      const { rerender } = renderHook(() =>
        useGlobalEncryptionGuard({
          primary: true,
          flushCurrent: async () => {
            flushes++;
            if (
              (phase === "flush" && flushes === 1) ||
              (phase === "final-flush" && flushes === 2)
            )
              await pause();
          },
          prepareViews: async () => {
            if (phase === "prepare") await pause();
          },
          clearViews,
        }),
      );
      const ahead =
        phase === "queued"
          ? withDatabaseMutation(manager as never, pause)
          : Promise.resolve();
      const pending = executeGlobalLock("idle", native);
      await waitFor(() => expect(entered).toHaveBeenCalledOnce());
      mocks.policy = { ...mocks.policy, enabled: false };
      rerender();
      await act(async () => {
        release();
        await ahead;
        await pending;
      });
      expect(mocks.invalidate).not.toHaveBeenCalled();
      expect(clearViews).not.toHaveBeenCalled();
      expect(native).not.toHaveBeenCalled();
    },
  );
  it.each(["manual", "shortcut"] as const)(
    "keeps %s locking unconditional with auto-lock disabled",
    async (reason) => {
      mocks.policy.enabled = false;
      const native = vi.fn();
      renderHook(() =>
        useGlobalEncryptionGuard({ primary: true, clearViews: vi.fn() }),
      );
      await act(async () => executeGlobalLock(reason, native, () => false));
      expect(native).toHaveBeenCalledOnce();
    },
  );
  it("cancels an automatic trigger retired while waiting even if policy is enabled again", async () => {
    const native = vi.fn();
    renderHook(() =>
      useGlobalEncryptionGuard({ primary: true, clearViews: vi.fn() }),
    );
    await act(async () => executeGlobalLock("idle", native, () => false));
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });
  it("finishes a committed lock if policy changes after access invalidation", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clearViews = vi.fn(() => blocked);
    const native = vi.fn();
    const { rerender } = renderHook(() =>
      useGlobalEncryptionGuard({ primary: true, clearViews }),
    );
    const pending = executeGlobalLock("idle", native);
    await waitFor(() => expect(clearViews).toHaveBeenCalledOnce());
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    mocks.policy = { ...mocks.policy, enabled: false };
    rerender();
    await act(async () => {
      release();
      await pending;
    });
    expect(native).toHaveBeenCalledOnce();
  });
  it("cancels detached automatic requests using the primary's current policy", async () => {
    mocks.policy.enabled = false;
    const clearViews = vi.fn();
    renderHook(() => useGlobalEncryptionGuard({ primary: true, clearViews }));
    await waitFor(() =>
      expect(mocks.events.has(GLOBAL_LOCK_REQUEST)).toBe(true),
    );
    await act(async () =>
      mocks.events.get(GLOBAL_LOCK_REQUEST)?.({
        payload: {
          requestId: "disabled-auto",
          windowLabel: "detached-1",
          reason: "idle",
        },
      }),
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(clearViews).not.toHaveBeenCalled();
    expect(mocks.emitTo).toHaveBeenCalledWith(
      "detached-1",
      expect.any(String),
      {
        requestId: "disabled-auto",
        error: undefined,
      },
    );
  });
  it("clears all old views when the lock lifecycle is still current", async () => {
    const views = {
      clearDialogs: vi.fn(),
      closeSessions: vi.fn().mockResolvedValue(undefined),
      closeDatabase: vi.fn().mockResolvedValue(undefined),
      clearRows: vi.fn(),
      clearSessions: vi.fn(),
    };
    await clearGlobalLockViews(() => true, views);
    expect(views.clearRows).toHaveBeenCalledTimes(2);
    expect(views.clearSessions).toHaveBeenCalledOnce();
    expect(views.closeDatabase).toHaveBeenCalledOnce();
  });
  it.each(["sessions", "database"])(
    "preserves replacement views when old %s cleanup finishes after unlock",
    async (delayed) => {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let rows = ["old"];
      let sessions = ["old"];
      let cleanup: Promise<void> | undefined;
      renderHook(() =>
        useGlobalEncryptionGuard({
          clearViews: (isCurrent) => {
            cleanup = clearGlobalLockViews(isCurrent, {
              clearDialogs: vi.fn(),
              closeSessions: () =>
                delayed === "sessions" ? blocked : Promise.resolve(),
              closeDatabase: () =>
                delayed === "database" ? blocked : Promise.resolve(),
              clearRows: () => {
                rows = [];
              },
              clearSessions: () => {
                sessions = [];
              },
            });
            return cleanup;
          },
        }),
      );
      await waitFor(() =>
        expect(mocks.events.has(ENCRYPTION_EVENT_UNLOCKED)).toBe(true),
      );
      act(() => mocks.events.get(ENCRYPTION_EVENT_LOCKED)?.({ payload: {} }));
      expect(rows).toEqual([]);
      act(() => mocks.events.get(ENCRYPTION_EVENT_UNLOCKED)?.({ payload: {} }));
      rows = ["replacement"];
      sessions = ["replacement"];
      await act(async () => {
        release();
        await cleanup;
      });
      expect(rows).toEqual(["replacement"]);
      expect(sessions).toEqual(["replacement"]);
    },
  );
  it("does not relock the UI when an old native command completes after unlock", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = vi.fn(() => blocked);
    const clearViews = vi.fn();
    const { result } = renderHook(() =>
      useGlobalEncryptionGuard({ primary: true, clearViews }),
    );
    await waitFor(() =>
      expect(mocks.events.has(ENCRYPTION_EVENT_UNLOCKED)).toBe(true),
    );
    const pending = executeGlobalLock("manual", native);
    await waitFor(() => expect(native).toHaveBeenCalledOnce());
    act(() => mocks.events.get(ENCRYPTION_EVENT_LOCKED)?.({ payload: {} }));
    act(() => mocks.events.get(ENCRYPTION_EVENT_UNLOCKED)?.({ payload: {} }));
    const clears = clearViews.mock.calls.length;
    await act(async () => {
      release();
      await pending;
    });
    expect(result.current).toBe(false);
    expect(clearViews).toHaveBeenCalledTimes(clears);
  });
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
