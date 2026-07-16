import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  PostgreSQLColumnDef,
  PostgreSQLConnectionConfig,
  PostgreSQLDatabaseInfo,
  PostgreSQLExecutionMode,
  PostgreSQLQueryResult,
  PostgreSQLSavedConnectionOptions,
  PostgreSQLSchemaInfo,
  PostgreSQLSessionInfo,
  PostgreSQLSslMode,
  PostgreSQLTableInfo,
} from "../../types/postgresql";
import { formatErrorForDisplay } from "../../utils/errors/formatError";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export type PostgreSQLClientStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type SavedPostgreSQLConnection = Connection & PostgreSQLSavedConnectionOptions;

const positiveInteger = (
  value: number | undefined,
  fallback: number,
  maximum: number,
): number =>
  Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(Math.floor(value as number), maximum)
    : fallback;

/** RFC 3986 form used to redact URL-encoded variants in backend errors. */
export const encodePostgreSQLUrlValue = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const normalizedHost = (hostname: string): string => {
  const host = hostname.trim();
  if (!host) throw new Error("A PostgreSQL hostname is required.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host) || host.includes("@")) {
    throw new Error(
      "Enter a PostgreSQL hostname, not a connection URI or credential-bearing address.",
    );
  }
  return host;
};

const tlsExtraParameters = (
  connection: SavedPostgreSQLConnection,
): Record<string, string> => {
  const mode: PostgreSQLSslMode = connection.postgresSslMode ?? "prefer";
  const caPath = connection.postgresCaCertificatePath?.trim();
  const certificatePath = connection.postgresClientCertificatePath?.trim();
  const keyPath = connection.postgresClientKeyPath?.trim();

  if (Boolean(certificatePath) !== Boolean(keyPath)) {
    throw new Error(
      "PostgreSQL mutual TLS requires both a client certificate path and a client key path.",
    );
  }
  if (caPath && mode !== "verify-ca" && mode !== "verify-full") {
    throw new Error(
      "A PostgreSQL CA certificate requires SSL mode Verify CA or Verify Full.",
    );
  }
  if (
    (certificatePath || keyPath) &&
    !["require", "verify-ca", "verify-full"].includes(mode)
  ) {
    throw new Error(
      "PostgreSQL client certificates require SSL mode Require, Verify CA, or Verify Full.",
    );
  }

  const parameters: Record<string, string> = { sslmode: mode };
  if (caPath) parameters.sslrootcert = caPath;
  if (certificatePath) parameters.sslcert = certificatePath;
  if (keyPath) parameters.sslkey = keyPath;
  return parameters;
};

/**
 * Build the exact snake_case DTO consumed by `PgConnectionConfig`.
 * Raw values stay in the DTO and its safe SessionInfo metadata. The Rust URL
 * builder performs percent encoding only at the SQLx transport boundary.
 */
export const buildPostgreSQLConnectionConfig = (
  connection: Connection,
  session: ConnectionSession,
): PostgreSQLConnectionConfig => {
  const saved = connection as SavedPostgreSQLConnection;
  const port = positiveInteger(saved.port, 5432, 65_535);
  const username = saved.username?.trim() || "postgres";
  const database = saved.database?.trim() || "postgres";

  return {
    host: normalizedHost(saved.hostname || session.hostname),
    port,
    username,
    password: saved.password ?? null,
    database,
    application_name: "sortOfRemoteNG",
    connection_timeout_secs: positiveInteger(
      saved.postgresConnectionTimeoutSecs ?? saved.timeout,
      10,
      600,
    ),
    ssh_tunnel: null,
    // The Rust TlsConfig field is currently inert. SQLx consumes the explicit,
    // allow-listed SSL URL parameters below, including certificate paths.
    tls: null,
    extra_params: tlsExtraParameters(saved),
  };
};

/** The native PostgreSQL service currently owns a direct socket only. */
export const getUnsupportedPostgreSQLRouteReason = (
  connection: Readonly<Connection>,
): string | null => {
  const hasInlineRoute =
    connection.security?.proxy?.enabled === true ||
    connection.security?.openvpn?.enabled === true ||
    connection.security?.sshTunnel?.enabled === true ||
    connection.security?.tunnelChain?.some((layer) => layer.enabled !== false);
  if (
    connection.proxyChainId ||
    connection.connectionChainId ||
    connection.tunnelChainId ||
    hasInlineRoute
  ) {
    return "The native PostgreSQL client currently supports direct connections only; remove the configured proxy, VPN, or tunnel chain for this session.";
  }
  return null;
};

