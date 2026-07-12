// LXD / Incus integration — `instances` category types (t42-lxd-c1).
//
// Compute-lifecycle slice: instances (containers + VMs), their live state,
// snapshots, backups, exec/console, logs, files, and migration/copy/publish.
// 1:1 mirror of the instance structs in
//   src-tauri/crates/sorng-lxd/src/types.rs
//
// CASING — each interface matches the EXACT serde wire format of its Rust struct,
// NOT a blanket camelCase. Tauri v2 only maps *top-level command argument* keys
// (camelCase↔snake_case); it does NOT transform serialized struct fields, so the
// struct's own `#[serde(rename_all = …)]` is the source of truth on the wire:
//   • RESPONSE structs (`rename_all = "snake_case"`, or no attr → Rust names) →
//     snake_case fields here (e.g. `status_code`, `created_at`).
//   • REQUEST structs (`rename_all = "camelCase"`) → camelCase fields.
//   • per-field `#[serde(rename = "type")]` → `type` regardless of the above.
// (The sibling pfsense slice follows the same rule for its snake_case structs.)
//
// Shared types (`LxdOperation`, `LxdError`, `LxdConnectionConfig`) live in the
// barrel `../lxd` and are imported by the hook — never redefined here.

// ─── Enums ─────────────────────────────────────────────────────────────────────

/** Mirror of `InstanceType` (serde `lowercase`). */
export type InstanceType = "container" | "virtual-machine";

/** Mirror of `InstanceStatus` (serde `lowercase`, `#[serde(other)]` → unknown). */
export type InstanceStatus =
  | "running"
  | "stopped"
  | "frozen"
  | "error"
  | "unknown";

// ─── Instance (response — snake_case) ──────────────────────────────────────────

/** Mirror of `Instance`. `type` is the Rust `instance_type` (`rename = "type"`). */
export interface Instance {
  name: string;
  description?: string | null;
  status?: string | null;
  status_code?: number | null;
  /** Rust `instance_type` — `"container"` | `"virtual-machine"`. */
  type?: string | null;
  architecture?: string | null;
  config?: Record<string, string> | null;
  devices?: Record<string, Record<string, string>> | null;
  ephemeral?: boolean | null;
  stateful?: boolean | null;
  profiles?: string[] | null;
  created_at?: string | null;
  last_used_at?: string | null;
  location?: string | null;
  project?: string | null;
  expanded_config?: Record<string, string> | null;
  expanded_devices?: Record<string, Record<string, string>> | null;
  backups?: string[] | null;
  snapshots?: string[] | null;
}

// ─── Live runtime state (response — snake_case) ────────────────────────────────

/** Mirror of `InstanceCpu`. */
export interface InstanceCpu {
  usage?: number | null;
}

/** Mirror of `InstanceDisk`. */
export interface InstanceDisk {
  usage?: number | null;
  total?: number | null;
}

/** Mirror of `InstanceMemory`. */
export interface InstanceMemory {
  usage?: number | null;
  usage_peak?: number | null;
  total?: number | null;
  swap_usage?: number | null;
  swap_usage_peak?: number | null;
}

/** Mirror of `InstanceAddress`. */
export interface InstanceAddress {
  family?: string | null;
  address?: string | null;
  netmask?: string | null;
  scope?: string | null;
}

/** Mirror of `InstanceNetCounters`. */
export interface InstanceNetCounters {
  bytes_received?: number | null;
  bytes_sent?: number | null;
  packets_received?: number | null;
  packets_sent?: number | null;
  errors_received?: number | null;
  errors_sent?: number | null;
}

/** Mirror of `InstanceNetwork`. `type` is the Rust `net_type` (`rename = "type"`). */
export interface InstanceNetwork {
  addresses?: InstanceAddress[] | null;
  counters?: InstanceNetCounters | null;
  hwaddr?: string | null;
  host_name?: string | null;
  mtu?: number | null;
  state?: string | null;
  type?: string | null;
}

/** Mirror of `InstanceState` — returned by `lxd_get_instance_state`. */
export interface InstanceState {
  status?: string | null;
  status_code?: number | null;
  cpu?: InstanceCpu | null;
  disk?: Record<string, InstanceDisk> | null;
  memory?: InstanceMemory | null;
  network?: Record<string, InstanceNetwork> | null;
  pid?: number | null;
  processes?: number | null;
}

// ─── Create / update requests (camelCase) ──────────────────────────────────────

/** Mirror of `InstanceSource` (request sub-struct — snake_case). `type` is the
 *  Rust `source_type` (`rename = "type"`). */
