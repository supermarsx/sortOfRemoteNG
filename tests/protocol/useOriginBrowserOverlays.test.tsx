import { cleanup, render, renderHook } from "@testing-library/react";
import React, { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOriginBrowserOverlays } from "../../src/hooks/protocol/useOriginBrowserOverlays";

interface Frame {
  blocked: boolean;
  rectangles: readonly unknown[];
}
let frames: Frame[];
const shield = () => [{ x: 0, y: 0, width: innerWidth, height: innerHeight }];
const box = [{ x: 298, y: 98, width: 204, height: 154 }];

beforeEach(() => {
  frames = [];
  vi.stubGlobal(
    "MutationObserver",
    class {
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
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
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
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Records what a consumer's presentation effect sends, commit by commit. */
function tab(active: boolean) {
  return renderHook(
    (props: { active: boolean }) => {
      const overlay = useOriginBrowserOverlays(props.active);
      useLayoutEffect(() => {
        if (props.active) frames.push(overlay);
      });
      return overlay;
    },
    { initialProps: { active } },
  );
}
function overlay(role: string, parent: HTMLElement = document.body) {
  const node = document.createElement("div");
  node.setAttribute("role", role);
  parent.append(node);
  return node;
}
function wrapper(configure: (node: HTMLElement) => void) {
  const node = document.createElement("div");
  configure(node);
  document.body.append(node);
  return node;
}

describe("native browser overlay activation", () => {
  it("presents no blocked frame when no overlay exists", () => {
    const view = tab(true);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((frame) => frame.blocked)).toEqual([]);
    expect(view.result.current).toMatchObject({
      blocked: false,
      rectangles: [],
    });

    view.rerender({ active: false });
    frames = [];
    view.rerender({ active: true });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((frame) => frame.blocked)).toEqual([]);
  });

  it("still clips the whole view until the first sample", () => {
    tab(true);
    expect(frames[0]).toMatchObject({ blocked: false, rectangles: shield() });
    expect(frames[frames.length - 1]).toMatchObject({
      blocked: false,
      rectangles: [],
    });
  });

  it.each([
    ["a hidden menu", () => (overlay("menu").hidden = true)],
    [
      "a dialog in an inactive tab",
      () =>
        overlay(
          "dialog",
          wrapper((node) => (node.style.visibility = "hidden")),
        ),
    ],
    [
      "a listbox under an aria-hidden ancestor",
      () =>
        overlay(
          "listbox",
          wrapper((node) => node.setAttribute("aria-hidden", "true")),
        ),
    ],
    [
      "an alert dialog under an inert ancestor",
      () =>
        overlay(
          "alertdialog",
          wrapper((node) => node.setAttribute("inert", "")),
        ),
    ],
    ["an undisplayed menu", () => (overlay("menu").style.display = "none")],
  ])("presents no blocked frame for %s", (_, arrange) => {
    arrange();
    const view = tab(true);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((frame) => frame.blocked)).toEqual([]);
    expect(view.result.current).toMatchObject({
      blocked: false,
      rectangles: [],
    });
  });

  it.each(["tooltip", "toast"])(
    "clips a %s that appeared while inactive without a blocked frame",
    (kind) => {
      const view = tab(false);
      if (kind === "tooltip") overlay("tooltip");
      else
        wrapper((node) =>
          node.setAttribute("data-native-browser-occlusion", ""),
        );
      view.rerender({ active: true });
      expect(frames.filter((frame) => frame.blocked)).toEqual([]);
      expect(frames[0].rectangles).toEqual(shield());
      expect(view.result.current).toMatchObject({
        blocked: false,
        rectangles: box,
      });
    },
  );

  it.each(["dialog", "alertdialog", "menu", "listbox"])(
    "is blocked from its first frame while a %s is showing",
    (role) => {
      const view = tab(false);
      overlay(role);
      view.rerender({ active: true });
      expect(frames[0]).toMatchObject({ blocked: true, rectangles: shield() });
      expect(frames.filter((frame) => !frame.blocked)).toEqual([]);
      expect(view.result.current).toMatchObject({
        blocked: true,
        rectangles: box,
      });
    },
  );

  it("shields, then blocks, an overlay mounted by the activating commit", () => {
    function Tab({ active }: { active: boolean }) {
      const overlay = useOriginBrowserOverlays(active);
      useLayoutEffect(() => {
        if (active) frames.push(overlay);
      });
      return active ? <div role="dialog" /> : null;
    }
    const view = render(<Tab active={false} />);
    view.rerender(<Tab active />);
    // The dialog is not in the document while this commit renders.
    expect(frames[0].rectangles).toEqual(shield());
    expect(frames[frames.length - 1]).toMatchObject({
      blocked: true,
      rectangles: box,
    });
  });
});
