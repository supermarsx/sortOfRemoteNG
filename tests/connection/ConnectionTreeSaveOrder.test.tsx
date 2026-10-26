import React, { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";

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
  targetCaptures: 0,
  provider: null as null | {
    dirty: boolean;
    saving: boolean;
    error: boolean;
    generation: number | null;
    ready: boolean;
  },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("../../src/utils/connection/databaseManager", () => {
  const manager = {
    getCurrentDatabase: () => ({ id: "order-fixture-db" }),
    onCurrentDatabaseChange: () => () => {},
    registerBeforeDatabaseTransition: () => () => {},
    captureCurrentDatabaseDataTarget: () => {
      fixture.targetCaptures += 1;
      return {
        databaseId: "order-fixture-db",
        load: fixture.load,
        save: fixture.save,
      };
    },
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
  const { state, loadData, dispatch, persistence, databaseAvailability } =
    useConnections();
  fixture.provider = {
    dirty: persistence.dirty,
    saving: persistence.saving,
    error: persistence.error !== null,
    generation: Number.isSafeInteger(databaseAvailability?.generation)
      ? (databaseAvailability?.generation ?? null)
      : null,
    ready: databaseAvailability?.status === "ready",
  };
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
  const before = beforeSaveClick();
  fireEvent.click(screen.getByTestId("editor-save"));
  await waitForSaveSuccess(before);
}

/** The connections in the most recent database write. */
function lastSaved(): Connection[] {
  const calls = fixture.save.mock.calls;
  return (calls[calls.length - 1][0] as { connections: Connection[] })
    .connections;
}

function beforeSaveClick() {
  const button = screen.getByTestId("editor-save") as HTMLButtonElement;
  const name = (screen.getByTestId("editor-name") as HTMLInputElement).value;
  return {
    disabled: button.disabled,
    name: ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Zulu"].includes(name)
      ? name
      : "other",
  };
}

function saveObservation() {
  // Read only state already maintained by the existing Vitest mock. Do not
  // attach handlers or replace the stable save method or its returned promise.
  const settled = fixture.save.mock.settledResults;
  return {
    saveStarted: fixture.save.mock.calls.length,
    saveAcknowledged: settled.filter((row) => row.type === "fulfilled").length,
    saveRejected: settled.filter((row) => row.type === "rejected").length,
    savePending: settled.filter((row) => row.type === "incomplete").length,
    saveReturned: fixture.save.mock.results.filter(
      (row) => row.type === "return",
    ).length,
    saveThrew: fixture.save.mock.results.filter((row) => row.type === "throw")
      .length,
  };
}

function diagnoseSaveFailure(
  error: unknown,
  before: ReturnType<typeof beforeSaveClick>,
): never {
  // All observations belong to this disposable fixture. Never log arguments,
  // connection snapshots, toast messages, the DOM, or the original exception.
  try {
    console.error(
      "ConnectionTreeSaveOrder.save diagnostic",
      JSON.stringify({
        before,
        targetCaptures: fixture.targetCaptures,
        ...saveObservation(),
        provider: fixture.provider,
        providerRevisionObserved: false,
        toast: {
          success: fixture.toast.success.mock.calls.length,
          error: fixture.toast.error.mock.calls.length,
          info: fixture.toast.info.mock.calls.length,
          noChanges: fixture.toast.info.mock.calls.some(
            ([message]) => message === "No changes to save",
          ),
        },
      }),
    );
  } catch {
    // A diagnostic sink failure must not replace the original wait failure.
  }
  throw error;
}

async function waitForSaveSuccess(before: ReturnType<typeof beforeSaveClick>) {
  try {
    await waitFor(() => expect(fixture.toast.success).toHaveBeenCalled());
  } catch (error) {
    diagnoseSaveFailure(error, before);
  }
}

async function save() {
  const before = beforeSaveClick();
  fireEvent.click(screen.getByTestId("editor-save"));
  await waitForSaveSuccess(before);
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.targetCaptures = 0;
  fixture.provider = null;
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

describe("save timeout diagnostic contract", () => {
  it("retains the exact original error and excludes messages, data and DOM", () => {
    const cause = new Error("PRIVATE_CAUSE");
    const original = Object.assign(new Error("PRIVATE_ERROR"), { cause });
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fixture.toast.error("PRIVATE_TOAST");
      fixture.save({ password: "PRIVATE_PASSWORD" });
      let caught: unknown;
      try {
        diagnoseSaveFailure(original, { disabled: true, name: "Zulu" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(original);
      const encoded = JSON.stringify(output.mock.calls);
      expect(encoded).not.toMatch(/PRIVATE_|<html|password/);
      expect(encoded.length).toBeLessThan(2048);
      expect(original.cause).toBe(cause);
      output.mockImplementation(() => {
        throw new Error("diagnostic sink");
      });
      try {
        diagnoseSaveFailure(original, { disabled: true, name: "other" });
      } catch (error) {
        expect(error).toBe(original);
      }
    } finally {
      output.mockRestore();
    }
  });

  it("reports pending durable work without changing the original wait or acknowledging it", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    let acknowledge!: () => void;
    fixture.save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
    try {
      mountTree(unorderedTree(), {
        editId: "root-alpha",
        filter: { sortBy: "name", sortDirection: "asc" },
      });
      await waitForRows(6);
      fireEvent.change(await screen.findByTestId("editor-name"), {
        target: { value: "Zulu" },
      });
      const pending = save();
      await expect(pending).rejects.toThrow(/called at least once/);
      expect(saveObservation().saveStarted).toBe(1);
      expect(saveObservation().saveAcknowledged).toBe(0);
      expect(treeOrder().slice(3)).toEqual([
        "root-bravo",
        "root-charlie",
        "root-alpha",
      ]);
      const diagnostic = JSON.parse(output.mock.calls[0][1]);
      expect(diagnostic.before).toEqual({ disabled: false, name: "Zulu" });
      expect(diagnostic.saveStarted).toBe(1);
      expect(diagnostic.saveAcknowledged).toBe(0);
      expect(diagnostic.provider.ready).toBe(true);
      expect(diagnostic.providerRevisionObserved).toBe(false);
      await act(async () => {
        acknowledge();
      });
      await waitFor(() =>
        expect(fixture.toast.success).toHaveBeenCalledTimes(1),
      );
      expect(saveObservation().saveAcknowledged).toBe(1);
    } finally {
      output.mockRestore();
    }
  });
});

it("save observations retain stable target methods and exact original promises", async () => {
  const manager = DatabaseManager.getInstance();
  const first = manager.captureCurrentDatabaseDataTarget();
  const second = manager.captureCurrentDatabaseDataTarget();
  expect(first?.save).toBe(fixture.save);
  expect(second?.save).toBe(first?.save);
  let resolve!: () => void;
  const owned = new Promise<void>((done) => {
    resolve = done;
  });
  fixture.save.mockImplementationOnce(() => owned);
  const returned = fixture.save({});
  expect(returned).toBe(owned);
  expect(fixture.save.mock.results[0].value).toBe(owned);
  expect(saveObservation()).toEqual({
    saveStarted: 1,
    saveAcknowledged: 0,
    saveRejected: 0,
    savePending: 1,
    saveReturned: 1,
    saveThrew: 0,
  });
  expect(fixture.save.mock.results[0].value).toBe(owned);
  resolve();
  await returned;
  expect(saveObservation().saveAcknowledged).toBe(1);
  expect(saveObservation().savePending).toBe(0);

  let reject!: (reason: unknown) => void;
  const rejection = new Promise<void>((_, fail) => {
    reject = fail;
  });
  const reason = new Error("PRIVATE_REJECTION");
  fixture.save.mockImplementationOnce(() => rejection);
  const rejected = fixture.save({});
  expect(rejected).toBe(rejection);
  expect(saveObservation().savePending).toBe(1);
  const checked = expect(rejected).rejects.toBe(reason);
  reject(reason);
  await checked;
  expect(saveObservation().saveRejected).toBe(1);
  expect(saveObservation().savePending).toBe(0);
  fixture.save.mockImplementationOnce(() => {
    throw reason;
  });
  expect(() => fixture.save({})).toThrow(reason);
  expect(saveObservation()).toEqual({
    saveStarted: 3,
    saveAcknowledged: 1,
    saveRejected: 2,
    savePending: 0,
    saveReturned: 2,
    saveThrew: 1,
  });
});
