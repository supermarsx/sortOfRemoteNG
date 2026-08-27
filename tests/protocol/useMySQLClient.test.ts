import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { MysqlQueryResult, MysqlSessionInfo } from "../../src/types/mysql";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import {
  MYSQL_KEEPALIVE_INTERVAL_MS,
  useMySQLClient,
} from "../../src/hooks/protocol/useMySQLClient";
import { encodeMysqlUrlValue } from "../../src/utils/services/mysqlService";

const password = "p@ss?word#42";
const connection: Connection = {
  id: "connection-mysql-1",
  name: "Shop database",
  protocol: "mysql",
  hostname: "db.example.test",
  port: 3307,
  username: "shop",
  password,
  database: "testdb",
  timeout: 17,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-mysql-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "mysql",
  hostname: connection.hostname,
  ...patch,
});

const sessionInfo = (
  id = "backend-mysql-1",
  patch: Partial<MysqlSessionInfo> = {},
): MysqlSessionInfo => ({
  id,
  host: connection.hostname,
  port: connection.port,
  username: connection.username || "",
  database: connection.database,
  status: "Connected",
  server_version: "8.0.36",
  server_charset: "utf8mb4",
  connected_at: "2026-01-01T00:00:00Z",
  via_ssh_tunnel: false,
  tls_enabled: false,
  queries_executed: 0,
  total_rows_fetched: 0,
  ...patch,
});

const queryResult: MysqlQueryResult = {
  columns: [
    { name: "id", ordinal: 0, data_type: "INT", is_nullable: false },
    { name: "name", ordinal: 1, data_type: "VARCHAR", is_nullable: true },
  ],
  rows: [
    [1, "Ada"],
    [2, "Grace"],
  ],
  row_count: 2,
  affected_rows: 0,
  last_insert_id: null,
  execution_time_ms: 3,
  warnings: [],
};

const statementResult: MysqlQueryResult = {
  columns: [],
  rows: [],
  row_count: 0,
  affected_rows: 2,
  last_insert_id: 7,
  execution_time_ms: 4,
  warnings: [],
};

const defaultInvoke = (command: string, args?: unknown) => {
  const id = (args as { sessionId?: string })?.sessionId;
  switch (command) {
    case "mysql_connect":
      return Promise.resolve("backend-mysql-1");
    case "mysql_get_session":
      return Promise.resolve(sessionInfo(id));
    case "mysql_server_info":
      return Promise.resolve({
        dialect: "MySql",
        server_version: "8.0.36",
        tls_enabled: false,
      });
    case "mysql_ping":
      return Promise.resolve(true);
    case "mysql_list_databases":
      return Promise.resolve([
        { name: "information_schema", table_count: 80 },
        { name: "testdb", character_set: "utf8mb4", table_count: 1 },
      ]);
    case "mysql_list_tables":
      return Promise.resolve([
        { name: "people", engine: "InnoDB", row_count: 5 },
      ]);
    case "mysql_describe_table":
      return Promise.resolve([
        {
          name: "id",
          data_type: "int",
          is_nullable: false,
          is_primary_key: true,
          is_unique: true,
          is_auto_increment: true,
          ordinal_position: 1,
          extra: "auto_increment",
        },
      ]);
    case "mysql_list_indexes":
      return Promise.resolve([
        {
          name: "PRIMARY",
          columns: ["id"],
          is_unique: true,
          is_primary: true,
          index_type: "BTREE",
        },
      ]);
    case "mysql_list_foreign_keys":
      return Promise.resolve([]);
    case "mysql_execute_query":
      return Promise.resolve(queryResult);
    case "mysql_execute_statement":
      return Promise.resolve(statementResult);
    case "mysql_explain_query":
      return Promise.resolve([
        { id: 1, select_type: "SIMPLE", table: "people", rows: 5 },
      ]);
    case "mysql_show_processlist":
      return Promise.resolve([
        { id: 9, user: "shop", host: "localhost", command: "Query", time: 1 },
      ]);
    default:
      return Promise.resolve(undefined);
  }
};

