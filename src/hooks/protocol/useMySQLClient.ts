import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  MYSQL_RESULT_PAGE_SIZE,
  type MysqlColumnDef,
  type MysqlDatabaseInfo,
  type MysqlDialect,
  type MysqlExecutionMode,
  type MysqlExplainRow,
  type MysqlForeignKeyInfo,
  type MysqlIndexInfo,
  type MysqlProcessInfo,
  type MysqlQueryResult,
  type MysqlSavedConnectionOptions,
  type MysqlServerInfo,
  type MysqlSessionInfo,
  type MysqlTableInfo,
} from "../../types/mysql";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";
import {
  buildMysqlConnectionConfig,
  detectMysqlDialect,
  getUnsupportedMysqlRouteReason,
  isMissingMysqlSessionError,
  mysqlApi,
  mysqlErrorMessage,
  quoteMysqlIdentifier,
} from "../../utils/services/mysqlService";

export type MySQLClientStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type MySQLResultTab = "results" | "explain" | "processes";

/** Keepalive interval; a failed ping surfaces a lost backend session. */
export const MYSQL_KEEPALIVE_INTERVAL_MS = 30_000;

export {
  buildMysqlConnectionConfig,
  getUnsupportedMysqlRouteReason,
  mysqlErrorMessage,
} from "../../utils/services/mysqlService";

const isConnectedSession = (info: MysqlSessionInfo): boolean =>
  info.status === "Connected";

const firstDatabaseName = (
  candidates: MysqlDatabaseInfo[],
  preferred: string | null | undefined,
): string | null => {
  if (preferred && candidates.some((item) => item.name === preferred)) {
    return preferred;
  }
  const user = candidates.find(
    (item) =>
      !/^(information_schema|performance_schema|mysql|sys)$/i.test(item.name),
  );
  return user?.name ?? candidates[0]?.name ?? null;
};

