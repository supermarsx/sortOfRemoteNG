// cPanel/WHM integration — shared/config types + barrel (t42 §4b, crate lead
// t42-cpanel-L).
//
// Mirror of the connection types in `src-tauri/crates/sorng-cpanel/src/types.rs`.
//
// IMPORTANT — this crate is snake_case. `CpanelConnectionConfig` and
// `CpanelConnectionSummary` carry NO `#[serde(rename_all)]`, so serde serialises
// their fields with the raw Rust snake_case names. The objects passed to
// `cpanel_connect` MUST use these snake_case keys verbatim (`whm_port`,
// `cpanel_port`, `use_tls`, `accept_invalid_certs`, `auth_mode`, `api_token`,
// `timeout_secs`). Only the top-level command ARGUMENT names (id/config) follow
// Tauri's camelCase conversion — struct fields do not. The same holds for every
// request struct in the per-category files; see `.orchestration/logs/t42-cpanel-categories.md`.
//
// Domain types (accounts/dns/backups/security/monitoring/php and domains/email/
// databases/files/ssl/ftp/cron) live in the per-category files `./server.ts` and
// `./account.ts`, each owned by one category executor. Their re-exports are
// appended to the marked region at the end of this file by the per-crate
// integrator — keep this file's own declarations above that region.

/** `CpanelAuthMode` — mirror of the Rust enum (`#[serde(rename_all = "snake_case")]`).
 *  `password` = username + password (session token); `api_token` = WHM API token
 *  (root/reseller); `user_api_token` = cPanel user-level API token. */
export type CpanelAuthMode = "password" | "api_token" | "user_api_token";

/** `CpanelConnectionConfig` — the connect form's payload. snake_case field names
 *  mirror the Rust struct exactly (no serde rename). `whm_port` defaults 2087,
 *  `cpanel_port` 2083, `use_tls` true, `timeout_secs` 30 server-side. */
export interface CpanelConnectionConfig {
  host: string;
  whm_port?: number;
  cpanel_port?: number;
  use_tls?: boolean;
  accept_invalid_certs?: boolean;
  auth_mode: CpanelAuthMode;
  username: string;
  /** Present when `auth_mode = "password"`. */
  password?: string;
  /** Present when `auth_mode = "api_token"` or `"user_api_token"`. */
  api_token?: string;
  timeout_secs?: number;
  proxy_url?: string;
}

/** Result of `cpanel_connect` / `cpanel_ping` — server identity summary. */
export interface CpanelConnectionSummary {
  host: string;
  hostname?: string;
  version?: string;
  theme?: string;
  server_type?: string;
  license_id?: string;
}

// ── category type re-exports (appended by the per-crate integrator) ──────────
export * from "./server";
export * from "./account";
