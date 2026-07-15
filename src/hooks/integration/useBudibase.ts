// useBudibase — real Tauri `invoke(...)` wrappers for the sorng-budibase backend.
//
// Binds all 58 Budibase commands registered in the Tauri handler
// (`sorng-commands-ops` / `sorng-commands-services` services_handler.rs). Every
// command after connect is keyed by a connection `id` (the backend holds a map
// of live clients). Argument keys are camelCase — Tauri v2 maps them to the
// snake_case Rust `#[tauri::command]` params (e.g. `appId` → `app_id`). The
// `config` object mirrors `BudibaseConnectionConfig`'s serde wire shape.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import type {
  AppPublishResponse,
  AutomationLogSearchRequest,
  AutomationLogSearchResponse,
  BudibaseApp,
  BudibaseAutomation,
  BudibaseConnectionConfig,
  BudibaseConnectionStatus,
  BudibaseDatasource,
  BudibaseQuery,
  BudibaseRow,
  BudibaseTable,
  BudibaseUser,
  BudibaseView,
  BulkRowDeleteRequest,
  BulkRowResponse,
  CreateAppRequest,
  CreateAutomationRequest,
  CreateDatasourceRequest,
  CreateTableRequest,
  CreateUserRequest,
  CreateViewRequest,
  DatasourceTestResponse,
  ExecuteQueryRequest,
  QueryExecutionResponse,
  RowSearchRequest,
  RowSearchResponse,
  TableFieldSchema,
  TriggerAutomationRequest,
  TriggerAutomationResponse,
  UpdateAppRequest,
  UpdateDatasourceRequest,
  UpdateTableRequest,
  UpdateUserRequest,
  UserSearchResponse,
  ViewQueryResponse,
} from "../../types/budibase";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const budibaseApi = {
  // ── Connection ──────────────────────────────────────────────────
  connect: (id: string, config: BudibaseConnectionConfig) =>
    invoke<BudibaseConnectionStatus>("budibase_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("budibase_disconnect", { id }),
  listConnections: () => invoke<string[]>("budibase_list_connections"),
  ping: (id: string) =>
    invoke<BudibaseConnectionStatus>("budibase_ping", { id }),
  setAppContext: (id: string, appId?: string) =>
    invoke<void>("budibase_set_app_context", { id, appId }),

  // ── Apps ────────────────────────────────────────────────────────
  listApps: (id: string) => invoke<BudibaseApp[]>("budibase_list_apps", { id }),
  searchApps: (id: string, name?: string) =>
    invoke<BudibaseApp[]>("budibase_search_apps", { id, name }),
  getApp: (id: string, appId: string) =>
    invoke<BudibaseApp>("budibase_get_app", { id, appId }),
  createApp: (id: string, request: CreateAppRequest) =>
    invoke<BudibaseApp>("budibase_create_app", { id, request }),
  updateApp: (id: string, appId: string, request: UpdateAppRequest) =>
    invoke<BudibaseApp>("budibase_update_app", { id, appId, request }),
  deleteApp: (id: string, appId: string) =>
    invoke<void>("budibase_delete_app", { id, appId }),
  publishApp: (id: string, appId: string) =>
    invoke<AppPublishResponse>("budibase_publish_app", { id, appId }),
  unpublishApp: (id: string, appId: string) =>
    invoke<void>("budibase_unpublish_app", { id, appId }),

  // ── Tables ──────────────────────────────────────────────────────
  listTables: (id: string) =>
    invoke<BudibaseTable[]>("budibase_list_tables", { id }),
  getTable: (id: string, tableId: string) =>
    invoke<BudibaseTable>("budibase_get_table", { id, tableId }),
  createTable: (id: string, request: CreateTableRequest) =>
    invoke<BudibaseTable>("budibase_create_table", { id, request }),
  updateTable: (id: string, tableId: string, request: UpdateTableRequest) =>
    invoke<BudibaseTable>("budibase_update_table", { id, tableId, request }),
  deleteTable: (id: string, tableId: string, rev?: string) =>
    invoke<void>("budibase_delete_table", { id, tableId, rev }),
  getTableSchema: (id: string, tableId: string) =>
    invoke<Record<string, TableFieldSchema>>("budibase_get_table_schema", {
      id,
      tableId,
    }),

  // ── Rows ────────────────────────────────────────────────────────
  listRows: (id: string, tableId: string) =>
    invoke<BudibaseRow[]>("budibase_list_rows", { id, tableId }),
  searchRows: (id: string, tableId: string, request: RowSearchRequest) =>
    invoke<RowSearchResponse>("budibase_search_rows", { id, tableId, request }),
  getRow: (id: string, tableId: string, rowId: string) =>
    invoke<BudibaseRow>("budibase_get_row", { id, tableId, rowId }),
  createRow: (id: string, tableId: string, row: BudibaseRow) =>
    invoke<BudibaseRow>("budibase_create_row", { id, tableId, row }),
  updateRow: (id: string, tableId: string, rowId: string, row: BudibaseRow) =>
    invoke<BudibaseRow>("budibase_update_row", { id, tableId, rowId, row }),
  deleteRow: (id: string, tableId: string, rowId: string) =>
    invoke<void>("budibase_delete_row", { id, tableId, rowId }),
  bulkCreateRows: (id: string, tableId: string, rows: BudibaseRow[]) =>
    invoke<BulkRowResponse>("budibase_bulk_create_rows", { id, tableId, rows }),
  bulkDeleteRows: (
    id: string,
    tableId: string,
    request: BulkRowDeleteRequest,
  ) =>
    invoke<BulkRowResponse>("budibase_bulk_delete_rows", {
      id,
      tableId,
      request,
    }),

  // ── Views ───────────────────────────────────────────────────────
  listViews: (id: string, tableId: string) =>
    invoke<BudibaseView[]>("budibase_list_views", { id, tableId }),
  getView: (id: string, viewId: string) =>
    invoke<BudibaseView>("budibase_get_view", { id, viewId }),
  createView: (id: string, request: CreateViewRequest) =>
    invoke<BudibaseView>("budibase_create_view", { id, request }),
  updateView: (id: string, viewId: string, request: CreateViewRequest) =>
    invoke<BudibaseView>("budibase_update_view", { id, viewId, request }),
  deleteView: (id: string, viewId: string) =>
    invoke<void>("budibase_delete_view", { id, viewId }),
  queryView: (id: string, viewId: string) =>
    invoke<ViewQueryResponse>("budibase_query_view", { id, viewId }),

  // ── Users ───────────────────────────────────────────────────────
  listUsers: (id: string) =>
    invoke<BudibaseUser[]>("budibase_list_users", { id }),
  searchUsers: (id: string, email?: string, bookmark?: string) =>
    invoke<UserSearchResponse>("budibase_search_users", {
      id,
      email,
      bookmark,
    }),
  getUser: (id: string, userId: string) =>
    invoke<BudibaseUser>("budibase_get_user", { id, userId }),
  createUser: (id: string, request: CreateUserRequest) =>
    invoke<BudibaseUser>("budibase_create_user", { id, request }),
  updateUser: (id: string, userId: string, request: UpdateUserRequest) =>
    invoke<BudibaseUser>("budibase_update_user", { id, userId, request }),
  deleteUser: (id: string, userId: string) =>
    invoke<void>("budibase_delete_user", { id, userId }),

  // ── Queries ─────────────────────────────────────────────────────
  listQueries: (id: string) =>
    invoke<BudibaseQuery[]>("budibase_list_queries", { id }),
  getQuery: (id: string, queryId: string) =>
    invoke<BudibaseQuery>("budibase_get_query", { id, queryId }),
  executeQuery: (id: string, queryId: string, request: ExecuteQueryRequest) =>
    invoke<QueryExecutionResponse>("budibase_execute_query", {
      id,
      queryId,
      request,
    }),
  createQuery: (id: string, query: BudibaseQuery) =>
    invoke<BudibaseQuery>("budibase_create_query", { id, query }),
  updateQuery: (id: string, queryId: string, query: BudibaseQuery) =>
    invoke<BudibaseQuery>("budibase_update_query", { id, queryId, query }),
  deleteQuery: (id: string, queryId: string) =>
    invoke<void>("budibase_delete_query", { id, queryId }),

  // ── Automations ─────────────────────────────────────────────────
  listAutomations: (id: string) =>
    invoke<BudibaseAutomation[]>("budibase_list_automations", { id }),
  getAutomation: (id: string, automationId: string) =>
    invoke<BudibaseAutomation>("budibase_get_automation", { id, automationId }),
  createAutomation: (id: string, request: CreateAutomationRequest) =>
    invoke<BudibaseAutomation>("budibase_create_automation", { id, request }),
  updateAutomation: (
    id: string,
    automationId: string,
    request: BudibaseAutomation,
  ) =>
    invoke<BudibaseAutomation>("budibase_update_automation", {
      id,
      automationId,
      request,
    }),
  deleteAutomation: (id: string, automationId: string) =>
    invoke<void>("budibase_delete_automation", { id, automationId }),
  triggerAutomation: (
    id: string,
    automationId: string,
    request: TriggerAutomationRequest,
  ) =>
    invoke<TriggerAutomationResponse>("budibase_trigger_automation", {
      id,
      automationId,
      request,
    }),
  getAutomationLogs: (id: string, request: AutomationLogSearchRequest) =>
    invoke<AutomationLogSearchResponse>("budibase_get_automation_logs", {
      id,
      request,
    }),

  // ── Datasources ─────────────────────────────────────────────────
  listDatasources: (id: string) =>
    invoke<BudibaseDatasource[]>("budibase_list_datasources", { id }),
  getDatasource: (id: string, datasourceId: string) =>
    invoke<BudibaseDatasource>("budibase_get_datasource", { id, datasourceId }),
  createDatasource: (id: string, request: CreateDatasourceRequest) =>
    invoke<BudibaseDatasource>("budibase_create_datasource", { id, request }),
  updateDatasource: (
    id: string,
    datasourceId: string,
    request: UpdateDatasourceRequest,
  ) =>
    invoke<BudibaseDatasource>("budibase_update_datasource", {
      id,
      datasourceId,
      request,
    }),
  deleteDatasource: (id: string, datasourceId: string, rev?: string) =>
    invoke<void>("budibase_delete_datasource", { id, datasourceId, rev }),
  testDatasource: (id: string, datasourceId: string) =>
    invoke<DatasourceTestResponse>("budibase_test_datasource", {
      id,
      datasourceId,
    }),
};

export type BudibaseApi = typeof budibaseApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Budibase session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api` (each call takes the connection id). The
 * `run` wrapper funnels arbitrary ops through the same loading/error handling.
 */
export function useBudibase() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<BudibaseConnectionStatus | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
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
  }, []);

  const connect = useCallback(
    async (id: string, config: BudibaseConnectionConfig): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await budibaseApi.connect(
          id,
          withGlobalHttpProxy(config, "camel"),
        );
        setConnectionId(id);
        setStatus(s);
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      await budibaseApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setStatus(null);
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    connectionId,
    status,
    isConnected: connectionId !== null,
    isConnecting,
    isLoading,
    error,
    setError,
    clearError,
    // lifecycle
    connect,
    disconnect,
    // full registered command surface + shared runner
    api: budibaseApi,
    run,
  };
}

export type BudibaseManager = ReturnType<typeof useBudibase>;
