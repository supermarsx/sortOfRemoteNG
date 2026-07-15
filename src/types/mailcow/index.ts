// mailcow integration — shared/config types + barrel (t42 §4b, crate lead
// t42-mailcow-L).
//
// Mirror of the connection types in `src-tauri/crates/sorng-mailcow/src/types.rs`.
//
// IMPORTANT — this crate is snake_case. `MailcowConnectionConfig` and
// `MailcowConnectionSummary` carry NO `#[serde(rename_all)]`, so serde serialises
// their fields with the raw Rust snake_case names. The object passed to
// `mailcow_connect` MUST use these snake_case keys verbatim (`base_url`, `api_key`,
// `timeout_secs`, `tls_skip_verify`). Only the top-level command ARGUMENT names
// (id/config) follow Tauri's camelCase conversion — struct fields do not. The same
// holds for every request struct in the per-category files; see
// `.orchestration/logs/t42-mailcow-categories.md`.
//
// Domain types (domains/mailboxes/aliases/dkim/resources/appPasswords and transport/
// queue/quarantine/logs/status/rateLimits) live in the per-category files
// `./objects.ts` and `./operations.ts`, each owned by one category executor. Their
// re-exports are appended to the marked region at the end of this file by the
// per-crate integrator — keep this file's own declarations above that region.

/** `MailcowConnectionConfig` — the connect form's payload. snake_case field names
 *  mirror the Rust struct exactly (no serde rename). `timeout_secs` defaults 30 and
 *  `tls_skip_verify` false server-side. `api_key` is the single secret persisted to
 *  the OS vault; `base_url` (e.g. `https://mail.example.com`) is the host. */
export interface MailcowConnectionConfig {
  base_url: string;
  api_key: string;
  timeout_secs?: number;
  tls_skip_verify?: boolean;
  proxy_url?: string;
}

/** Result of `mailcow_connect` / `mailcow_ping` — server identity summary. */
export interface MailcowConnectionSummary {
  host: string;
  version?: string | null;
  hostname?: string | null;
  containers_count: number;
}

// ── category type re-exports (appended by the per-crate integrator) ──────────
export * from "./objects";
export * from "./operations";