export interface InstanceSource {
  /** Rust `source_type` — `"image"` | `"copy"` | `"migration"` | `"none"`. */
  type: string;
  alias?: string;
  fingerprint?: string;
  server?: string;
  protocol?: string;
  mode?: string;
  operation?: string;
  certificate?: string;
  source?: string;
  base_image?: string;
}

/** Mirror of `CreateInstanceRequest` — passed as `req` to `lxd_create_instance`. */
export interface CreateInstanceRequest {
  name: string;
  description?: string;
  instanceType?: string;
  source: InstanceSource;
  profiles?: string[];
  config?: Record<string, string>;
  devices?: Record<string, Record<string, string>>;
  ephemeral?: boolean;
  /** Start the instance immediately after creation. */
  start?: boolean;
}

/** Mirror of `UpdateInstanceRequest` — passed as `req` to `lxd_update_instance`. */
export interface UpdateInstanceRequest {
  name: string;
  description?: string;
  config?: Record<string, string>;
  devices?: Record<string, Record<string, string>>;
  profiles?: string[];
  ephemeral?: boolean;
}

// ─── Exec / console (request — snake_case) ─────────────────────────────────────

/** Mirror of `InstanceExecRequest` — passed as `req` to `lxd_exec_instance`. */
export interface InstanceExecRequest {
  command: string[];
  wait_for_websocket?: boolean;
  interactive?: boolean;
  width?: number;
  height?: number;
  environment?: Record<string, string> | null;
  user?: number;
  group?: number;
  cwd?: string;
  record_output?: boolean;
}

/** Mirror of `InstanceExecResult` (response — camelCase). */
export interface InstanceExecResult {
  returnCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

/** Mirror of `InstanceConsoleRequest` — passed as `req` to `lxd_console_instance`.
 *  `type` is the Rust `console_type` (`rename = "type"`). */
export interface InstanceConsoleRequest {
  type?: string;
  width?: number;
  height?: number;
}

// ─── Snapshots ─────────────────────────────────────────────────────────────────

/** Mirror of `InstanceSnapshot` (response — snake_case). */
export interface InstanceSnapshot {
  name: string;
  created_at?: string | null;
  expires_at?: string | null;
  stateful?: boolean | null;
  config?: Record<string, string> | null;
  devices?: Record<string, Record<string, string>> | null;
  size?: number | null;
}

/** Mirror of `CreateSnapshotRequest` — passed as `req` to `lxd_create_snapshot`. */
export interface CreateSnapshotRequest {
  instance: string;
  name: string;
  stateful?: boolean;
  expiresAt?: string;
}

/** Mirror of `RestoreSnapshotRequest` — passed as `req` to `lxd_restore_snapshot`. */
export interface RestoreSnapshotRequest {
  instance: string;
  snapshot: string;
  stateful?: boolean;
}

// ─── Backups ───────────────────────────────────────────────────────────────────

/** Mirror of `InstanceBackup` (response — snake_case). */
export interface InstanceBackup {
  name: string;
  created_at?: string | null;
  expires_at?: string | null;
  instance_only?: boolean | null;
  optimized_storage?: boolean | null;
  compression_algorithm?: string | null;
}

/** Mirror of `CreateBackupRequest` — passed as `req` to `lxd_create_backup`. */
export interface CreateBackupRequest {
  instance: string;
  name: string;
  instanceOnly?: boolean;
  optimizedStorage?: boolean;
  compressionAlgorithm?: string;
  expiresAt?: string;
}

// ─── Migration ─────────────────────────────────────────────────────────────────

/** Mirror of `MigrateInstanceRequest` — passed as `req` to `lxd_migrate_instance`. */
export interface MigrateInstanceRequest {
  name: string;
  targetServer: string;
  targetProject?: string;
  targetPool?: string;
  live?: boolean;
  targetName?: string;
  /** For remote migrations, TLS client cert (PEM) of the target. */
  certificate?: string;
}

// ─── Logs & files ──────────────────────────────────────────────────────────────

/** Mirror of `InstanceLogFile` (response — camelCase). */
export interface InstanceLogFile {
  name: string;
  size?: number | null;
}

/** Mirror of `FileTransferRequest` (request — camelCase). `type` is the Rust
 *  `file_type` (`rename = "type"`) — `"file"` | `"directory"` | `"symlink"`. */
export interface FileTransferRequest {
  instance: string;
  path: string;
  content?: string;
  uid?: number;
  gid?: number;
  mode?: string;
  type?: string;
}
