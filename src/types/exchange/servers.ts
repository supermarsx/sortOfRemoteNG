// Exchange "Servers, Databases & Migration" domain types (t42-exchange-c3).
//
// camelCase 1:1 mirror of the corresponding structs in
// `src-tauri/crates/sorng-exchange/src/types.rs`. Every struct there derives
// `#[serde(rename_all = "camelCase")]` (enums too), so these interfaces are a
// direct view of the wire shape — no invoke-layer remapping. `interface` for
// structs, string-literal unions for enums. Fields that are `Option<_>` with
// `skip_serializing_if` on the Rust side are optional here (may be absent).
//
// Shared connection/config/tab-props types live in the barrel
// `src/types/exchange`; import those from there, not from this file.

// ─── Servers ──────────────────────────────────────────────────────────────────

/** Mirror of `ServerRole`. */
export type ServerRole =
  | "mailbox"
  | "clientAccess"
  | "edgeTransport"
  | "unifiedMessaging"
  | "hubTransport";

/** Mirror of `ExchangeServer`. */
export interface ExchangeServer {
  name: string;
  fqdn: string;
  roles: ServerRole[];
  edition?: string | null;
  adminDisplayVersion?: string | null;
  isMemberOfDag: boolean;
  site?: string | null;
}

// ─── Databases ────────────────────────────────────────────────────────────────

/** Mirror of `DatabaseMountStatus`. */
export type DatabaseMountStatus =
  | "mounted"
  | "dismounted"
  | "mounting"
  | "dismounting";

/** Mirror of `MailboxDatabase`. */
export interface MailboxDatabase {
  name: string;
  server: string;
  mountStatus: DatabaseMountStatus;
  databaseSize?: string | null;
  availableSpace?: string | null;
  mailboxCount: number;
  recovery: boolean;
  edbFilePath?: string | null;
  logFolderPath?: string | null;
  /** ISO-8601 timestamp. */
  lastFullBackup?: string | null;
  circularLoggingEnabled: boolean;
}

// ─── Database Availability Groups (DAG) ───────────────────────────────────────

/** Mirror of `DagCopyStatus`. */
export type DagCopyStatus =
  | "healthy"
  | "mounted"
  | "suspended"
  | "failed"
  | "seeding"
  | "initializing"
  | "resynchronizing"
  | "disconnectedAndHealthy"
  | "failedAndSuspended"
  | "serviceDown";

/** Mirror of `DagReplicationStatus` — one database copy's replication health. */
export interface DagReplicationStatus {
  databaseName: string;
  server: string;
  status: DagCopyStatus;
  copyQueueLength: number;
  replayQueueLength: number;
  contentIndexState?: string | null;
  /** ISO-8601 timestamp. */
  lastInspectedLogTime?: string | null;
  /** ISO-8601 timestamp. */
  latestAvailableLogTime?: string | null;
}

/** Mirror of `DatabaseAvailabilityGroup`. */
export interface DatabaseAvailabilityGroup {
  name: string;
  servers: string[];
  witnessServer?: string | null;
  witnessDirectory?: string | null;
  operationalServers?: string[] | null;
}

// ─── Service health ───────────────────────────────────────────────────────────

/** Mirror of `FeatureStatus` — one feature within a service-health entry. */
export interface FeatureStatus {
  featureName: string;
  featureServiceStatus: string;
  featureServiceStatusDisplayName?: string | null;
}

/** Mirror of `ServiceHealthStatus` — Exchange Online service health
 *  (M365 Service Communications API). */
export interface ServiceHealthStatus {
  service: string;
  status: string;
  statusDisplayName?: string | null;
  featureStatus: FeatureStatus[];
}

/** Mirror of `ServerComponentState` — a maintenance/component state entry. */
export interface ServerComponentState {
  server: string;
  component: string;
  state: string;
  requester?: string | null;
}

// ─── Migration batches & move requests ────────────────────────────────────────

/** Mirror of `MigrationBatchStatus`. */
export type MigrationBatchStatus =
  | "created"
  | "syncing"
  | "synced"
  | "completing"
  | "completed"
  | "completedWithErrors"
  | "failed"
  | "stopped"
  | "removing"
  | "corrupted";

/** Mirror of `MigrationType`. */
export type MigrationType =
  | "localMove"
  | "crossForestMove"
  | "remoteMove"
  | "imap"
  | "cutoverExchange"
  | "stagedExchange"
  | "publicFolderToUnifiedGroup"
  | "googleWorkspace";

/** Mirror of `MigrationBatch`. */
export interface MigrationBatch {
  id: string;
  identity: string;
  status: MigrationBatchStatus;
  migrationType: MigrationType;
  totalCount: number;
  syncedCount: number;
  failedCount: number;
  finalizedCount: number;
  /** ISO-8601 timestamp. */
  createdDate?: string | null;
  /** ISO-8601 timestamp. */
  startDate?: string | null;
  /** ISO-8601 timestamp. */
  finalizedDate?: string | null;
  report?: string | null;
}

/** Mirror of `MoveRequest` — also the return of `get_move_request_statistics`. */
export interface MoveRequest {
  identity: string;
  displayName: string;
  status: string;
  percentComplete: number;
  targetDatabase?: string | null;
  sourceDatabase?: string | null;
  batchName?: string | null;
  totalMailboxSize?: string | null;
}

/** Mirror of `MigrationUser`. */
export interface MigrationUser {
  identity: string;
  batchId: string;
  status: string;
  errorSummary?: string | null;
  itemsSynced: number;
  itemsSkipped: number;
}

// ─── Mailbox import / export requests ─────────────────────────────────────────

/** Mirror of `ImportExportDirection`. */
export type ImportExportDirection = "import" | "export";

/** Mirror of `MailboxImportExportRequest`. */
export interface MailboxImportExportRequest {
  name: string;
  mailbox: string;
  direction: ImportExportDirection;
  filePath: string;
  status: string;
  percentComplete: number;
  includeFolders?: string[] | null;
  excludeFolders?: string[] | null;
  targetRootFolder?: string | null;
}
