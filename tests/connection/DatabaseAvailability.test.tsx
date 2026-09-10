import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import {
  ConnectionProvider,
  connectionReducer,
} from "../../src/contexts/ConnectionProvider";
import { ConnectionContext } from "../../src/contexts/ConnectionContextTypes";
import { useConnections } from "../../src/contexts/useConnections";
import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseAccessState } from "../../src/types/encryption/databaseProtection";

vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: vi.fn(async () => null),
}));
// Test the real access wrapper without mounting protocol/row dependencies.
vi.mock("../../src/hooks/connection/useConnectionTree", () => ({
  useConnectionTree: () => {
    throw new Error("Unavailable tree mounted private content");
  },
}));
const connection: Connection = {
  id: "private-row",
  name: "Private database row",
  protocol: "ssh",
  hostname: "fixture.invalid",
  port: 22,
  isGroup: false,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};
const session = (
  id: string,
  protocol = "tool:trustCenter",
): ConnectionSession => ({
  id,
  protocol,
  connectionId: id,
  hostname: "",
  name: id,
  status: "connected",
  startTime: new Date(0),
});
function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let manager: DatabaseManager;
beforeEach(async () => {
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function createDatabase() {
  const database = await manager.createDatabase("Availability fixture");
  await manager.selectDatabase(database.id);
  await manager.saveDatabaseData(database.id, {
    connections: [connection],
    settings: {},
    timestamp: Date.now(),
  });
  return database.id;
}
describe("authoritative database availability", () => {
  it("keeps ownerless detached snapshots readable but never treats them as an opened database or persists them", async () => {
    const save = vi.spyOn(manager, "saveDatabaseData");
    const capture = vi.spyOn(manager, "captureCurrentDatabaseDataTarget");
    const { result } = renderHook(() => useConnections(), { wrapper });
    expect(result.current.databaseAvailability).toMatchObject({
      status: "none",
    });
    act(() => {
      result.current.dispatch({
        type: "SET_CONNECTIONS",
        payload: [connection],
      });
      result.current.dispatch({
        type: "SET_SESSIONS",
        payload: [
          { ...session("detached", "ssh"), ownerDatabaseId: "known-owner" },
        ],
      });
    });
    expect(result.current.state.connections).toEqual([connection]);
    expect(result.current.state.sessions[0].ownerDatabaseId).toBe(
      "known-owner",
    );
    await act(async () => {
      await result.current.saveData();
      await result.current.flushPendingSave();
    });
    expect(save).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(result.current.persistence.dirty).toBe(false);
    render(
      <ConnectionContext.Provider value={result.current}>
        <ConnectionTree
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </ConnectionContext.Provider>,
    );
    expect(screen.queryByText(connection.name)).toBeNull();
    expect(screen.getByRole("tree")).toHaveTextContent("Open and unlock");
  });
  it("reports loading until actual completion, failed reload as error, then a new ready generation after retry", async () => {
    const id = await createDatabase();
    const { result } = renderHook(() => useConnections(), { wrapper });
    expect(result.current.databaseAvailability).toMatchObject({
      status: "loading",
      databaseId: id,
    });
    await act(async () => {
      await result.current.loadData(id);
    });
    const before = result.current.databaseAvailability!.generation;
    const original = manager.captureCurrentDatabaseDataTarget.bind(manager);
    const gate = deferred();
    const spy = vi
      .spyOn(manager, "captureCurrentDatabaseDataTarget")
      .mockImplementation(() => ({
        ...original()!,
        load: async () => {
          await gate.promise;
          throw new Error("synthetic read refusal");
        },
      }));
    let reload!: Promise<boolean>;
    act(() => {
      reload = result.current.loadData(id);
    });
    expect(result.current.databaseAvailability).toMatchObject({
      status: "loading",
      databaseId: id,
    });
    await act(async () => {
      gate.resolve();
      await expect(reload).rejects.toThrow("synthetic read refusal");
    });
    expect(result.current.databaseAvailability?.status).toBe("error");
    expect(result.current.state.connections[0].id).toBe(connection.id);
    spy.mockRestore();
    await act(async () => {
      await result.current.loadData(id);
    });
    expect(result.current.databaseAvailability?.status).toBe("ready");
    expect(result.current.databaseAvailability!.generation).toBeGreaterThan(
      before,
    );
  });
  it("masks suspended access without deleting recoverable dirty rows and revokes stale owner binds", async () => {
    const id = await createDatabase();
    let access: DatabaseAccessState | null = null;
    let notify!: (state: DatabaseAccessState) => void;
    vi.spyOn(manager, "getDatabaseAccessState").mockImplementation(
      () => access,
    );
    vi.spyOn(manager, "onDatabaseAccessChange").mockImplementation(
      (listener) => {
        notify = listener;
        return () => {};
      },
    );
    const { result } = renderHook(() => useConnections(), { wrapper });
    await act(async () => {
      await result.current.loadData(id);
    });
    const generation = result.current.databaseAvailability!.generation;
    act(() => {
      result.current.dispatch({
        type: "SET_SESSIONS",
        payload: [session("unbound")],
      });
      result.current.dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, name: "Unsaved draft" },
      });
      access = {
        databaseId: id,
        status: "suspended",
        reason: "locked",
        accessEpoch: "new",
        securityRevision: "1",
      };
      notify(access);
      result.current.dispatch({
        type: "BIND_TOOL_DATABASE_OWNER",
        payload: { sessionId: "unbound", databaseId: id, generation },
      });
    });
    expect(result.current.databaseAvailability).toMatchObject({
      status: "suspended",
      databaseId: id,
    });
    expect(result.current.persistence.dirty).toBe(true);
    expect(result.current.state.connections[0].name).toBe("Unsaved draft");
    expect(result.current.state.sessions[0].ownerDatabaseId).toBeUndefined();
  });
  it.each(["close", "switch"])(
    "clears owner selections on %s while preserving live sessions",
    async (mode) => {
      const id = await createDatabase();
      const other = await manager.createDatabase("Other");
      const { result } = renderHook(() => useConnections(), { wrapper });
      await act(async () => {
        await result.current.loadData(id);
      });
      act(() => {
        result.current.dispatch({
          type: "SELECT_CONNECTION",
          payload: connection,
        });
        result.current.dispatch({
          type: "TOGGLE_SELECT_CONNECTION",
          payload: { id: connection.id, ctrl: true, shift: false },
        });
        result.current.dispatch({
          type: "ADD_SESSION",
          payload: session("live", "ssh"),
        });
      });
      await act(async () => {
        if (mode === "close") manager.closeCurrentDatabase();
        else await manager.selectDatabase(other.id);
      });
      expect(result.current.state.connections).toEqual([]);
      expect(result.current.state.selectedConnection).toBeNull();
      expect(result.current.state.selectedConnectionIds.size).toBe(0);
      expect(result.current.state.sessions[0].ownerDatabaseId).toBe(id);
      expect(result.current.databaseAvailability?.status).toBe(
        mode === "close" ? "none" : "loading",
      );
    },
  );
  it("binds only ownerless tool sessions to the exact ready generation and cannot retarget them", async () => {
    const id = await createDatabase();
    const { result } = renderHook(() => useConnections(), { wrapper });
    await act(async () => {
      await result.current.loadData(id);
    });
    const generation = result.current.databaseAvailability!.generation;
    const bind = (sessionId: string, databaseId = id, gen = generation) =>
      result.current.dispatch({
        type: "BIND_TOOL_DATABASE_OWNER",
        payload: { sessionId, databaseId, generation: gen },
      });
    act(() => {
      result.current.dispatch({
        type: "SET_SESSIONS",
        payload: [
          session("tool"),
          session("ssh", "ssh"),
          { ...session("owned"), ownerDatabaseId: "original" },
        ],
      });
      bind("tool", "other");
      bind("tool", id, generation - 1);
      bind("ssh");
      bind("owned");
    });
    expect(result.current.state.sessions.map((s) => s.ownerDatabaseId)).toEqual(
      [undefined, undefined, "original"],
    );
    act(() => {
      bind("tool");
    });
    expect(result.current.state.sessions[0].ownerDatabaseId).toBe(id);
    const state = connectionReducer(result.current.state, {
      type: "BIND_TOOL_DATABASE_OWNER",
      payload: { sessionId: "tool", databaseId: "retarget", generation },
    });
    expect(state.sessions[0].ownerDatabaseId).toBe(id);
  });
  it("does not invalidate a ready tree when an unrelated database is created", async () => {
    const id = await createDatabase();
    const { result } = renderHook(() => useConnections(), { wrapper });
    await act(async () => {
      await result.current.loadData(id);
    });
    const availability = result.current.databaseAvailability;
    await act(async () => {
      await manager.createDatabase("Unrelated database");
    });
    expect(result.current.databaseAvailability).toEqual(availability);
  });
});
