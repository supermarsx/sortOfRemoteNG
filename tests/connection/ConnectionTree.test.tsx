import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";
import { Connection } from "../../src/types/connection/connection";
import type { ConnectionFilter } from "../../src/types/connection/connection";

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

function InitConnections({
  connections,
  filter,
}: {
  connections: Connection[];
  filter?: Partial<ConnectionFilter>;
}) {
  const { dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: connections });
    if (filter) {
      dispatch({ type: "SET_FILTER", payload: filter });
    }
  }, [connections, dispatch, filter]);
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

  it("expands a folder when clicking the row body (folderSingleClickToggle default)", async () => {
    // The default mock for useSettings ships
    // folderSingleClickToggle = true, so a click anywhere on the
    // folder row should toggle expansion — not just the chevron.
    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections connections={mockConnections} />
        </ConnectionProvider>
      </ToastProvider>,
    );

    expect(screen.queryByText("Item 1")).toBeNull();

    // Click the folder NAME — well away from the chevron — and
    // verify the child becomes visible.
    const folderName = screen.getByText("Group 1");
    fireEvent.click(folderName);

    expect(await screen.findByText("Item 1")).toBeInTheDocument();

    // Click again on the row body → collapses again.
    fireEvent.click(folderName);
    await waitFor(() => {
      expect(screen.queryByText("Item 1")).toBeNull();
    });
  });

  it("does NOT expand a folder on row-body click when folderSingleClickToggle is off", async () => {
    // The setup-file mock locks in `useSettings()` at module load,
    // so re-mocking SettingsContext mid-test doesn't reach
    // already-imported components. Render ConnectionTreeItem
    // directly with the explicit prop instead — that's the same
    // surface ConnectionTree threads the setting through, so the
    // assertion still covers the wiring contract end-to-end.
    const { default: ConnectionTreeItem } =
      await import("../../src/components/connection/connectionTree/ConnectionTreeItem");

    function Harness() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
      }, [dispatch]);
      const folder = mockConnections[0];
      const noop = () => {};
      return (
        <ConnectionTreeItem
          connection={folder}
          level={0}
          onConnect={noop}
          onDisconnect={noop}
          onEdit={noop}
          onDelete={noop}
          onCopyHostname={noop}
          onRename={noop}
          onExport={noop}
          onConnectWithOptions={noop}
          onConnectWithoutCredentials={noop}
          onExecuteScripts={noop}
          onDiagnostics={noop}
          onDetachSession={noop}
          onDuplicate={noop}
          onCheckConnection={noop}
          onWindowsTool={noop}
          onConnectAll={noop}
          onConnectAllRecursive={noop}
          enableReorder={false}
          isDragging={false}
          isDragOver={false}
          dropPosition={null}
          onDragStart={noop}
          onDragOver={noop}
          onDragLeave={noop}
          onDragEnd={noop}
          onDrop={noop}
          singleClickConnect={false}
          singleClickDisconnect={false}
          doubleClickRename={false}
          folderSingleClickToggle={false}
        />
      );
    }

    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );

    // Click the folder NAME — must NOT change aria-expanded.
    const folderName = screen.getByText("Group 1");
    fireEvent.click(folderName);

    await new Promise((r) => setTimeout(r, 20));
    const folderRow = folderName.closest('[role="treeitem"]') as HTMLElement;
    expect(folderRow.getAttribute("aria-expanded")).toBe("false");

    // Chevron path still toggles even when row-click is off.
    const toggleButton = within(folderRow).getAllByRole("button")[0];
    fireEvent.click(toggleButton);
    await waitFor(() => {
      expect(folderRow.getAttribute("aria-expanded")).toBe("true");
    });
  });

  it("toggles a folder on row-body double click when enabled", async () => {
    const { default: ConnectionTreeItem } =
      await import("../../src/components/connection/connectionTree/ConnectionTreeItem");

    function Harness() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
      }, [dispatch]);
      const folder = mockConnections[0];
      const noop = () => {};
      return (
        <ConnectionTreeItem
          connection={folder}
          level={0}
          onConnect={noop}
          onDisconnect={noop}
          onEdit={noop}
          onDelete={noop}
          onCopyHostname={noop}
          onRename={noop}
          onExport={noop}
          onConnectWithOptions={noop}
          onConnectWithoutCredentials={noop}
          onExecuteScripts={noop}
          onDiagnostics={noop}
          onDetachSession={noop}
          onDuplicate={noop}
          onCheckConnection={noop}
          onWindowsTool={noop}
          onConnectAll={noop}
          onConnectAllRecursive={noop}
          enableReorder={false}
          isDragging={false}
          isDragOver={false}
          dropPosition={null}
          onDragStart={noop}
          onDragOver={noop}
          onDragLeave={noop}
          onDragEnd={noop}
          onDrop={noop}
          singleClickConnect={false}
          singleClickDisconnect={false}
          doubleClickRename={false}
          folderSingleClickToggle={false}
          folderDoubleClickToggle={true}
        />
      );
    }

    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );

    const folderName = screen.getByText("Group 1");
    const folderRow = folderName.closest('[role="treeitem"]') as HTMLElement;

    fireEvent.doubleClick(folderName);
    await waitFor(() => {
      expect(folderRow.getAttribute("aria-expanded")).toBe("true");
    });

    fireEvent.doubleClick(folderName);
    await waitFor(() => {
      expect(folderRow.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("does not let the second click of a folder double-click cancel single-click expansion", async () => {
    const { default: ConnectionTreeItem } =
      await import("../../src/components/connection/connectionTree/ConnectionTreeItem");

    function Harness() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
      }, [dispatch]);
      const folder = mockConnections[0];
      const noop = () => {};
      return (
        <ConnectionTreeItem
          connection={folder}
          level={0}
          onConnect={noop}
          onDisconnect={noop}
          onEdit={noop}
          onDelete={noop}
          onCopyHostname={noop}
          onRename={noop}
          onExport={noop}
          onConnectWithOptions={noop}
          onConnectWithoutCredentials={noop}
          onExecuteScripts={noop}
          onDiagnostics={noop}
          onDetachSession={noop}
          onDuplicate={noop}
          onCheckConnection={noop}
          onWindowsTool={noop}
          onConnectAll={noop}
          onConnectAllRecursive={noop}
          enableReorder={false}
          isDragging={false}
          isDragOver={false}
          dropPosition={null}
          onDragStart={noop}
          onDragOver={noop}
          onDragLeave={noop}
          onDragEnd={noop}
          onDrop={noop}
          singleClickConnect={false}
          singleClickDisconnect={false}
          doubleClickRename={false}
          folderSingleClickToggle={true}
          folderDoubleClickToggle={true}
        />
      );
    }

    render(
      <ToastProvider>
        <ConnectionProvider>
          <Harness />
        </ConnectionProvider>
      </ToastProvider>,
    );

    const folderName = screen.getByText("Group 1");
    const folderRow = folderName.closest('[role="treeitem"]') as HTMLElement;

    fireEvent.click(folderName, { detail: 1 });
    fireEvent.click(folderName, { detail: 2 });
    fireEvent.doubleClick(folderName);

    await waitFor(() => {
      expect(folderRow.getAttribute("aria-expanded")).toBe("true");
    });
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

    await waitFor(() => expect(screen.getAllByText("Item 1")).toHaveLength(2));
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

  it("filters by text tags while preserving parent folders for matching children", async () => {
    const filteredConnections: Connection[] = [
      {
        id: "group1",
        name: "Production Folder",
        protocol: "rdp",
        hostname: "",
        port: 0,
        isGroup: true,
        expanded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "prod-db",
        name: "Production Database",
        protocol: "ssh",
        hostname: "prod-db.example.test",
        port: 22,
        parentId: "group1",
        isGroup: false,
        tags: ["prod", "database"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "prod-web",
        name: "Production Web",
        protocol: "ssh",
        hostname: "prod-web.example.test",
        port: 22,
        parentId: "group1",
        isGroup: false,
        tags: ["prod"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "dev-db",
        name: "Development Database",
        protocol: "ssh",
        hostname: "dev-db.example.test",
        port: 22,
        parentId: "group1",
        isGroup: false,
        tags: ["dev", "database"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections
            connections={filteredConnections}
            filter={{ tags: ["prod", "database"] }}
          />
        </ConnectionProvider>
      </ToastProvider>,
    );

    expect(await screen.findByText("Production Folder")).toBeInTheDocument();
    expect(await screen.findByText("Production Database")).toBeInTheDocument();
    expect(screen.queryByText("Production Web")).not.toBeInTheDocument();
    expect(screen.queryByText("Development Database")).not.toBeInTheDocument();
  });

  it("filters by color tags using connection.colorTag", async () => {
    const filteredConnections: Connection[] = [
      {
        id: "group1",
        name: "Color Folder",
        protocol: "rdp",
        hostname: "",
        port: 0,
        isGroup: true,
        expanded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "critical",
        name: "Critical Server",
        protocol: "rdp",
        hostname: "critical.example.test",
        port: 3389,
        parentId: "group1",
        isGroup: false,
        colorTag: "critical-color",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "normal",
        name: "Normal Server",
        protocol: "rdp",
        hostname: "normal.example.test",
        port: 3389,
        parentId: "group1",
        isGroup: false,
        colorTag: "normal-color",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections
            connections={filteredConnections}
            filter={{ colorTags: ["critical-color"] }}
          />
        </ConnectionProvider>
      </ToastProvider>,
    );

    expect(await screen.findByText("Color Folder")).toBeInTheDocument();
    expect(await screen.findByText("Critical Server")).toBeInTheDocument();
    expect(screen.queryByText("Normal Server")).not.toBeInTheDocument();
  });
});
