import React, { useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import type {
  Connection,
  ConnectionFilter,
} from "../../src/types/connection/connection";

const fixture = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("../../src/utils/connection/databaseManager", () => {
  const manager = {
    getCurrentDatabase: () => ({ id: "order-fixture-db" }),
    onCurrentDatabaseChange: () => () => {},
    registerBeforeDatabaseTransition: () => () => {},
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "order-fixture-db",
      load: fixture.load,
      save: fixture.save,
    }),
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onCurrentDatabaseChange: () => () => {},
  };
});

vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: fixture.toast }),
}));

/**
 * Connections that predate the editor — imported, discovered, created through
 * "New Folder", or written by an older build — carry no `order` at all. The
 * tree treats a missing order as 0, so they render as one alphabetical block.
 * Saving one must not lift it out of that block.
 */
const connectionAt = (
  id: string,
  name: string,
  overrides: Partial<Connection> = {},
): Connection => ({
  id,
  name,
  protocol: "http",
  hostname: `${id}.example`,
  port: 80,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const unorderedTree = (): Connection[] => [
  connectionAt("folder-one", "Folder One", {
    isGroup: true,
    expanded: true,
    protocol: "rdp",
    hostname: "",
    port: 3389,
  }),
  connectionAt("child-delta", "Delta", { parentId: "folder-one" }),
  connectionAt("child-echo", "Echo", { parentId: "folder-one" }),
  connectionAt("root-alpha", "Alpha"),
  connectionAt("root-bravo", "Bravo"),
  connectionAt("root-charlie", "Charlie"),
];

function Harness({
  editId,
  newConnection,
  filter,
}: {
  editId?: string;
  newConnection?: boolean;
  filter?: Partial<ConnectionFilter>;
}) {
  const { state, loadData, dispatch } = useConnections();
  useEffect(() => {
    void loadData("order-fixture-db");
  }, [loadData]);
  useEffect(() => {
    if (filter) dispatch({ type: "SET_FILTER", payload: filter });
  }, [dispatch, filter]);
  const connection = editId
    ? state.connections.find((candidate) => candidate.id === editId)
    : undefined;
  return (
    <>
      <ConnectionTree
        onConnect={() => {}}
        onDisconnect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
      {editId && !connection ? null : newConnection || connection ? (
        <ConnectionEditor connection={connection} isOpen onClose={() => {}} />
      ) : null}
    </>
  );
}

function mountTree(
  connections: Connection[],
  options: {
    editId?: string;
    newConnection?: boolean;
    filter?: Partial<ConnectionFilter>;
  } = {},
) {
  fixture.load.mockResolvedValue({
    connections,
    settings: {},
    timestamp: 0,
    tabGroups: [],
  });
  return render(
    <ConnectionProvider>
      <Harness {...options} />
    </ConnectionProvider>,
  );
}

/** Ids of every rendered row, top to bottom — what the user actually sees. */
const treeOrder = (): (string | null)[] =>
  Array.from(
    screen.getByRole("tree").querySelectorAll("[data-connection-id]"),
  ).map((row) => row.getAttribute("data-connection-id"));

async function waitForRows(count: number) {
  await waitFor(() => expect(treeOrder()).toHaveLength(count));
}

/** Change a field that no sort mode keys on, then save and await the flush. */
async function editHostnameAndSave(currentHostname: string) {
  const input = await screen.findByDisplayValue(currentHostname);
  fireEvent.change(input, { target: { value: "moved.example" } });
  fireEvent.click(screen.getByTestId("editor-save"));
  await waitFor(() => expect(fixture.toast.success).toHaveBeenCalled());
}

/** The connections in the most recent database write. */
function lastSaved(): Connection[] {
  const calls = fixture.save.mock.calls;
  return (calls[calls.length - 1][0] as { connections: Connection[] })
    .connections;
}

async function save() {
  fireEvent.click(screen.getByTestId("editor-save"));
  await waitFor(() => expect(fixture.toast.success).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.save.mockReset().mockResolvedValue(undefined);
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "clone_connection") {
      const payload = args as { connection: Connection; newName?: string };
      const source = payload.connection;
      return {
        ...source,
        id: `${source.id}-copy`,
        name: payload.newName ?? `${source.name} (Copy)`,
        updatedAt: new Date().toISOString(),
      } as never;
    }
    return undefined as never;
  });
});

afterEach(() => {
  cleanup();
});

