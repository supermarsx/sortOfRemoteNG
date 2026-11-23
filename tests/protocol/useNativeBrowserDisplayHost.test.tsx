import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  NATIVE_DISPLAY_COMMAND_EVENT,
  NATIVE_DISPLAY_FAILED_MESSAGE,
  NATIVE_DISPLAY_NEEDS_MAIN_MESSAGE,
  NATIVE_DISPLAY_RETURNED_EVENT,
  NATIVE_DISPLAY_SLOT_EVENT,
  NATIVE_DISPLAY_SLOT_TIMEOUT_MS,
  NATIVE_DISPLAY_STATE_EVENT,
  nativeDisplayStore,
  setNativeDisplayTransportForTests,
} from "../../src/utils/session/nativeBrowserDisplay";

const bus = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  emitted: [] as Array<{ target: string; name: string; payload: unknown }>,
  destroyed: [] as string[],
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    const set = bus.handlers.get(name) ?? new Set();
    set.add(handler);
    bus.handlers.set(name, set);
    return Promise.resolve(() => set.delete(handler));
  },
  emitTo: (target: string, name: string, payload: unknown) => {
    bus.emitted.push({ target, name, payload });
    return Promise.resolve();
  },
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: (label: string) =>
      Promise.resolve({
        destroy: () => {
          bus.destroyed.push(label);
          return Promise.resolve();
        },
      }),
  },
}));

import { useNativeBrowserDisplayHost } from "../../src/hooks/protocol/useNativeBrowserDisplayHost";

const identity = {
  ownerDatabaseId: "db",
  connectionId: "c",
  sessionId: "s1",
  attemptId: "a1",
};
const state = {
  title: "t",
  url: "https://a.test/",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  phase: "attached",
};
const slot = {
  sessionId: "s1",
  bounds: { x: 0, y: 40, width: 800, height: 500 },
  rectangles: [],
  blocked: false,
};

