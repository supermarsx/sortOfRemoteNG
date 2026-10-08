import { act, cleanup, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOriginBrowserOverlays } from "../../src/hooks/protocol/useOriginBrowserOverlays";

let mutation: () => void;
let resize: () => void;
let mutationObservers = 0;
let resizeObservers = 0;
const disconnectMutation = vi.fn();
const disconnectResize = vi.fn();
let frame: FrameRequestCallback | undefined;
let reads = 0;
beforeEach(() => {
  mutationObservers = 0;
  resizeObservers = 0;
  disconnectMutation.mockClear();
  disconnectResize.mockClear();
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(cb: () => void) {
        mutationObservers++;
        mutation = cb;
      }
      observe() {}
      disconnect = disconnectMutation;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resizeObservers++;
        resize = cb;
      }
      observe() {}
      unobserve() {}
      disconnect = disconnectResize;
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
      reads++;
      const hidden = !!this.closest("[hidden]");
      return {
        x: 300,
        y: 100,
        left: 300,
        top: 100,
        right: 500,
        bottom: 250,
        width: hidden ? 0 : 200,
        height: hidden ? 0 : 150,
        toJSON() {},
      };
    },
  );
  reads = 0;
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  frame = undefined;
});
const flush = () =>
  act(() => {
    const cb = frame;
    frame = undefined;
    cb?.(0);
  });
it("coalesces app mutations and keeps stable geometry instead of hiding the page", () => {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  const { result } = renderHook(() => useOriginBrowserOverlays(true));
  expect(result.current.blocked).toBe(true);
  expect(result.current.rectangles).toEqual([
    { x: 298, y: 98, width: 204, height: 154 },
  ]);
  const previous = result.current.rectangles;
  const oldReads = reads;
  act(() => {
    for (let i = 0; i < 100; i++) mutation();
  });
  expect(reads).toBe(oldReads);
  flush();
  expect(reads).toBe(oldReads + 1);
  expect(result.current.rectangles).toBe(previous);
  menu.remove();
  act(() => mutation());
  flush();
  expect(result.current).toMatchObject({ blocked: false, rectangles: [] });
});
it("ignores hidden overlays and clips tooltips without blocking keyboard input", () => {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const tip = document.createElement("div");
  tip.setAttribute("role", "tooltip");
  document.body.append(menu, tip);
  const { result } = renderHook(() => useOriginBrowserOverlays(true));
  expect(result.current.blocked).toBe(false);
  expect(result.current.rectangles).toHaveLength(1);
});

it("does not observe, scan or schedule work for inactive tabs", () => {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  const scan = vi.spyOn(document, "querySelectorAll");
  const { result } = renderHook(() => useOriginBrowserOverlays(false));
  act(() => {
    result.current.refresh();
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
  });
  expect(result.current).toMatchObject({ blocked: false, rectangles: [] });
  expect(mutationObservers).toBe(0);
  expect(resizeObservers).toBe(0);
  expect(scan).not.toHaveBeenCalled();
  expect(reads).toBe(0);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});

it("disconnects and cancels queued work on deactivation, including late callbacks", () => {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  const { result, rerender } = renderHook(
    ({ active }) => useOriginBrowserOverlays(active),
    { initialProps: { active: true } },
  );
  const refresh = result.current.refresh;
  act(() => mutation());
  const queued = frame;
  const oldReads = reads;
  rerender({ active: false });
  expect(result.current).toMatchObject({ blocked: false, rectangles: [] });
  expect(disconnectMutation).toHaveBeenCalledOnce();
  expect(disconnectResize).toHaveBeenCalledOnce();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  vi.mocked(requestAnimationFrame).mockClear();
  act(() => {
    mutation();
    resize();
    queued?.(0);
    refresh();
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
  });
  expect(reads).toBe(oldReads);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  expect(result.current.refresh).toBe(refresh);
});

it("resamples on activation and shields the first presentation from stale geometry", () => {
  const presented: { blocked: boolean; rectangles: readonly unknown[] }[] = [];
  const { result, rerender } = renderHook(
    ({ active }) => {
      const overlay = useOriginBrowserOverlays(active);
      // Models the consumer's presentation effect in the same commit.
      useLayoutEffect(() => {
        if (active) presented.push(overlay);
      });
      return overlay;
    },
    { initialProps: { active: true } },
  );
  expect(result.current.blocked).toBe(false);
  rerender({ active: false });
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  presented.length = 0;
  rerender({ active: true });
  expect(presented[0]).toMatchObject({
    blocked: true,
    rectangles: [{ x: 0, y: 0, width: innerWidth, height: innerHeight }],
  });
  expect(result.current).toMatchObject({
    blocked: true,
    rectangles: [{ x: 298, y: 98, width: 204, height: 154 }],
  });
  expect(mutationObservers).toBe(2);
  expect(resizeObservers).toBe(2);
  rerender({ active: false });
  menu.remove();
  rerender({ active: true });
  expect(result.current).toMatchObject({ blocked: false, rectangles: [] });
});

it("keeps observer and geometry work bounded by active tabs, not mounted tabs", () => {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  for (let i = 0; i < 10; i++)
    renderHook(() => useOriginBrowserOverlays(false));
  const { unmount } = renderHook(() => useOriginBrowserOverlays(true));
  expect(mutationObservers).toBe(1);
  expect(resizeObservers).toBe(1);
  expect(reads).toBe(1);
  act(() => {
    for (let i = 0; i < 100; i++) mutation();
  });
  flush();
  expect(reads).toBe(2);
  unmount();
  expect(disconnectMutation).toHaveBeenCalledOnce();
  expect(disconnectResize).toHaveBeenCalledOnce();
});
