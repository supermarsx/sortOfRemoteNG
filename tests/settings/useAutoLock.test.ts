/** Policy predicates and actual listener/timer/native-query lifecycle tests. */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  shouldArmAutoLock,
  useAutoLock,
} from "../../src/hooks/settings/useAutoLock";
import type { AutoLockConfig } from "../../src/types/settings/settings";

const mocks = vi.hoisted(() => ({
  unlocked: true,
  lock: vi.fn(),
  getInvoke: vi.fn(),
  isFocused: vi.fn(),
  isMinimized: vi.fn(),
  onFocusChanged: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  focusListeners: new Set<(event: { payload: boolean }) => void>(),
  legacyBlurListeners: new Set<() => void>(),
}));
vi.mock("../../src/hooks/settings/useEncryption", () => ({
  useEncryption: () => ({
    status: { unlocked: mocks.unlocked },
    lock: mocks.lock,
  }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: mocks.getInvoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: mocks.isFocused,
    isMinimized: mocks.isMinimized,
    onFocusChanged: mocks.onFocusChanged,
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let focused = true;
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  focused = true;
  hidden = false;
  mocks.unlocked = true;
  mocks.lock.mockReset().mockResolvedValue(undefined);
  mocks.getInvoke.mockReset().mockResolvedValue(null);
  mocks.isFocused.mockReset().mockResolvedValue(true);
  mocks.isMinimized.mockReset().mockResolvedValue(false);
  mocks.unlisten.mockReset();
  mocks.focusListeners.clear();
  mocks.legacyBlurListeners.clear();
  mocks.onFocusChanged.mockReset().mockImplementation(async (callback) => {
    mocks.focusListeners.add(callback);
    return () => {
      mocks.focusListeners.delete(callback);
      mocks.unlisten();
    };
  });
  mocks.listen.mockReset().mockImplementation(async (_name, callback) => {
    mocks.legacyBlurListeners.add(callback);
    return () => {
      mocks.legacyBlurListeners.delete(callback);
      mocks.unlisten();
    };
  });
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => {
  cleanup();
  document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}
async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
function dom(type: string) {
  act(() => {
    (type === "visibilitychange" ? document : window).dispatchEvent(
      new Event(type),
    );
  });
}
function nativeFocus(value: boolean) {
  act(() => {
    for (const callback of mocks.focusListeners) callback({ payload: value });
    if (!value) for (const callback of mocks.legacyBlurListeners) callback();
  });
}
function native() {
  mocks.getInvoke.mockResolvedValue(vi.fn());
}

function cfg(overrides: Partial<AutoLockConfig> = {}): AutoLockConfig {
  return {
    enabled: true,
    timeoutMinutes: 15,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: true,
    lockOnMinimize: false,
    lockOnBlur: false,
    lockOnVisibilityHidden: false,
    ...overrides,
  };
}

describe("shouldArmAutoLock", () => {
  it("returns false when the encryption state is locked", () => {
    expect(shouldArmAutoLock(cfg(), /* unlocked= */ false)).toBe(false);
  });

  it("returns false when the policy is disabled", () => {
    expect(shouldArmAutoLock(cfg({ enabled: false }), true)).toBe(false);
  });

  it("returns false when no signal is configured", () => {
    expect(
      shouldArmAutoLock(
        cfg({
          lockOnIdle: false,
          lockOnMinimize: false,
          lockOnBlur: false,
          lockOnVisibilityHidden: false,
        }),
        true,
      ),
    ).toBe(false);
  });

  it("arms when only the idle signal is on", () => {
    expect(
      shouldArmAutoLock(
        cfg({
          lockOnIdle: true,
          lockOnMinimize: false,
          lockOnBlur: false,
          lockOnVisibilityHidden: false,
        }),
        true,
      ),
    ).toBe(true);
  });

  it("arms when only the minimise signal is on (idle off)", () => {
    expect(
      shouldArmAutoLock(cfg({ lockOnIdle: false, lockOnMinimize: true }), true),
    ).toBe(true);
  });

  it("arms when only the blur signal is on", () => {
    expect(
      shouldArmAutoLock(cfg({ lockOnIdle: false, lockOnBlur: true }), true),
    ).toBe(true);
  });

  it("arms when only the visibility-hidden fallback is on", () => {
    expect(
      shouldArmAutoLock(
        cfg({ lockOnIdle: false, lockOnVisibilityHidden: true }),
        true,
      ),
    ).toBe(true);
  });

  it("returns false on a missing config object", () => {
    expect(shouldArmAutoLock(undefined, true)).toBe(false);
  });
});

describe("useAutoLock focus and async lifecycle", () => {
  const blur = () => cfg({ lockOnIdle: false, lockOnBlur: true });
  const minimize = () => cfg({ lockOnIdle: false, lockOnMinimize: true });

  it("does not lock when DOM blur transfers focus to an embedded frame", async () => {
    renderHook(() => useAutoLock(blur()));
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.focus();
    expect(document.activeElement).toBe(frame);
    focused = true; // document.hasFocus includes the focused descendant frame.
    dom("blur");
    await advance(250);
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("uses native window focus when the embedded surface leaves DOM focus false", async () => {
    native();
    renderHook(() => useAutoLock(blur()));
    await settle();
    focused = false;
    mocks.isFocused.mockResolvedValue(true);
    dom("blur");
    await advance(250);
    expect(mocks.isFocused).toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("still locks after a genuine OS blur while an iframe remains active", async () => {
    native();
    renderHook(() => useAutoLock(blur()));
    await settle();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.focus();
    focused = false;
    mocks.isFocused.mockResolvedValue(false);
    nativeFocus(false);
    await advance(249);
    expect(mocks.lock).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("blur");
  });

  it("keeps browser-only blur locking and cancels transient focus loss", async () => {
    renderHook(() => useAutoLock(blur()));
    focused = false;
    dom("blur");
    await advance(200);
    focused = true;
    dom("focus");
    await advance(100);
    expect(mocks.lock).not.toHaveBeenCalled();
    focused = false;
    dom("blur");
    await advance(250);
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("blur");
  });

  it("falls back to real document focus if native focus querying fails", async () => {
    native();
    mocks.isFocused.mockRejectedValue(new Error("window API unavailable"));
    renderHook(() => useAutoLock(blur()));
    await settle();
    dom("blur");
    await advance(250);
    expect(mocks.lock).not.toHaveBeenCalled();
    focused = false;
    dom("blur");
    await advance(250);
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("blur");
  });

  it.each(["focus", "unmount", "disable"])(
    "discards a pending blur query after %s",
    async (action) => {
      native();
      const query = deferred<boolean>();
      mocks.isFocused.mockReturnValue(query.promise);
      const hook = renderHook(({ policy }) => useAutoLock(policy), {
        initialProps: { policy: blur() },
      });
      await settle();
      focused = false;
      dom("blur");
      await advance(250);
      if (action === "focus") {
        focused = true;
        nativeFocus(true);
      }
      if (action === "unmount") hook.unmount();
      if (action === "disable")
        hook.rerender({ policy: cfg({ enabled: false }) });
      await act(async () => {
        query.resolve(false);
      });
      expect(mocks.lock).not.toHaveBeenCalled();
    },
  );

  it("locks on confirmed native minimize but not ordinary background focus loss", async () => {
    native();
    renderHook(() => useAutoLock(minimize()));
    await settle();
    nativeFocus(false);
    await settle();
    expect(mocks.lock).not.toHaveBeenCalled();
    mocks.isMinimized.mockResolvedValue(true);
    nativeFocus(false);
    await settle();
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("minimize");
  });

  it.each(["native-focus", "dom-focus", "visible", "unmount", "disable"])(
    "discards a pending minimize query after %s",
    async (action) => {
      native();
      const query = deferred<boolean>();
      mocks.isMinimized.mockReturnValue(query.promise);
      const hook = renderHook(({ policy }) => useAutoLock(policy), {
        initialProps: { policy: minimize() },
      });
      await settle();
      focused = false;
      nativeFocus(false);
      await settle();
      if (action === "native-focus") nativeFocus(true);
      if (action === "dom-focus") dom("focus");
      if (action === "visible") {
        hidden = false;
        dom("visibilitychange");
      }
      if (action === "unmount") hook.unmount();
      if (action === "disable")
        hook.rerender({ policy: cfg({ enabled: false }) });
      await act(async () => {
        query.resolve(true);
      });
      expect(mocks.lock).not.toHaveBeenCalled();
    },
  );

  it("does not lock from an older minimize query superseded by a newer check", async () => {
    native();
    const old = deferred<boolean>();
    mocks.isMinimized.mockReturnValueOnce(old.promise).mockResolvedValue(false);
    renderHook(() => useAutoLock(minimize()));
    await settle();
    nativeFocus(false);
    await settle();
    nativeFocus(false);
    await settle();
    await act(async () => {
      old.resolve(true);
    });
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("uses hidden visibility as the minimize fallback when native state is unavailable", async () => {
    native();
    mocks.isMinimized.mockRejectedValue(new Error("unsupported"));
    renderHook(() => useAutoLock(minimize()));
    await settle();
    hidden = true;
    nativeFocus(false);
    await settle();
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("minimize");
  });

  it("does not mistake hidden visibility for minimize when native says it is restored", async () => {
    native();
    renderHook(() => useAutoLock(minimize()));
    await settle();
    hidden = true;
    dom("visibilitychange");
    await settle();
    expect(mocks.isMinimized).toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("retains the minimize visibility fallback outside a native runtime", async () => {
    renderHook(() => useAutoLock(minimize()));
    hidden = true;
    dom("visibilitychange");
    await settle();
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("minimize");
  });

  it("ignores a queued native event delivered after unmount", async () => {
    native();
    renderHook(() =>
      useAutoLock(
        cfg({ lockOnIdle: false, lockOnBlur: true, lockOnMinimize: true }),
      ),
    );
    await settle();
    const callback = [...mocks.focusListeners][0];
    expect(callback).toBeTypeOf("function");
    cleanup();
    focused = false;
    hidden = true;
    mocks.isFocused.mockResolvedValue(false);
    mocks.isMinimized.mockResolvedValue(true);
    act(() => callback({ payload: false }));
    await advance(1000);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("immediately disposes native listeners whose registration finishes after unmount", async () => {
    native();
    const registration = deferred<() => void>();
    mocks.onFocusChanged.mockReturnValue(registration.promise);
    mocks.listen.mockReturnValue(registration.promise);
    const hook = renderHook(() => useAutoLock(minimize()));
    await settle();
    hook.unmount();
    await act(async () => {
      registration.resolve(mocks.unlisten);
    });
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("does not register native listeners after pending initialization is disposed", async () => {
    const initialization = deferred<() => Promise<void>>();
    mocks.getInvoke.mockReturnValue(initialization.promise);
    const hook = renderHook(() => useAutoLock(minimize()));
    hook.unmount();
    await act(async () => {
      initialization.resolve(async () => {});
    });
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.onFocusChanged).not.toHaveBeenCalled();
  });

  it("does not overlap lock requests across signals or a policy rerender", async () => {
    const request = deferred<void>();
    mocks.lock.mockReturnValue(request.promise);
    const policy = cfg({
      lockOnBlur: true,
      lockOnVisibilityHidden: true,
      timeoutMinutes: 0.01,
    });
    const hook = renderHook(({ value }) => useAutoLock(value), {
      initialProps: { value: policy },
    });
    hidden = true;
    dom("visibilitychange");
    focused = false;
    dom("blur");
    hook.rerender({ value: { ...policy, timeoutMinutes: 0.02 } });
    dom("visibilitychange");
    await advance(1200);
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("visibility-hidden");
    await act(async () => {
      request.resolve();
    });
  });

  it("allows a later event to retry a rejected lock", async () => {
    mocks.lock
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValue(undefined);
    renderHook(() =>
      useAutoLock(cfg({ lockOnIdle: false, lockOnVisibilityHidden: true })),
    );
    hidden = true;
    dom("visibilitychange");
    await settle();
    dom("visibilitychange");
    await settle();
    expect(mocks.lock).toHaveBeenCalledTimes(2);
  });

  it("retains idle locking and resets it only on the existing activity events", async () => {
    renderHook(() => useAutoLock(cfg({ timeoutMinutes: 0.01 })));
    await advance(400);
    dom("pointerdown");
    await advance(400);
    expect(mocks.lock).not.toHaveBeenCalled();
    await advance(200);
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("idle");
  });

  it("does not reset idle time on equivalent policy objects or focus events", async () => {
    const policy = cfg({ timeoutMinutes: 0.01, lockOnBlur: true });
    const hook = renderHook(({ value }) => useAutoLock(value), {
      initialProps: { value: policy },
    });
    await advance(400);
    hook.rerender({ value: { ...policy } });
    dom("focus");
    await advance(200);
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("idle");
  });

  it("stops pending work when encryption becomes locked", async () => {
    const hook = renderHook(() =>
      useAutoLock(cfg({ timeoutMinutes: 0.01, lockOnBlur: true })),
    );
    focused = false;
    dom("blur");
    mocks.unlocked = false;
    hook.rerender();
    await advance(1000);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
});
