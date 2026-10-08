import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { useOriginQuickConnection } from "../../src/hooks/protocol/useOriginQuickConnection";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { createQuickConnectConnection } from "../../src/utils/session/quickConnectConnection";
import {
  clearRuntimeConnectionsForTests,
  registerQuickConnectConnection,
  registerRuntimeConnection,
  releaseRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);

let manager: DatabaseManager;
let databaseId: string;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearRuntimeConnectionsForTests();
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
  const database = await manager.createDatabase("Open database");
  databaseId = database.id;
  await manager.selectDatabase(databaseId);
});

afterEach(() => {
  clearRuntimeConnectionsForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function sessionFor(connection: Connection): ConnectionSession {
  return {
    id: "quick-session",
    connectionId: connection.id,
    protocol: connection.protocol,
    hostname: connection.hostname,
    name: connection.name,
    status: "connecting",
    startTime: new Date(),
  };
}

async function mountProvider() {
  const hook = renderHook(() => useConnections(), { wrapper });
  await act(async () => {
    expect(await hook.result.current.loadData(databaseId)).toBe(true);
  });
  expect(hook.result.current.databaseAvailability?.status).toBe("ready");
  return hook;
}

describe("Quick Connect ownership with an open database", () => {
  it.each(["http", "https", "ssh", "rdp", "vnc", "telnet"])(
    "keeps explicitly registered %s sessions ownerless through provider dispatch",
    async (protocol) => {
      const connection = createQuickConnectConnection(
        {
          hostname: "[2001:db8::1]:8443",
          protocol,
          basicAuthUsername: "operator",
          basicAuthPassword: "temporary-secret",
        },
        "Quick Connect",
      );
      registerQuickConnectConnection(connection);
      const { result } = await mountProvider();
      const saved = {
        ...connection,
        id: "saved-website",
        name: "Saved website",
      };
      act(() => {
        result.current.dispatch({ type: "SET_CONNECTIONS", payload: [saved] });
        result.current.dispatch({
          type: "ADD_SESSION",
          payload: sessionFor(connection),
        });
      });
      const created = result.current.state.sessions[0];
      expect(created.ownerDatabaseId).toBeUndefined();
      expect(created).not.toHaveProperty("basicAuthPassword");
      expect(result.current.state.connections).toEqual([saved]);

      if (protocol === "http" || protocol === "https") {
        const closeRef = { current: vi.fn(async () => {}) };
        const authority = renderHook(() =>
          useOriginQuickConnection(
            created,
            result.current.state.connections,
            closeRef,
          ),
        );
        expect(authority.result.current?.quickConnect).toMatchObject({
          protocol,
          hostname: "2001:db8::1",
          port: 8443,
        });
        expect(() =>
          authority.result.current!.proof.assertCurrent(),
        ).not.toThrow();
        authority.unmount();
      }

      act(() =>
        result.current.dispatch({
          type: "UPDATE_SESSION",
          payload: {
            id: created.id,
            status: "connected",
            ownerDatabaseId: databaseId,
          },
        }),
      );
      expect(result.current.state.sessions[0].ownerDatabaseId).toBeUndefined();
    },
  );

  it.each([
    "generic runtime",
    "unregistered",
    "released",
    "saved collision",
    "explicit owner",
    "hostname mismatch",
    "protocol mismatch",
    "reattach",
    "group",
  ])("preserves database ownership for %s", async (scenario) => {
    const connection = createQuickConnectConnection(
      { hostname: "website.test", protocol: "https" },
      "Quick Connect",
    );
    const session = sessionFor(connection);
    if (scenario === "generic runtime") registerRuntimeConnection(connection);
    else if (scenario !== "unregistered")
      registerQuickConnectConnection(connection);
    if (scenario === "released") releaseRuntimeConnection(connection.id);
    if (scenario === "explicit owner")
      session.ownerDatabaseId = "original-database";
    if (scenario === "hostname mismatch") session.hostname = "different.test";
    if (scenario === "protocol mismatch") session.protocol = "http";
    if (scenario === "reattach") session.reattachOnly = true;
    if (scenario === "group") connection.isGroup = true;
    const { result } = await mountProvider();
    act(() => {
      if (scenario === "saved collision") {
        // Same dispatch batch must see the saved row immediately, without
        // waiting for a React render to update the provider's state closure.
        result.current.dispatch({
          type: "SET_CONNECTIONS",
          payload: [{ ...connection }],
        });
      }
      result.current.dispatch({ type: "ADD_SESSION", payload: session });
    });
    const owner =
      scenario === "explicit owner" ? "original-database" : databaseId;
    const created = result.current.state.sessions[0];
    expect(created.ownerDatabaseId).toBe(owner);
    act(() =>
      result.current.dispatch({
        type: "UPDATE_SESSION",
        payload: { id: created.id, ownerDatabaseId: undefined },
      }),
    );
    expect(result.current.state.sessions[0].ownerDatabaseId).toBe(owner);
    act(() =>
      result.current.dispatch({
        type: "SET_SESSIONS",
        payload: [
          {
            ...created,
            ownerDatabaseId: "other-database",
            lifecycleRevision: 100,
          },
        ],
      }),
    );
    expect(result.current.state.sessions[0].ownerDatabaseId).toBe(owner);
  });
});
