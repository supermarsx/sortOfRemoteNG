import React, { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOriginBrowserPrewarm } from "../../src/hooks/protocol/useOriginBrowserPrewarm";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { Connection } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  capture: vi.fn(),
  current: vi.fn(),
  assertCurrent: vi.fn(),
  access: () => {},
  database: () => {},
  close: () => {},
  onCloseRequested: vi.fn(),
  label: "main",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: mocks.label,
    onCloseRequested: mocks.onCloseRequested,
  }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: mocks.current,
      captureOriginBrowserOwnerProof: mocks.capture,
      onCurrentDatabaseChange: (callback: () => void) => {
        mocks.database = callback;
        return () => {
          mocks.database = () => {};
        };
      },
    }),
  },
  onDatabaseAccessChange: (callback: () => void) => {
    mocks.access = callback;
    return () => {
      mocks.access = () => {};
    };
  },
}));

type Options = Parameters<typeof useOriginBrowserPrewarm>[0];
let callbacks: Map<number, IdleRequestCallback>;
let frames: Map<number, FrameRequestCallback>;
let nextIdle: number;
const website = { id: "saved", protocol: "https" } as Connection;
const settings = (patch: object = {}) =>
  ({
    webBrowser: normalizeWebBrowserSettings(patch),
  }) as GlobalSettings;
