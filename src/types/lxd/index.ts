// LXD / Incus integration — shared types (barrel).
//
// camelCase 1:1 mirror of the shared structs in
// `src-tauri/crates/sorng-lxd/src/types.rs` (serde `rename_all = "camelCase"`).
// Only the connection + cross-cutting types live here; each command-category
// slice (instances, images, networking, storage) defines its own types in
// `./<category>.ts` and this barrel re-exports them.
//
// Ownership (t42 §4b): the LEAD owns this file's shared-type definitions. The
// per-crate integrator appends `export * from "./<category>"` lines below the
// marker as category slices land — the same disjoint-append discipline as the
// top-level registry. Do not hand-edit the re-export block from a category slice.

// ─── Connection ───────────────────────────────────────────────────────────────

/** Mirror of `LxdConnectionConfig`. Multi-credential: mTLS (cert+key, optional
 *  trust token) OR an OIDC token. */
export interface LxdConnectionConfig {
  /** Base URL of the LXD/Incus REST API, e.g. `https://10.0.0.1:8443`. */
  url: string;
  /** TLS client certificate (PEM) for mutual-TLS auth. */
  clientCertPem?: string;
  /** TLS client key (PEM). */
  clientKeyPem?: string;
  /** Trust token / password for the initial handshake. */
  trustPassword?: string;
  /** OIDC access token for token-based auth (Incus). */
  oidcToken?: string;
  /** Skip TLS verification (self-signed certs). */
  skipTlsVerify: boolean;
  /** Target project (default `"default"`). */
  project: string;
  /** Request timeout in seconds. */
  timeoutSecs: number;
}

/** Mirror of `LxdConnectionSummary` — returned by `lxd_connect`. */
export interface LxdConnectionSummary {
  connected: boolean;
  serverUrl: string;
  project: string;
  apiVersion?: string | null;
  serverName?: string | null;
  serverVersion?: string | null;
  authType?: string | null;
  authUserName?: string | null;
  clusterEnabled?: boolean | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Mirror of `LxdErrorKind`. */
export type LxdErrorKind =
  | "auth"
  | "connection"
  | "timeout"
  | "notFound"
  | "conflict"
  | "validation"
  | "api"
  | "operationFailed"
  | "throttled"
  | "quotaExceeded"
  | "serviceUnavailable"
  | "unknown";

/** Mirror of `LxdError`. Note: commands map this to a plain `String` at the
 *  Tauri boundary (`err_str`), so `invoke` rejections are strings — this shape
 *  documents the backend error for callers that parse it. */
export interface LxdError {
  kind: LxdErrorKind;
  message: string;
  statusCode?: number | null;
  code?: string | null;
}

// ─── Operations (async op handle, shared across every category) ────────────────

/** Mirror of `LxdOperation`. Returned by every mutating command that runs
 *  asynchronously (create/delete/start/stop/migrate/...). Shared — category
 *  slices import this rather than redefining it. */
export interface LxdOperation {
  id?: string | null;
  class?: string | null;
  description?: string | null;
  status?: string | null;
  statusCode?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  resources?: Record<string, string[]> | null;
  metadata?: unknown;
  mayCancel?: boolean | null;
  err?: string | null;
  location?: string | null;
}

/** Default connection config matching the Rust `Default` impl. */
export function defaultLxdConnectionConfig(): LxdConnectionConfig {
  return {
    url: "https://127.0.0.1:8443",
    clientCertPem: undefined,
    clientKeyPem: undefined,
    trustPassword: undefined,
    oidcToken: undefined,
    skipTlsVerify: true,
    project: "default",
    timeoutSecs: 30,
  };
}

// ─── Category slice re-exports (wired by the per-crate integrator) ─────────────
export * from "./instances";
export * from "./images";
export * from "./networking";
export * from "./storage";
