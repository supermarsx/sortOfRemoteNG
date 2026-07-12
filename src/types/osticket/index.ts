// osTicket integration — shared/config types + barrel (t42 §4b, crate lead
// t42-osticket-L).
//
// Mirror of the connection types in `src-tauri/crates/sorng-osticket/src/types.rs`.
//
// IMPORTANT — this crate is snake_case. NO struct in `types.rs` carries a
// `#[serde(rename_all)]`, so serde serialises every field with its raw Rust
// snake_case name. The `config` / `request` objects passed to the `osticket_*`
// commands MUST use these snake_case keys verbatim (`api_key`, `timeout_seconds`,
// `skip_tls_verify`, `ticket_id`, `dept_id`, `staff_id`, …). Only the top-level
// command ARGUMENT names (`id`, `config`, `ticketId`, `staffId`, …) follow
// Tauri's default camelCase conversion — struct fields do not. The same holds for
// every request struct in the per-category files; see
// `.orchestration/logs/t42-osticket-categories.md`.
//
// Domain types (tickets/threads/users and departments/topics/agents/teams/sla/
// canned-responses/custom-fields) live in the per-category files `./ticketing.ts`
// and `./admin.ts`, each owned by one category executor. Their re-exports are
// appended to the marked region at the end of this file by the per-crate
// integrator — keep this file's own declarations above that region.

/** `OsticketConnectionConfig` — the connect form's payload. snake_case field
 *  names mirror the Rust struct exactly (no serde rename). `timeout_seconds`
 *  defaults 30 and `skip_tls_verify` false server-side. `api_key` is the osTicket
 *  API key created in the helpdesk admin panel. */
export interface OsticketConnectionConfig {
  /** User-facing instance name (required by the Rust struct). */
  name: string;
  /** Base URL, e.g. `https://helpdesk.example.com`. */
  host: string;
  /** API key created in osTicket admin. Sent on connect; never persisted in the
   *  config blob (stored in the OS vault via `useIntegrationConfigStore`). */
  api_key: string;
  timeout_seconds?: number;
  skip_tls_verify?: boolean;
}

/** Result of `osticket_connect` / `osticket_ping`. Unlike host-oriented crates,
 *  osTicket returns a lightweight liveness status (no hostname/theme fields). */
export interface OsticketConnectionStatus {
  connected: boolean;
  version?: string | null;
  message?: string | null;
}

// ── category type re-exports (appended by the per-crate integrator) ──────────
// export * from "./ticketing";
// export * from "./admin";
