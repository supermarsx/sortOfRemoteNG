/**
 * `useNonPassiveWheel` exists because React attaches its own `wheel` listener
 * at the root as a *passive* one: `preventDefault()` inside a React `onWheel`
 * handler is ignored, the browser logs "Unable to preventDefault inside passive
 * event listener invocation", and the page scrolls or zooms anyway.
 *
 * These tests pin both halves: the third `addEventListener` argument, and the
 * behaviour jsdom derives from it (jsdom does ignore `preventDefault()` inside
 * a passive listener, so `defaultPrevented` is a real signal here).
 */
import React, { useRef, useState } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNonPassiveWheel } from "../../src/hooks/window/useNonPassiveWheel";

type Registration = { target: EventTarget; options: unknown };

let added: Registration[] = [];
let removed: Registration[] = [];

beforeEach(() => {
  added = [];
  removed = [];
  const addOriginal = HTMLElement.prototype.addEventListener;
  const removeOriginal = HTMLElement.prototype.removeEventListener;
  vi.spyOn(HTMLElement.prototype, "addEventListener").mockImplementation(
    function (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "wheel") added.push({ target: this, options });
      return addOriginal.call(this, type, listener, options);
    } as typeof HTMLElement.prototype.addEventListener,
  );
  vi.spyOn(HTMLElement.prototype, "removeEventListener").mockImplementation(
    function (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "wheel") removed.push({ target: this, options });
      return removeOriginal.call(this, type, listener, options);
    } as typeof HTMLElement.prototype.removeEventListener,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const Probe: React.FC<{
  handler: (event: WheelEvent) => void;
  mounted?: boolean;
  elementKey?: string;
}> = ({ handler, mounted = true, elementKey = "a" }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useNonPassiveWheel(ref, handler);
  return mounted ? (
    <div key={elementKey} ref={ref} data-testid="wheel-target" />
  ) : null;
};

const wheel = () =>
  new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });

/** Registrations on one element; React also registers wheel on its root. */
const addedFor = (target: EventTarget) =>
  added.filter((entry) => entry.target === target);

const removedTargets = () => removed.map((entry) => entry.target);

describe("useNonPassiveWheel", () => {
  it("registers the wheel listener with passive: false", () => {
    const handler = vi.fn();
    const { getByTestId } = render(<Probe handler={handler} />);
    const element = getByTestId("wheel-target");

    expect(addedFor(element)).toHaveLength(1);
    expect(addedFor(element)[0].options).toEqual({ passive: false });

    // React's own root wheel listener is the reason the hook exists: it is
    // never registered as non-passive, so a React `onWheel` cannot preventDefault.
    const reactRoot = added.filter((entry) => entry.target !== element);
    expect(reactRoot.length).toBeGreaterThan(0);
    expect(
      reactRoot.every(
        (entry) =>
          (entry.options as AddEventListenerOptions | undefined)?.passive !==
          false,
      ),
    ).toBe(true);
  });

  it("runs the handler and lets it prevent the default scroll", () => {
    const handler = vi.fn((event: WheelEvent) => event.preventDefault());
    const { getByTestId } = render(<Probe handler={handler} />);

    const event = wheel();
    act(() => {
      getByTestId("wheel-target").dispatchEvent(event);
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("calls the latest handler without re-registering the listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { getByTestId, rerender } = render(<Probe handler={first} />);

    rerender(<Probe handler={second} />);
    act(() => {
      getByTestId("wheel-target").dispatchEvent(wheel());
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(addedFor(getByTestId("wheel-target"))).toHaveLength(1);
  });

  it("follows the ref when the element is remounted", () => {
    const handler = vi.fn();
    const { getByTestId, rerender } = render(<Probe handler={handler} />);
    const firstElement = getByTestId("wheel-target");

    rerender(<Probe handler={handler} elementKey="b" />);
    const secondElement = getByTestId("wheel-target");
    expect(secondElement).not.toBe(firstElement);

    act(() => {
      secondElement.dispatchEvent(wheel());
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(addedFor(firstElement)).toHaveLength(1);
    expect(addedFor(secondElement)).toHaveLength(1);
    expect(addedFor(secondElement)[0].options).toEqual({ passive: false });
    expect(removedTargets()).toContain(firstElement);
  });

  it("detaches the listener when the element unmounts", () => {
    const handler = vi.fn();
    const { getByTestId, rerender } = render(<Probe handler={handler} />);
    const element = getByTestId("wheel-target");

    rerender(<Probe handler={handler} mounted={false} />);
    act(() => {
      element.dispatchEvent(wheel());
    });

    expect(handler).not.toHaveBeenCalled();
    expect(removedTargets()).toContain(element);
  });

  it("detaches the listener when the component unmounts", () => {
    const handler = vi.fn();
    const { getByTestId, unmount } = render(<Probe handler={handler} />);
    const element = getByTestId("wheel-target");

    unmount();
    act(() => {
      element.dispatchEvent(wheel());
    });

    expect(handler).not.toHaveBeenCalled();
    expect(removedTargets()).toContain(element);
  });

  it("attaches to an element that only appears after a later render", () => {
    const handler = vi.fn();
    const Delayed: React.FC = () => {
      const ref = useRef<HTMLDivElement | null>(null);
      const [visible, setVisible] = useState(false);
      useNonPassiveWheel(ref, handler);
      return (
        <>
          <button onClick={() => setVisible(true)}>show</button>
          {visible ? <div ref={ref} data-testid="wheel-target" /> : null}
        </>
      );
    };

    const { getByText, getByTestId } = render(<Delayed />);
    const isTarget = (entry: Registration) =>
      (entry.target as HTMLElement).dataset?.testid === "wheel-target";
    expect(added.some(isTarget)).toBe(false);

    act(() => {
      getByText("show").click();
    });

    const element = getByTestId("wheel-target");
    expect(addedFor(element)).toHaveLength(1);
    expect(addedFor(element)[0].options).toEqual({ passive: false });

    act(() => {
      element.dispatchEvent(wheel());
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
