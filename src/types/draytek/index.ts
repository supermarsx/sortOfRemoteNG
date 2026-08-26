// DrayTek integration — shared/config types (t68 D3).
//
// 1:1 mirror of the connection/status types in
// `src-tauri/crates/sorng-draytek/src/types.rs`. The Rust structs use
// snake_case field names and NO serde `rename_all`, so Tauri serialises them
// verbatim — the wire shapes below are therefore snake_case too (unlike the
// pfSense TS mirror, which drifted to camelCase). Keep them in sync with the
// crate; the panel builds `DraytekConnectionConfig` from its form and passes
// it straight to `draytek_connect`.

/** The `vendor` discriminator — DrayTek today, UniFi / MikroTik may slot in
 *  behind the same panel shell later. */
export type DraytekVendor = "draytek" | (string & {});

/** `DraytekConnectionConfig` — the connect form's payload (D1 `types.rs`). */
export interface DraytekConnectionConfig {
  host: string;
  /** Defaults to 443 (TLS) / 80 (plain) when the form leaves it blank. */
  port: number;
  username: string;
  password: string;
  use_tls: boolean;
  accept_invalid_certs: boolean;
  /** Runtime-only acknowledgement for one insecure connection attempt. */
  acknowledge_invalid_cert_risk?: boolean;
  timeout_secs: number;
  proxy_url?: string | null;
  vendor: DraytekVendor;
}

/** Result of `draytek_connect` / `draytek_ping` — device identity summary.
 *  Every field but `host` is best-effort (firmware/model dependent). */
export interface DraytekConnectionSummary {
  host: string;
  model?: string | null;
  firmware?: string | null;
  hostname?: string | null;
}

/** One WAN interface row from the status page / `wan status` CLI output. */
export interface DraytekWanStatus {
  name: string;
  /** e.g. "Up" / "Down" / "Connected"; firmware-specific free text. */
  status?: string | null;
  ip?: string | null;
  gateway?: string | null;
  /** Access mode / link type, e.g. "PPPoE", "DHCP", "Static". */
  mode?: string | null;
  uptime?: string | null;
}

/** Result of `draytek_get_status`. Every field is optional — never assume a
 *  given model exposes it. */
export interface DraytekStatus {
  model?: string | null;
  firmware?: string | null;
  build?: string | null;
  uptime?: string | null;
  wan: DraytekWanStatus[];
}

/** Whitelisted CLI verbs `draytek_run_cli` accepts (D1 `cli.rs`). */
export type DraytekCliVerb = "sys_version" | "wan_status" | "sys_reboot";

/** Result of `draytek_reboot` / `draytek_run_cli` — a typed, never
 *  fire-and-forget acknowledgement. */
export interface DraytekActionResult {
  accepted: boolean;
  message?: string | null;
  /** Raw CLI/HTTP output when the backend has any to show. */
  output?: string | null;
}
