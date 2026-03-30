import React from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MenuSurface } from "../../src/components/ui/overlays/MenuSurface";

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
  it("renders with menu semantics and focuses the first item", async () => {
    render(
      <MenuSurface
        isOpen
        onClose={() => {}}
        position={{ x: 20, y: 20 }}
        dataTestId="menu-surface"
        ariaLabel="Test menu"
      >
        <button>First Item</button>
        <button>Second Item</button>
      </MenuSurface>,
    );

    const menu = screen.getByTestId("menu-surface");
    expect(menu).toHaveAttribute("role", "menu");
    expect(menu).toHaveAttribute("aria-label", "Test menu");

    await waitFor(() => {
      expect(screen.getByText("First Item")).toHaveFocus();
    });
  });

  it("navigates menuitems with Arrow keys, Home, and End", async () => {
    render(
      <MenuSurface
        isOpen
        onClose={() => {}}
        position={{ x: 20, y: 20 }}
        dataTestId="menu-surface"
      >
        <button>First Item</button>
        <button>Second Item</button>
        <button>Third Item</button>
      </MenuSurface>,
    );

    const first = screen.getByText("First Item");
    const second = screen.getByText("Second Item");
    const third = screen.getByText("Third Item");

    await waitFor(() => {
      expect(first).toHaveFocus();
    });

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();

    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(third).toHaveFocus();

    fireEvent.keyDown(third, { key: "ArrowUp" });
    expect(second).toHaveFocus();

    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "End" });
    expect(third).toHaveFocus();
  });

  it("opens and closes nested submenus with ArrowRight and ArrowLeft", async () => {
    render(
      <MenuSurface
        isOpen
        onClose={() => {}}
        position={{ x: 20, y: 20 }}
        dataTestId="menu-surface"
      >
        <button>Top Item</button>
        <div className="sor-menu-submenu" data-testid="submenu-wrapper" data-submenu-open="false">
          <button
            id="submenu-trigger"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded="false"
            aria-controls="submenu-panel"
          >
            More Actions
          </button>
          <div id="submenu-panel" className="sor-menu-submenu-panel" role="menu" aria-labelledby="submenu-trigger">
            <button role="menuitem">Sub Item</button>
          </div>
        </div>
      </MenuSurface>,
    );

    const trigger = screen.getByText("More Actions");
    const submenuWrapper = screen.getByTestId("submenu-wrapper");
    const subItem = screen.getByText("Sub Item");

    await waitFor(() => {
      expect(screen.getByText("Top Item")).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByText("Top Item"), { key: "ArrowDown" });
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(submenuWrapper).toHaveAttribute("data-submenu-open", "true");
    await waitFor(() => {
      expect(subItem).toHaveFocus();
    });

    fireEvent.keyDown(subItem, { key: "ArrowLeft" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(submenuWrapper).toHaveAttribute("data-submenu-open", "false");
    expect(trigger).toHaveFocus();
  });

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
