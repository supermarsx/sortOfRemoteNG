import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { useAppDocumentsStore } from "../../src/hooks/documents/useAppDocumentsStore";
import {
  APP_DOCUMENTS_OWNER_ID,
  APP_DOCUMENTS_STORE_KEY,
} from "../../src/utils/documents/appDocumentsStore";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../src/utils/storage/appDataJsonStore";
import {
  ENCRYPTION_EVENT_LOCKED,
  ENCRYPTION_EVENT_UNLOCKED,
} from "../../src/types/encryption/encryption";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { fixture } from "./fixtures";

const native = vi.hoisted(() => ({
  settingsReady: true as boolean | undefined,
  available: true,
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settingsReady: native.settingsReady }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (native.available ? native.invoke : null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => native.listen(...args),
}));
let handlers: Map<string, () => void>;
let unlisteners: ReturnType<typeof vi.fn>[];
const unlocked = { schemaVersion: 2, unlocked: true };
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  native.settingsReady = true;
  native.available = true;
  handlers = new Map();
  unlisteners = [];
  native.invoke.mockReset().mockImplementation(async (command) => {
    if (command === "encryption_status") return unlocked;
    if (command === "read_app_data") return null;
    throw new Error(`Unexpected command ${command}`);
  });
  native.listen
    .mockReset()
    .mockImplementation(async (event: string, callback: () => void) => {
      handlers.set(event, callback);
      const off = vi.fn(() => {
        if (handlers.get(event) === callback) handlers.delete(event);
      });
      unlisteners.push(off);
      return off;
    });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("app-wide document access lifecycle", () => {
  it("waits for settings and desktop listeners without reading or writing documents", async () => {
    native.settingsReady = false;
    const { result, rerender } = renderHook(() => useAppDocumentsStore());
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("encryption_status"),
    );
    expect(result.current).toBeUndefined();
    expect(native.listen).toHaveBeenCalledTimes(2);
    native.settingsReady = true;
    rerender();
    await waitFor(() =>
      expect(result.current?.scope).toMatchObject({
        kind: "app",
        databaseId: APP_DOCUMENTS_OWNER_ID,
      }),
    );
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("encryption_status");
    // There is deliberately no ConnectionContext provider/database availability.
    expect(await result.current!.read(result.current!.scope!)).toEqual(
      emptyDatabaseDocuments(),
    );
  });

  it("does not expose a scope before every access listener is installed", async () => {
    let finish!: (off: () => void) => void;
    native.listen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(result.current).toBeUndefined();
    await act(async () => finish(vi.fn()));
    await waitFor(() => expect(result.current?.scope?.kind).toBe("app"));
  });

  it.each([false, undefined])(
    "requires explicit settings readiness (%s)",
    async (ready) => {
      native.settingsReady = ready;
      const { result } = renderHook(() => useAppDocumentsStore());
      await waitFor(() =>
        expect(native.invoke).toHaveBeenCalledWith("encryption_status"),
      );
      expect(result.current).toBeUndefined();
    },
  );

  it("revokes immediately on native lock and gives unlock a fresh epoch", async () => {
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
    const old = result.current!,
      scope = old.scope!;
    act(() => handlers.get(ENCRYPTION_EVENT_LOCKED)!());
    expect(result.current).toBeUndefined();
    expect(old.scope).toBeNull();
    await expect(old.read(scope)).rejects.toThrow(/access changed/i);
    await expect(
      old.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...fixture(),
        revision: 1,
      }),
    ).rejects.toThrow(/access changed/i);
    act(() => handlers.get(ENCRYPTION_EVENT_UNLOCKED)!());
    await waitFor(() =>
      expect(result.current?.scope?.generation).toBeGreaterThan(
        scope.generation,
      ),
    );
    await expect(result.current!.read(scope)).rejects.toThrow(
      /access changed/i,
    );
    expect(
      native.invoke.mock.calls.every(
        ([command]) => command === "encryption_status",
      ),
    ).toBe(true);
  });

  it("revokes old methods on settings loss and never resurrects their scope", async () => {
    const { result, rerender } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
    const old = result.current!,
      scope = old.scope!;
    native.settingsReady = false;
    rerender();
    expect(result.current).toBeUndefined();
    await expect(old.read(scope)).rejects.toThrow(/access changed/i);
    native.settingsReady = true;
    rerender();
    await waitFor(() =>
      expect(result.current?.scope?.generation).toBeGreaterThan(
        scope.generation,
      ),
    );
    await expect(old.read(scope)).rejects.toThrow(/access changed/i);
  });

  it("does not unlock a locked scope just because settings become ready", async () => {
    const { result, rerender } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
    act(() => handlers.get(ENCRYPTION_EVENT_LOCKED)!());
    native.settingsReady = false;
    rerender();
    native.settingsReady = true;
    rerender();
    expect(result.current).toBeUndefined();
  });

  it("starts unavailable for an already locked desktop with plaintext settings", async () => {
    native.invoke.mockResolvedValue({
      ...unlocked,
      unlocked: false,
      settingsEncryptedOnDisk: false,
    });
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("encryption_status"),
    );
    expect(result.current).toBeUndefined();
    act(() => handlers.get(ENCRYPTION_EVENT_UNLOCKED)!());
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
  });

  it("allows an unconfigured desktop to use the existing app storage policy", async () => {
    native.invoke.mockResolvedValue({ schemaVersion: 0, unlocked: false });
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
  });

  it("keeps lock events authoritative over an older pending status response", async () => {
    let finish!: (value: unknown) => void;
    native.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => handlers.get(ENCRYPTION_EVENT_LOCKED)!());
    await act(async () => finish(unlocked));
    expect(result.current).toBeUndefined();
  });

  it("rejects pending document reads after lock without publishing their data", async () => {
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
    let finish!: (value: string) => void;
    native.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = result.current!;
    const pending = old.read(old.scope!);
    const rejected = expect(pending).rejects.toThrow(/access changed/i);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => handlers.get(ENCRYPTION_EVENT_LOCKED)!());
    finish(JSON.stringify(fixture()));
    await rejected;
    expect(result.current).toBeUndefined();
  });

  it("revokes retained methods on unmount and uses distinct epochs after remount", async () => {
    const first = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(first.result.current?.scope).toBeTruthy());
    const old = first.result.current!,
      scope = old.scope!;
    first.unmount();
    expect(unlisteners.every((off) => off.mock.calls.length === 1)).toBe(true);
    await expect(old.read(scope)).rejects.toThrow(/access changed/i);
    const second = renderHook(() => useAppDocumentsStore());
    await waitFor(() =>
      expect(second.result.current?.scope?.generation).toBeGreaterThan(
        scope.generation,
      ),
    );
    await expect(second.result.current!.read(scope)).rejects.toThrow(
      /access changed/i,
    );
  });

  it("releases a listener that finishes registering after unmount", async () => {
    let finish!: (off: () => void) => void;
    native.listen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    unmount();
    const off = vi.fn();
    await act(async () => finish(off));
    expect(off).toHaveBeenCalledOnce();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("works through React StrictMode effect cleanup and replay", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { result, unmount } = renderHook(() => useAppDocumentsStore(), {
      wrapper,
    });
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
    const old = result.current!,
      scope = old.scope!;
    unmount();
    await expect(old.read(scope)).rejects.toThrow(/access changed/i);
  });

  it("notifies app-key changes without invalidating access or reading database data", async () => {
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(result.current?.scope).toBeTruthy());
    const before = result.current!,
      scope = before.scope!;
    act(() =>
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: "unrelated" },
        }),
      ),
    );
    expect(result.current?.changeRevision).toBe(before.changeRevision);
    act(() =>
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: APP_DOCUMENTS_STORE_KEY },
        }),
      ),
    );
    expect(result.current?.changeRevision).toBe(before.changeRevision + 1);
    expect(result.current?.scope).toEqual(scope);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("encryption_status");
  });

  it("stays unavailable outside desktop and does not install listeners", async () => {
    native.available = false;
    const { result } = renderHook(() => useAppDocumentsStore());
    await act(async () => {});
    expect(result.current).toBeUndefined();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listen).not.toHaveBeenCalled();
  });

  it("fails closed if listener installation fails", async () => {
    native.listen.mockRejectedValueOnce(new Error("listener unavailable"));
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() => expect(native.listen).toHaveBeenCalledOnce());
    expect(result.current).toBeUndefined();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("fails closed if native lock status cannot be checked", async () => {
    native.invoke.mockRejectedValueOnce(new Error("status unavailable"));
    const { result } = renderHook(() => useAppDocumentsStore());
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("encryption_status"),
    );
    expect(result.current).toBeUndefined();
  });
});
