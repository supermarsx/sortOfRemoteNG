import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  PostgreSQLQueryResult,
  PostgreSQLSessionInfo,
} from "../../types/postgresql";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  useConnections: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => mocks.useConnections(),
}));

import {
  buildPostgreSQLConnectionConfig,
  encodePostgreSQLUrlValue,
  getUnsupportedPostgreSQLRouteReason,
  postgresqlErrorMessage,
  usePostgreSQLClient,
} from "./usePostgreSQLClient";

const password = "p@ss?word#42";
const connection: Connection = {
  id: "connection-pg-1",
  name: "Reporting database",
  protocol: "postgresql" as Connection["protocol"],
  hostname: "db.example.test",
  port: 5433,
  username: "reporter@example.test",
  password,
  database: "sales data",
  timeout: 17,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createSession = (
  patch: Partial<ConnectionSession> = {},
): ConnectionSession => ({
  id: "frontend-pg-1",
  connectionId: connection.id,
  name: connection.name,
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "postgresql",
  hostname: connection.hostname,
  ...patch,
});

const sessionInfo = (
  id = "backend-pg-1",
  patch: Partial<PostgreSQLSessionInfo> = {},
): PostgreSQLSessionInfo => ({
  id,
  host: connection.hostname,
  port: connection.port,
  username: connection.username || "",
  database: connection.database,
  status: "Connected",
  server_version: "PostgreSQL 17.1 test",
  connected_at: "2026-01-01T00:00:00Z",
  queries_executed: 0,
  total_rows_fetched: 0,
  via_ssh_tunnel: false,
  ...patch,
});

const queryResult: PostgreSQLQueryResult = {
  columns: [{ name: "answer", type_name: "INT4", ordinal: 0 }],
  rows: [{ answer: "42" }],
  affected_rows: 0,
  execution_time_ms: 3,
};

const statementResult: PostgreSQLQueryResult = {
  columns: [],
  rows: [],
  affected_rows: 2,
  execution_time_ms: 4,
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
  mocks.invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "pg_connect") return Promise.resolve("backend-pg-1");
    if (command === "pg_get_session") {
      const sessionId = (args as { sessionId?: string })?.sessionId;
      return Promise.resolve(sessionInfo(sessionId));
    }
    if (command === "pg_ping") return Promise.resolve(true);
    if (command === "pg_list_databases") {
      return Promise.resolve([
        {
          name: "sales data",
          owner: "reporter",
          encoding: "UTF8",
          collation: "en_GB.UTF-8",
          size_bytes: 2048,
        },
      ]);
    }
    if (command === "pg_list_schemas") {
      return Promise.resolve([{ name: "public", owner: "reporter" }]);
    }
    if (command === "pg_list_tables") {
      return Promise.resolve([
        {
          name: "orders",
          schema: "public",
          table_type: "table",
          estimated_rows: 5,
          total_size: "16 kB",
        },
      ]);
    }
    if (command === "pg_describe_table") {
      return Promise.resolve([
        {
          name: "id",
          data_type: "integer",
          udt_name: "int4",
          is_nullable: false,
          ordinal_position: 1,
          is_identity: true,
        },
      ]);
    }
    if (command === "pg_execute_query") return Promise.resolve(queryResult);
    if (command === "pg_execute_statement") {
      return Promise.resolve(statementResult);
    }
    return Promise.resolve(undefined);
  });
});