beforeEach(() => {
  clearRuntimeConnectionsForTests();
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.useConnections.mockReset();
  mocks.useConnections.mockReturnValue({
    state: { connections: [connection], sessions: [] },
    dispatch: mocks.dispatch,
  });
  mocks.invoke.mockImplementation(defaultInvoke);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMySQLClient", () => {
  it("connects with backendSessionId, detects the dialect, and loads the catalog", async () => {
    const { result, unmount } = renderHook(() =>
      useMySQLClient(createSession()),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await waitFor(() => expect(result.current.tables).toHaveLength(1));

    expect(mocks.invoke).toHaveBeenCalledWith("mysql_connect", {
      config: expect.objectContaining({
        host: connection.hostname,
        port: 3307,
        username: "shop",
        password,
        database: "testdb",
        ssh_tunnel: null,
        tls: null,
        connect_timeout_secs: 17,
      }),
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_server_info", {
      sessionId: "backend-mysql-1",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_list_tables", {
      sessionId: "backend-mysql-1",
      database: "testdb",
    });
    expect(result.current.backendSessionId).toBe("backend-mysql-1");
    expect(result.current.dialect).toBe("mysql");
    expect(result.current.serverVersion).toBe("8.0.36");
    expect(result.current.selectedDatabase).toBe("testdb");

    const updates = JSON.stringify(mocks.dispatch.mock.calls);
    expect(updates).not.toContain(password);
    expect(updates).not.toContain(encodeMysqlUrlValue(password));
    expect(updates).toContain("backend-mysql-1");

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).not.toHaveBeenCalledWith("mysql_disconnect", {
      sessionId: "backend-mysql-1",
    });
  });

  it("reports MariaDB from the backend tag and falls back to the version sniff", async () => {
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "mysql_server_info") {
        return Promise.resolve({
          dialect: "MariaDb",
          server_version: "11.4.2-MariaDB-ubu2404",
          tls_enabled: true,
        });
      }
      return defaultInvoke(command, args);
    });
    const tagged = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(tagged.result.current.status).toBe("connected"));
    expect(tagged.result.current.dialect).toBe("mariadb");
    expect(tagged.result.current.serverInfo?.tls_enabled).toBe(true);
    tagged.unmount();

    mocks.invoke.mockImplementation((command, args) => {
      if (command === "mysql_server_info") {
        return Promise.reject(new Error("command mysql_server_info not found"));
      }
      if (command === "mysql_get_session") {
        return Promise.resolve(
          sessionInfo((args as { sessionId: string }).sessionId, {
            server_version: "10.6.18-MariaDB-log",
          }),
        );
      }
      return defaultInvoke(command, args);
    });
    const sniffed = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() =>
      expect(sniffed.result.current.status).toBe("connected"),
    );
    expect(sniffed.result.current.dialect).toBe("mariadb");
    expect(sniffed.result.current.serverVersion).toBe("10.6.18-MariaDB-log");
  });

  it("uses the saved dialect hint before the first connect", () => {
    mocks.useConnections.mockReturnValue({
      state: {
        connections: [{ ...connection, mysqlDialectHint: "mariadb" }],
        sessions: [],
      },
      dispatch: mocks.dispatch,
    });
    mocks.invoke.mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => useMySQLClient(createSession()));
    expect(result.current.status).toBe("connecting");
    expect(result.current.dialect).toBe("mariadb");
  });

  it("resolves volatile Quick Connect credentials", async () => {
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions: [] },
      dispatch: mocks.dispatch,
    });
    registerRuntimeConnection(connection);

    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(mocks.invoke).toHaveBeenCalledWith(
      "mysql_connect",
      expect.objectContaining({
        config: expect.objectContaining({ password }),
      }),
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(password);
  });

  it("reattaches a live backend and disconnects it at most once", async () => {
    const { result } = renderHook(() =>
      useMySQLClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-existing",
        }),
      ),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));

    expect(mocks.invoke).toHaveBeenCalledWith("mysql_get_session", {
      sessionId: "backend-existing",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_ping", {
      sessionId: "backend-existing",
    });
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "mysql_connect"),
    ).toBe(false);

    await act(async () => {
      await Promise.all([
        result.current.disconnect(),
        result.current.disconnect(),
      ]);
      await result.current.disconnect();
    });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "mysql_disconnect",
      ),
    ).toEqual([["mysql_disconnect", { sessionId: "backend-existing" }]]);
    expect(result.current.status).toBe("disconnected");
    expect(result.current.databases).toEqual([]);
  });

  it("closes a stale backend before opening exactly one replacement", async () => {
    mocks.invoke.mockImplementation((command, args) => {
      const id = (args as { sessionId?: string })?.sessionId;
      if (command === "mysql_get_session" && id === "backend-stale") {
        return Promise.resolve(
          sessionInfo("backend-stale", { status: "Disconnected" }),
        );
      }
      if (command === "mysql_connect") return Promise.resolve("backend-new");
      return defaultInvoke(command, args);
    });

    const { result } = renderHook(() =>
      useMySQLClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-stale",
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-new"),
    );

    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_disconnect", {
      sessionId: "backend-stale",
    });
    expect(commands.indexOf("mysql_disconnect")).toBeLessThan(
      commands.indexOf("mysql_connect"),
    );
    expect(
      commands.filter((command) => command === "mysql_connect"),
    ).toHaveLength(1);
  });

  it("recovers when the backend reports the reattached session missing", async () => {
    mocks.invoke.mockImplementation((command, args) => {
      const id = (args as { sessionId?: string })?.sessionId;
      if (command === "mysql_get_session" && id === "backend-gone") {
        return Promise.reject("No active MySQL connection");
      }
      return defaultInvoke(command, args);
    });
    const { result } = renderHook(() =>
      useMySQLClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-gone",
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-mysql-1"),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith("mysql_disconnect", {
      sessionId: "backend-gone",
    });
    expect(result.current.status).toBe("connected");
  });

  it("closes existing handles before failing a missing owner or blocked route", async () => {
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions: [] },
      dispatch: mocks.dispatch,
    });
    const missing = renderHook(() =>
      useMySQLClient(
        createSession({ backendSessionId: "backend-missing-owner" }),
      ),
    );
    await waitFor(() => expect(missing.result.current.status).toBe("error"));
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_disconnect", {
      sessionId: "backend-missing-owner",
    });
    expect(missing.result.current.backendSessionId).toBeNull();
    expect(missing.result.current.error).toMatch(/could not be found/i);
    missing.unmount();

    for (const routed of [
      { ...connection, proxyChainId: "chain" },
      {
        ...connection,
        security: { openvpn: { enabled: true, configId: "vpn" } },
      },
      {
        ...connection,
        security: {
          sshTunnel: {
            enabled: true,
            connectionId: "jump",
            localPort: 0,
            remoteHost: "h",
            remotePort: 1,
          },
        },
      },
      { ...connection, tunnelChainId: "tunnel" },
    ] as Connection[]) {
      mocks.invoke.mockClear();
      mocks.useConnections.mockReturnValue({
        state: { connections: [routed], sessions: [] },
        dispatch: mocks.dispatch,
      });
      const blocked = renderHook(() =>
        useMySQLClient(createSession({ backendSessionId: "backend-blocked" })),
      );
      await waitFor(() => expect(blocked.result.current.status).toBe("error"));
      expect(blocked.result.current.error).toMatch(/direct connections only/i);
      expect(mocks.invoke).toHaveBeenCalledWith("mysql_disconnect", {
        sessionId: "backend-blocked",
      });
      expect(
        mocks.invoke.mock.calls.some(
          ([command]) => command === "mysql_connect",
        ),
      ).toBe(false);
      blocked.unmount();
    }
  });

  it("runs query and statement modes, EXPLAIN, describe, and the process list", async () => {
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    await waitFor(() => expect(result.current.tables).toHaveLength(1));

    await act(async () => {
      expect(await result.current.executeSql("query")).toEqual(queryResult);
    });
    expect(result.current.results).toEqual(queryResult);
    expect(result.current.visibleRows).toHaveLength(2);
    expect(result.current.hasMoreRows).toBe(false);
    expect(result.current.resultTab).toBe("results");

    await act(async () => {
      result.current.setMode("statement");
    });
    await act(async () => {
      expect(await result.current.executeSql()).toEqual(statementResult);
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_execute_statement", {
      sessionId: "backend-mysql-1",
      sql: "SELECT DATABASE(), USER(), VERSION();",
    });

    await act(async () => {
      await result.current.explainQuery();
    });
    expect(result.current.explainRows?.[0]?.table).toBe("people");
    expect(result.current.resultTab).toBe("explain");

    await act(async () => {
      await result.current.describeTable({ name: "people" });
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_describe_table", {
      sessionId: "backend-mysql-1",
      database: "testdb",
      table: "people",
    });
    expect(result.current.columns[0]?.name).toBe("id");
    expect(result.current.indexes[0]?.name).toBe("PRIMARY");
    expect(result.current.selectedTable?.name).toBe("people");

    await act(async () => {
      await result.current.loadProcessList();
    });
    expect(result.current.processes[0]?.id).toBe(9);
    expect(result.current.resultTab).toBe("processes");

    await act(async () => {
      await result.current.killProcess(9);
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_kill_process", {
      sessionId: "backend-mysql-1",
      processId: 9,
    });
  });

  it("generates a backtick-quoted table query and windows large results", async () => {
    const big: MysqlQueryResult = {
      ...queryResult,
      rows: Array.from({ length: 1500 }, (_, index) => [index, `row ${index}`]),
      row_count: 1500,
    };
    mocks.invoke.mockImplementation((command, args) =>
      command === "mysql_execute_query"
        ? Promise.resolve(big)
        : defaultInvoke(command, args),
    );
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.selectedDatabase).toBe("testdb"));

    act(() => result.current.setQueryForTable({ name: "peo`ple" }));
    expect(result.current.query).toBe(
      "SELECT *\nFROM `testdb`.`peo``ple`\nLIMIT 100;",
    );

    await act(async () => {
      await result.current.executeSql("query");
    });
    expect(result.current.visibleRows).toHaveLength(1000);
    expect(result.current.hasMoreRows).toBe(true);
    act(() => result.current.showMoreRows());
    expect(result.current.visibleRows).toHaveLength(1500);
    expect(result.current.hasMoreRows).toBe(false);
  });

  it("rejects empty SQL without invoking the backend", async () => {
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockClear();
    act(() => result.current.setQuery("   "));
    await expect(result.current.executeSql("query")).rejects.toThrow(
      /Enter a SQL statement/i,
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("redacts raw, encoded, and URI credentials from connection errors", async () => {
    const encoded = encodeMysqlUrlValue(password);
    mocks.invoke.mockRejectedValueOnce(
      `connect failed: mysql://shop:${encoded}@db.example.test/shop?password=${encoded} raw=${password}`,
    );
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("error"));

    const rendered = `${result.current.error} ${JSON.stringify(mocks.dispatch.mock.calls)}`;
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain(password);
    expect(rendered).not.toContain(encoded);
    expect(rendered).not.toContain("shop:");
  });

  it("keeps a query error as an operation error while the session stays live", async () => {
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockImplementationOnce(() =>
      Promise.reject(new Error("You have an error in your SQL syntax")),
    );
    await act(async () => {
      await expect(result.current.executeSql("query")).rejects.toThrow(
        /SQL syntax/,
      );
    });
    expect(result.current.status).toBe("connected");
    expect(result.current.error).toMatch(/SQL syntax/);
    expect(result.current.results).toBeNull();
  });

  it("drops the handle when an operation reports the session missing", async () => {
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockImplementationOnce(() =>
      Promise.reject("No active MySQL connection"),
    );
    await act(async () => {
      await expect(result.current.executeSql("query")).rejects.toThrow();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.backendSessionId).toBeNull();
    expect(result.current.error).toMatch(
      /Reconnect to open a new MySQL session/,
    );
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ status: "error" }),
      }),
    );
  });

  it("pings on the keepalive interval and surfaces a lost session", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MYSQL_KEEPALIVE_INTERVAL_MS);
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_ping", {
      sessionId: "backend-mysql-1",
    });
    expect(result.current.status).toBe("connected");

    mocks.invoke.mockImplementation((command, args) =>
      command === "mysql_ping"
        ? Promise.resolve(false)
        : defaultInvoke(command, args),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MYSQL_KEEPALIVE_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.backendSessionId).toBeNull();
  });

  it("reconnects when the session enters the reconnecting state", async () => {
    const { result, rerender } = renderHook(
      ({ session }: { session: ConnectionSession }) => useMySQLClient(session),
      { initialProps: { session: createSession() } },
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockImplementation((command, args) =>
      command === "mysql_connect"
        ? Promise.resolve("backend-mysql-2")
        : defaultInvoke(command, args),
    );

    rerender({
      session: createSession({ status: "reconnecting", reconnectAttempts: 1 }),
    });
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-mysql-2"),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_disconnect", {
      sessionId: "backend-mysql-1",
    });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "mysql_connect",
      ),
    ).toHaveLength(2);
  });

  it("explicit reconnect closes the old backend and opens a new one", async () => {
    const { result } = renderHook(() => useMySQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    mocks.invoke.mockImplementation((command, args) =>
      command === "mysql_connect"
        ? Promise.resolve("backend-mysql-3")
        : defaultInvoke(command, args),
    );
    await act(async () => {
      await result.current.reconnect();
    });
    expect(mocks.invoke).toHaveBeenCalledWith("mysql_disconnect", {
      sessionId: "backend-mysql-1",
    });
    expect(result.current.backendSessionId).toBe("backend-mysql-3");
    expect(result.current.status).toBe("connected");
  });
});
