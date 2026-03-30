import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const renderTabs = () =>
  render(
    <SessionTabs
      activeSessionId="s1"
      onSessionSelect={onSessionSelect}
      onSessionClose={onSessionClose}
      onSessionDetach={onSessionDetach}
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
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "c2",
        name: "Connection Two",
        protocol: "ssh",
        hostname: "host-2",
        port: 22,
        isGroup: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
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
});
