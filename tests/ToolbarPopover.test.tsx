import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ToolbarPopover,
  ToolbarPopoverHeader,
} from "../src/components/ui/ToolbarPopover";

const renderPopover = () => {
  const TestHarness: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(true);
    const anchorRef = React.useRef<HTMLButtonElement | null>(null);

    return (
      <div>
        <button ref={anchorRef} data-testid="toolbar-popover-anchor">
          Anchor
        </button>
        <ToolbarPopover
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          anchorRef={anchorRef}
          dataTestId="toolbar-popover"
        >
          <ToolbarPopoverHeader
            title="Toolbar Popover"
            actions={<button data-testid="toolbar-extra-action">Extra</button>}
            onClose={() => setIsOpen(false)}
          />
          <div>Body Content</div>
        </ToolbarPopover>
      </div>
    );
  };

  return render(<TestHarness />);
};

describe("ToolbarPopover", () => {
  it("renders header/actions and closes from close button", () => {
    renderPopover();

    expect(screen.getByTestId("toolbar-popover")).toBeInTheDocument();
    expect(screen.getByText("Toolbar Popover")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-extra-action")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("toolbar-popover")).not.toBeInTheDocument();
  });

  it("closes on outside click", () => {
    renderPopover();

    expect(screen.getByTestId("toolbar-popover")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("toolbar-popover")).not.toBeInTheDocument();
  });
});
