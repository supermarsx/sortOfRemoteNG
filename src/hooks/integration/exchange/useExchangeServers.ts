// useExchangeServers — "Servers, Databases & Migration" slice for the Exchange
// integration (t42-exchange-c3).
//
// Pairs 1:1 with the 32 commands in this category from
// `src-tauri/crates/sorng-exchange/src/commands.rs`:
//   Servers / databases / DAG / health: 15
//   Migration batches & move requests:  11
//   Mailbox import / export requests:    6
// Argument names are camelCase 1:1 with the Rust `#[tauri::command]` params
// (Tauri maps them to the snake_case fn params, e.g. `targetDatabase` ->
// `target_database`).
//
// ⚠️ Exchange is a SINGLETON service: NO command takes a connection id — each
// operates on the one active connection. This slice is mounted only when the
// shell is connected, so every call runs against the live connection.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  DagReplicationStatus,
  DatabaseAvailabilityGroup,
  ExchangeServer,
  MailboxDatabase,
  MailboxImportExportRequest,
  MigrationBatch,
  MigrationUser,
  MoveRequest,
  ServerComponentState,
  ServiceHealthStatus,
} from "../../../types/exchange/servers";

// ─── Low-level invoke wrappers (all 32 commands, grouped) ─────────────────────

export const exchangeServersApi = {
  // Servers / databases / DAG / health (15) ────────────────────────────────────
  /** `exchange_list_servers()`. */
  listServers: () => invoke<ExchangeServer[]>("exchange_list_servers"),
  /** `exchange_get_server(identity)`. */
  getServer: (identity: string) =>
    invoke<ExchangeServer>("exchange_get_server", { identity }),
  /** `exchange_list_databases(server?)`. */
  listDatabases: (server?: string) =>
    invoke<MailboxDatabase[]>("exchange_list_databases", { server }),
  /** `exchange_get_database(identity)`. */
  getDatabase: (identity: string) =>
    invoke<MailboxDatabase>("exchange_get_database", { identity }),
  /** `exchange_mount_database(identity)`. */
  mountDatabase: (identity: string) =>
    invoke<string>("exchange_mount_database", { identity }),
  /** `exchange_dismount_database(identity)`. */
  dismountDatabase: (identity: string) =>
    invoke<string>("exchange_dismount_database", { identity }),
  /** `exchange_list_dags()`. */
  listDags: () =>
    invoke<DatabaseAvailabilityGroup[]>("exchange_list_dags"),
  /** `exchange_get_dag(identity)`. */
  getDag: (identity: string) =>
    invoke<DatabaseAvailabilityGroup>("exchange_get_dag", { identity }),
  /** `exchange_get_dag_copy_status(server?, database?)`. */
  getDagCopyStatus: (server?: string, database?: string) =>
    invoke<DagReplicationStatus[]>("exchange_get_dag_copy_status", {
      server,
      database,
    }),
  /** `exchange_test_replication_health(server)`. */
  testReplicationHealth: (server: string) =>
    invoke<unknown[]>("exchange_test_replication_health", { server }),
  /** `exchange_service_health()`. */
  serviceHealth: () =>
    invoke<ServiceHealthStatus[]>("exchange_service_health"),
  /** `exchange_service_issues()`. */
  serviceIssues: () => invoke<unknown[]>("exchange_service_issues"),
  /** `exchange_test_mailflow(target?)`. */
  testMailflow: (target?: string) =>
    invoke<unknown>("exchange_test_mailflow", { target }),
  /** `exchange_test_service_health(server)`. */
  testServiceHealth: (server: string) =>
    invoke<unknown[]>("exchange_test_service_health", { server }),
  /** `exchange_get_server_component_state(server)`. */
  getServerComponentState: (server: string) =>
    invoke<ServerComponentState[]>("exchange_get_server_component_state", {
      server,
    }),

  // Migration batches & move requests (11) ──────────────────────────────────────
  /** `exchange_list_migration_batches()`. */
  listMigrationBatches: () =>
    invoke<MigrationBatch[]>("exchange_list_migration_batches"),
  /** `exchange_get_migration_batch(identity)`. */
  getMigrationBatch: (identity: string) =>
    invoke<MigrationBatch>("exchange_get_migration_batch", { identity }),
  /** `exchange_start_migration_batch(identity)`. */
  startMigrationBatch: (identity: string) =>
    invoke<string>("exchange_start_migration_batch", { identity }),
  /** `exchange_stop_migration_batch(identity)`. */
  stopMigrationBatch: (identity: string) =>
    invoke<string>("exchange_stop_migration_batch", { identity }),
  /** `exchange_complete_migration_batch(identity)`. */
  completeMigrationBatch: (identity: string) =>
    invoke<string>("exchange_complete_migration_batch", { identity }),
  /** `exchange_remove_migration_batch(identity)`. */
  removeMigrationBatch: (identity: string) =>
    invoke<string>("exchange_remove_migration_batch", { identity }),
  /** `exchange_list_migration_users(batchId?)`. */
  listMigrationUsers: (batchId?: string) =>
    invoke<MigrationUser[]>("exchange_list_migration_users", { batchId }),
  /** `exchange_list_move_requests()`. */
  listMoveRequests: () =>
    invoke<MoveRequest[]>("exchange_list_move_requests"),
  /** `exchange_get_move_request_statistics(identity)`. */
  getMoveRequestStatistics: (identity: string) =>
    invoke<MoveRequest>("exchange_get_move_request_statistics", { identity }),
  /** `exchange_new_move_request(identity, targetDatabase, batchName?)`. */
  newMoveRequest: (
    identity: string,
    targetDatabase: string,
    batchName?: string,
  ) =>
    invoke<string>("exchange_new_move_request", {
      identity,
      targetDatabase,
      batchName,
    }),
  /** `exchange_remove_move_request(identity)`. */
  removeMoveRequest: (identity: string) =>
    invoke<string>("exchange_remove_move_request", { identity }),

  // Mailbox import / export requests (6) ────────────────────────────────────────
  /** `exchange_new_mailbox_import_request(mailbox, filePath, targetRootFolder?)`. */
  newMailboxImportRequest: (
    mailbox: string,
    filePath: string,
    targetRootFolder?: string,
  ) =>
    invoke<string>("exchange_new_mailbox_import_request", {
      mailbox,
      filePath,
      targetRootFolder,
    }),
  /** `exchange_new_mailbox_export_request(mailbox, filePath, includeFolders?, excludeFolders?)`. */
  newMailboxExportRequest: (
    mailbox: string,
    filePath: string,
    includeFolders?: string[],
    excludeFolders?: string[],
  ) =>
    invoke<string>("exchange_new_mailbox_export_request", {
      mailbox,
      filePath,
      includeFolders,
      excludeFolders,
    }),
  /** `exchange_list_mailbox_import_requests(mailbox?)`. */
  listMailboxImportRequests: (mailbox?: string) =>
    invoke<MailboxImportExportRequest[]>(
      "exchange_list_mailbox_import_requests",
      { mailbox },
    ),
  /** `exchange_list_mailbox_export_requests(mailbox?)`. */
  listMailboxExportRequests: (mailbox?: string) =>
    invoke<MailboxImportExportRequest[]>(
      "exchange_list_mailbox_export_requests",
      { mailbox },
    ),
  /** `exchange_remove_mailbox_import_request(identity)`. */
  removeMailboxImportRequest: (identity: string) =>
    invoke<string>("exchange_remove_mailbox_import_request", { identity }),
  /** `exchange_remove_mailbox_export_request(identity)`. */
  removeMailboxExportRequest: (identity: string) =>
    invoke<string>("exchange_remove_mailbox_export_request", { identity }),
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** The list-backed sub-views the tab can display. */
export type ExchangeServersView =
  | "servers"
  | "databases"
  | "dags"
  | "replication"
  | "serviceHealth"
  | "migrationBatches"
  | "moveRequests"
  | "importRequests"
  | "exportRequests";

export interface UseExchangeServers {
  servers: ExchangeServer[];
  databases: MailboxDatabase[];
  dags: DatabaseAvailabilityGroup[];
  replication: DagReplicationStatus[];
  serviceHealth: ServiceHealthStatus[];
  migrationBatches: MigrationBatch[];
  moveRequests: MoveRequest[];
  importRequests: MailboxImportExportRequest[];
  exportRequests: MailboxImportExportRequest[];
  loading: boolean;
  error: string | null;
  /** (Re)load the list backing a single view. */
  load: (view: ExchangeServersView) => Promise<void>;
  clearError: () => void;
  /** Report a caught error into the shared error slot (used by action buttons). */
  reportError: (e: unknown) => void;
  api: typeof exchangeServersApi;
}

const toMessage = (e: unknown): string =>
  typeof e === "string" ? e : ((e as Error)?.message ?? String(e));

/**
 * Read/refresh state for the Servers, Databases & Migration tab. Each
 * `load(view)` fetches the list for that view via `exchangeServersApi`; mutating
 * / action commands (mount, dismount, start/stop/complete/remove batch, new/remove
 * move request, new/remove import-export request, the test-* diagnostics, ...) are
 * available directly on the returned `api` so the tab can call them and then
 * `load` the affected view.
 */
export function useExchangeServers(): UseExchangeServers {
  const [servers, setServers] = useState<ExchangeServer[]>([]);
  const [databases, setDatabases] = useState<MailboxDatabase[]>([]);
  const [dags, setDags] = useState<DatabaseAvailabilityGroup[]>([]);
  const [replication, setReplication] = useState<DagReplicationStatus[]>([]);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealthStatus[]>([]);
  const [migrationBatches, setMigrationBatches] = useState<MigrationBatch[]>([]);
  const [moveRequests, setMoveRequests] = useState<MoveRequest[]>([]);
  const [importRequests, setImportRequests] = useState<
    MailboxImportExportRequest[]
  >([]);
  const [exportRequests, setExportRequests] = useState<
    MailboxImportExportRequest[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (view: ExchangeServersView): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        switch (view) {
          case "servers":
            setServers(await exchangeServersApi.listServers());
            break;
          case "databases":
            setDatabases(await exchangeServersApi.listDatabases());
            break;
          case "dags":
            setDags(await exchangeServersApi.listDags());
            break;
          case "replication":
            setReplication(await exchangeServersApi.getDagCopyStatus());
            break;
          case "serviceHealth":
            setServiceHealth(await exchangeServersApi.serviceHealth());
            break;
          case "migrationBatches":
            setMigrationBatches(
              await exchangeServersApi.listMigrationBatches(),
            );
            break;
          case "moveRequests":
            setMoveRequests(await exchangeServersApi.listMoveRequests());
            break;
          case "importRequests":
            setImportRequests(
              await exchangeServersApi.listMailboxImportRequests(),
            );
            break;
          case "exportRequests":
            setExportRequests(
              await exchangeServersApi.listMailboxExportRequests(),
            );
            break;
        }
      } catch (e) {
        setError(toMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);
  const reportError = useCallback((e: unknown) => setError(toMessage(e)), []);

  return {
    servers,
    databases,
    dags,
    replication,
    serviceHealth,
    migrationBatches,
    moveRequests,
    importRequests,
    exportRequests,
    loading,
    error,
    load,
    clearError,
    reportError,
    api: exchangeServersApi,
  };
}
