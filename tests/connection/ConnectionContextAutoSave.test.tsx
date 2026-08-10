import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { openDB } from "idb";
import { Connection } from "../../src/types/connection/connection";
import { StorageData } from "../../src/utils/storage/storage";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}

/** Flush the 500ms debounce timer and all pending micro-tasks. */
async function flushSave() {
  // Advance past the 500ms debounce
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  // Flush any remaining micro-tasks from the async save
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe("ConnectionProvider auto-save", () => {
  let manager: DatabaseManager;
  let collectionId: string;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    DatabaseManager.resetInstance();
    manager = DatabaseManager.getInstance();
    const col = await manager.createDatabase("Test");
    await manager.selectDatabase(col.id);
    collectionId = col.id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes empty list after deleting all connections", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    // Must call loadData first to enable auto-save
    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: "c1",
      name: "c1",
      protocol: "ssh",
      hostname: "host",
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: "SET_CONNECTIONS", payload: [conn] });
    });

    await flushSave();

    let stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toHaveLength(1);

    await act(async () => {
      result.current.dispatch({ type: "SET_CONNECTIONS", payload: [] });
    });

    await flushSave();

    stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toEqual([]);
  });

  it("auto-saves after updating a connection", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: "u1",
      name: "original",
      protocol: "ssh",
      hostname: "host",
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: "SET_CONNECTIONS", payload: [conn] });
    });
    await flushSave();

    const updated = { ...conn, name: "renamed" };
    await act(async () => {
      result.current.dispatch({ type: "UPDATE_CONNECTION", payload: updated });
    });
    await flushSave();

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toHaveLength(1);
    expect(stored!.connections[0].name).toBe("renamed");
  });

  it("auto-saves after adding a connection", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: "a1",
      name: "added",
      protocol: "rdp",
      hostname: "newhost",
      port: 3389,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: "ADD_CONNECTION", payload: conn });
    });
    await flushSave();

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toHaveLength(1);
    expect(stored!.connections[0].id).toBe("a1");
  });

  it("persists the latest state after multiple rapid updates", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn1: Connection = {
      id: "r1",
      name: "first",
      protocol: "ssh",
      hostname: "h1",
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;
    const conn2: Connection = {
      id: "r2",
      name: "second",
      protocol: "rdp",
      hostname: "h2",
      port: 3389,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: "SET_CONNECTIONS", payload: [conn1] });
    });
    await act(async () => {
      result.current.dispatch({
        type: "SET_CONNECTIONS",
        payload: [conn1, conn2],
      });
    });
    await flushSave();

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toHaveLength(2);
  });

  it("flushes pending changes immediately without waiting for debounce", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: "immediate",
      name: "immediate",
      protocol: "ssh",
      hostname: "host",
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    act(() => {
      result.current.dispatch({ type: "ADD_CONNECTION", payload: conn });
    });

    expect(result.current.persistence.dirty).toBe(true);

    await act(async () => {
      await result.current.flushPendingSave();
    });

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toHaveLength(1);
    expect(stored!.connections[0].id).toBe("immediate");
    expect(result.current.persistence).toEqual({
      dirty: false,
      saving: false,
      error: null,
    });
  });

  it("offers an awaited durable dispatch contract for destructive actions", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const conn: Connection = {
      id: "delete-me",
      name: "delete me",
      protocol: "ssh",
      hostname: "host",
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      await result.current.dispatchAndFlush({
        type: "SET_CONNECTIONS",
        payload: [conn],
      });
      await result.current.dispatchAndFlush({
        type: "DELETE_CONNECTION",
        payload: "delete-me",
      });
    });

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toHaveLength(0);
    expect(result.current.persistence.dirty).toBe(false);
  });

  it("retains failed snapshots as dirty and retries them explicitly", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData();
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const saveSpy = vi
      .spyOn(DatabaseManager.getInstance(), "saveDatabaseData" as any)
      .mockRejectedValueOnce(new Error("DB write failed"));

    const conn: Connection = {
      id: "e1",
      name: "err",
      protocol: "ssh",
      hostname: "host",
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    await act(async () => {
      result.current.dispatch({ type: "SET_CONNECTIONS", payload: [conn] });
    });
    await flushSave();

    expect(result.current.persistence).toEqual({
      dirty: true,
      saving: false,
      error: "DB write failed",
    });

    await act(async () => {
      await result.current.flushPendingSave();
    });

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored!.connections).toHaveLength(1);
    expect(stored!.connections[0].id).toBe("e1");
    expect(result.current.persistence).toEqual({
      dirty: false,
      saving: false,
      error: null,
    });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    saveSpy.mockRestore();
  });

  it("flushes the outgoing collection before switching and never writes its snapshot to the incoming collection", async () => {
    const second = await manager.createDatabase("Second");
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData(collectionId);
    });

    const outgoing: Connection = {
      id: "outgoing-edit",
      name: "belongs to first",
      protocol: "ssh",
      hostname: "first.example",
      port: 22,
      isGroup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Connection;

    act(() => {
      result.current.dispatch({
        type: "SET_CONNECTIONS",
        payload: [outgoing],
      });
    });

    await act(async () => {
      await manager.selectDatabase(second.id);
      expect(await result.current.loadData(second.id)).toBe(true);
    });

    const firstData = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    const secondData = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${second.id}`,
    );
    expect(firstData?.connections.map((connection) => connection.id)).toEqual([
      "outgoing-edit",
    ]);
    expect(secondData?.connections).toEqual([]);
    expect(result.current.state.connections).toEqual([]);
  });

  it("keeps the current collection attached when its transition flush fails", async () => {
    const second = await manager.createDatabase("Second");
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData(collectionId);
    });
    act(() => {
      result.current.dispatch({
        type: "SET_CONNECTIONS",
        payload: [
          {
            id: "retry-me",
            name: "retry me",
            protocol: "ssh",
            hostname: "first.example",
            port: 22,
            isGroup: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as Connection,
        ],
      });
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const saveSpy = vi
      .spyOn(manager, "saveDatabaseData")
      .mockRejectedValueOnce(new Error("disk unavailable"));

    await act(async () => {
      await expect(manager.selectDatabase(second.id)).rejects.toThrow(
        "disk unavailable",
      );
    });

    expect(manager.getCurrentDatabase()?.id).toBe(collectionId);
    expect(result.current.persistence).toEqual({
      dirty: true,
      saving: false,
      error: "disk unavailable",
    });

    saveSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not persist close-time UI cleanup as an empty collection", async () => {
    const { result } = renderHook(() => useConnections(), { wrapper });

    await act(async () => {
      await result.current.loadData(collectionId);
    });
    act(() => {
      result.current.dispatch({
        type: "SET_CONNECTIONS",
        payload: [
          {
            id: "keep-after-close",
            name: "keep after close",
            protocol: "ssh",
            hostname: "first.example",
            port: 22,
            isGroup: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as Connection,
        ],
      });
    });
    await act(async () => {
      await result.current.flushPendingSave();
    });

    manager.closeCurrentDatabase();
    act(() => {
      result.current.dispatch({ type: "SET_CONNECTIONS", payload: [] });
      result.current.dispatch({ type: "SET_TAB_GROUPS", payload: [] });
      vi.advanceTimersByTime(600);
    });

    const stored = await IndexedDbService.getItem<StorageData>(
      `mremote-database-${collectionId}`,
    );
    expect(stored?.connections.map((connection) => connection.id)).toEqual([
      "keep-after-close",
    ]);
    expect(result.current.persistence).toEqual({
      dirty: false,
      saving: false,
      error: null,
    });
  });
});
