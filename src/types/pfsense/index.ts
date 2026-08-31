// pfSense integration — shared/config types + barrel (t42 §4b, crate lead
// t42-pfsense-L).
//
// camelCase 1:1 mirror of the connection types in
// `src-tauri/crates/sorng-pfsense/src/types.rs` (`rename_all = "camelCase"`).
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
  useTls: boolean;
  acceptInvalidCerts: boolean;
  /** Runtime-only acknowledgement for one insecure connection attempt. */
  acknowledgeInvalidCertRisk?: boolean;
  timeoutSecs: number;
  /** Protected `p<token>.localhost` endpoint created by the internal proxy. */
  internalProxyUrl: string;
  /** Deprecated transport metadata; outbound proxying belongs to the internal mediator. */
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
