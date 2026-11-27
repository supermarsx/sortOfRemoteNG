import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TreeItemMenu from "../../src/components/connection/connectionTree/TreeItemMenu";
import type { Connection } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  reveal: vi.fn(),
  diagnostics: vi.fn(),
  check: vi.fn(),
  sessions: [] as Array<{ id: string; connectionId: string; protocol: string }>,
  emit: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [], sessions: mocks.sessions },
    dispatch: vi.fn(),
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: async () => [] }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => mocks.emit(...args),
}));

const connection: Connection = {
  id: "saved-connection",
  name: "Saved website",
  protocol: "https",
  hostname: "example.test",
  port: 443,
  isGroup: false,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
};

function mount(
  overrides: Partial<Connection> = {},
  active = true,
  openSpecial = true,
) {
  const row = { ...connection, ...overrides };
  const noop = vi.fn();
  render(
    <TreeItemMenu
      connection={row}
      activeSession={
        active ? { id: "existing-tab", status: "connected" } : undefined
      }
      showMenu
      menuPosition={{ x: 20, y: 20 }}
      triggerRef={{ current: null }}
      onClose={noop}
      onConnect={mocks.connect}
      onDisconnect={mocks.disconnect}
      onSessionReconnect={mocks.reconnect}
      onRevealSession={mocks.reveal}
      onDiagnostics={mocks.diagnostics}
      onCheckConnection={mocks.check}
      onEdit={noop}
      onDelete={noop}
      onCopyHostname={noop}
      onRename={noop}
      onExport={noop}
      onConnectWithOptions={noop}
      onConnectWithoutCredentials={noop}
      onExecuteScripts={noop}
      onDuplicate={noop}
    />,
  );
  if (openSpecial)
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Connect / reconnect" }),
    );
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessions = [];
  mocks.connect.mockResolvedValue("new-tab");
  mocks.emit.mockResolvedValue(undefined);
});

describe("connection tree repeated sessions", () => {
  it("keeps diagnostic actions inside an accessible submenu", () => {
    const row = mount({}, true, false);
    expect(screen.queryByRole("menuitem", { name: "Connection diagnostics" })).toBeNull();
    const trigger = screen.getByRole("menuitem", { name: "Diagnostics" });
    fireEvent.mouseEnter(trigger.parentElement!);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Connection diagnostics" }));
    expect(mocks.diagnostics).toHaveBeenCalledExactlyOnceWith(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Check connection" }));
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith(row);
  });
  it("reveals the selected existing tab without connecting another session", () => {
    mocks.sessions = [{ id: "one", connectionId: connection.id, protocol: "https" }, { id: "two", connectionId: connection.id, protocol: "https" }];
    mount({}, true, false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal tab" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /HTTPS 2/ }));
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith("two");
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.reconnect).not.toHaveBeenCalled();
  });
  it("keeps Disconnect on the main menu and opens special actions through a submenu", () => {
    mount({}, true, false);
    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reconnect this tab" }),
    ).toBeNull();
    const trigger = screen.getByRole("menuitem", {
      name: "Connect / reconnect",
    });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Reconnect this tab" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole("menu", { name: "Connect / reconnect" }),
      { key: "Escape" },
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Reconnect this tab" }),
    ).toBeNull();
  });
  it("reconnects this tab using the existing session action", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect this tab" }));
    expect(mocks.reconnect).toHaveBeenCalledExactlyOnceWith("existing-tab");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("reconnects all tabs of this connection without reconnecting tools or other connections", async () => {
    mocks.sessions = [
      { id: "existing-tab", connectionId: connection.id, protocol: "https" },
      { id: "second-tab", connectionId: connection.id, protocol: "https" },
      { id: "tool", connectionId: connection.id, protocol: "tool:files" },
      { id: "other", connectionId: "other-connection", protocol: "https" },
    ];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect all tabs" }));
    await waitFor(() =>
      expect(mocks.reconnect.mock.calls).toEqual([
        ["existing-tab"],
        ["second-tab"],
      ]),
    );
  });
  it.each(["ssh", "http", "https", "rdp", "vnc"] as const)(
    "offers an additional %s tab without disconnecting the existing one",
    async (protocol) => {
      const row = mount({ protocol });
      fireEvent.click(
        screen.getByRole("button", { name: "Connect again (new tab)" }),
      );
      expect(mocks.connect).toHaveBeenCalledExactlyOnceWith(row);
      expect(mocks.disconnect).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Disconnect" }),
      ).toBeInTheDocument();
    },
  );
  it("places only the new session in a separate window", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect in New Window" }),
    );
    await waitFor(() =>
      expect(mocks.emit).toHaveBeenCalledExactlyOnceWith(
        "connect-in-new-window",
        { sessionId: "new-tab" },
      ),
    );
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });
  it("does not move an existing tab when a new connection is cancelled", async () => {
    mocks.connect.mockResolvedValue(undefined);
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect in New Window" }),
    );
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("does not promise independent tabs for shared integration backends", () => {
    mount({ protocol: "integration:proxmox" });
    expect(
      screen.queryByRole("button", { name: "Connect again (new tab)" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Connect in New Window" }),
    ).toBeNull();
  });
  it("keeps the normal Connect action when no session exists", () => {
    const row = mount({}, false);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith(row);
    expect(
      screen.queryByRole("button", { name: "Connect again (new tab)" }),
    ).toBeNull();
  });
});
