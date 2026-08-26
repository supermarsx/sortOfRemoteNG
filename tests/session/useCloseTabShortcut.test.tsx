import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloseTabShortcut } from "../../src/hooks/session/useCloseTabShortcut";
import type { ConnectionSession } from "../../src/types/connection/connection";

const makeSession = (
  id: string,
  status: ConnectionSession["status"],
): ConnectionSession => ({
  id,
  connectionId: `conn-${id}`,
  name: `Session ${id}`,
  status,
  startTime: new Date("2026-08-26T08:00:00.000Z"),
  protocol: "ssh",
  hostname: "127.0.0.1",
});

const pressCtrlW = (
  target: EventTarget = window,
  init: Partial<KeyboardEventInit> & { defaultPrevented?: boolean } = {},
): KeyboardEvent => {
  const { defaultPrevented, ...rest } = init;
  const event = new KeyboardEvent("keydown", {
    key: "w",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...rest,
  });
  if (defaultPrevented) event.preventDefault();
  target.dispatchEvent(event);
  return event;
};

describe("useCloseTabShortcut", () => {
  let handleSessionClose: ReturnType<
    typeof vi.fn<(sessionId: string) => Promise<boolean>>
  >;
  let viewer: HTMLDivElement;
  let outside: HTMLDivElement;

  beforeEach(() => {
    handleSessionClose = vi.fn().mockResolvedValue(true);
    viewer = document.createElement("div");
    viewer.setAttribute("data-session-viewer", "");
    const inner = document.createElement("textarea");
    viewer.appendChild(inner);
    outside = document.createElement("div");
    document.body.append(viewer, outside);
  });

  afterEach(() => {
    viewer.remove();
    outside.remove();
  });

  it("closes the active error session on Ctrl+W and prevents default", () => {
    renderHook(() =>
      useCloseTabShortcut([makeSession("a", "error")], "a", handleSessionClose),
    );

    const event = pressCtrlW(viewer.firstElementChild!);

    expect(handleSessionClose).toHaveBeenCalledWith("a");
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes an active connecting session even from inside the viewer", () => {
    renderHook(() =>
      useCloseTabShortcut(
        [makeSession("a", "connecting")],
        "a",
        handleSessionClose,
      ),
    );

    const event = pressCtrlW(viewer.firstElementChild!);

    expect(handleSessionClose).toHaveBeenCalledWith("a");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Ctrl+W to the remote when a connected session's viewer has focus", () => {
    renderHook(() =>
      useCloseTabShortcut(
        [makeSession("a", "connected")],
        "a",
        handleSessionClose,
      ),
    );

    const event = pressCtrlW(viewer.firstElementChild!);

    expect(handleSessionClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("closes a connected session when the key event originates outside the viewer", () => {
    renderHook(() =>
      useCloseTabShortcut(
        [makeSession("a", "connected")],
        "a",
        handleSessionClose,
      ),
    );

    const event = pressCtrlW(outside);

    expect(handleSessionClose).toHaveBeenCalledWith("a");
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing without an active session", () => {
    renderHook(() =>
      useCloseTabShortcut(
        [makeSession("a", "error")],
        undefined,
        handleSessionClose,
      ),
    );

    const event = pressCtrlW(outside);

    expect(handleSessionClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing when the active id has no matching session", () => {
    renderHook(() =>
      useCloseTabShortcut(
        [makeSession("a", "error")],
        "missing",
        handleSessionClose,
      ),
    );

    pressCtrlW(outside);

    expect(handleSessionClose).not.toHaveBeenCalled();
  });

  it("ignores events that were already defaultPrevented", () => {
    renderHook(() =>
      useCloseTabShortcut([makeSession("a", "error")], "a", handleSessionClose),
    );

    pressCtrlW(outside, { defaultPrevented: true });

    expect(handleSessionClose).not.toHaveBeenCalled();
  });

  it("ignores key repeats and other modifier combinations", () => {
    renderHook(() =>
      useCloseTabShortcut([makeSession("a", "error")], "a", handleSessionClose),
    );

    pressCtrlW(outside, { repeat: true });
    pressCtrlW(outside, { altKey: true });
    pressCtrlW(outside, { metaKey: true });
    pressCtrlW(outside, { ctrlKey: false });
    pressCtrlW(outside, { key: "q" });

    expect(handleSessionClose).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const { unmount } = renderHook(() =>
      useCloseTabShortcut([makeSession("a", "error")], "a", handleSessionClose),
    );
    unmount();

    pressCtrlW(outside);

    expect(handleSessionClose).not.toHaveBeenCalled();
  });
});
