import { act, cleanup, render, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nativeBrowserOcclusion,
  useOriginBrowserOverlays,
} from "../../src/hooks/protocol/useOriginBrowserOverlays";
import {
  beginOriginBrowserConfirmation,
  getOriginBrowserConfirmation,
  resetOriginBrowserConfirmationsForTests,
  useOriginBrowserConfirmation,
} from "../../src/hooks/protocol/originBrowserConfirmations";
import { useTooltipSystem } from "../../src/hooks/window/useTooltipSystem";
import { CriticalErrorScreen } from "../../src/components/app/CriticalErrorScreen";

const h = vi.hoisted(() => ({ reclaim: vi.fn() }));
vi.mock("../../src/utils/window/reclaimShellFocus", () => ({
  reclaimShellFocus: h.reclaim,
}));

let mutation: () => void;
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  h.reclaim.mockReset();
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(cb: () => void) {
        mutation = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const hidden = !!this.closest("[hidden]");
      return new DOMRect(300, 100, hidden ? 0 : 200, hidden ? 0 : 150);
    },
  );
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  frame = undefined;
  resetOriginBrowserConfirmationsForTests();
});
const flush = () =>
  act(() => {
    const cb = frame;
    frame = undefined;
    cb?.(0);
  });
const box = { x: 298, y: 98, width: 204, height: 154 };
function add(attributes: Record<string, string>) {
  const node = document.createElement("div");
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  document.body.append(node);
  return node;
}

describe("native browser overlay sampler", () => {
  it("blocks for nested dialogs until the last one closes, then restores", () => {
    const outer = add({ role: "dialog" });
    const inner = add({ role: "alertdialog" });
    const { result } = renderHook(() => useOriginBrowserOverlays(true));
    expect(result.current).toMatchObject({ blocked: true, rectangles: [box] });
    inner.remove();
    act(() => mutation());
    flush();
    expect(result.current.blocked).toBe(true);
    outer.remove();
    act(() => mutation());
    flush();
    expect(result.current).toMatchObject({ blocked: false, rectangles: [] });
  });

  it("restores after a modal component unmounts without any close path", () => {
    function Broken({ open }: { open: boolean }) {
      // No onClose, no state reset: the subtree is simply torn down.
      return open ? <div className="sor-modal-backdrop" /> : null;
    }
    const view = render(<Broken open />);
    const { result } = renderHook(() => useOriginBrowserOverlays(true));
    expect(result.current.blocked).toBe(true);
    view.unmount();
    act(() => mutation());
    flush();
    expect(result.current).toMatchObject({ blocked: false, rectangles: [] });
  });

  it("treats the blocking opt-in like a dialog and the plain opt-in as clip-only", () => {
    expect(nativeBrowserOcclusion()).toEqual({
      "data-native-browser-occlusion": "",
    });
    expect(nativeBrowserOcclusion("blocking")).toEqual({
      "data-native-browser-occlusion": "blocking",
    });
    const notice = add(nativeBrowserOcclusion());
    const { result } = renderHook(() => useOriginBrowserOverlays(true));
    expect(result.current).toMatchObject({ blocked: false, rectangles: [box] });
    notice.setAttribute("data-native-browser-occlusion", "blocking");
    act(() => mutation());
    flush();
    expect(result.current).toMatchObject({ blocked: true, rectangles: [box] });
  });

  it("samples again when a transform transition or animation settles", () => {
    const reveal = add({ role: "tooltip" });
    const { result } = renderHook(() => useOriginBrowserOverlays(true));
    expect(result.current.rectangles).toEqual([box]);
    reveal.getBoundingClientRect = () => new DOMRect(300, 0, 200, 40);
    act(() => {
      reveal.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });
    flush();
    expect(result.current.rectangles).toEqual([
      { x: 298, y: 0, width: 204, height: 42 },
    ]);
    reveal.getBoundingClientRect = () => new DOMRect(10, 10, 20, 20);
    act(() => {
      reveal.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    flush();
    expect(result.current.rectangles).toEqual([
      { x: 8, y: 8, width: 24, height: 24 },
    ]);
  });

  it("stops listening for transitions after deactivation", () => {
    add({ role: "tooltip" });
    const view = renderHook(
      (active: boolean) => useOriginBrowserOverlays(active),
      {
        initialProps: true,
      },
    );
    view.rerender(false);
    frame = undefined;
    document.body.dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(frame).toBeUndefined();
  });

  it("covers the global tooltip, which floats over toolbar-adjacent native regions", () => {
    renderHook(() => useTooltipSystem());
    const tooltip = document.querySelector(".app-tooltip");
    expect(tooltip).toHaveAttribute("role", "tooltip");
  });

  it("fences a native browser behind the window-wide critical error screen", () => {
    render(<CriticalErrorScreen title="Broken" detail="detail" />);
    const { result } = renderHook(() => useOriginBrowserOverlays(true));
    expect(result.current.blocked).toBe(true);
  });
});

describe("pending security confirmations", () => {
  it("tracks nested holds per tab, newest first, with idempotent releases", () => {
    const first = beginOriginBrowserConfirmation("tab", "ssh-command");
    const second = beginOriginBrowserConfirmation("tab", "ssh-host-key");
    expect(getOriginBrowserConfirmation("tab")).toBe("ssh-host-key");
    expect(getOriginBrowserConfirmation("other")).toBeNull();
    second();
    second();
    expect(getOriginBrowserConfirmation("tab")).toBe("ssh-command");
    first();
    expect(getOriginBrowserConfirmation("tab")).toBeNull();
  });

  it("re-renders subscribed tabs and reclaims shell focus when a prompt begins", () => {
    const { result } = renderHook(() => useOriginBrowserConfirmation("tab"));
    expect(result.current).toBeNull();
    let release!: () => void;
    act(() => {
      release = beginOriginBrowserConfirmation("tab", "certificate");
    });
    expect(result.current).toBe("certificate");
    expect(h.reclaim).toHaveBeenCalledOnce();
    act(() => release());
    expect(result.current).toBeNull();
  });

  it("still records the hold when focus reclaim throws", () => {
    h.reclaim.mockImplementation(() => {
      throw new Error("no webview");
    });
    const release = beginOriginBrowserConfirmation("tab", "certificate");
    expect(getOriginBrowserConfirmation("tab")).toBe("certificate");
    release();
    expect(getOriginBrowserConfirmation("tab")).toBeNull();
  });
});
