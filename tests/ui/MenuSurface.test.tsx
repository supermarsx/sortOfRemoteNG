import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MenuSurface } from "../../src/components/ui/overlays/MenuSurface";
import { listen } from "@tauri-apps/api/event";

const nativeEvents = vi.hoisted(() => ({
  callback: undefined as undefined | (() => void),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: () => void) => {
    if (name === "origin-browser-native-focus")
      nativeEvents.callback = callback;
    return nativeEvents.unlisten;
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

const rect = (x: number, y: number, width: number, height: number): DOMRect =>
  ({
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  }) as DOMRect;

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
};

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
  it("preserves a user's menu choice when initial autofocus runs later", () => {
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        frame = callback;
        return 1;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    render(
      <MenuSurface isOpen onClose={() => {}} position={{ x: 20, y: 20 }}>
        <button role="menuitem">First</button>
        <button role="menuitem">User choice</button>
      </MenuSurface>,
    );
    const choice = screen.getByRole("menuitem", { name: "User choice" });
    expect(frame).toBeTypeOf("function");
    act(() => {
      choice.focus();
      frame!(0);
    });
    expect(choice).toHaveFocus();
    expect(choice).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
        <div
          className="sor-menu-submenu"
          data-testid="submenu-wrapper"
          data-submenu-open="false"
        >
          <button
            id="submenu-trigger"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded="false"
            aria-controls="submenu-panel"
          >
            More Actions
          </button>
          <div
            id="submenu-panel"
            className="sor-menu-submenu-panel"
            role="menu"
            aria-labelledby="submenu-trigger"
          >
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

  it("clamps to the viewport and opens flyouts inward near the right edge", async () => {
    setViewport(700, 400);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getRect(this: HTMLElement) {
        const x = Number.parseFloat(this.style.left || "0") || 0;
        const y = Number.parseFloat(this.style.top || "0") || 0;
        if (this.getAttribute("data-testid") === "menu-surface") {
          return rect(x, y, 160, 80);
        }
        return rect(x, y, 0, 0);
      },
    );

    render(
      <MenuSurface
        isOpen
        onClose={() => {}}
        position={{ x: 650, y: 350 }}
        dataTestId="menu-surface"
      >
        <button>Top Item</button>
        <div
          className="sor-menu-submenu"
          data-testid="submenu-wrapper"
          data-submenu-open="false"
        >
          <button role="menuitem" aria-haspopup="menu">
            More Actions
          </button>
          <div className="sor-menu-submenu-panel" role="menu">
            <button role="menuitem">Sub Item</button>
          </div>
        </div>
      </MenuSurface>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("menu-surface")).toHaveStyle({
        left: "536px",
        top: "316px",
      });
    });

    expect(screen.getByTestId("submenu-wrapper")).toHaveAttribute(
      "data-submenu-side",
      "left",
    );
  });

  it("dismisses on native CEF focus without restoring shell focus over the user's click", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const restore = vi.spyOn(trigger, "focus");
    renderMenu();
    await waitFor(() => expect(screen.getByText("Menu Item")).toHaveFocus());
    await waitFor(() => expect(nativeEvents.callback).toBeTypeOf("function"));
    expect(listen).toHaveBeenCalledWith(
      "origin-browser-native-focus",
      expect.any(Function),
      { target: "main" },
    );
    act(() => nativeEvents.callback!());
    expect(screen.queryByTestId("menu-surface")).not.toBeInTheDocument();
    expect(restore).not.toHaveBeenCalled();
    trigger.remove();
  });

  it("ignores a native receipt after its menu has unmounted", async () => {
    const close = vi.fn();
    const view = render(
      <MenuSurface isOpen onClose={close} position={{ x: 20, y: 20 }}>
        <button>Item</button>
      </MenuSurface>,
    );
    await waitFor(() => expect(nativeEvents.callback).toBeTypeOf("function"));
    const stale = nativeEvents.callback!;
    view.unmount();
    act(() => stale());
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps outside-close-disabled menus unsubscribed from native focus", async () => {
    const close = vi.fn();
    const calls = vi.mocked(listen).mock.calls.length;
    render(
      <MenuSurface
        isOpen
        onClose={close}
        closeOnOutside={false}
        position={{ x: 20, y: 20 }}
      >
        <button>Item</button>
      </MenuSurface>,
    );
    await act(async () => {});
    expect(vi.mocked(listen).mock.calls).toHaveLength(calls);
    expect(close).not.toHaveBeenCalled();
  });

  it("releases a native subscription that resolves after unmount", async () => {
    let resolve: ((off: () => void) => void) | undefined;
    vi.mocked(listen).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <MenuSurface isOpen onClose={() => {}} position={{ x: 20, y: 20 }}>
        <button>Item</button>
      </MenuSurface>,
    );
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    view.unmount();
    const off = vi.fn();
    await act(async () => {
      resolve!(off);
    });
    expect(off).toHaveBeenCalledOnce();
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
