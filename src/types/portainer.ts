// Portainer integration types — camelCase 1:1 mirror of the crate's wire shapes.
//
// Source: src-tauri/crates/sorng-portainer/src/types.rs
// All structs there derive `#[serde(rename_all = "camelCase")]`, so snake_case
// Rust fields serialize to camelCase JSON — mirrored here. Fields carrying an
// explicit `#[serde(rename = "...")]` (e.g. `acknowledge_invalid_cert_risk`)
// keep that wire name. `Option<T>` fields become optional (`?`); serde
// `#[serde(default)]` collections are always present on the wire but modelled
// optional-friendly.

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/** Which credential the backend will use (`apiKey` wins when both are set). */
export type PortainerAuthMode = "password" | "apiKey";

export interface PortainerConnectionConfig {
  /** Portainer base URL (e.g. "https://host:9443"). */
  baseUrl: string;
  /** Username for `POST /api/auth` (password mode). */
  username?: string | null;
  /** Password for `POST /api/auth` (password mode). */
  password?: string | null;
  /** Access token sent as `X-API-Key` (API-key mode). */
  apiKey?: string | null;
  /** Whether to skip TLS certificate verification (https only). */
  skipTlsVerify?: boolean | null;
  /** Runtime-only acknowledgement for one insecure connection attempt. */
  acknowledge_invalid_cert_risk?: boolean;
  /** Request timeout in seconds. */
  timeoutSecs?: number | null;
  /** Optional HTTP proxy URL supplied from the app-wide proxy setting. */
  proxyUrl?: string | null;
}

export interface PortainerConnectionSummary {
  /** Portainer server version (from `/api/system/status`). */
  version: string;
  /** Portainer instance identifier. */
  instanceId?: string | null;
  /** Authenticated user name, when known. */
  user?: string | null;
  /** Portainer role id (1 = administrator, 2 = standard user). */
  role?: number | null;
  /** Which credential was used for this connection. */
  authMode: PortainerAuthMode;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Errors (serde `snake_case` kinds)
// ═══════════════════════════════════════════════════════════════════════════════

export type PortainerErrorKind =
  | "not_connected"
  | "already_connected"
  | "config_error"
  | "connection_failed"
  | "tls_untrusted"
  | "authentication_failed"
  | "token_expired"
  | "permission_denied"
  | "not_found"
  | "http_error"
  | "parse_error"
  | "timeout"
  | "internal_error";

export interface PortainerError {
  kind: PortainerErrorKind;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Environments (endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** `Status` on the wire: 1 = up, 2 = down. */
export type PortainerEndpointStatus = 1 | 2 | number;

export interface PortainerEndpoint {
  id: number;
  name: string;
  /** Environment type (1 = Docker, 2 = Agent, 3 = Azure, 4 = Edge, 5 = K8s …). */
  type?: number | null;
  url?: string | null;
  status?: PortainerEndpointStatus | null;
  groupId?: number | null;
  /** Docker snapshot summary (container/image counts), when present. */
  snapshots?: PortainerEndpointSnapshot[];
}

export interface PortainerEndpointSnapshot {
  time?: number | null;
  dockerVersion?: string | null;
  swarm?: boolean | null;
  totalCpu?: number | null;
  totalMemory?: number | null;
  runningContainerCount?: number | null;
  stoppedContainerCount?: number | null;
  healthyContainerCount?: number | null;
  unhealthyContainerCount?: number | null;
  imageCount?: number | null;
  volumeCount?: number | null;
  stackCount?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Containers (proxied Docker Engine API)
// ═══════════════════════════════════════════════════════════════════════════════

export interface PortainerContainerPort {
  ip?: string | null;
  privatePort?: number | null;
  publicPort?: number | null;
  type?: string | null;
}

export interface PortainerContainer {
  id: string;
  /** Docker returns names with a leading "/" (e.g. "/portainer"). */
  names: string[];
  image?: string | null;
  /** Docker container state ("running", "exited", "paused", …). */
  state?: string | null;
  /** Human status line ("Up 3 hours"). */
  status?: string | null;
  ports?: PortainerContainerPort[];
  /** Unix timestamp (seconds). */
  created?: number | null;
}

export type PortainerLogStream = "stdout" | "stderr" | "stdin" | "raw";

export interface PortainerLogLine {
  stream: PortainerLogStream;
  text: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stacks
// ═══════════════════════════════════════════════════════════════════════════════

export interface PortainerStack {
  id: number;
  name: string;
  /** 1 = swarm, 2 = compose, 3 = kubernetes. */
  type?: number | null;
  endpointId?: number | null;
  /** 1 = active, 2 = inactive. */
  status?: number | null;
}