export const postgresqlApi = {
  connect: (config: PostgreSQLConnectionConfig) =>
    invoke<string>("pg_connect", { config }),
  disconnect: (sessionId: string) =>
    invoke<void>("pg_disconnect", { sessionId }),
  getSession: (sessionId: string) =>
    invoke<PostgreSQLSessionInfo>("pg_get_session", { sessionId }),
  ping: (sessionId: string) => invoke<boolean>("pg_ping", { sessionId }),
  executeQuery: (sessionId: string, sql: string) =>
    invoke<PostgreSQLQueryResult>("pg_execute_query", { sessionId, sql }),
  executeStatement: (sessionId: string, sql: string) =>
    invoke<PostgreSQLQueryResult>("pg_execute_statement", { sessionId, sql }),
  listDatabases: (sessionId: string) =>
    invoke<PostgreSQLDatabaseInfo[]>("pg_list_databases", { sessionId }),
  listSchemas: (sessionId: string) =>
    invoke<PostgreSQLSchemaInfo[]>("pg_list_schemas", { sessionId }),
  listTables: (sessionId: string, schema: string) =>
    invoke<PostgreSQLTableInfo[]>("pg_list_tables", { sessionId, schema }),
  describeTable: (sessionId: string, schema: string, table: string) =>
    invoke<PostgreSQLColumnDef[]>("pg_describe_table", {
      sessionId,
      schema,
      table,
    }),
};

const connectionSecrets = (
  connection: Readonly<Connection> | undefined,
): string[] => {
  if (!connection) return [];
  const inlineSecrets = (connection.security?.tunnelChain ?? []).flatMap(
    (layer) => [
      layer.proxy?.password,
      layer.sshTunnel?.password,
      layer.sshTunnel?.passphrase,
      layer.sshTunnel?.privateKey,
      layer.sshTunnel?.proxyCommand?.proxyPassword,
      layer.vpn?.privateKey,
      layer.vpn?.presharedKey,
      layer.tunnel?.authToken,
      layer.mesh?.authKey,
    ],
  );
  const raw = [
    connection.password,
    connection.passphrase,
    connection.privateKey,
    connection.security?.proxy?.password,
    ...inlineSecrets,
  ].filter((value): value is string => Boolean(value));
  return [...raw, ...raw.map(encodePostgreSQLUrlValue)];
};

