import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTabs } from "../../src/components/session/SessionTabs";
import type {
  Connection,
  ConnectionSession,
  TabGroup,
} from "../../src/types/connection/connection";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

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
const onSessionRetryClose = vi.fn();
const onSessionForceClose = vi.fn();

const originalScrollWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollWidth",
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);

const forceTabOverflow = () => {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "session-tabs-scroll"
        ? 500
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.testid === "session-tabs-scroll"
        ? 100
        : 0;
    },
  });
};

const restoreTabSizing = () => {
  if (originalScrollWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollWidth",
      originalScrollWidth,
    );
  } else {
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  }

  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidth,
    );
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
    clearRuntimeConnectionsForTests();
  });

  it("shows that no session is selected when the tab list is empty", () => {
    mockSessions = [];

    renderTabs({ activeSessionId: undefined });

    expect(screen.getByText("No session selected")).toBeInTheDocument();
    expect(screen.queryByText("No active sessions")).not.toBeInTheDocument();
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

  it("exposes the session status on the tab for e2e observability", () => {
    mockSessions[1] = { ...mockSessions[1], status: "error" };

    renderTabs();

    expect(screen.getByRole("tab", { name: /session one/i })).toHaveAttribute(
      "data-session-status",
      "connected",
    );
    expect(screen.getByRole("tab", { name: /session two/i })).toHaveAttribute(
      "data-session-status",
      "error",
    );
  });

  it("uses canonical saved, protocol, brand, integration, and tool icons", () => {
    const makeSession = (
      id: string,
      protocol: string,
      connectionId = `connection-${id}`,
    ): ConnectionSession => ({
      id,
      connectionId,
      name: id,
      status: "connected",
      startTime: new Date("2026-01-01T00:00:00.000Z"),
      protocol,
      hostname: `${id}.example.test`,
    });
    const makeConnection = (
      id: string,
      protocol: Connection["protocol"],
      overrides: Partial<Connection> = {},
    ): Connection => ({
      id: `connection-${id}`,
      name: id,
      protocol,
      hostname: `${id}.example.test`,
      port: 22,
      isGroup: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    });

    mockSessions = [
      makeSession("ssh-built-in", "ssh"),
      makeSession("saved-override", "ssh"),
      makeSession("database-brand", "postgresql"),
      makeSession("cloud-brand", "azure"),
      makeSession("integration-brand", "integration:nginx"),
      makeSession("settings-tool", "tool:settings", "tool-settings"),
    ];
    mockConnections = [
      makeConnection("ssh-built-in", "ssh"),
      makeConnection("saved-override", "ssh", { icon: "star" }),
      makeConnection("database-brand", "postgresql"),
      makeConnection("cloud-brand", "azure"),
      makeConnection("integration-brand", "integration:nginx", {
        integration: { descriptorKey: "nginx" },
      }),
    ];

    renderTabs({ activeSessionId: "ssh-built-in" });

    const expected = {
      "ssh-built-in": "terminal",
      "saved-override": "star",
      "database-brand": "postgresql",
      "cloud-brand": "azure",
      "integration-brand": "nginx",
      "settings-tool": "tool:settings",
    } as const;

    Object.entries(expected).forEach(([name, iconKey]) => {
      const tab = screen.getByRole("tab", { name });
      expect(
        tab.querySelector(`[data-session-icon="${iconKey}"]`),
        `${name} should render ${iconKey}`,
      ).toBeInTheDocument();
    });
  });

  it("uses the canonical provider icon for an ephemeral pfSense WebGUI tab", () => {
    const runtimeConnection: Connection = {
      id: "runtime-pfsense-webui",
      name: "pfSense WebGUI",
      protocol: "https",
      hostname: "fw.example.test",
      port: 443,
      isGroup: false,
      icon: "pfsense",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    };
    registerRuntimeConnection(runtimeConnection);
    mockConnections = [];
    mockSessions = [
      {
        id: "runtime-pfsense-session",
        connectionId: runtimeConnection.id,
        name: runtimeConnection.name,
        status: "connected",
        startTime: new Date("2026-08-31T00:00:00.000Z"),
        protocol: runtimeConnection.protocol,
        hostname: runtimeConnection.hostname,
      },
    ];

    renderTabs({ activeSessionId: "runtime-pfsense-session" });

    const tab = screen.getByRole("tab", { name: "pfSense WebGUI" });
    expect(
      tab.querySelector('[data-session-icon="pfsense"]'),
    ).toBeInTheDocument();
  });

  it("keeps canonical database and tool icons in the overflow menu", async () => {
    forceTabOverflow();
    mockSessions = [
      {
        id: "postgres-tab",
        connectionId: "postgres-connection",
        name: "Postgres tab",
        status: "connected",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        protocol: "postgresql",
        hostname: "postgres.example.test",
      },
      {
        id: "database-tool",
        connectionId: "tool-database",
        name: "Database tool",
        status: "connected",
        startTime: new Date("2026-01-01T00:00:00.000Z"),
        protocol: "tool:database",
        hostname: "",
      },
    ];
    mockConnections = [
      {
        id: "postgres-connection",
        name: "Postgres",
        protocol: "postgresql",
        hostname: "postgres.example.test",
        port: 5432,
        isGroup: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    renderTabs({ activeSessionId: "postgres-tab" });
    fireEvent.click(
      await screen.findByRole("button", { name: /show all tabs/i }),
    );

    const menu = await screen.findByTestId("session-tabs-overflow-menu");
    const postgresItem = within(menu).getByRole("menuitem", {
      name: "Postgres tab",
    });
    const databaseToolItem = within(menu).getByRole("menuitem", {
      name: "Database tool",
    });

    expect(
      postgresItem.querySelector('[data-session-icon="postgresql"]'),
    ).toBeInTheDocument();
    expect(
      databaseToolItem.querySelector('[data-session-icon="tool:database"]'),
    ).toBeInTheDocument();
  });

  it("dims an unresponsive tab, disables ordinary interaction, and exposes explicit recovery controls", async () => {
    renderTabs({
      sessionCloseStates: {
        s1: {
          sessionId: "s1",
          attemptId: 7,
          phase: "unresponsive",
          startedAt: Date.now(),
          timeoutMs: 15_000,
          cleanupPending: true,
          message:
            "Cleanup is still pending. Check again or force close the tab.",
        },
      },
      onSessionRetryClose,
      onSessionForceClose,
    });

    const tab = screen.getByRole("tab", { name: /session one/i });
    expect(tab).not.toHaveAttribute("aria-disabled");
    expect(tab).toHaveAttribute("data-interaction-disabled", "true");
    expect(tab).toHaveAttribute("data-close-state", "unresponsive");
    expect(tab).toHaveClass("opacity-60", "saturate-50");
    expect(tab).not.toHaveAttribute("draggable", "true");

    fireEvent.click(tab);
    expect(onSessionSelect).not.toHaveBeenCalledWith("s1");
    expect(
      within(tab).queryByTestId("session-tab-detach"),
    ).not.toBeInTheDocument();
    expect(
      within(tab).queryByTestId("session-tab-close"),
    ).not.toBeInTheDocument();

    const retryButton = within(tab).getByRole("button", {
      name: /check cleanup again/i,
    });
    const forceButton = within(tab).getByRole("button", {
      name: /force close session one/i,
    });
    expect(retryButton).toBeEnabled();
    expect(forceButton).toBeEnabled();

    fireEvent.click(retryButton);
    expect(onSessionRetryClose).toHaveBeenCalledWith("s1");

    fireEvent.click(forceButton);
    expect(onSessionForceClose).toHaveBeenCalledWith("s1");

    fireEvent.contextMenu(tab);
    expect(
      await screen.findByRole("menuitem", {
        name: /check existing cleanup again/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", {
        name: /force close tab.*cleanup unconfirmed/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /^rename tab$/i }),
    ).not.toBeInTheDocument();
  });

  it("announces a bounded close in progress without exposing force prematurely", () => {
    renderTabs({
      sessionCloseStates: {
        s1: {
          sessionId: "s1",
          attemptId: 8,
          phase: "closing",
          startedAt: Date.now(),
          timeoutMs: 15_000,
          cleanupPending: true,
          message: "Closing session and waiting for cleanup…",
        },
      },
      onSessionRetryClose,
      onSessionForceClose,
    });

    const tab = screen.getByRole("tab", { name: /session one.*closing/i });
    expect(tab).toHaveAttribute("aria-busy", "true");
    expect(tab).toHaveAttribute("data-close-state", "closing");
    expect(within(tab).getByRole("status")).toHaveAccessibleName(
      /closing session one/i,
    );
    expect(
      within(tab).queryByRole("button", { name: /force close/i }),
    ).not.toBeInTheDocument();
  });

  it("opens and closes submenu with keyboard and updates aria-expanded", async () => {
    renderTabs();

    const firstTab = screen.getByRole("tab", { name: /session one/i });
    fireEvent.contextMenu(firstTab);

    const submenuTrigger = await screen.findByRole("menuitem", {
      name: /add to group/i,
    });
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

    fireEvent.click(
      await screen.findByRole("menuitem", { name: /rename tab/i }),
    );

    expect(
      await screen.findByLabelText(/rename tab session one/i),
    ).toBeInTheDocument();
  });

  it("closes the tab context menu when its tab is removed", async () => {
    const { rerender } = renderTabs();

    const firstTab = screen.getByRole("tab", { name: /session one/i });
    fireEvent.contextMenu(firstTab);

    expect(
      await screen.findByTestId("session-tab-context-menu"),
    ).toBeInTheDocument();

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
      expect(
        screen.queryByTestId("session-tab-context-menu"),
      ).not.toBeInTheDocument();
    });
  });

  it("closes a tab from the overflow menu with middle click", async () => {
    forceTabOverflow();
    renderTabs();

    fireEvent.click(
      await screen.findByRole("button", { name: /show all tabs/i }),
    );

    const menu = await screen.findByTestId("session-tabs-overflow-menu");
    fireEvent.mouseDown(
      within(menu).getByRole("menuitem", { name: /session two/i }),
      {
        button: 1,
      },
    );

    expect(onSessionClose).toHaveBeenCalledWith("s2");
    expect(onSessionSelect).not.toHaveBeenCalledWith("s2");
    await waitFor(() => {
      expect(
        screen.queryByTestId("session-tabs-overflow-menu"),
      ).not.toBeInTheDocument();
    });
  });

  it("respects the middle-click close setting in the overflow menu", async () => {
    forceTabOverflow();
    renderTabs({ middleClickCloseTab: false });

    fireEvent.click(
      await screen.findByRole("button", { name: /show all tabs/i }),
    );

    const menu = await screen.findByTestId("session-tabs-overflow-menu");
    fireEvent.mouseDown(
      within(menu).getByRole("menuitem", { name: /session two/i }),
      {
        button: 1,
      },
    );

    expect(onSessionClose).not.toHaveBeenCalled();
  });
});