describe("usePostgreSQLClient", () => {
  it("builds the exact snake_case DTO and safely encodes URL values", () => {
    const config = buildPostgreSQLConnectionConfig(
      {
        ...connection,
        postgresSslMode: "verify-full",
        postgresCaCertificatePath: "C:\\certs\\root CA.pem",
        postgresClientCertificatePath: "C:\\certs\\client.pem",
        postgresClientKeyPath: "C:\\certs\\client key.pem",
      } as Connection,
      createSession(),
    );

    expect(config).toMatchObject({
      host: "db.example.test",
      port: 5433,
      username: "reporter@example.test",
      password: "p@ss?word#42",
      database: "sales data",
      application_name: "sortOfRemoteNG",
      connection_timeout_secs: 17,
      ssh_tunnel: null,
      tls: null,
      extra_params: {
        sslmode: "verify-full",
        sslrootcert: "C:\\certs\\root CA.pem",
        sslcert: "C:\\certs\\client.pem",
        sslkey: "C:\\certs\\client key.pem",
      },
    });
    expect(config).not.toHaveProperty("connectionTimeoutSecs");
    expect(encodePostgreSQLUrlValue("a/b?c#d")).toBe("a%2Fb%3Fc%23d");
  });

  it("rejects TLS combinations the native URL contract cannot safely honor", () => {
    expect(() =>
      buildPostgreSQLConnectionConfig(
        {
          ...connection,
          postgresSslMode: "prefer",
          postgresCaCertificatePath: "root.pem",
        } as Connection,
        createSession(),
      ),
    ).toThrow(/Verify CA or Verify Full/i);
    expect(() =>
      buildPostgreSQLConnectionConfig(
        {
          ...connection,
          postgresSslMode: "require",
          postgresClientCertificatePath: "client.pem",
        } as Connection,
        createSession(),
      ),
    ).toThrow(/both a client certificate path and a client key path/i);
  });

  it("connects through registered commands without persisting credentials", async () => {
    const { result, unmount } = renderHook(() =>
      usePostgreSQLClient(createSession()),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await waitFor(() => expect(result.current.tables).toHaveLength(1));
    expect(mocks.invoke).toHaveBeenCalledWith("pg_connect", {
      config: expect.objectContaining({
        host: connection.hostname,
        username: "reporter@example.test",
        password: "p@ss?word#42",
        database: "sales data",
        extra_params: { sslmode: "prefer" },
      }),
    });
    expect(mocks.invoke).toHaveBeenCalledWith("pg_get_session", {
      sessionId: "backend-pg-1",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("pg_list_tables", {
      sessionId: "backend-pg-1",
      schema: "public",
    });

    const updates = JSON.stringify(mocks.dispatch.mock.calls);
    expect(updates).not.toContain(password);
    expect(updates).not.toContain(encodePostgreSQLUrlValue(password));
    expect(updates).toContain("backend-pg-1");

    unmount();
    await act(async () => Promise.resolve());
    expect(mocks.invoke).not.toHaveBeenCalledWith("pg_disconnect", {
      sessionId: "backend-pg-1",
    });
  });

  it("resolves volatile Quick Connect credentials", async () => {
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions: [] },
      dispatch: mocks.dispatch,
    });
    registerRuntimeConnection(connection);

    const { result } = renderHook(() => usePostgreSQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    expect(mocks.invoke).toHaveBeenCalledWith(
      "pg_connect",
      expect.objectContaining({
        config: expect.objectContaining({
          password,
        }),
      }),
    );
    expect(JSON.stringify(mocks.dispatch.mock.calls)).not.toContain(password);
  });

  it("reattaches a live backend and disconnects it at most once", async () => {
    const { result } = renderHook(() =>
      usePostgreSQLClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-pg-existing",
        }),
      ),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));

    expect(mocks.invoke).toHaveBeenCalledWith("pg_get_session", {
      sessionId: "backend-pg-existing",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("pg_ping", {
      sessionId: "backend-pg-existing",
    });
    expect(
      mocks.invoke.mock.calls.some(([command]) => command === "pg_connect"),
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
        ([command]) => command === "pg_disconnect",
      ),
    ).toEqual([["pg_disconnect", { sessionId: "backend-pg-existing" }]]);
    expect(result.current.status).toBe("disconnected");
  });

  it("closes a stale backend before opening exactly one replacement", async () => {
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      const id = (args as { sessionId?: string })?.sessionId;
      if (command === "pg_get_session" && id === "backend-pg-stale") {
        return Promise.resolve(
          sessionInfo("backend-pg-stale", { status: "Disconnected" }),
        );
      }
      if (command === "pg_connect") return Promise.resolve("backend-pg-new");
      if (command === "pg_get_session") {
        return Promise.resolve(sessionInfo(id || "backend-pg-new"));
      }
      if (command === "pg_list_databases") return Promise.resolve([]);
      if (command === "pg_list_schemas") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() =>
      usePostgreSQLClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-pg-stale",
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.backendSessionId).toBe("backend-pg-new"),
    );

    expect(mocks.invoke).toHaveBeenCalledWith("pg_disconnect", {
      sessionId: "backend-pg-stale",
    });
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands.indexOf("pg_disconnect")).toBeLessThan(
      commands.indexOf("pg_connect"),
    );
    expect(commands.filter((command) => command === "pg_connect")).toHaveLength(
      1,
    );
  });

  it("preserves literal percent sequences in raw session metadata", async () => {
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "pg_get_session") {
        return Promise.resolve(
          sessionInfo((args as { sessionId: string }).sessionId, {
            username: "literal%41user",
            database: "literal%20database",
          }),
        );
      }
      if (command === "pg_ping") return Promise.resolve(true);
      if (command === "pg_list_databases") return Promise.resolve([]);
      if (command === "pg_list_schemas") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() =>
      usePostgreSQLClient(
        createSession({
          status: "connected",
          backendSessionId: "backend-pg-existing",
        }),
      ),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(result.current.sessionInfo?.username).toBe("literal%41user");
    expect(result.current.sessionInfo?.database).toBe("literal%20database");
  });

  it("closes existing handles before failing a missing or newly blocked connection", async () => {
    mocks.useConnections.mockReturnValue({
      state: { connections: [], sessions: [] },
      dispatch: mocks.dispatch,
    });
    const missing = renderHook(() =>
      usePostgreSQLClient(
        createSession({ backendSessionId: "backend-pg-missing-owner" }),
      ),
    );
    await waitFor(() => expect(missing.result.current.status).toBe("error"));
    expect(mocks.invoke).toHaveBeenCalledWith("pg_disconnect", {
      sessionId: "backend-pg-missing-owner",
    });
    expect(missing.result.current.backendSessionId).toBeNull();
    missing.unmount();

    mocks.invoke.mockClear();
    mocks.useConnections.mockReturnValue({
      state: {
        connections: [{ ...connection, proxyChainId: "newly-blocked" }],
        sessions: [],
      },
      dispatch: mocks.dispatch,
    });
    const blocked = renderHook(() =>
      usePostgreSQLClient(
        createSession({ backendSessionId: "backend-pg-blocked-route" }),
      ),
    );
    await waitFor(() => expect(blocked.result.current.status).toBe("error"));
    expect(mocks.invoke).toHaveBeenCalledWith("pg_disconnect", {
      sessionId: "backend-pg-blocked-route",
    });
    expect(blocked.result.current.backendSessionId).toBeNull();
  });

  it("runs real query, statement, schema, and describe commands", async () => {
    const { result } = renderHook(() => usePostgreSQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    await act(async () => {
      expect(await result.current.executeSql("query")).toEqual(queryResult);
      expect(await result.current.executeSql("statement")).toEqual(
        statementResult,
      );
      await result.current.loadTables("public");
      await result.current.describeTable({
        name: "orders",
        schema: "public",
        table_type: "table",
      });
    });

    expect(mocks.invoke).toHaveBeenCalledWith("pg_execute_query", {
      sessionId: "backend-pg-1",
      sql: "SELECT current_database(), current_user, version();",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("pg_execute_statement", {
      sessionId: "backend-pg-1",
      sql: "SELECT current_database(), current_user, version();",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("pg_describe_table", {
      sessionId: "backend-pg-1",
      schema: "public",
      table: "orders",
    });
    expect(result.current.columns[0]?.name).toBe("id");
  });

  it("redacts raw, encoded, and URI credentials from UI/session errors", async () => {
    const encoded = encodePostgreSQLUrlValue(password);
    mocks.invoke.mockRejectedValueOnce(
      `connect failed: postgresql://reporter:${encoded}@db.example.test/sales?password=${encoded} raw=${password}`,
    );
    const { result } = renderHook(() => usePostgreSQLClient(createSession()));
    await waitFor(() => expect(result.current.status).toBe("error"));

    const rendered = `${result.current.error} ${JSON.stringify(
      mocks.dispatch.mock.calls,
    )}`;
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain(password);
    expect(rendered).not.toContain(encoded);
    expect(rendered).not.toContain("reporter:");

    expect(
      postgresqlErrorMessage("postgres://someone:any-secret@example.test/db"),
    ).toBe("postgres://[redacted]@example.test/db");
  });

  it("fails closed for all persisted proxy, VPN, and tunnel routes", () => {
    const routed: Connection[] = [
      { ...connection, proxyChainId: "proxy-chain" },
      { ...connection, connectionChainId: "connection-chain" },
      { ...connection, tunnelChainId: "tunnel-chain" },
      {
        ...connection,
        security: {
          proxy: {
            type: "socks5",
            host: "proxy.test",
            port: 1080,
            enabled: true,
          },
        },
      },
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
            remoteHost: connection.hostname,
            remotePort: connection.port,
          },
        },
      },
      {
        ...connection,
        security: {
          tunnelChain: [
            { id: "inline-route", type: "wireguard", enabled: true },
          ],
        },
      },
    ];
    for (const candidate of routed) {
      expect(getUnsupportedPostgreSQLRouteReason(candidate)).toMatch(
        /direct connections only/i,
      );
    }
    expect(
      getUnsupportedPostgreSQLRouteReason({
        ...connection,
        security: {
          proxy: {
            type: "socks5",
            host: "proxy.test",
            port: 1080,
            enabled: false,
          },
          tunnelChain: [
            { id: "disabled-route", type: "wireguard", enabled: false },
          ],
        },
      }),
    ).toBeNull();
  });
});