const redactPostgreSQLUri = (message: string): string =>
  message
    .replace(/\b((?:postgres|postgresql):\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:password|sslpassword)=)[^&#\s]*/gi, "$1[redacted]");

export const postgresqlErrorMessage = (
  cause: unknown,
  connection?: Readonly<Connection>,
): string =>
  redactPostgreSQLUri(
    formatErrorForDisplay(cause, connectionSecrets(connection)),
  );

const isMissingSessionError = (cause: unknown): boolean =>
  /session (?:not found|does not exist)|no active postgresql connection/i.test(
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "",
  );

const isConnectedSession = (info: PostgreSQLSessionInfo): boolean =>
  info.status === "Connected";

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;

export function usePostgreSQLClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );

  const [status, setStatus] = useState<PostgreSQLClientStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<PostgreSQLSessionInfo | null>(
    null,
  );
  const [query, setQuery] = useState(
    "SELECT current_database(), current_user, version();",
  );
  const [results, setResults] = useState<PostgreSQLQueryResult | null>(null);
  const [databases, setDatabases] = useState<PostgreSQLDatabaseInfo[]>([]);
  const [schemas, setSchemas] = useState<PostgreSQLSchemaInfo[]>([]);
  const [tables, setTables] = useState<PostgreSQLTableInfo[]>([]);
  const [selectedSchema, setSelectedSchemaState] = useState("public");
  const [selectedTable, setSelectedTable] =
    useState<PostgreSQLTableInfo | null>(null);
  const [columns, setColumns] = useState<PostgreSQLColumnDef[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const selectedSchemaRef = useRef(selectedSchema);
  selectedSchemaRef.current = selectedSchema;
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const busyCountRef = useRef(0);
  const disconnectPromiseRef = useRef<{
    sessionId: string;
    promise: Promise<void>;
  } | null>(null);
  const disconnectedIdsRef = useRef(new Set<string>());
  const reconnectTokenRef = useRef<string | null>(null);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      sessionRef.current = { ...sessionRef.current, ...patch };
      dispatch({
        type: "UPDATE_SESSION",
        payload: sessionRef.current,
      });
    },
    [dispatch],
  );

  const toErrorMessage = useCallback(
    (cause: unknown) => postgresqlErrorMessage(cause, connectionRef.current),
    [],
  );

  const runBusy = useCallback(async <T>(operation: () => Promise<T>) => {
    busyCountRef.current += 1;
    if (mountedRef.current) setIsBusy(true);
    try {
      return await operation();
    } finally {
      busyCountRef.current = Math.max(0, busyCountRef.current - 1);
      if (mountedRef.current && busyCountRef.current === 0) setIsBusy(false);
    }
  }, []);

  const markConnectionError = useCallback(
    (cause: unknown) => {
      const message = toErrorMessage(cause);
      if (mountedRef.current) {
        setStatus("error");
        setError(message);
      }
      updateSession({ status: "error", errorMessage: message });
      return message;
    },
    [toErrorMessage, updateSession],
  );

  const markOperationError = useCallback(
    (cause: unknown) => {
      const message = toErrorMessage(cause);
      if (mountedRef.current) setError(message);
      return message;
    },
    [toErrorMessage],
  );

  const markConnected = useCallback(
    (info: PostgreSQLSessionInfo) => {
      backendRef.current = info.id;
      disconnectedIdsRef.current.delete(info.id);
      if (mountedRef.current) {
        setBackendSessionId(info.id);
        setSessionInfo(info);
        setStatus("connected");
        setError(null);
      }
      updateSession({
        backendSessionId: info.id,
        status: "connected",
        errorMessage: undefined,
      });
    },
    [updateSession],
  );

  const requireSessionId = useCallback((): string => {
    const sessionId = backendRef.current;
    if (!sessionId) throw new Error("PostgreSQL is not connected.");
    return sessionId;
  }, []);

  const disconnectBackendOnce = useCallback(async (sessionId: string) => {
    if (disconnectedIdsRef.current.has(sessionId)) return;
    const pending = disconnectPromiseRef.current;
    if (pending?.sessionId === sessionId) return pending.promise;

    const promise = postgresqlApi
      .disconnect(sessionId)
      .catch((cause) => {
        if (!isMissingSessionError(cause)) throw cause;
      })
      .then(() => {
        disconnectedIdsRef.current.add(sessionId);
      })
      .finally(() => {
        if (disconnectPromiseRef.current?.sessionId === sessionId) {
          disconnectPromiseRef.current = null;
        }
      });
    disconnectPromiseRef.current = { sessionId, promise };
    return promise;
  }, []);

  const blockConnection = useCallback(
    async (reason: string) => {
      const existingId = backendRef.current;
      if (existingId) {
        try {
          await disconnectBackendOnce(existingId);
        } catch (cause) {
          markConnectionError(
            `${reason} The existing PostgreSQL backend session could not be closed safely: ${toErrorMessage(cause)}`,
          );
          return;
        }
        if (backendRef.current === existingId) backendRef.current = null;
        if (mountedRef.current) {
          setBackendSessionId(null);
          setSessionInfo(null);
        }
        updateSession({ backendSessionId: undefined });
      }
      markConnectionError(reason);
    },
    [disconnectBackendOnce, markConnectionError, toErrorMessage, updateSession],
  );

  const loadTables = useCallback(
    async (schema: string): Promise<PostgreSQLTableInfo[]> => {
      const sessionId = requireSessionId();
      try {
        const nextTables = await runBusy(() =>
          postgresqlApi.listTables(sessionId, schema),
        );
        if (backendRef.current === sessionId && mountedRef.current) {
          selectedSchemaRef.current = schema;
          setSelectedSchemaState(schema);
          setTables(nextTables);
          setSelectedTable(null);
          setColumns([]);
          setError(null);
        }
        return nextTables;
      } catch (cause) {
        throw new Error(markOperationError(cause));
      }
    },
    [markOperationError, requireSessionId, runBusy],
  );

  const refreshCatalog = useCallback(async () => {
    const sessionId = requireSessionId();
    try {
      const [nextDatabases, nextSchemas] = await runBusy(() =>
        Promise.all([
          postgresqlApi.listDatabases(sessionId),
          postgresqlApi.listSchemas(sessionId),
        ]),
      );
      if (backendRef.current !== sessionId) return;
      if (mountedRef.current) {
        setDatabases(nextDatabases);
        setSchemas(nextSchemas);
      }
      const schema =
        nextSchemas.find((item) => item.name === selectedSchemaRef.current)
          ?.name ??
        nextSchemas.find((item) => item.name === "public")?.name ??
        nextSchemas[0]?.name;
      if (schema) await loadTables(schema);
      else if (mountedRef.current) {
        setTables([]);
        setColumns([]);
      }
      if (mountedRef.current) setError(null);
    } catch (cause) {
      throw new Error(markOperationError(cause));
    }
  }, [loadTables, markOperationError, requireSessionId, runBusy]);

  const describeTable = useCallback(
    async (table: PostgreSQLTableInfo) => {
      const sessionId = requireSessionId();
      try {
        const nextColumns = await runBusy(() =>
          postgresqlApi.describeTable(sessionId, table.schema, table.name),
        );
        if (backendRef.current === sessionId && mountedRef.current) {
          setSelectedTable(table);
          setColumns(nextColumns);
          setError(null);
        }
        return nextColumns;
      } catch (cause) {
        throw new Error(markOperationError(cause));
      }
    },
    [markOperationError, requireSessionId, runBusy],
  );

  const connect = useCallback(
    async (reattach: boolean) => {
      const generation = ++generationRef.current;
      const currentConnection = connectionRef.current;
      if (!currentConnection) {
        await blockConnection(
          "The saved or Quick Connect PostgreSQL connection could not be found.",
        );
        return;
      }
      const routeError = getUnsupportedPostgreSQLRouteReason(currentConnection);
      if (routeError) {
        await blockConnection(routeError);
        return;
      }

      if (mountedRef.current) {
        setStatus("connecting");
        setError(null);
      }

      let info: PostgreSQLSessionInfo | null = null;
      const previousId = reattach ? backendRef.current : null;
      if (previousId) {
        let previousSessionIsMissing = false;
        try {
          info = await postgresqlApi.getSession(previousId);
          if (
            !isConnectedSession(info) ||
            !(await postgresqlApi.ping(previousId))
          ) {
            info = null;
          }
        } catch (cause) {
          if (!isMissingSessionError(cause)) {
            markConnectionError(cause);
            return;
          }
          previousSessionIsMissing = true;
          info = null;
        }
        if (!info) {
          if (!previousSessionIsMissing) {
            try {
              await disconnectBackendOnce(previousId);
            } catch (cause) {
              markConnectionError(cause);
              return;
            }
          }
          if (backendRef.current === previousId) backendRef.current = null;
          if (mountedRef.current) {
            setBackendSessionId(null);
            setSessionInfo(null);
          }
          updateSession({ backendSessionId: undefined });
        }
      }

      if (generationRef.current !== generation || !mountedRef.current) return;

      let openedId: string | null = null;
      try {
        if (!info) {
          const config = buildPostgreSQLConnectionConfig(
            currentConnection,
            sessionRef.current,
          );
          openedId = await postgresqlApi.connect(config);
          info = await postgresqlApi.getSession(openedId);
          if (!isConnectedSession(info)) {
            throw new Error(
              "The PostgreSQL backend did not report a connected session.",
            );
          }
        }
        if (generationRef.current !== generation || !mountedRef.current) {
          if (openedId)
            await disconnectBackendOnce(openedId).catch(() => undefined);
          return;
        }
        markConnected(info);
        void refreshCatalog().catch(() => {
          // The catalog error remains visible while the query session stays live.
        });
      } catch (cause) {
        if (openedId) {
          await disconnectBackendOnce(openedId).catch(() => undefined);
        }
        if (generationRef.current === generation) markConnectionError(cause);
      }
    },
    [
      blockConnection,
      disconnectBackendOnce,
      markConnected,
      markConnectionError,
      refreshCatalog,
      updateSession,
    ],
  );

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    generationRef.current += 1;
    if (!sessionId) {
      if (mountedRef.current) {
        setBackendSessionId(null);
        setSessionInfo(null);
        setStatus("disconnected");
        setError(null);
      }
      updateSession({
        backendSessionId: undefined,
        status: "disconnected",
        errorMessage: undefined,
      });
      return;
    }

    try {
      await disconnectBackendOnce(sessionId);
    } catch (cause) {
      const message = markConnectionError(cause);
      if (mountedRef.current) setBackendSessionId(sessionId);
      updateSession({ backendSessionId: sessionId, errorMessage: message });
      throw new Error(message);
    }

    if (backendRef.current === sessionId) backendRef.current = null;
    if (mountedRef.current) {
      setBackendSessionId(null);
      setSessionInfo(null);
      setDatabases([]);
      setSchemas([]);
      setTables([]);
      setColumns([]);
      setStatus("disconnected");
      setError(null);
    }
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [disconnectBackendOnce, markConnectionError, updateSession]);

  const reconnect = useCallback(async () => {
    const previousId = backendRef.current;
    generationRef.current += 1;
    if (mountedRef.current) {
      setStatus("connecting");
      setError(null);
    }
    if (previousId) {
      try {
        await disconnectBackendOnce(previousId);
      } catch (cause) {
        const message = markConnectionError(cause);
        throw new Error(message);
      }
      if (backendRef.current === previousId) backendRef.current = null;
      updateSession({ backendSessionId: undefined, status: "connecting" });
    }
    await connect(false);
  }, [connect, disconnectBackendOnce, markConnectionError, updateSession]);

  const executeSql = useCallback(
    async (mode: PostgreSQLExecutionMode) => {
      const sql = query.trim();
      if (!sql) throw new Error("Enter a SQL statement to execute.");
      const sessionId = requireSessionId();
      if (mountedRef.current) {
        setIsExecuting(true);
        setError(null);
      }
      try {
        const result = await (mode === "query"
          ? postgresqlApi.executeQuery(sessionId, sql)
          : postgresqlApi.executeStatement(sessionId, sql));
        if (backendRef.current === sessionId && mountedRef.current) {
          setResults(result);
          setError(null);
        }
        return result;
      } catch (cause) {
        if (mountedRef.current) setResults(null);
        throw new Error(markOperationError(cause));
      } finally {
        if (mountedRef.current) setIsExecuting(false);
      }
    },
    [markOperationError, query, requireSessionId],
  );

  const setQueryForTable = useCallback((table: PostgreSQLTableInfo) => {
    setQuery(
      `SELECT *\nFROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}\nLIMIT 100;`,
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (sessionRef.current.status !== "reconnecting") void connect(true);
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [connect, session.connectionId]);

  useEffect(() => {
    if (session.status !== "reconnecting") return;
    const token = `${session.connectionId}:${session.reconnectAttempts ?? 0}`;
    if (reconnectTokenRef.current === token) return;
    reconnectTokenRef.current = token;
    void reconnect().catch(() => {
      /* reconnect already reported a redacted session error */
    });
  }, [
    reconnect,
    session.connectionId,
    session.reconnectAttempts,
    session.status,
  ]);

  return useMemo(
    () => ({
      status,
      error,
      backendSessionId,
      sessionInfo,
      query,
      setQuery,
      results,
      databases,
      schemas,
      tables,
      selectedSchema,
      selectedTable,
      columns,
      isBusy,
      isExecuting,
      refreshCatalog,
      loadTables,
      describeTable,
      setQueryForTable,
      executeSql,
      reconnect,
      disconnect,
    }),
    [
      backendSessionId,
      columns,
      databases,
      describeTable,
      disconnect,
      error,
      executeSql,
      isBusy,
      isExecuting,
      loadTables,
      query,
      reconnect,
      refreshCatalog,
      results,
      schemas,
      selectedSchema,
      selectedTable,
      sessionInfo,
      status,
      tables,
      setQueryForTable,
    ],
  );
}
