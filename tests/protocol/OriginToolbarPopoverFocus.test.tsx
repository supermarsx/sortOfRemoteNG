import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OriginToolbarPopover } from "../../src/components/protocol/webBrowser/OriginCredentialControls";
import { PopoverSurface } from "../../src/components/ui/overlays/PopoverSurface";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frameQueue() {
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++next, callback);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  return () => {
    const callbacks = [...pending.values()];
    pending.clear();
    act(() => callbacks.forEach((callback) => callback(0)));
  };
}

function Popup() {
  return (
    <OriginToolbarPopover
      label="Website security"
      icon={null}
      eligible
      canOpen
      scope="owner"
      assertOwner={() => {}}
      onOverlayChange={() => {}}
    >
      {({ anchorRef, panelRef, onClose }) => (
        <PopoverSurface isOpen anchorRef={anchorRef} onClose={onClose}>
          <section ref={panelRef}>
            <button onClick={onClose}>Close website security</button>
          </section>
        </PopoverSurface>
      )}
    </OriginToolbarPopover>
  );
}

describe("native toolbar popup focus", () => {
  it("waits for the portal's visible commit before focusing its first control", () => {
    const frame = frameQueue();
    const nativeFocus = HTMLElement.prototype.focus;
    // JSDOM normally focuses hidden elements. Model the browser's rejection so
    // a focus attempt in the same frame as the reveal cannot falsely pass.
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (getComputedStyle(this).visibility === "hidden") return;
      nativeFocus.call(this, options);
    });
    render(<Popup />);
    const trigger = screen.getByRole("button", { name: "Website security" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const close = screen.getByText("Close website security");
    expect(close.closest(".sor-popover-surface")).toHaveStyle({
      visibility: "hidden",
    });
    frame();
    expect(close).toBeVisible();
    expect(trigger).toHaveFocus();
    frame();
    expect(close).toHaveFocus();
  });

  it("cancels the deferred focus when the popup closes before the next frame", () => {
    const frame = frameQueue();
    render(<Popup />);
    const trigger = screen.getByRole("button", { name: "Website security" });
    fireEvent.click(trigger);
    const close = screen.getByText("Close website security");
    frame();
    fireEvent.click(trigger);
    const focus = vi.spyOn(close, "focus");
    frame();
    expect(focus).not.toHaveBeenCalled();
    expect(screen.queryByText("Close website security")).toBeNull();
  });
});
