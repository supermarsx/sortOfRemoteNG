import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import type { Connection } from "../../src/types/connection/connection";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConnectionProvider>{children}</ConnectionProvider>;
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await IndexedDbService.init();
  const db = await openDB("mremote-keyval", 1);
  await db.clear("keyval");
  DatabaseManager.resetInstance();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("preserves persisted connection timestamp evidence through hydration and unrelated saves", async () => {
  const manager = DatabaseManager.getInstance();
  const database = await manager.createDatabase("Timezone fixture");
  await manager.selectDatabase(database.id);
  const examples: [string, unknown][] = [
    ["utc", "2026-09-26T12:00:00.000Z"],
    ["offset", "2026-09-26T08:00:00-04:00"],
    ["no-zone", "2026-09-26T12:00:00"],
    ["dst-ambiguous", "2026-10-25T01:30:00"],
    ["calendar", "2026-09-26"],
    ["empty", ""],
    ["invalid", "not a timestamp"],
    ["epoch", 0],
    ["null", null],
    ["missing", undefined],
  ];
  const connections = examples.map(([id, timestamp]) => ({
    id,
    name: id,
    protocol: "ssh",
    hostname: "fixture.test",
    port: 22,
    isGroup: false,
    ...(timestamp === undefined
      ? {}
      : { createdAt: timestamp, updatedAt: timestamp }),
  })) as Connection[];
  await manager.saveDatabaseData(database.id, {
    connections,
    settings: {},
    timestamp: 0,
    tabGroups: [],
  });
  const original = (await manager.loadDatabaseData(database.id))!;
  const { result, unmount } = renderHook(() => useConnections(), { wrapper });
  await act(async () => {
    expect(await result.current.loadData(database.id)).toBe(true);
  });
  expect(result.current.state.connections).toEqual(original.connections);
  expect(result.current.persistence.dirty).toBe(false);

  // Saving another category used to serialize guessed Date values for every
  // existing connection, creating false record edits and cross-device conflicts.
  act(() =>
    result.current.dispatch({
      type: "SET_TAB_GROUPS",
      payload: [{ id: "group", name: "Unrelated edit", color: "blue" }],
    }),
  );
  await act(async () => {
    await result.current.flushPendingSave();
  });
  const saved = (await manager.loadDatabaseData(database.id))!;
  expect(saved.connections).toEqual(original.connections);
  for (const { id } of connections)
    expect(saved.recordMetadata!.records[`$/connections/@${id}`]).toEqual(
      original.recordMetadata!.records[`$/connections/@${id}`],
    );
  expect(saved.tabGroups).toHaveLength(1);
  unmount();

  // A second load must not invent a new timestamp from the current clock.
  vi.setSystemTime(new Date("2027-07-01T19:00:00Z"));
  const reopened = renderHook(() => useConnections(), { wrapper });
  await act(async () => {
    await reopened.result.current.loadData(database.id);
  });
  expect(reopened.result.current.state.connections).toEqual(
    original.connections,
  );
  expect(reopened.result.current.persistence.dirty).toBe(false);
});
