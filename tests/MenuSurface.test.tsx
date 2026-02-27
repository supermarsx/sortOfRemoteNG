import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuSurface } from "../src/components/ui/MenuSurface";

const renderMenu = (useIgnoreRef = false) => {
  const TestHarness: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(true);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);

    return (
      <div>
        <button ref={triggerRef} data-testid="menu-trigger">
          Trigger
        </button>
        <MenuSurface
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          position={{ x: 20, y: 20 }}
          dataTestId="menu-surface"
          ignoreRefs={useIgnoreRef ? [triggerRef] : []}
        >
          <button>Menu Item</button>
        </MenuSurface>
      </div>
    );
  };

  return render(<TestHarness />);
};

describe("MenuSurface", () => {
  it("closes when clicking outside", () => {
    renderMenu();

    expect(screen.getByTestId("menu-surface")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("menu-surface")).not.toBeInTheDocument();
  });

  it("ignores outside-close for configured trigger refs", () => {
    renderMenu(true);

    expect(screen.getByTestId("menu-surface")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("menu-trigger"));
    expect(screen.getByTestId("menu-surface")).toBeInTheDocument();
  });

  it("closes on escape", () => {
    renderMenu();

    expect(screen.getByTestId("menu-surface")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("menu-surface")).not.toBeInTheDocument();
  });
});
