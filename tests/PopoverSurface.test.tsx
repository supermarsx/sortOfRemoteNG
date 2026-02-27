import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PopoverSurface } from "../src/components/ui/PopoverSurface";

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
