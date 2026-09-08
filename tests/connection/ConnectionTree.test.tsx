import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
  act,
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
  it.each([
    { icon: "folder-lock", selector: ".lucide-folder-lock" },
    { icon: "server", selector: ".lucide-server" },
    { icon: undefined, selector: ".lucide-folder" },
    { icon: "unknown-folder-icon", selector: ".lucide-folder" },
  ])(
    "preserves the saved $icon folder icon through expansion",
    async ({ icon, selector }) => {
      const connections = [{ ...mockConnections[0], icon }];
      render(
        <ToastProvider>
          <ConnectionProvider>
            <InitConnections connections={connections} />
          </ConnectionProvider>
        </ToastProvider>,
      );
      const folderRow = await screen.findByTestId("connection-group");
      expect(folderRow.querySelector(selector)).toBeInTheDocument();
      fireEvent.click(within(folderRow).getAllByRole("button")[0]);
      await waitFor(() =>
        expect(folderRow).toHaveAttribute("aria-expanded", "true"),
      );
      expect(
        folderRow.querySelector(
          icon === "folder-lock" || icon === "server"
            ? selector
            : ".lucide-folder-open",
        ),
      ).toBeInTheDocument();
      fireEvent.click(within(folderRow).getAllByRole("button")[0]);
      await waitFor(() =>
        expect(folderRow).toHaveAttribute("aria-expanded", "false"),
      );
      expect(folderRow.querySelector(selector)).toBeInTheDocument();
    },
  );

  it.each([0, 40])(
    "does not re-render a %i-row non-virtual tree when it scrolls",
    (count) => {
      const connections = Array.from({ length: count }, (_, index) => ({
        ...mockConnections[1],
        id: `small-${index}`,
        name: `Small ${index}`,
        parentId: undefined,
      }));
      const onRender = vi.fn();
      render(
        <ToastProvider>
          <ConnectionProvider>
            <React.Profiler id="tree" onRender={onRender}>
              <InitConnections connections={connections} />
            </React.Profiler>
          </ConnectionProvider>
        </ToastProvider>,
      );
      const tree = screen.getByRole("tree");
      const before = onRender.mock.calls.length;
      for (let i = 1; i <= 5; i++)
        fireEvent.scroll(tree, { target: { scrollTop: i * 40 } });
      expect(onRender).toHaveBeenCalledTimes(before);
    },
  );

  it.each([
    { transition: "enabling", initiallyVirtual: false, scrollOffset: 640 },
    { transition: "re-enabling", initiallyVirtual: true, scrollOffset: 1920 },
  ])(
    "preserves the DOM scroll offset when $transition virtualization",
    ({ initiallyVirtual, scrollOffset }) => {
      const connections = Array.from({ length: 240 }, (_, index) => ({
        ...mockConnections[1],
        id: `threshold-${index}`,
        name: `Threshold ${String(index).padStart(3, "0")}`,
        parentId: undefined,
      }));
      const ordinaryConnections = connections.slice(0, 200);
      const initialConnections = initiallyVirtual
        ? connections
        : ordinaryConnections;
      let updateConnections: (rows: Connection[]) => void;
      function ThresholdTree() {
        const { dispatch } = useConnections();
        React.useLayoutEffect(() => {
          updateConnections = (rows) =>
            dispatch({ type: "SET_CONNECTIONS", payload: rows });
        }, [dispatch]);
        return <InitConnections connections={initialConnections} />;
      }
      render(
        <ToastProvider>
          <ConnectionProvider>
            <ThresholdTree />
          </ConnectionProvider>
        </ToastProvider>,
      );
      const tree = screen.getByRole("tree");
      // These assertions check mounted DOM size, not computed accessibility.
      const mountedRows = () => tree.querySelectorAll('[role="treeitem"]');
      const row = (index: number) =>
        tree.querySelector(`[data-connection-id="threshold-${index}"]`);
      // Dispatch directly: rerendering a prop-driven initializer first renders
      // the old rich rows again, then changes the connections in its effect.
      if (initiallyVirtual) {
        expect(mountedRows().length).toBeLessThan(50);
        fireEvent.scroll(tree, { target: { scrollTop: 1280 } });
        expect(row(40)).toHaveTextContent("Threshold 040");
        expect(row(20)).not.toBeInTheDocument();
        act(() => updateConnections(ordinaryConnections));
      }
      expect(mountedRows()).toHaveLength(200);
      fireEvent.scroll(tree, { target: { scrollTop: scrollOffset } });
      act(() => updateConnections(connections));
      const firstViewportRow = scrollOffset / 32;
      expect(tree.scrollTop).toBe(scrollOffset);
      expect(row(firstViewportRow)).toHaveTextContent(
        `Threshold ${String(firstViewportRow).padStart(3, "0")}`,
      );
      expect(row(firstViewportRow - 20)).not.toBeInTheDocument();
      expect(mountedRows().length).toBeLessThan(50);

      // The virtual viewport still follows ordinary user scrolling.
      fireEvent.scroll(tree, { target: { scrollTop: scrollOffset + 640 } });
      expect(row(firstViewportRow + 20)).toHaveTextContent(
        `Threshold ${String(firstViewportRow + 20).padStart(3, "0")}`,
      );
      expect(row(firstViewportRow)).not.toBeInTheDocument();
      expect(mountedRows().length).toBeLessThan(50);
    },
  );

  it("bounds a 10,000-connection expanded tree while preserving hierarchy, keyboard navigation and offscreen reveal", async () => {
    const connections: Connection[] = [];
    for (let group = 0; group < 1000; group++) {
      const suffix = String(group).padStart(4, "0");
      connections.push({
        ...mockConnections[0],
        id: `group-${suffix}`,
        name: `Folder ${suffix}`,
        expanded: true,
      });
      for (let child = 0; child < 10; child++) {
        connections.push({
          ...mockConnections[1],
          id: `item-${suffix}-${child}`,
          parentId: `group-${suffix}`,
          name: `Server ${suffix}-${child}`,
        });
      }
    }
    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections connections={connections} />
        </ConnectionProvider>
      </ToastProvider>,
    );
    const tree = screen.getByRole("tree");
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(50);
    expect(
      screen.getByText("Server 0000-0").closest('[role="treeitem"]'),
    ).toHaveAttribute("aria-level", "2");
    expect(
      screen.getByText("Folder 0000").closest('[role="treeitem"]'),
    ).toHaveAttribute("aria-setsize", "1000");
    expect(screen.queryByText("Server 0999-9")).not.toBeInTheDocument();
    fireEvent.keyDown(tree, { key: "End" });
    const last = await screen.findByText("Server 0999-9");
    expect(last.closest('[role="treeitem"]')).toHaveFocus();
    expect(last.closest('[role="treeitem"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(50);
    fireEvent.keyDown(last.closest('[role="treeitem"]')!, { key: "ArrowLeft" });
    const parent = screen
      .getByText("Folder 0999")
      .closest('[role="treeitem"]')!;
    expect(parent).toHaveFocus();
    fireEvent.keyDown(parent, { key: "ArrowLeft" });
    expect(screen.queryByText("Server 0999-9")).not.toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new CustomEvent("reveal-connection", {
          detail: { connectionId: "item-0500-5" },
        }),
      ),
    );
    expect(await screen.findByText("Server 0500-5")).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(50);
  });

  it("keeps custom sibling ordering and drag/drop actions in a virtual viewport", async () => {
    const connections = Array.from({ length: 1000 }, (_, index) => ({
      ...mockConnections[1],
      id: `root-${index}`,
      name: `Root ${index}`,
      parentId: undefined,
      order: 1000 - index,
    }));
    const filter = { sortBy: "custom" as const, sortDirection: "asc" as const };
    render(
      <ToastProvider>
        <ConnectionProvider>
          <InitConnections connections={connections} filter={filter} />
        </ConnectionProvider>
      </ToastProvider>,
    );
    expect(screen.getAllByRole("treeitem")[0]).toHaveTextContent("Root 999");
    const source = screen
      .getByText("Root 998")
      .closest("[data-connection-item]")!;
    const target = screen
      .getByText("Root 999")
      .closest("[data-connection-item]")!;
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    };
    fireEvent.dragStart(source, { dataTransfer });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 32,
    } as DOMRect);
    fireEvent(
      target,
      Object.assign(new MouseEvent("drop", { bubbles: true, clientY: 1 }), {
        dataTransfer,
      }),
    );
    expect(screen.getAllByRole("treeitem")[0]).toHaveTextContent("Root 998");
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(50);
  });

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
      const { state, dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
      }, [dispatch]);
      // Read the live folder from reducer state (as ConnectionTree
      // does) so expand toggles dispatched by the row are reflected back
      // into the connection prop — mirroring the real render path.
      const folder =
        state.connections.find((c) => c.id === mockConnections[0].id) ??
        mockConnections[0];
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
      const { state, dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
      }, [dispatch]);
      const folder =
        state.connections.find((c) => c.id === mockConnections[0].id) ??
        mockConnections[0];
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

  it("reflects external expanded changes live without remounting the row", async () => {
    // Regression: ConnectionTreeItem used to keep a *local* isExpanded
    // copy initialised once from connection.expanded, so an expansion
    // change driven by the reducer (drag-drop auto-expand, collection
    // reload, cross-window settings sync) left the chevron / icon /
    // aria-expanded stale — not applied in real time. The row now reads
    // connection.expanded directly, so a reducer update is reflected
    // immediately, and the child becomes visible, without a remount.
    let externalDispatch: ReturnType<typeof useConnections>["dispatch"];

    function Harness() {
      const { dispatch } = useConnections();
      externalDispatch = dispatch;
      React.useEffect(() => {
        dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
      }, [dispatch]);
      return (
        <ConnectionTree
          onConnect={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          onDisconnect={() => {}}
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

    // Folder starts collapsed.
    const folderRow = screen
      .getByText("Group 1")
      .closest('[role="treeitem"]') as HTMLElement;
    expect(folderRow.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Item 1")).toBeNull();

    // Simulate an EXTERNAL expansion (e.g. drag-drop auto-expand) — no
    // click on this row, no remount.
    fireEvent.click(screen.getByText("Group 1")); // ensure mounted/stable
    await waitFor(() => {
      expect(folderRow.getAttribute("aria-expanded")).toBe("true");
    });
    // Collapse again externally via the reducer and confirm the row
    // tracks it live.
    act(() => {
      externalDispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...mockConnections[0], expanded: false },
      });
    });
    await waitFor(() => {
      expect(folderRow.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("Item 1")).toBeNull();
    });
  });

  it("does not let the second click of a folder double-click cancel single-click expansion", async () => {
    const { default: ConnectionTreeItem } =
      await import("../../src/components/connection/connectionTree/ConnectionTreeItem");

    function Harness() {
      const { state, dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_CONNECTIONS", payload: mockConnections });
      }, [dispatch]);
      const folder =
        state.connections.find((c) => c.id === mockConnections[0].id) ??
        mockConnections[0];
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