function deliver(name: string, payload: unknown) {
  return act(async () => {
    bus.handlers.get(name)?.forEach((handler) => handler({ payload }));
    await Promise.resolve();
  });
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

describe("main-window display host for a detached native page", () => {
  const transport = {
    capability: vi.fn(async () => true),
    move: vi.fn(async (..._args: unknown[]) => undefined),
    claim: vi.fn(async (..._args: unknown[]) => undefined),
    release: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const actions = {
    navigate: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
  };
  const restoreSession = vi.fn();
  const notify = vi.fn();
  const render = () =>
    renderHook(() =>
      useNativeBrowserDisplayHost({
        sessionId: "s1",
        identity,
        attached: true,
        needsOwnerWindow: false,
        state,
        actions,
        restoreSession,
        notify,
      }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    bus.handlers.clear();
    bus.emitted.length = 0;
    bus.destroyed.length = 0;
    nativeDisplayStore.reset();
    setNativeDisplayTransportForTests(transport as never);
  });
  afterEach(() => vi.useRealTimers());

  it("moves and claims once the detached window reports a slot; the page is never created, navigated or closed", async () => {
    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await flush();
    expect(transport.move).not.toHaveBeenCalled();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, slot);
    await flush();
    expect(transport.move).toHaveBeenCalledWith(identity, "detached-s1");
    expect(transport.claim).toHaveBeenCalledWith(identity, "detached-s1");
    expect(nativeDisplayStore.get("s1")?.phase).toBe("claimed");
    expect(nativeDisplayStore.get("s1")?.slot?.bounds).toEqual(slot.bounds);
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(transport.release).not.toHaveBeenCalled();
    expect(restoreSession).not.toHaveBeenCalled();
    expect(
      bus.emitted.some(
        (e) =>
          e.name === NATIVE_DISPLAY_STATE_EVENT && e.target === "detached-s1",
      ),
    ).toBe(true);
  });

  it("ignores slot reports for other sessions or with bad bounds", async () => {
    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await flush();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, { ...slot, sessionId: "other" });
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, {
      ...slot,
      bounds: { x: -5, y: 0, width: 4, height: 4 },
    });
    await flush();
    expect(transport.move).not.toHaveBeenCalled();
    expect(nativeDisplayStore.get("s1")?.slot).toBeNull();
  });

  it("relays toolbar actions to the main controller only after the claim", async () => {
    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await flush();
    await deliver(NATIVE_DISPLAY_COMMAND_EVENT, {
      sessionId: "s1",
      action: { kind: "back" },
    });
    expect(actions.back).not.toHaveBeenCalled();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, slot);
    await flush();
    await deliver(NATIVE_DISPLAY_COMMAND_EVENT, {
      sessionId: "s1",
      action: { kind: "back" },
    });
    await deliver(NATIVE_DISPLAY_COMMAND_EVENT, {
      sessionId: "s1",
      action: { kind: "navigate", url: "https://b.test/" },
    });
    await deliver(NATIVE_DISPLAY_COMMAND_EVENT, {
      sessionId: "s1",
      action: { kind: "close" },
    });
    expect(actions.back).toHaveBeenCalledOnce();
    expect(actions.navigate).toHaveBeenCalledWith("https://b.test/");
  });

  it("reattach: Return to main window releases natively, restores the tab and closes the display window", async () => {
    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await flush();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, slot);
    await flush();
    await deliver(NATIVE_DISPLAY_COMMAND_EVENT, {
      sessionId: "s1",
      action: { kind: "release" },
    });
    await flush();
    expect(transport.release).toHaveBeenCalledWith(identity);
    expect(restoreSession).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
    expect(nativeDisplayStore.get("s1")).toBeUndefined();
    expect(bus.destroyed).toEqual(["detached-s1"]);
  });

  it("native move failure keeps the main viewer: tab restored, popup notice, window closed", async () => {
    transport.move.mockRejectedValueOnce(new Error("refused"));
    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await flush();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, slot);
    await flush();
    expect(transport.claim).not.toHaveBeenCalled();
    expect(transport.release).not.toHaveBeenCalled();
    expect(restoreSession).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(NATIVE_DISPLAY_FAILED_MESSAGE);
    expect(nativeDisplayStore.get("s1")).toBeUndefined();
    expect(bus.destroyed).toEqual(["detached-s1"]);
  });

  it("a claim failure after the move returns the page natively before falling back", async () => {
    transport.claim.mockRejectedValueOnce(new Error("mismatch"));
    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await flush();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, slot);
    await flush();
    expect(transport.release).toHaveBeenCalledWith(identity);
    expect(restoreSession).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(NATIVE_DISPLAY_FAILED_MESSAGE);
  });

  it("a detached window that never reports a slot times out and keeps the page in main", async () => {
    vi.useFakeTimers();
    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await act(async () => {
      vi.advanceTimersByTime(NATIVE_DISPLAY_SLOT_TIMEOUT_MS + 1);
    });
    expect(transport.move).not.toHaveBeenCalled();
    expect(restoreSession).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(NATIVE_DISPLAY_FAILED_MESSAGE);
    expect(nativeDisplayStore.get("s1")).toBeUndefined();
  });

  it("a prompt only the main window can show takes the page back with a notice", async () => {
    nativeDisplayStore.request("s1", "detached-s1");
    const view = renderHook(
      ({ needs }: { needs: boolean }) =>
        useNativeBrowserDisplayHost({
          sessionId: "s1",
          identity,
          attached: true,
          needsOwnerWindow: needs,
          state,
          actions,
          restoreSession,
          notify,
        }),
      { initialProps: { needs: false } },
    );
    await flush();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, slot);
    await flush();
    view.rerender({ needs: true });
    await flush();
    expect(transport.release).toHaveBeenCalledWith(identity);
    expect(notify).toHaveBeenCalledWith(NATIVE_DISPLAY_NEEDS_MAIN_MESSAGE);
    expect(restoreSession).toHaveBeenCalledOnce();
  });

  it("native return events end the display: silent when the user closed the window, a notice on failure", async () => {
    nativeDisplayStore.request("s1", "detached-s1");
    const view = render();
    await flush();
    await deliver(NATIVE_DISPLAY_SLOT_EVENT, slot);
    await flush();
    await deliver(NATIVE_DISPLAY_RETURNED_EVENT, {
      sessionId: "other",
      kind: "returned",
      reason: null,
    });
    expect(nativeDisplayStore.get("s1")).toBeDefined();
    await deliver(NATIVE_DISPLAY_RETURNED_EVENT, {
      sessionId: "s1",
      kind: "returned",
      reason: "target-closed",
    });
    expect(restoreSession).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
    expect(transport.release).not.toHaveBeenCalled();
    expect(nativeDisplayStore.get("s1")).toBeUndefined();
    view.unmount();

    nativeDisplayStore.request("s1", "detached-s1");
    render();
    await flush();
    await deliver(NATIVE_DISPLAY_RETURNED_EVENT, {
      sessionId: "s1",
      kind: "closed",
      reason: "return-failed",
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(bus.destroyed).toContain("detached-s1");
  });
});
