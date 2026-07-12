// useMssql — real Tauri `invoke(...)` wrappers for the sorng-mssql backend.
//
// Pairs 1:1 with src-tauri/crates/sorng-mssql/src/mssql/commands.rs (31 commands).
//
// Two arg conventions are in play (see src/types/mssql.ts header):
//   - Top-level command params (`sessionId`, `schema`, `whereClause`, ...) use
//     camelCase — Tauri maps them to the snake_case Rust params.
//   - Nested argument STRUCTS (`config`, `options`) are deserialized by serde
//     with NO rename, so their inner keys are snake_case. The `MssqlConnectionConfig`
//     / `ExportOptions` types already carry snake_case fields; pass them as-is.
//
// `mssql_connect` returns a session id string; every subsequent command takes that
// id as `sessionId`. The hook stores the active session id and threads it.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnDef,
  DatabaseInfo,
  ExportOptions,
  ForeignKeyInfo,
  IndexInfo,
  MssqlConnectionConfig,
  QueryResult,
  SchemaInfo,
  ServerProperty,
  SessionInfo,
  SpWhoResult,
  SqlLogin,
  StoredProcInfo,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from "../../types/mssql";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const mssqlApi = {
  // Connection / sessions
  connect: (config: MssqlConnectionConfig) =>
    invoke<string>("mssql_connect", { config }),
  disconnect: (sessionId: string) =>
    invoke<void>("mssql_disconnect", { sessionId }),
  disconnectAll: () => invoke<void>("mssql_disconnect_all"),
  listSessions: () => invoke<SessionInfo[]>("mssql_list_sessions"),
  getSession: (sessionId: string) =>
    invoke<SessionInfo>("mssql_get_session", { sessionId }),

  // Query execution
  executeQuery: (sessionId: string, sql: string) =>
    invoke<QueryResult>("mssql_execute_query", { sessionId, sql }),
  executeStatement: (sessionId: string, sql: string) =>
    invoke<QueryResult>("mssql_execute_statement", { sessionId, sql }),

  // Schema introspection
  listDatabases: (sessionId: string) =>
    invoke<DatabaseInfo[]>("mssql_list_databases", { sessionId }),
  listSchemas: (sessionId: string) =>
    invoke<SchemaInfo[]>("mssql_list_schemas", { sessionId }),
  listTables: (sessionId: string, schema: string) =>
    invoke<TableInfo[]>("mssql_list_tables", { sessionId, schema }),
  describeTable: (sessionId: string, schema: string, table: string) =>
    invoke<ColumnDef[]>("mssql_describe_table", { sessionId, schema, table }),
  listIndexes: (sessionId: string, schema: string, table: string) =>
    invoke<IndexInfo[]>("mssql_list_indexes", { sessionId, schema, table }),
  listForeignKeys: (sessionId: string, schema: string, table: string) =>
    invoke<ForeignKeyInfo[]>("mssql_list_foreign_keys", {
      sessionId,
      schema,
      table,
    }),
  listViews: (sessionId: string, schema: string) =>
    invoke<ViewInfo[]>("mssql_list_views", { sessionId, schema }),
  listStoredProcs: (sessionId: string, schema: string) =>
    invoke<StoredProcInfo[]>("mssql_list_stored_procs", { sessionId, schema }),
  listTriggers: (sessionId: string, schema: string) =>
    invoke<TriggerInfo[]>("mssql_list_triggers", { sessionId, schema }),

  // DDL
  createDatabase: (sessionId: string, name: string) =>
    invoke<void>("mssql_create_database", { sessionId, name }),
  dropDatabase: (sessionId: string, name: string) =>
    invoke<void>("mssql_drop_database", { sessionId, name }),
  dropTable: (sessionId: string, schema: string, table: string) =>
    invoke<void>("mssql_drop_table", { sessionId, schema, table }),
  truncateTable: (sessionId: string, schema: string, table: string) =>
    invoke<void>("mssql_truncate_table", { sessionId, schema, table }),

  // Data CRUD
  getTableData: (
    sessionId: string,
    schema: string,
    table: string,
    limit?: number,
    offset?: number,
  ) =>
    invoke<QueryResult>("mssql_get_table_data", {
      sessionId,
      schema,
      table,
      limit,
      offset,
    }),
  insertRow: (
    sessionId: string,
    schema: string,
    table: string,
    columns: string[],
    values: string[],
  ) =>
    invoke<number>("mssql_insert_row", {
      sessionId,
      schema,
      table,
      columns,
      values,
    }),
  updateRows: (
    sessionId: string,
    schema: string,
    table: string,
    columns: string[],
    values: string[],
    whereClause: string,
  ) =>
    invoke<number>("mssql_update_rows", {
      sessionId,
      schema,
      table,
      columns,
      values,
      whereClause,
    }),
  deleteRows: (
    sessionId: string,
    schema: string,
    table: string,
    whereClause: string,
  ) =>
    invoke<number>("mssql_delete_rows", {
      sessionId,
      schema,
      table,
      whereClause,
    }),

  // Export / import
  exportTable: (
    sessionId: string,
    schema: string,
    table: string,
    options: ExportOptions,
  ) =>
    invoke<string>("mssql_export_table", {
      sessionId,
      schema,
      table,
      options,
    }),
  importSql: (sessionId: string, sqlContent: string) =>
    invoke<number>("mssql_import_sql", { sessionId, sqlContent }),
  importCsv: (
    sessionId: string,
    schema: string,
    table: string,
    csvContent: string,
    hasHeader: boolean,
  ) =>
    invoke<number>("mssql_import_csv", {
      sessionId,
      schema,
      table,
      csvContent,
      hasHeader,
    }),

  // Administration
  serverProperties: (sessionId: string) =>
    invoke<ServerProperty[]>("mssql_server_properties", { sessionId }),
  showProcesses: (sessionId: string) =>
    invoke<SpWhoResult[]>("mssql_show_processes", { sessionId }),
  killProcess: (sessionId: string, spid: number) =>
    invoke<void>("mssql_kill_process", { sessionId, spid }),
  listLogins: (sessionId: string) =>
    invoke<SqlLogin[]>("mssql_list_logins", { sessionId }),
};