function options(patch: Partial<Options> = {}): Options {
  return {
    appReady: true,
    settingsReady: true,
    locked: false,
    closing: { current: false },
    connections: [website],
    settings: settings(),
    ...patch,
  };
}
async function idle(didTimeout = false) {
  await act(async () => {
    vi.advanceTimersByTime(2_000);
    const queued = [...callbacks.values()];
    callbacks.clear();
    for (const callback of queued)
      callback({ didTimeout, timeRemaining: () => (didTimeout ? 0 : 20) });
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  callbacks = new Map();
  frames = new Map();
  nextIdle = 0;
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn((callback: IdleRequestCallback) => {
      const id = ++nextIdle;
      callbacks.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelIdleCallback",
    vi.fn((id: number) => callbacks.delete(id)),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextIdle;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  mocks.label = "main";
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockResolvedValue(undefined);
  mocks.current.mockReturnValue({ id: "db" });
  mocks.assertCurrent.mockImplementation(() => {});
  mocks.capture.mockImplementation(() => ({
    ownerDatabaseId: "db",
    expectedSecurityRevision: "revision",
    sourceSessionId: "native-unlock",
    assertCurrent: mocks.assertCurrent,
  }));
  mocks.onCloseRequested.mockImplementation((callback: () => void) => {
    mocks.close = callback;
    return Promise.resolve(() => {});
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("idle native engine prewarm", () => {
  it("waits for ready settings, app readiness and idle without creating a connection/session", async () => {
    const initial = options({ appReady: false, settingsReady: false });
    const { rerender } = renderHook(useOriginBrowserPrewarm, {
      initialProps: initial,
    });
    await idle();
    expect(mocks.invoke).not.toHaveBeenCalled();
    rerender({ ...initial, appReady: true });
    await idle();
    expect(mocks.invoke).not.toHaveBeenCalled();
    rerender({ ...initial, appReady: true, settingsReady: true });
    expect(mocks.invoke).not.toHaveBeenCalled();
    await idle();
    expect(mocks.invoke.mock.calls).toEqual([
      [
        "origin_browser_prewarm",
        {
          request: {
            ownerDatabaseId: "db",
            connectionId: "saved",
            expectedSecurityRevision: "revision",
            sourceSessionId: "native-unlock",
          },
        },
      ],
    ]);
    expect(initial.connections).toEqual([website]);
    expect(website).toEqual({ id: "saved", protocol: "https" });
  });

  it.each([
    ["locked", { locked: true }],
    ["disabled", { settings: settings({ idlePrewarmEnabled: false }) }],
    ["legacy engine", { settings: settings({ engine: "legacy" }) }],
    [
      "malformed settings",
      {
        settings: {
          webBrowser: { idlePrewarmEnabled: "yes" },
        } as unknown as GlobalSettings,
      },
    ],
    [
      "no saved website",
      { connections: [{ id: "ssh", protocol: "ssh" } as Connection] },
    ],
    ["website group", { connections: [{ ...website, isGroup: true }] }],
    ["closing", { closing: { current: true } }],
  ] as const)("does not prewarm when %s", async (_, patch) => {
    renderHook(useOriginBrowserPrewarm, { initialProps: options(patch) });
    await idle();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("waits for a real saved owner proof and reacts to unlock", async () => {
    mocks.capture.mockImplementation(() => {
      throw new Error("locked");
    });
    renderHook(useOriginBrowserPrewarm, { initialProps: options() });
    await idle();
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.capture.mockReturnValue({
      ownerDatabaseId: "db",
      expectedSecurityRevision: "revision",
      sourceSessionId: "native-unlock",
      assertCurrent: mocks.assertCurrent,
    });
    act(() => mocks.access());
    await idle();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["no database", "other window", "web preview"])(
    "skips %s",
    async (reason) => {
      if (reason === "no database") mocks.current.mockReturnValue(null);
      if (reason === "other window") mocks.label = "detached";
      if (reason === "web preview") mocks.isTauri.mockReturnValue(false);
      renderHook(useOriginBrowserPrewarm, { initialProps: options() });
      await idle();
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it("coalesces StrictMode, rerenders and repeated owner notifications", async () => {
    const initial = options();
    const { rerender } = renderHook(useOriginBrowserPrewarm, {
      initialProps: initial,
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    act(() => {
      mocks.database();
      mocks.access();
    });
    rerender(initial);
    await idle();
    act(() => {
      mocks.database();
      mocks.access();
    });
    await idle();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["lock", "disable", "close", "unmount", "database change"])(
    "cancels queued idle work on %s even if its callback runs late",
    async (reason) => {
      const initial = options();
      const { rerender, unmount } = renderHook(useOriginBrowserPrewarm, {
        initialProps: initial,
      });
      act(() => vi.advanceTimersByTime(2_000));
      const late = [...callbacks.values()][0];
      act(() => {
        if (reason === "lock") rerender({ ...initial, locked: true });
        if (reason === "disable")
          rerender({
            ...initial,
            settings: settings({ idlePrewarmEnabled: false }),
          });
        if (reason === "close") mocks.close();
        if (reason === "unmount") unmount();
        if (reason === "database change") {
          mocks.current.mockReturnValue(null);
          mocks.database();
        }
      });
      act(() => {
        late({ didTimeout: false, timeRemaining: () => 20 });
      });
      await idle();
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it.each(["lock", "disable", "close", "pagehide", "unmount"])(
    "cancels already dispatched native work on %s",
    async (reason) => {
      mocks.invoke.mockImplementation(() => new Promise(() => {}));
      const initial = options();
      const { rerender, unmount } = renderHook(useOriginBrowserPrewarm, {
        initialProps: initial,
      });
      await idle();
      act(() => {
        if (reason === "lock") {
          mocks.capture.mockImplementation(() => {
            throw new Error("locked");
          });
          mocks.access();
        }
        if (reason === "disable")
          rerender({
            ...initial,
            settings: settings({ idlePrewarmEnabled: false }),
          });
        if (reason === "close") mocks.close();
        if (reason === "pagehide") window.dispatchEvent(new Event("pagehide"));
        if (reason === "unmount") unmount();
      });
      expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
        "origin_browser_prewarm",
        "origin_browser_cancel_prewarm",
      ]);
    },
  );

  it("does not retry failures or surface them into shell initialization", async () => {
    mocks.invoke.mockRejectedValue(new Error("native runtime unavailable"));
    const initial = options();
    const { rerender } = renderHook(useOriginBrowserPrewarm, {
      initialProps: initial,
    });
    await idle();
    for (let i = 0; i < 5; i++) {
      act(() => {
        mocks.access();
        mocks.database();
      });
      rerender({ ...initial, connections: [...initial.connections] });
      await idle();
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("rechecks the captured proof immediately before native dispatch", async () => {
    renderHook(useOriginBrowserPrewarm, { initialProps: options() });
    mocks.assertCurrent.mockImplementation(() => {
      throw new Error("expired");
    });
    await idle();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("retries busy idle deadlines at most three times without forcing native startup", async () => {
    renderHook(useOriginBrowserPrewarm, { initialProps: options() });
    for (let i = 0; i < 5; i++) await idle(true);
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("prewarms once when a later bounded idle opportunity is available", async () => {
    renderHook(useOriginBrowserPrewarm, { initialProps: options() });
    await idle(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await idle();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("falls back to a frame followed by a cancellable task delay", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    renderHook(useOriginBrowserPrewarm, { initialProps: options() });
    await idle();
    expect(mocks.invoke).not.toHaveBeenCalled();
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(249));
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(["lock", "disable", "close", "hidden", "stale owner"])(
    "cancels fallback work on %s after a frame",
    async (reason) => {
      vi.stubGlobal("requestIdleCallback", undefined);
      const initial = options();
      const { rerender } = renderHook(useOriginBrowserPrewarm, {
        initialProps: initial,
      });
      await idle();
      act(() => {
        for (const callback of frames.values()) callback(0);
        frames.clear();
      });
      act(() => {
        if (reason === "lock") rerender({ ...initial, locked: true });
        if (reason === "disable")
          rerender({
            ...initial,
            settings: settings({ idlePrewarmEnabled: false }),
          });
        if (reason === "close") mocks.close();
        if (reason === "hidden")
          vi.spyOn(document, "visibilityState", "get").mockReturnValue(
            "hidden",
          );
        if (reason === "stale owner")
          mocks.assertCurrent.mockImplementation(() => {
            throw new Error("locked");
          });
      });
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(mocks.invoke).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    },
  );

  it("cancels a pending fallback frame on unmount", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const { unmount } = renderHook(useOriginBrowserPrewarm, {
      initialProps: options(),
    });
    await idle();
    const late = [...frames.values()][0];
    unmount();
    expect(frames.size).toBe(0);
    act(() => {
      late(0);
      vi.advanceTimersByTime(1_000);
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
