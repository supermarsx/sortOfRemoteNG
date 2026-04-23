import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";
import { Connection } from "../../src/types/connection/connection";

const mockConnections: Connection[] = [
  {
    id: "group1",
    name: "Group 1",
    protocol: "rdp",
    hostname: "",
    port: 0,
    isGroup: true,
    expanded: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "item1",
    name: "Item 1",
    protocol: "rdp",
    hostname: "host",
    port: 3389,
    parentId: "group1",
    isGroup: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function InitConnections({ connections }: { connections: Connection[] }) {
  const { dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: connections });
  }, [connections, dispatch]);
  return (
    <ConnectionTree
      onConnect={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onDisconnect={() => {}}
    />
  );
}

describe("ConnectionTree", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "clone_connection") {
        const src = args?.connection as Connection;
        return {
          ...src,
          id: `${src.id}-copy-${Math.random().toString(36).slice(2, 8)}`,
          name: args?.newName ?? src.name,
          updatedAt: new Date().toISOString(),
        } as any;
      }
      return undefined as any;
    });
  });

  it("toggles group expansion when clicking the toggle button", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections connections={mockConnections} />
        </ConnectionProvider>
      </ToastProvider>,
    );

    expect(screen.queryByText("Item 1")).toBeNull();

    const groupRow = screen
      .getByText("Group 1")
      .closest(".group") as HTMLElement;
    const toggleButton = within(groupRow).getAllByRole("button")[0];

    fireEvent.click(toggleButton);

    expect(await screen.findByText("Item 1")).toBeInTheDocument();
  });

  it("selects an item when clicked", async () => {
    let selectedId: string | null = null;
    const Observer = () => {
      const { state } = useConnections();
      React.useEffect(() => {
        selectedId = state.selectedConnection?.id ?? null;
      }, [state.selectedConnection]);
      return null;
    };

    render(
      <ToastProvider>
        <ConnectionProvider>
          <Observer />
          <InitConnections connections={mockConnections} />
        </ConnectionProvider>
      </ToastProvider>,
    );

    const groupRow = screen
      .getByText("Group 1")
      .closest(".group") as HTMLElement;
    const toggleButton = within(groupRow).getAllByRole("button")[0];
    fireEvent.click(toggleButton);

    const itemRow = screen.getByText("Item 1");
    fireEvent.click(itemRow);

    expect(selectedId).toBe("item1");
  });

  it("duplicates a connection when Duplicate is clicked", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections connections={mockConnections} />
        </ConnectionProvider>
      </ToastProvider>,
    );

    const groupRow = screen
      .getByText("Group 1")
      .closest(".group") as HTMLElement;
    const toggleButton = within(groupRow).getAllByRole("button")[0];
    fireEvent.click(toggleButton);

    const itemGroup = screen
      .getByText("Item 1")
      .closest(".group") as HTMLElement;
    const menuButton = within(itemGroup).getAllByRole("button")[1];
    fireEvent.click(menuButton);

    const duplicateButton = screen.getByText("connections.clone");
    fireEvent.click(duplicateButton);

    await waitFor(() =>
      expect(screen.getAllByText("Item 1")).toHaveLength(2),
    );
  });

  it("closes item context menu on Escape", async () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections connections={mockConnections} />
        </ConnectionProvider>
      </ToastProvider>,
    );

    const groupRow = screen
      .getByText("Group 1")
      .closest(".group") as HTMLElement;
    const toggleButton = within(groupRow).getAllByRole("button")[0];
    fireEvent.click(toggleButton);

    const itemGroup = screen
      .getByText("Item 1")
      .closest(".group") as HTMLElement;
    const menuButton = within(itemGroup).getAllByRole("button")[1];
    fireEvent.click(menuButton);

    expect(screen.getByText("connections.clone")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("connections.clone")).not.toBeInTheDocument();
  });
});
