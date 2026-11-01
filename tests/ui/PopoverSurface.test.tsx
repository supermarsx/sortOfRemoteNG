import React from "react";
import { describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PopoverSurface } from "../../src/components/ui/overlays/PopoverSurface";

const renderPopover = () => {
  const TestHarness: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(true);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);

    return (
      <div>
        <button ref={triggerRef} data-testid="popover-trigger">
          Trigger
        </button>
        <PopoverSurface
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          anchorRef={triggerRef}
          dataTestId="popover-surface"
        >
          <button>Popover Item</button>
        </PopoverSurface>
      </div>
    );
  };

  return render(<TestHarness />);
};

describe("PopoverSurface", () => {
  it("keeps an open editor inside the viewport when its content grows", async () => {
    let height = 120;
    let resized!: ResizeObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("innerHeight", 600);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "popover-surface" ? height : 24;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 300,
      y: 350,
      left: 300,
      top: 350,
      width: 80,
      height: 24,
      right: 380,
      bottom: 374,
      toJSON: () => ({}),
    });
    const view = renderPopover();
    try {
      const popup = screen.getByTestId("popover-surface");
      await waitFor(() => expect(popup.style.visibility).toBe("visible"));
      await waitFor(() => expect(observe).toHaveBeenCalledWith(popup));
      expect(Number.parseFloat(popup.style.top)).toBe(382);
      height = 400;
      act(() => resized([], {} as ResizeObserver));
      expect(Number.parseFloat(popup.style.top)).toBeGreaterThanOrEqual(4);
      expect(Number.parseFloat(popup.style.top) + height).toBeLessThanOrEqual(
        596,
      );
      expect(
        screen.getByRole("button", { name: "Popover Item" }),
      ).toBeVisible();
      const disconnectedBeforeUnmount = disconnect.mock.calls.length;
      view.unmount();
      expect(disconnect).toHaveBeenCalledTimes(disconnectedBeforeUnmount + 1);
    } finally {
      view.unmount();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
  it("closes when clicking outside", () => {
    renderPopover();

    expect(screen.getByTestId("popover-surface")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("popover-surface")).not.toBeInTheDocument();
  });

  it("does not close when clicking trigger anchor", () => {
    renderPopover();

    expect(screen.getByTestId("popover-surface")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("popover-trigger"));
    expect(screen.getByTestId("popover-surface")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderPopover();

    expect(screen.getByTestId("popover-surface")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("popover-surface")).not.toBeInTheDocument();
  });
});
