import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTabs } from "../../src/components/session/SessionTabs";
import type { Connection, ConnectionSession, TabGroup } from "../../src/types/connection/connection";

const mockDispatch = vi.fn();

let mockSessions: ConnectionSession[] = [];
let mockConnections: Connection[] = [];
let mockTabGroups: TabGroup[] = [];

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: mockSessions,
      connections: mockConnections,
      tabGroups: mockTabGroups,
    },
    dispatch: mockDispatch,
  }),
}));

vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      defaultTabColor: "",
    },
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(() => Promise.resolve([])),
}));

const onSessionSelect = vi.fn();
const onSessionClose = vi.fn();
const onSessionDetach = vi.fn();

const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

const forceTabOverflow = () => {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "session-tabs-scroll" ? 500 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "session-tabs-scroll" ? 100 : 0;
    },
  });
};

const restoreTabSizing = () => {
  if (originalScrollWidth) {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", originalScrollWidth);
  } else {
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  }

  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  } else {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  }
};

const renderTabs = (props?: Partial<ComponentProps<typeof SessionTabs>>) =>
  render(
    <SessionTabs
      activeSessionId="s1"
      onSessionSelect={onSessionSelect}
      onSessionClose={onSessionClose}
      onSessionDetach={onSessionDetach}
      {...props}
    />,
  );

describe("SessionTabs accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSessions = [
      {
        id: "s1",
        connectionId: "c1",
        name: "Session One",
        status: "connected",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        protocol: "ssh",
        hostname: "host-1",
      },
      {
        id: "s2",
        connectionId: "c2",
        name: "Session Two",
        status: "disconnected",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        protocol: "ssh",
        hostname: "host-2",
      },
    ];

    mockConnections = [
      {
        id: "c1",
        name: "Connection One",
        protocol: "ssh",
        hostname: "host-1",
        port: 22,
        isGroup: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      },
      {
        id: "c2",
        name: "Connection Two",
        protocol: "ssh",
        hostname: "host-2",
        port: 22,
        isGroup: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      },
    ];

    mockTabGroups = [
      {
        id: "g1",
        name: "Ops",
        color: "#22c55e",
        collapsed: false,
      },
    ];
  });

  afterEach(() => {
    restoreTabSizing();
  });

  it("exposes tablist and tab semantics", () => {
    renderTabs();

    const tablist = screen.getByRole("tablist", { name: /session tabs/i });
    expect(tablist).toBeInTheDocument();

    const firstTab = screen.getByRole("tab", { name: /session one/i });
    const secondTab = screen.getByRole("tab", { name: /session two/i });

    expect(firstTab).toHaveAttribute("aria-selected", "true");
    expect(secondTab).toHaveAttribute("aria-selected", "false");
    expect(firstTab).toHaveAttribute("aria-controls", "session-main-panel");
    expect(secondTab).toHaveAttribute("aria-controls", "session-main-panel");
  });

  it("opens and closes submenu with keyboard and updates aria-expanded", async () => {
    renderTabs();

    const firstTab = screen.getByRole("tab", { name: /session one/i });
    fireEvent.contextMenu(firstTab);

    const submenuTrigger = await screen.findByRole("menuitem", { name: /add to group/i });
    expect(submenuTrigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(submenuTrigger, { key: "ArrowRight" });

    await waitFor(() => {
      expect(submenuTrigger).toHaveAttribute("aria-expanded", "true");
    });

    const submenu = screen.getByRole("menu", { name: /add to group/i });
    const groupItem = within(submenu).getByRole("menuitem", { name: /ops/i });
    expect(groupItem).toBeInTheDocument();

    fireEvent.keyDown(groupItem, { key: "ArrowLeft" });

    await waitFor(() => {
      expect(submenuTrigger).toHaveAttribute("aria-expanded", "false");
      expect(submenuTrigger).toHaveFocus();
    });
  });

  it("adds an accessible label to inline tab rename input", async () => {
    renderTabs();

    const firstTab = screen.getByRole("tab", { name: /session one/i });
    fireEvent.contextMenu(firstTab);

    fireEvent.click(await screen.findByRole("menuitem", { name: /rename tab/i }));

    expect(await screen.findByLabelText(/rename tab session one/i)).toBeInTheDocument();
  });

  it("closes the tab context menu when its tab is removed", async () => {
    const { rerender } = renderTabs();

    const firstTab = screen.getByRole("tab", { name: /session one/i });
    fireEvent.contextMenu(firstTab);

    expect(await screen.findByTestId("session-tab-context-menu")).toBeInTheDocument();

    mockSessions = mockSessions.filter((session) => session.id !== "s1");
    rerender(
      <SessionTabs
        activeSessionId="s2"
        onSessionSelect={onSessionSelect}
        onSessionClose={onSessionClose}
        onSessionDetach={onSessionDetach}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("session-tab-context-menu")).not.toBeInTheDocument();
    });
  });

  it("closes a tab from the overflow menu with middle click", async () => {
    forceTabOverflow();
    renderTabs();

    fireEvent.click(await screen.findByRole("button", { name: /show all tabs/i }));

    const menu = await screen.findByTestId("session-tabs-overflow-menu");
    fireEvent.mouseDown(within(menu).getByRole("menuitem", { name: /session two/i }), {
      button: 1,
    });

    expect(onSessionClose).toHaveBeenCalledWith("s2");
    expect(onSessionSelect).not.toHaveBeenCalledWith("s2");
    await waitFor(() => {
      expect(screen.queryByTestId("session-tabs-overflow-menu")).not.toBeInTheDocument();
    });
  });

  it("respects the middle-click close setting in the overflow menu", async () => {
    forceTabOverflow();
    renderTabs({ middleClickCloseTab: false });

    fireEvent.click(await screen.findByRole("button", { name: /show all tabs/i }));

    const menu = await screen.findByTestId("session-tabs-overflow-menu");
    fireEvent.mouseDown(within(menu).getByRole("menuitem", { name: /session two/i }), {
      button: 1,
    });

    expect(onSessionClose).not.toHaveBeenCalled();
  });
});
