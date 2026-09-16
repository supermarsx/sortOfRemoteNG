import React, { useEffect } from "react";
import {
  cleanup,
  render,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    getCurrentDatabase: () => ({ id: "drop-fixture-db" }),
    onCurrentDatabaseChange: () => () => {},
    registerBeforeDatabaseTransition: () => () => {},
    captureCurrentDatabaseDataTarget: () => ({
      databaseId: "drop-fixture-db",
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
 * Reordering by drag has to answer "which row did the pointer land between?",
 * and the only list that can answer it is the one on screen. A sibling group
 * whose members have never been dragged carries no `order` at all, so the
 * persisted array says nothing about how the group reads top to bottom — every
 * fixture below is therefore seeded in an order that differs from the rendered
 * one, which is exactly the situation the drop used to get wrong.
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

/** Persisted back to front; displayed alphabetically as Alpha, Bravo, Charlie. */
const scrambledRoots = (): Connection[] => [
  connectionAt("root-charlie", "Charlie"),
  connectionAt("root-bravo", "Bravo"),
  connectionAt("root-alpha", "Alpha"),
];

/** The same three, dragged into place at some point: dense, non-alphabetical. */
const orderedRoots = (): Connection[] => [
  connectionAt("root-charlie", "Charlie", { order: 0 }),
  connectionAt("root-bravo", "Bravo", { order: 1 }),
  connectionAt("root-alpha", "Alpha", { order: 2 }),
];

const folderTree = (): Connection[] => [
  connectionAt("root-bravo", "Bravo"),
  connectionAt("child-echo", "Echo", { parentId: "folder-one" }),
  connectionAt("root-alpha", "Alpha"),
  connectionAt("child-delta", "Delta", { parentId: "folder-one" }),
  connectionAt("folder-one", "Folder One", {
    isGroup: true,
    expanded: true,
    protocol: "rdp",
    hostname: "",
    port: 3389,
  }),
];

function Harness({ filter }: { filter?: Partial<ConnectionFilter> }) {
  const { state, loadData, dispatch } = useConnections();
  useEffect(() => {
    void loadData("drop-fixture-db");
  }, [loadData]);
  useEffect(() => {
    if (filter) dispatch({ type: "SET_FILTER", payload: filter });
  }, [dispatch, filter]);
  return (
    <>
      <button
        data-testid="sort-custom-asc"
        onClick={() =>
          dispatch({
            type: "SET_FILTER",
            payload: { sortBy: "custom", sortDirection: "asc" },
          })
        }
      />
      <output data-testid="connections-state">
        {JSON.stringify(state.connections)}
      </output>
      <ConnectionTree
        onConnect={() => {}}
        onDisconnect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </>
  );
}

function mountTree(
  connections: Connection[],
  filter?: Partial<ConnectionFilter>,
) {
  fixture.load.mockResolvedValue({
    connections,
    settings: {},
    timestamp: 0,
    tabGroups: [],
  });
  return render(
    <ConnectionProvider>
      <Harness filter={filter} />
    </ConnectionProvider>,
  );
}

/** Ids of every rendered row, top to bottom — what the user actually sees. */
const treeOrder = (): (string | null)[] =>
  Array.from(
    screen.getByRole("tree").querySelectorAll("[data-connection-id]"),
  ).map((element) => element.getAttribute("data-connection-id"));

async function waitForRows(count: number) {
  await waitFor(() => expect(treeOrder()).toHaveLength(count));
}

/** The stored parent/order of every connection, keyed by id. */
function positions(): Record<string, { parentId?: string; order?: number }> {
  const connections = JSON.parse(
    screen.getByTestId("connections-state").textContent!,
  ) as Connection[];
  return Object.fromEntries(
    connections.map(({ id, parentId, order }) => [id, { parentId, order }]),
  );
}

const row = (id: string): HTMLElement =>
  document.querySelector(`[data-connection-id="${id}"]`)!;

/**
 * Drag one row onto another. `ConnectionTreeItem` derives the drop position
 * from where the pointer sits in the target row: the top quarter of a folder is
 * "before", the bottom quarter "after" and the middle "inside", while a plain
 * connection splits in half.
 */
function dragTo(
  sourceId: string,
  targetId: string,
  position: "before" | "inside" | "after",
) {
  const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
  fireEvent.dragStart(row(sourceId), { dataTransfer });
  const target = row(targetId);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    top: 0,
    height: 32,
  } as DOMRect);
  const clientY = position === "before" ? 2 : position === "after" ? 30 : 16;
  fireEvent(
    target,
    Object.assign(
      new MouseEvent("drop", { bubbles: true, cancelable: true, clientY }),
      { dataTransfer },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.save.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("connection tree drop insertion order", () => {
  describe("siblings that have never been dragged", () => {
    it("moves a row to the front of the group", async () => {
      // The reported bug: Charlie stayed put and the two rows nobody touched
      // swapped, because the drop indexed the persisted array (Charlie, Bravo,
      // Alpha) rather than the rendered one.
      mountTree(scrambledRoots());
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);

      dragTo("root-charlie", "root-alpha", "before");

      expect(treeOrder()).toEqual(["root-charlie", "root-alpha", "root-bravo"]);
    });

    it("moves a row into the middle of the group", async () => {
      mountTree(scrambledRoots());
      await waitForRows(3);

      dragTo("root-alpha", "root-charlie", "before");

      expect(treeOrder()).toEqual(["root-bravo", "root-alpha", "root-charlie"]);
    });

    it("moves a row to the end of the group", async () => {
      mountTree(scrambledRoots());
      await waitForRows(3);

      dragTo("root-alpha", "root-charlie", "after");

      expect(treeOrder()).toEqual(["root-bravo", "root-charlie", "root-alpha"]);
    });

    it("writes dense orders across the whole group", async () => {
      mountTree(scrambledRoots());
      await waitForRows(3);

      dragTo("root-charlie", "root-alpha", "before");

      expect(positions()).toEqual({
        "root-charlie": { parentId: undefined, order: 0 },
        "root-alpha": { parentId: undefined, order: 1 },
        "root-bravo": { parentId: undefined, order: 2 },
      });
    });
  });

  describe("siblings with explicit orders", () => {
    it("inserts before the target without overshooting it", async () => {
      // Dropping the first row after the second must land it between the
      // second and third, not past them: the index has to be read off the list
      // with the dragged row already removed.
      mountTree(orderedRoots());
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);

      dragTo("root-charlie", "root-bravo", "after");

      expect(treeOrder()).toEqual(["root-bravo", "root-charlie", "root-alpha"]);
    });

    it("keeps an untouched neighbour where it was", async () => {
      mountTree(orderedRoots());
      await waitForRows(3);

      dragTo("root-alpha", "root-bravo", "before");

      expect(treeOrder()).toEqual(["root-charlie", "root-alpha", "root-bravo"]);
      expect(positions()["root-charlie"].order).toBe(0);
    });

    it("mixes ordered and unordered siblings by what is displayed", async () => {
      // Half the group was dragged at some point, half never was. Displayed:
      // Alpha and Bravo share the implicit 0 and sort by name, Delta's 5 puts
      // it last.
      mountTree([
        connectionAt("root-delta", "Delta", { order: 5 }),
        connectionAt("root-bravo", "Bravo"),
        connectionAt("root-alpha", "Alpha"),
      ]);
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-delta"]);

      dragTo("root-delta", "root-alpha", "before");

      expect(treeOrder()).toEqual(["root-delta", "root-alpha", "root-bravo"]);
    });
  });

  describe("descending custom sort", () => {
    it("reverses the dense orders so the drop reads as rendered", async () => {
      // Highest order first, so unordered siblings tie at 0 and fall back to
      // reverse-alphabetical.
      mountTree(scrambledRoots(), {
        sortBy: "custom",
        sortDirection: "desc",
      });
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);

      dragTo("root-alpha", "root-charlie", "before");

      expect(treeOrder()).toEqual(["root-alpha", "root-charlie", "root-bravo"]);
      // Written back to front: the top row now holds the largest order.
      expect(positions()).toEqual({
        "root-alpha": { parentId: undefined, order: 2 },
        "root-charlie": { parentId: undefined, order: 1 },
        "root-bravo": { parentId: undefined, order: 0 },
      });
    });

    it("moves a row to the end of a descending group", async () => {
      mountTree(orderedRoots(), { sortBy: "custom", sortDirection: "desc" });
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);

      dragTo("root-alpha", "root-charlie", "after");

      expect(treeOrder()).toEqual(["root-bravo", "root-charlie", "root-alpha"]);
    });
  });

  describe("sort modes that ignore the custom order", () => {
    // Dropping stays enabled under every sort mode — `enableReorder` follows
    // the "freeze positions" preference alone (Sidebar.tsx) and nothing in the
    // tree consults `sortBy`. The drop therefore writes an order that the
    // active sort does not read, which is by design: the rows do not jump
    // around underneath the pointer, and switching to the custom sort shows
    // the arrangement that was dragged.
    it("leaves the rendered order alone under the name sort, then honours it under custom", async () => {
      mountTree(scrambledRoots(), { sortBy: "name", sortDirection: "asc" });
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);

      dragTo("root-charlie", "root-alpha", "before");

      expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);

      fireEvent.click(screen.getByTestId("sort-custom-asc"));

      expect(treeOrder()).toEqual(["root-charlie", "root-alpha", "root-bravo"]);
    });

    it("records the drop against the hostname sort's own order", async () => {
      // Hostnames run opposite to the names, so the displayed list is
      // Charlie, Bravo, Alpha and dropping Alpha at the front means exactly
      // that once the custom sort takes over.
      mountTree(
        [
          connectionAt("root-alpha", "Alpha", { hostname: "ccc.example" }),
          connectionAt("root-bravo", "Bravo", { hostname: "bbb.example" }),
          connectionAt("root-charlie", "Charlie", { hostname: "aaa.example" }),
        ],
        { sortBy: "hostname", sortDirection: "asc" },
      );
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);

      dragTo("root-alpha", "root-charlie", "before");

      expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);

      fireEvent.click(screen.getByTestId("sort-custom-asc"));

      expect(treeOrder()).toEqual(["root-alpha", "root-charlie", "root-bravo"]);
    });

    it("records the drop against the protocol sort's own order", async () => {
      mountTree(
        [
          connectionAt("root-alpha", "Alpha", { protocol: "vnc" }),
          connectionAt("root-bravo", "Bravo", { protocol: "ssh" }),
          connectionAt("root-charlie", "Charlie", { protocol: "rdp" }),
        ],
        { sortBy: "protocol", sortDirection: "asc" },
      );
      await waitForRows(3);
      expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);

      dragTo("root-charlie", "root-alpha", "after");

      expect(treeOrder()).toEqual(["root-charlie", "root-bravo", "root-alpha"]);

      fireEvent.click(screen.getByTestId("sort-custom-asc"));

      expect(treeOrder()).toEqual(["root-bravo", "root-alpha", "root-charlie"]);
    });
  });

  describe("moving between folders", () => {
    it("drops a connection into a folder, ahead of its children", async () => {
      mountTree(folderTree());
      await waitForRows(5);
      expect(treeOrder()).toEqual([
        "folder-one",
        "child-delta",
        "child-echo",
        "root-alpha",
        "root-bravo",
      ]);

      dragTo("root-bravo", "folder-one", "inside");

      expect(treeOrder()).toEqual([
        "folder-one",
        "root-bravo",
        "child-delta",
        "child-echo",
        "root-alpha",
      ]);
      expect(positions()["root-bravo"]).toEqual({
        parentId: "folder-one",
        order: 0,
      });
    });

    it("drops a child out to the root at the position it was released", async () => {
      mountTree(folderTree());
      await waitForRows(5);

      dragTo("child-echo", "root-bravo", "after");

      expect(treeOrder()).toEqual([
        "folder-one",
        "child-delta",
        "root-alpha",
        "root-bravo",
        "child-echo",
      ]);
      expect(positions()["child-echo"].parentId).toBeUndefined();
      expect(row("child-echo").closest('[role="treeitem"]')).toHaveAttribute(
        "aria-level",
        "1",
      );
    });

    it("keeps folders above connections when a connection is dropped before one", async () => {
      // Folders sort first whatever the order values say, so this drop can only
      // lift Bravo to the top of the connections.
      mountTree(folderTree());
      await waitForRows(5);

      dragTo("root-bravo", "folder-one", "before");

      expect(treeOrder()).toEqual([
        "folder-one",
        "child-delta",
        "child-echo",
        "root-bravo",
        "root-alpha",
      ]);
      expect(positions()["root-bravo"].parentId).toBeUndefined();
    });
  });

  describe("drops that change nothing", () => {
    it("ignores a row dropped onto itself", async () => {
      mountTree(scrambledRoots());
      await waitForRows(3);
      const before = positions();

      dragTo("root-bravo", "root-bravo", "before");

      expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);
      expect(positions()).toEqual(before);
      expect(positions()["root-bravo"].order).toBeUndefined();
    });

    it("leaves the rendered order alone when a row is dropped back where it was", async () => {
      mountTree(scrambledRoots());
      await waitForRows(3);

      dragTo("root-bravo", "root-alpha", "after");

      expect(treeOrder()).toEqual(["root-alpha", "root-bravo", "root-charlie"]);
    });
  });
});