export function useMySQLClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );

  const [status, setStatus] = useState<MySQLClientStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<MysqlSessionInfo | null>(null);
  const [serverInfo, setServerInfo] = useState<MysqlServerInfo | null>(null);
  const [query, setQuery] = useState("SELECT DATABASE(), USER(), VERSION();");
  const [mode, setMode] = useState<MysqlExecutionMode>("query");
  const [results, setResults] = useState<MysqlQueryResult | null>(null);
  const [explainRows, setExplainRows] = useState<MysqlExplainRow[] | null>(
    null,
  );
  const [processes, setProcesses] = useState<MysqlProcessInfo[]>([]);
  const [resultTab, setResultTab] = useState<MySQLResultTab>("results");
  const [visibleRowLimit, setVisibleRowLimit] = useState(
    MYSQL_RESULT_PAGE_SIZE,
  );
  const [databases, setDatabases] = useState<MysqlDatabaseInfo[]>([]);
  const [selectedDatabase, setSelectedDatabaseState] = useState<string | null>(
    null,
  );
  const [tables, setTables] = useState<MysqlTableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<MysqlTableInfo | null>(
    null,
  );
  const [columns, setColumns] = useState<MysqlColumnDef[]>([]);
  const [indexes, setIndexes] = useState<MysqlIndexInfo[]>([]);
  const [foreignKeys, setForeignKeys] = useState<MysqlForeignKeyInfo[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const sessionInfoRef = useRef<MysqlSessionInfo | null>(null);
  const selectedDatabaseRef = useRef<string | null>(null);
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
      dispatch({ type: "UPDATE_SESSION", payload: sessionRef.current });
    },
    [dispatch],
  );

  const toErrorMessage = useCallback(
    (cause: unknown) => mysqlErrorMessage(cause, connectionRef.current),
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

  const dropBackendHandle = useCallback(
    (sessionId: string) => {
      if (backendRef.current === sessionId) backendRef.current = null;
      if (mountedRef.current) {
        setBackendSessionId(null);
        setSessionInfo(null);
        setServerInfo(null);
      }
      updateSession({ backendSessionId: undefined });
    },
    [updateSession],
  );

  const markOperationError = useCallback(
    (cause: unknown) => {
      const message = toErrorMessage(cause);
      if (isMissingMysqlSessionError(cause) && backendRef.current) {
        // The backend evicted the session (restart, timeout); make the UI
        // honest and let the reconnect action open a fresh one.
        dropBackendHandle(backendRef.current);
        markConnectionError(
          `${message} Reconnect to open a new MySQL session.`,
        );
        return message;
      }
      if (mountedRef.current) setError(message);
      return message;
    },
    [dropBackendHandle, markConnectionError, toErrorMessage],
  );

  const markConnected = useCallback(
    (info: MysqlSessionInfo, server: MysqlServerInfo | null) => {
      backendRef.current = info.id;
      sessionInfoRef.current = info;
      disconnectedIdsRef.current.delete(info.id);
      if (mountedRef.current) {
        setBackendSessionId(info.id);
        setSessionInfo(info);
        setServerInfo(server);
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
    if (!sessionId) throw new Error("MySQL is not connected.");
    return sessionId;
  }, []);

  const disconnectBackendOnce = useCallback(async (sessionId: string) => {
    if (disconnectedIdsRef.current.has(sessionId)) return;
    const pending = disconnectPromiseRef.current;
    if (pending?.sessionId === sessionId) return pending.promise;

    const promise = mysqlApi
      .disconnect(sessionId)
      .catch((cause) => {
        if (!isMissingMysqlSessionError(cause)) throw cause;
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
            `${reason} The existing MySQL backend session could not be closed safely: ${toErrorMessage(cause)}`,
          );
          return;
        }
        dropBackendHandle(existingId);
      }
      markConnectionError(reason);
    },
    [
      disconnectBackendOnce,
      dropBackendHandle,
      markConnectionError,
      toErrorMessage,
    ],
  );

  const loadServerInfo = useCallback(
    async (sessionId: string, info: MysqlSessionInfo) => {
      try {
        return await mysqlApi.serverInfo(sessionId);
      } catch (cause) {
        if (isMissingMysqlSessionError(cause)) throw cause;
        // Older backends without `mysql_server_info`: derive from the session.
        return {
          dialect: detectMysqlDialect(info.dialect, info.server_version),
          server_version: info.server_version ?? "",
          tls_enabled: info.tls_enabled,
        } satisfies MysqlServerInfo;
      }
    },
    [],
  );

  const loadTables = useCallback(
    async (database: string): Promise<MysqlTableInfo[]> => {
      const sessionId = requireSessionId();
      try {
        const nextTables = await runBusy(() =>
          mysqlApi.listTables(sessionId, database),
        );
        if (backendRef.current === sessionId && mountedRef.current) {
          selectedDatabaseRef.current = database;
          setSelectedDatabaseState(database);
          setTables(nextTables);
          setSelectedTable(null);
          setColumns([]);
          setIndexes([]);
          setForeignKeys([]);
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
      const nextDatabases = await runBusy(() =>
        mysqlApi.listDatabases(sessionId),
      );
      if (backendRef.current !== sessionId) return;
      if (mountedRef.current) setDatabases(nextDatabases);
      const database = firstDatabaseName(
        nextDatabases,
        selectedDatabaseRef.current ?? sessionInfoRef.current?.database,
      );
      if (database) await loadTables(database);
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
    async (table: MysqlTableInfo) => {
      const sessionId = requireSessionId();
      const database = selectedDatabaseRef.current;
      if (!database) throw new Error("Select a database first.");
      try {
        const [nextColumns, nextIndexes, nextForeignKeys] = await runBusy(() =>
          Promise.all([
            mysqlApi.describeTable(sessionId, database, table.name),
            mysqlApi.listIndexes(sessionId, database, table.name),
            mysqlApi.listForeignKeys(sessionId, database, table.name),
          ]),
        );
        if (backendRef.current === sessionId && mountedRef.current) {
          setSelectedTable(table);
          setColumns(nextColumns);
          setIndexes(nextIndexes);
          setForeignKeys(nextForeignKeys);
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
          "The saved or Quick Connect MySQL connection could not be found.",
        );
        return;
      }
      const routeError = getUnsupportedMysqlRouteReason(currentConnection);
      if (routeError) {
        await blockConnection(routeError);
        return;
      }

      if (mountedRef.current) {
        setStatus("connecting");
        setError(null);
      }

      let info: MysqlSessionInfo | null = null;
      const previousId = reattach ? backendRef.current : null;
      if (previousId) {
        let previousSessionIsMissing = false;
        try {
          info = await mysqlApi.getSession(previousId);
          if (!isConnectedSession(info) || !(await mysqlApi.ping(previousId))) {
            info = null;
          }
        } catch (cause) {
          if (!isMissingMysqlSessionError(cause)) {
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
          dropBackendHandle(previousId);
        }
      }

      if (generationRef.current !== generation || !mountedRef.current) return;

      let openedId: string | null = null;
      try {
        if (!info) {
          const config = buildMysqlConnectionConfig(
            currentConnection,
            sessionRef.current,
          );
          openedId = await mysqlApi.connect(config);
          info = await mysqlApi.getSession(openedId);
          if (!isConnectedSession(info)) {
            throw new Error(
              "The MySQL backend did not report a connected session.",
            );
          }
        }
        const server = await loadServerInfo(info.id, info);
        if (generationRef.current !== generation || !mountedRef.current) {
          if (openedId)
            await disconnectBackendOnce(openedId).catch(() => undefined);
          return;
        }
        markConnected(info, server);
        void refreshCatalog().catch(() => {
          // The catalog error stays visible while the query session is live.
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
      dropBackendHandle,
      loadServerInfo,
      markConnected,
      markConnectionError,
      refreshCatalog,
    ],
  );

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    generationRef.current += 1;
    if (!sessionId) {
      if (mountedRef.current) {
        setBackendSessionId(null);
        setSessionInfo(null);
        setServerInfo(null);
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
      setServerInfo(null);
      setDatabases([]);
      setTables([]);
      setColumns([]);
      setIndexes([]);
      setForeignKeys([]);
      setProcesses([]);
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
        throw new Error(markConnectionError(cause));
      }
      if (backendRef.current === previousId) backendRef.current = null;
      updateSession({ backendSessionId: undefined, status: "connecting" });
    }
    await connect(false);
  }, [connect, disconnectBackendOnce, markConnectionError, updateSession]);

  const executeSql = useCallback(
    async (executionMode: MysqlExecutionMode = mode) => {
      const sql = query.trim();
      if (!sql) throw new Error("Enter a SQL statement to execute.");
      const sessionId = requireSessionId();
      if (mountedRef.current) {
        setIsExecuting(true);
        setError(null);
      }
      try {
        const result = await (executionMode === "query"
          ? mysqlApi.executeQuery(sessionId, sql)
          : mysqlApi.executeStatement(sessionId, sql));
        if (backendRef.current === sessionId && mountedRef.current) {
          setResults(result);
          setVisibleRowLimit(MYSQL_RESULT_PAGE_SIZE);
          setResultTab("results");
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
    [markOperationError, mode, query, requireSessionId],
  );

  const explainQuery = useCallback(async () => {
    const sql = query.trim();
    if (!sql) throw new Error("Enter a SQL statement to explain.");
    const sessionId = requireSessionId();
    if (mountedRef.current) {
      setIsExecuting(true);
      setError(null);
    }
    try {
      const rows = await mysqlApi.explainQuery(sessionId, sql);
      if (backendRef.current === sessionId && mountedRef.current) {
        setExplainRows(rows);
        setResultTab("explain");
        setError(null);
      }
      return rows;
    } catch (cause) {
      if (mountedRef.current) setExplainRows(null);
      throw new Error(markOperationError(cause));
    } finally {
      if (mountedRef.current) setIsExecuting(false);
    }
  }, [markOperationError, query, requireSessionId]);

  const loadProcessList = useCallback(async () => {
    const sessionId = requireSessionId();
    try {
      const rows = await runBusy(() => mysqlApi.showProcesslist(sessionId));
      if (backendRef.current === sessionId && mountedRef.current) {
        setProcesses(rows);
        setResultTab("processes");
        setError(null);
      }
      return rows;
    } catch (cause) {
      throw new Error(markOperationError(cause));
    }
  }, [markOperationError, requireSessionId, runBusy]);

  const killProcess = useCallback(
    async (processId: number) => {
      const sessionId = requireSessionId();
      try {
        await runBusy(() => mysqlApi.killProcess(sessionId, processId));
      } catch (cause) {
        throw new Error(markOperationError(cause));
      }
      await loadProcessList();
    },
    [loadProcessList, markOperationError, requireSessionId, runBusy],
  );

  const showMoreRows = useCallback(() => {
    setVisibleRowLimit((limit) => limit + MYSQL_RESULT_PAGE_SIZE);
  }, []);

  const setQueryForTable = useCallback((table: MysqlTableInfo) => {
    const database = selectedDatabaseRef.current;
    const target = database
      ? `${quoteMysqlIdentifier(database)}.${quoteMysqlIdentifier(table.name)}`
      : quoteMysqlIdentifier(table.name);
    setQuery(`SELECT *\nFROM ${target}\nLIMIT 100;`);
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

  useEffect(() => {
    if (status !== "connected" || !backendSessionId) return;
    const timer = setInterval(() => {
      const sessionId = backendRef.current;
      if (!sessionId) return;
      void mysqlApi
        .ping(sessionId)
        .then((alive) => {
          if (!alive) throw new Error("No active MySQL connection");
        })
        .catch((cause) => {
          if (backendRef.current === sessionId) markOperationError(cause);
        });
    }, MYSQL_KEEPALIVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [backendSessionId, markOperationError, status]);

  const dialect: MysqlDialect = useMemo(() => {
    if (serverInfo) {
      return detectMysqlDialect(serverInfo.dialect, serverInfo.server_version);
    }
    if (sessionInfo) {
      return detectMysqlDialect(
        sessionInfo.dialect,
        sessionInfo.server_version,
      );
    }
    const hint = (connection as MysqlSavedConnectionOptions | undefined)
      ?.mysqlDialectHint;
    return hint === "mariadb" ? "mariadb" : "mysql";
  }, [connection, serverInfo, sessionInfo]);

  const serverVersion =
    serverInfo?.server_version || sessionInfo?.server_version || null;

  const visibleRows = useMemo(
    () => (results ? results.rows.slice(0, visibleRowLimit) : []),
    [results, visibleRowLimit],
  );

  return useMemo(
    () => ({
      status,
      error,
      backendSessionId,
      sessionInfo,
      serverInfo,
      dialect,
      serverVersion,
      query,
      setQuery,
      mode,
      setMode,
      results,
      visibleRows,
      hasMoreRows: Boolean(results && results.rows.length > visibleRows.length),
      showMoreRows,
      explainRows,
      processes,
      resultTab,
      setResultTab,
      databases,
      selectedDatabase,
      tables,
      selectedTable,
      columns,
      indexes,
      foreignKeys,
      isBusy,
      isExecuting,
      refreshCatalog,
      loadTables,
      describeTable,
      setQueryForTable,
      executeSql,
      explainQuery,
      loadProcessList,
      killProcess,
      reconnect,
      disconnect,
    }),
    [
      backendSessionId,
      columns,
      databases,
      describeTable,
      dialect,
      disconnect,
      error,
      executeSql,
      explainQuery,
      explainRows,
      foreignKeys,
      indexes,
      isBusy,
      isExecuting,
      killProcess,
      loadProcessList,
      loadTables,
      mode,
      processes,
      query,
      reconnect,
      refreshCatalog,
      resultTab,
      results,
      selectedDatabase,
      selectedTable,
      serverInfo,
      serverVersion,
      sessionInfo,
      setQueryForTable,
      showMoreRows,
      status,
      tables,
      visibleRows,
    ],
  );
}

export type MySQLClientModel = ReturnType<typeof useMySQLClient>;
