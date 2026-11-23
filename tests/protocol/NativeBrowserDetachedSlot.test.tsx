import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ConnectionSession } from "../../src/types/connection/connection";
import {
  NATIVE_DISPLAY_COMMAND_EVENT,
  NATIVE_DISPLAY_SLOT_EVENT,
  NATIVE_DISPLAY_STATE_EVENT,
} from "../../src/utils/session/nativeBrowserDisplay";

const bus = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  emitted: [] as Array<{ target: string; name: string; payload: any }>,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    const set = bus.handlers.get(name) ?? new Set();
    set.add(handler);
    bus.handlers.set(name, set);
    return Promise.resolve(() => set.delete(handler));
  },
  emitTo: (target: string, name: string, payload: unknown) => {
    bus.emitted.push({ target, name, payload: payload as any });
    return Promise.resolve();
  },
}));

import { NativeBrowserDetachedSlot } from "../../src/components/protocol/webBrowser/NativeBrowserDetachedSlot";

const session = {
  id: "s1",
  connectionId: "c1",
  name: "Router",
  status: "connected",
  startTime: new Date(),
  protocol: "https",
  hostname: "r.test",
} as ConnectionSession;

describe("NativeBrowserDetachedSlot", () => {
  beforeEach(() => {
    bus.handlers.clear();
    bus.emitted.length = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.nativeDisplaySlot
          ? ({
              left: 0,
              top: 40,
              right: 800,
              bottom: 540,
              width: 800,
              height: 500,
              x: 0,
              y: 40,
              toJSON: () => ({}),
            } as DOMRect)
          : ({
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              width: 0,
              height: 0,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            } as DOMRect);
      },
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders no remote content: only a slot and a toolbar, and reports the slot to main", async () => {
    const view = render(<NativeBrowserDetachedSlot session={session} />);
    await act(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
    });
    expect(view.container.querySelector("iframe, webview, object")).toBeNull();
    const reports = bus.emitted.filter(
      (e) => e.name === NATIVE_DISPLAY_SLOT_EVENT,
    );
    expect(reports.length).toBeGreaterThan(0);
    const last = reports[reports.length - 1];
    expect(last.target).toBe("main");
    expect(last.payload.sessionId).toBe("s1");
    expect(last.payload.bounds).toEqual({
      x: 0,
      y: 40,
      width: 800,
      height: 500,
    });
  });

  it("mirrors page state and relays toolbar actions to main only", async () => {
    render(<NativeBrowserDetachedSlot session={session} />);
    const back = screen.getByLabelText("Back") as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    await act(async () => {
      bus.handlers.get(NATIVE_DISPLAY_STATE_EVENT)?.forEach((handler) =>
        handler({
          payload: {
            sessionId: "s1",
            state: {
              title: "Login",
              url: "https://r.test/",
              loading: false,
              canGoBack: true,
              canGoForward: false,
              phase: "attached",
            },
          },
        }),
      );
    });
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    fireEvent.click(screen.getByLabelText("Reload"));
    fireEvent.click(screen.getByText("Return to main window"));
    const actions = bus.emitted
      .filter((e) => e.name === NATIVE_DISPLAY_COMMAND_EVENT)
      .map((e) => [e.target, e.payload.action.kind]);
    expect(actions).toEqual([
      ["main", "back"],
      ["main", "reload"],
      ["main", "release"],
    ]);
  });
});