describe("connection tree order across a save", () => {
  it("keeps an unordered connection in place when it is saved", async () => {
    mountTree(unorderedTree(), { editId: "root-bravo" });
    await waitForRows(6);
    const before = treeOrder();
    expect(before).toEqual([
      "folder-one",
      "child-delta",
      "child-echo",
      "root-alpha",
      "root-bravo",
      "root-charlie",
    ]);

    await editHostnameAndSave("root-bravo.example");

    expect(treeOrder()).toEqual(before);
  });

  it("does not stamp an order onto a saved connection that had none", async () => {
    mountTree(unorderedTree(), { editId: "root-bravo" });
    await waitForRows(6);

    await editHostnameAndSave("root-bravo.example");

    const saved = lastSaved().find((c) => c.id === "root-bravo")!;
    expect(saved.hostname).toBe("moved.example");
    expect(saved.order).toBeUndefined();
  });

  it("keeps a connection in place when it is saved inside a folder", async () => {
    mountTree(unorderedTree(), { editId: "child-delta" });
    await waitForRows(6);
    const before = treeOrder();

    await editHostnameAndSave("child-delta.example");

    expect(treeOrder()).toEqual(before);
    expect(treeOrder().slice(1, 3)).toEqual(["child-delta", "child-echo"]);
  });

  it("keeps a favourite in place when it is saved", async () => {
    const connections = unorderedTree().map((connection) =>
      connection.id === "root-bravo"
        ? { ...connection, favorite: true }
        : connection,
    );
    mountTree(connections, { editId: "root-bravo" });
    await waitForRows(6);
    const before = treeOrder();

    await editHostnameAndSave("root-bravo.example");

    expect(treeOrder()).toEqual(before);
    expect(lastSaved().find((c) => c.id === "root-bravo")?.favorite).toBe(true);
  });

  it("keeps a manual drag order when one of the dragged siblings is saved", async () => {
    // What handleItemDrop leaves behind: dense sibling indexes, deliberately
    // not alphabetical.
    const connections = [
      connectionAt("root-charlie", "Charlie", { order: 0 }),
      connectionAt("root-bravo", "Bravo", { order: 1 }),
      connectionAt("root-alpha", "Alpha", { order: 2 }),
    ];
    mountTree(connections, { editId: "root-bravo" });
    await waitForRows(3);
    expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);

    await editHostnameAndSave("root-bravo.example");

    expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);
    expect(lastSaved().find((c) => c.id === "root-bravo")?.order).toBe(1);
  });

  it("keeps an unordered connection in place among drag-ordered siblings", async () => {
    // A folder half of whose members were dragged: the untouched ones sit at
    // the implicit 0 and must stay there across a save.
    const connections = [
      connectionAt("root-alpha", "Alpha"),
      connectionAt("root-bravo", "Bravo"),
      connectionAt("root-charlie", "Charlie", { order: 3 }),
    ];
    mountTree(connections, { editId: "root-bravo" });
    await waitForRows(3);
    expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);

    await editHostnameAndSave("root-bravo.example");

    expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);
  });

  it("still moves a renamed connection while the name sort is active", async () => {
    mountTree(unorderedTree(), {
      editId: "root-alpha",
      filter: { sortBy: "name", sortDirection: "asc" },
    });
    await waitForRows(6);
    expect(treeOrder().slice(3)).toEqual([
      "root-alpha",
      "root-bravo",
      "root-charlie",
    ]);

    fireEvent.change(await screen.findByTestId("editor-name"), {
      target: { value: "Zulu" },
    });
    await save();

    expect(treeOrder().slice(3)).toEqual([
      "root-bravo",
      "root-charlie",
      "root-alpha",
    ]);
  });

  it("appends a newly created connection instead of interleaving it", async () => {
    mountTree(unorderedTree(), { newConnection: true });
    await waitForRows(6);

    fireEvent.change(await screen.findByTestId("editor-name"), {
      target: { value: "Zulu" },
    });
    fireEvent.change(screen.getByTestId("editor-hostname"), {
      target: { value: "zulu.example" },
    });
    await save();

    await waitForRows(7);
    // The six existing rows keep their places; the new one lands last.
    expect(treeOrder().slice(0, 6)).toEqual([
      "folder-one",
      "child-delta",
      "child-echo",
      "root-alpha",
      "root-bravo",
      "root-charlie",
    ]);
    expect(screen.getByText("Zulu")).toBeInTheDocument();
  });

  it("places a duplicate next to its source without moving the others", async () => {
    mountTree(unorderedTree());
    await waitForRows(6);

    const row = screen.getByText("Bravo").closest(".group") as HTMLElement;
    fireEvent.click(within(row).getAllByRole("button")[1]);
    fireEvent.click(screen.getByText("connections.clone"));

    await waitForRows(7);
    expect(treeOrder()).toEqual([
      "folder-one",
      "child-delta",
      "child-echo",
      "root-alpha",
      "root-bravo",
      "root-bravo-copy",
      "root-charlie",
    ]);
  });
});
