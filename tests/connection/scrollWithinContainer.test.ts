import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollElementWithinContainer } from "../../src/components/connection/editor/scrollWithinContainer";

const rect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect =>
  ({
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }) as DOMRect;

const makeFixture = () => {
  const parent = document.createElement("div");
  const pane = document.createElement("div");
  const target = document.createElement("div");
  parent.append(pane);
  pane.append(target);
  document.body.append(parent);

  Object.defineProperties(pane, {
    clientHeight: { configurable: true, value: 400 },
    clientWidth: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 1_200 },
    scrollWidth: { configurable: true, value: 1_400 },
  });
  parent.getBoundingClientRect = vi.fn(() => rect(20, 80, 660, 520));
  pane.getBoundingClientRect = vi.fn(() => rect(40, 100, 640, 500));
  pane.scrollLeft = 200;
  pane.scrollTop = 250;

  return { parent, pane, target };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("scrollElementWithinContainer", () => {
  it("clamps targets below and above without moving the page or parent", () => {
    const { parent, pane, target } = makeFixture();
    const parentBounds = parent.getBoundingClientRect();
    const bodyTop = document.body.scrollTop;
    const documentTop = document.documentElement.scrollTop;
    const windowScroll = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);

    target.getBoundingClientRect = vi.fn(() => rect(80, 520, 280, 560));
    expect(scrollElementWithinContainer(pane, target, { padding: 16 })).toEqual(
      { changed: true, left: 200, top: 326 },
    );

    target.getBoundingClientRect = vi.fn(() => rect(80, 60, 280, 90));
    expect(scrollElementWithinContainer(pane, target, { padding: 16 })).toEqual(
      { changed: true, left: 200, top: 270 },
    );

    expect(document.body.scrollTop).toBe(bodyTop);
    expect(document.documentElement.scrollTop).toBe(documentTop);
    expect(windowScroll).not.toHaveBeenCalled();
    expect(parent.getBoundingClientRect()).toMatchObject({
      left: parentBounds.left,
      top: parentBounds.top,
      right: parentBounds.right,
      bottom: parentBounds.bottom,
    });
    expect(parent.getAttribute("style")).toBeNull();
  });

  it("handles horizontal overflow and clamps both extremes", () => {
    const { pane, target } = makeFixture();

    target.getBoundingClientRect = vi.fn(() => rect(560, 160, 700, 200));
    expect(scrollElementWithinContainer(pane, target, { padding: 16 })).toEqual(
      { changed: true, left: 276, top: 250 },
    );

    target.getBoundingClientRect = vi.fn(() => rect(1_500, 160, 1_600, 200));
    expect(scrollElementWithinContainer(pane, target, { padding: 16 })).toEqual(
      { changed: true, left: 800, top: 250 },
    );

    target.getBoundingClientRect = vi.fn(() => rect(-900, 160, -800, 200));
    expect(scrollElementWithinContainer(pane, target, { padding: 16 })).toEqual(
      { changed: true, left: 0, top: 250 },
    );
  });

  it("can reserve horizontal position for a vertically owned scroll lane", () => {
    const { pane, target } = makeFixture();
    target.getBoundingClientRect = vi.fn(() => rect(700, 520, 900, 560));

    expect(
      scrollElementWithinContainer(pane, target, {
        padding: 16,
        axis: "vertical",
      }),
    ).toEqual({ changed: true, left: 200, top: 326 });
    expect(pane.scrollLeft).toBe(200);
  });

  it("keeps an intersecting oversized target stable instead of bouncing between edges", () => {
    const { pane, target } = makeFixture();
    target.getBoundingClientRect = vi.fn(() => rect(80, 50, 280, 700));

    expect(scrollElementWithinContainer(pane, target, { padding: 16 })).toEqual(
      { changed: false, left: 200, top: 250 },
    );
    expect(pane.scrollTop).toBe(250);
  });

  it("leaves an already visible target and its pane unchanged", () => {
    const { pane, target } = makeFixture();
    target.getBoundingClientRect = vi.fn(() => rect(120, 180, 320, 220));

    expect(scrollElementWithinContainer(pane, target, { padding: 16 })).toEqual(
      { changed: false, left: 200, top: 250 },
    );
    expect(pane.scrollLeft).toBe(200);
    expect(pane.scrollTop).toBe(250);
  });

  it("refuses to scroll a container that does not own the target", () => {
    const { pane } = makeFixture();
    const unrelatedTarget = document.createElement("div");
    document.body.append(unrelatedTarget);

    expect(scrollElementWithinContainer(pane, unrelatedTarget)).toBeUndefined();
    expect(pane.scrollLeft).toBe(200);
    expect(pane.scrollTop).toBe(250);
  });
});
