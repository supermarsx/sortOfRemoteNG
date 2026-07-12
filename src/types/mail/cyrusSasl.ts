// Cyrus SASL (auth) sub-tab types — 1:1 mirror of
// `src-tauri/crates/sorng-cyrus-sasl/src/types.rs`.
//
// Backing crate: sorng-cyrus-sasl. Command prefix is `sasl_` (NOT `cyrus_`).
// `CyrusSaslConnectionConfig` is snake_case (NO `#[serde(rename_all)]`), so the
// object passed to `sasl_connect` uses these keys verbatim. It shares the common
// SSH-transport head with the other 5 SSH-managed mail crates via
// `MailSshConnectionFields` (see `../mail`) and adds its own binary/config-dir
// paths.

import type { MailSshConnectionFields } from "./index";

// ═══════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════

/** Config passed to `sasl_connect(id, config)`. Mirrors
 *  `CyrusSaslConnectionConfig` (snake_case). SSH head + SASL tool paths. */
export interface CyrusSaslConnectionConfig extends MailSshConnectionFields {
  /** Path to saslauthd binary (default: /usr/sbin/saslauthd). */
  saslauthd_bin?: string;
  /** Path to sasldblistusers2 binary (default: /usr/sbin/sasldblistusers2). */
  sasldblistusers_bin?: string;
  /** Path to saslpasswd2 binary (default: /usr/sbin/saslpasswd2). */
  saslpasswd_bin?: string;
  /** SASL config directory (default: /etc/sasl2). */
  config_dir?: string;
}

/** Result of `sasl_connect` / summary shape. Mirrors `CyrusSaslConnectionSummary`. */
export interface CyrusSaslConnectionSummary {
  host: string;
  version?: string | null;
  mechanisms: string[];
  saslauthd_running: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// SSH output
// ═══════════════════════════════════════════════════════════════════════════

/** Raw remote-command result. Mirrors `SshOutput`. */
export interface SaslSshOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mechanisms
// ═══════════════════════════════════════════════════════════════════════════

/** A SASL mechanism. Mirrors `SaslMechanism`. */
export interface SaslMechanism {
  name: string;
  enabled: boolean;
  description: string;
  security_flags: string[];
  features: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════════

/** A SASL user. Mirrors `SaslUser`. */
export interface SaslUser {
  username: string;
  realm: string;
  password_exists: boolean;
}

/** Request body for `sasl_create_user`. Mirrors `CreateSaslUserRequest`. */
export interface CreateSaslUserRequest {
  username: string;
  realm?: string | null;
  password: string;
}

/** Request body for `sasl_update_user`. Mirrors `UpdateSaslUserRequest`. */
export interface UpdateSaslUserRequest {
  password: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// saslauthd
// ═══════════════════════════════════════════════════════════════════════════

/** saslauthd daemon config. Mirrors `SaslauthConfig`. */
export interface SaslauthConfig {
  /** Mechanism: pam, shadow, ldap, rimap, kerberos5, httpform. */
  mech: string;
  flags: string[];
  run_dir?: string | null;
  threads?: number | null;
  cache_timeout?: number | null;
  log_level?: string | null;
}

/** saslauthd runtime status. Mirrors `SaslauthStatus`. */
export interface SaslauthStatus {
  running: boolean;
  pid?: number | null;
  socket_path?: string | null;
  mechanism?: string | null;
  threads_active?: number | null;
  threads_idle?: number | null;
  cache_hits?: number | null;
  cache_misses?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// App config
// ═══════════════════════════════════════════════════════════════════════════

/** Per-application SASL config (e.g. smtpd.conf). Mirrors `SaslAppConfig`. */
export interface SaslAppConfig {
  app_name: string;
  pwcheck_method?: string | null;
  mech_list?: string | null;
  log_level?: string | null;
  auxprop_plugin?: string | null;
  sql_engine?: string | null;
  sql_hostnames?: string | null;
  sql_database?: string | null;
  sql_user?: string | null;
  sql_passw?: string | null;
  ldapdb_uri?: string | null;
  ldapdb_id?: string | null;
  ldapdb_pw?: string | null;
  extra: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// auxprop plugins
// ═══════════════════════════════════════════════════════════════════════════

/** An auxprop plugin. Mirrors `AuxpropPlugin`. */
export interface AuxpropPlugin {
  name: string;
  plugin_type: string;
  description: string;
  available: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test
// ═══════════════════════════════════════════════════════════════════════════

/** Result of an auth / config test. Mirrors `SaslTestResult`. */
export interface SaslTestResult {
  success: boolean;
  mechanism_used?: string | null;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// sasldb
// ═══════════════════════════════════════════════════════════════════════════

/** A single property row from the SASL database. Mirrors `SaslDbEntry`. */
export interface SaslDbEntry {
  username: string;
  realm: string;
  property: string;
  value: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Info
// ═══════════════════════════════════════════════════════════════════════════

/** `sasl_info` payload. Mirrors `SaslInfo`. */
export interface SaslInfo {
  version: string;
  available_mechanisms: string[];
  plugin_dir?: string | null;
  config_dir: string;
  saslauthd_running: boolean;
}
