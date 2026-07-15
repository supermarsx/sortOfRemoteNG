// pfSense integration — shared/config types + barrel (t42 §4b, crate lead
// t42-pfsense-L).
//
// camelCase 1:1 mirror of the connection types in
// `src-tauri/crates/sorng-pfsense/src/types.rs` (serde `rename_all` is NOT set
// on this crate, but the field names are already snake_case → Tauri serialises
// them verbatim; the connection struct below matches the Rust field names).
//
// Domain types (interfaces/firewall/nat/routing/vpn and dhcp/dns/services/…)
// live in the per-category files `./network.ts` and `./services.ts`, each owned
// by one category executor. Their re-exports are appended to the marked region
// at the end of this file by the per-crate integrator — keep this file's own
// declarations above that region.

/** `PfsenseConnectionConfig` — the connect form's payload. Mirror of the Rust
 *  struct of the same name. `useTls` defaults true, `timeoutSecs` 30 server-side. */
export interface PfsenseConnectionConfig {
  host: string;
  port: number;
  apiKey: string;
  apiSecret: string;
  useTls: boolean;
  acceptInvalidCerts: boolean;
  timeoutSecs: number;
  proxyUrl?: string | null;
}

/** Result of `pfsense_connect` / `pfsense_ping` — appliance identity summary. */
export interface PfsenseConnectionSummary {
  host: string;
  version: string;
  hostname: string;
  platform: string;
}

// ── category type re-exports (appended by the per-crate integrator) ──────────
export * from "./network";
export * from "./services";
