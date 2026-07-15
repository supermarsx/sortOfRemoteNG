import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBehaviorWindowLifecycle } from "../../src/hooks/window/useBehaviorWindowLifecycle";
import type { BehaviorWindowLifecycleSignal } from "../../src/utils/behavior/windowLifecycle";

const mocks = vi.hoisted(() => ({
  minimized: false,
  focusListener: undefined as
    | ((event: { payload: boolean }) => void | Promise<void>)
    | undefined,
  resizeListener: undefined as (() => void | Promise<void>) | undefined,
  remoteListener: undefined as
    | ((event: { payload: BehaviorWindowLifecycleSignal }) => void)
    | undefined,
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
  isMinimized: vi.fn(async () => false),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    isMinimized: mocks.isMinimized,
    onFocusChanged: vi.fn(
      async (
        listener: (event: { payload: boolean }) => void | Promise<void>,
      ) => {
        mocks.focusListener = listener;
        return () => undefined;
      },
    ),
    onResized: vi.fn(async (listener: () => void | Promise<void>) => {
      mocks.resizeListener = listener;
      return () => undefined;
    }),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mocks.emitTo,
  listen: mocks.listen.mockImplementation(
    async (
      _event: string,
      listener: (event: { payload: BehaviorWindowLifecycleSignal }) => void,
    ) => {
      mocks.remoteListener = listener;
      return () => undefined;
    },
  ),
}));

describe("useBehaviorWindowLifecycle", () => {
  beforeEach(() => {
    (
      window as typeof window & { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = {};
    mocks.focusListener = undefined;
    mocks.resizeListener = undefined;
    mocks.remoteListener = undefined;
    mocks.minimized = false;
    mocks.isMinimized.mockImplementation(async () => mocks.minimized);
    mocks.emitTo.mockClear();
    mocks.listen.mockClear();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("bridges focus, blur, minimize, and restore edges in local order", async () => {
    const signals: BehaviorWindowLifecycleSignal[] = [];
    renderHook(() =>
      useBehaviorWindowLifecycle({
        windowId: "main",
        kind: "main",
        activeSessionId: "session-1",
        createEventId: () => `event-${signals.length + 1}`,
        onSignal: (signal) => {
          signals.push(signal);
        },
      }),
    );
    await act(async () => Promise.resolve());

    await act(async () => {
      await mocks.focusListener?.({ payload: true });
      mocks.minimized = true;
      await mocks.focusListener?.({ payload: false });
      mocks.minimized = false;
      await mocks.resizeListener?.();
    });

    expect(signals.map((signal) => signal.edge)).toEqual([
      "focused",
      "blurred",
      "minimized",
      "restored",
    ]);
    expect(
      signals.every((signal) => signal.window.activeSessionId === "session-1"),
    ).toBe(true);
  });

  it("snapshots the close attempt session and distinguishes cancel from confirm", async () => {
    const signals: BehaviorWindowLifecycleSignal[] = [];
    let activeSessionId = "session-1";
    const hook = renderHook(() =>
      useBehaviorWindowLifecycle({
        windowId: "main",
        kind: "main",
        activeSessionId,
        createEventId: () => `id-${signals.length + 1}`,
        onSignal: (signal) => {
          signals.push(signal);
        },
      }),
    );

    await act(async () => {
      await hook.result.current.requestClose();
    });
    await act(async () => {
      activeSessionId = "session-2";
      hook.rerender();
    });
    await act(async () => {
      await hook.result.current.cancelClose();
      await hook.result.current.requestClose();
      await hook.result.current.confirmClose();
    });

    expect(signals.map((signal) => signal.edge)).toEqual([
      "closeRequested",
      "closeCancelled",
      "closeRequested",
      "closed",
    ]);
    expect(
      signals.slice(0, 2).map((signal) => signal.window.activeSessionId),
    ).toEqual(["session-1", "session-1"]);
    expect(
      signals.slice(2).map((signal) => signal.window.activeSessionId),
    ).toEqual(["session-2", "session-2"]);
  });

  it("targets detached signals only to main and accepts detached payloads only in main", async () => {
    const detachedSink = vi.fn();
    renderHook(() =>
      useBehaviorWindowLifecycle({
        windowId: "detached-1",
        kind: "detached",
        activeSessionId: "session-2",
        onSignal: detachedSink,
      }),
    );
    await act(async () => {
      await mocks.focusListener?.({ payload: true });
    });
    expect(detachedSink).not.toHaveBeenCalled();
    expect(mocks.emitTo).toHaveBeenCalledWith(
      "main",
      "sortofremoteng:behavior-window-lifecycle",
      expect.objectContaining({
        edge: "focused",
        window: expect.objectContaining({ id: "detached-1" }),
      }),
    );

    const mainSink = vi.fn();
    renderHook(() =>
      useBehaviorWindowLifecycle({
        windowId: "main",
        kind: "main",
        receiveDetachedSignals: true,
        onSignal: mainSink,
      }),
    );
    const detachedSignal: BehaviorWindowLifecycleSignal = {
      version: 1,
      eventId: "remote-1",
      edge: "blurred",
      timestamp: 1,
      window: {
        id: "detached-1",
        kind: "detached",
        activeSessionId: "session-2",
      },
    };
    act(() => mocks.remoteListener?.({ payload: detachedSignal }));
    expect(mainSink).toHaveBeenCalledWith(detachedSignal);
  });
});