export type MssqlApi = typeof mssqlApi;

// ─── React hook ─────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful SQL Server session hook. The backend keeps a multi-session registry;
 * this hook binds ONE active session (the one this panel opened), stores its id,
 * and threads it to every command. `run` centralises `isLoading`/`error` so the
 * whole command surface shares one loading/error convention (matching useVmware).
 */
export function useMssql() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);

  const run = useCallback(
    async <T>(op: () => Promise<T>): Promise<T> => {
      inflight.current += 1;
      setIsLoading(true);
      setError(null);
      try {
        return await op();
      } catch (e) {
        setError(errMsg(e));
        throw e;
      } finally {
        inflight.current -= 1;
        if (inflight.current === 0) setIsLoading(false);
      }
    },
    [],
  );

  const refreshSession = useCallback(
    async (id: string) => {
      try {
        setSession(await mssqlApi.getSession(id));
      } catch {
        // Non-fatal — the session is live even if the info echo fails.
      }
    },
    [],
  );

  const connect = useCallback(
    async (config: MssqlConnectionConfig): Promise<string> => {
      const id = await run(() => mssqlApi.connect(config));
      setSessionId(id);
      await refreshSession(id);
      return id;
    },
    [run, refreshSession],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await run(() => mssqlApi.disconnect(sessionId));
    setSessionId(null);
    setSession(null);
  }, [run, sessionId]);

  /** Adopt an already-open backend session if one exists (e.g. on remount). */
  const refreshConnection = useCallback(async (): Promise<boolean> => {
    const sessions = await run(() => mssqlApi.listSessions());
    const live = sessions.find(
      (s) => s.status === "Connected" || typeof s.status === "object",
    );
    if (live) {
      setSessionId(live.id);
      setSession(live);
      return true;
    }
    return false;
  }, [run]);

  return {
    // state
    sessionId,
    session,
    isConnected: sessionId != null,
    isLoading,
    error,
    setError,
    // lifecycle
    connect,
    disconnect,
    refreshConnection,
    refreshSession,
    // full command surface (share `run` for consistent loading/error)
    api: mssqlApi,
    run,
  };
}

export type MssqlManager = ReturnType<typeof useMssql>;
