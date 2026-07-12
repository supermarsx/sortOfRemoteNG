// OpenDKIM (mail signing) sub-tab types — 1:1 mirror of
// `src-tauri/crates/sorng-opendkim/src/types.rs` (t42 Wave M, sub-tab exec
// t42-mail-opendkim).
//
// Command prefix is `dkim_*` (NOT `opendkim_*`). Every field below is snake_case
// verbatim — the crate's `OpendkimConnectionConfig` carries NO
// `#[serde(rename_all)]`, so the object passed to `dkim_connect` uses these keys
// as written. See `.orchestration/logs/t42-mail-categories.md`.

import type { MailSshConnectionFields } from "./index";

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

/** Config passed to `dkim_connect`. SSH transport base + opendkim paths.
 *  snake_case verbatim (mirrors `OpendkimConnectionConfig`). */
export interface OpendkimConnectionConfig extends MailSshConnectionFields {
  /** Path to the opendkim binary (default `/usr/sbin/opendkim`). */
  opendkim_bin?: string;
  /** Path to opendkim.conf (default `/etc/opendkim.conf`). */
  config_path?: string;
  /** Directory containing DKIM keys (default `/etc/opendkim/keys`). */
  key_dir?: string;
}

/** Returned by `dkim_connect` / `dkim_ping`. */
export interface OpendkimConnectionSummary {
  host: string;
  version?: string | null;
  /** Operating mode: "sign", "verify", or "both" (sv). */
  mode?: string | null;
  domain?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DKIM Keys
// ═══════════════════════════════════════════════════════════════════════════════

export interface DkimKey {
  selector: string;
  domain: string;
  /** Key type: "rsa" or "ed25519". */
  key_type: string;
  /** RSA key size in bits (e.g. 1024, 2048, 4096). null for ed25519. */
  bits?: number | null;
  private_key_path: string;
  public_key_path?: string | null;
  /** The DNS TXT record value for this key. */
  dns_record?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
}

export interface CreateKeyRequest {
  selector: string;
  domain: string;
  /** Key type: "rsa" (default) or "ed25519". */
  key_type?: string | null;
  /** RSA key bits (default 2048). Ignored for ed25519. */
  bits?: number | null;
}

export interface RotateKeyRequest {
  selector: string;
  domain: string;
  /** New selector name for the rotated key. */
  new_selector: string;
  /** Key type for the new key (default: same as existing). */
  key_type?: string | null;
  /** Bits for the new key (default: same as existing). */
  bits?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signing Table
// ═══════════════════════════════════════════════════════════════════════════════

export interface SigningTableEntry {
  /** Pattern to match (e.g. "*@example.com"). */
  pattern: string;
  /** Key name reference (e.g. "default._domainkey.example.com"). */
  key_name: string;
  comment?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Key Table
// ═══════════════════════════════════════════════════════════════════════════════

export interface KeyTableEntry {
  /** Key name (e.g. "default._domainkey.example.com"). */
  key_name: string;
  /** Domain (e.g. "example.com"). */
  domain: string;
  /** Selector (e.g. "default"). */
  selector: string;
  /** Path to the private key file. */
  private_key_path: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trusted / Internal Hosts
// ═══════════════════════════════════════════════════════════════════════════════

export interface TrustedHost {
  /** Hostname, IP, or CIDR. */
  host: string;
  comment?: string | null;
}

export interface InternalHost {
  /** Hostname, IP, or CIDR. */
  host: string;
  comment?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config Parameters
// ═══════════════════════════════════════════════════════════════════════════════

export interface OpendkimConfig {
  /** Configuration key (e.g. "Mode", "Socket", "Domain"). */
  key: string;
  /** Configuration value. */
  value: string;
  /** Optional inline comment. */
  comment?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statistics
// ═══════════════════════════════════════════════════════════════════════════════

export interface OpendkimStats {
  messages_signed: number;
  messages_verified: number;
  signatures_good: number;
  signatures_bad: number;
  signatures_error: number;
  dns_queries: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DNS Records
// ═══════════════════════════════════════════════════════════════════════════════

export interface DnsRecord {
  selector: string;
  domain: string;
  /** DNS record type (usually "TXT"). */
  record_type: string;
  /** The full DNS TXT record value. */
  value: string;
  /** Suggested TTL. */
  ttl?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Info
// ═══════════════════════════════════════════════════════════════════════════════

export interface OpendkimInfo {
  version: string;
  /** Operating mode: "sign", "verify", or "both" (sv). */
  mode?: string | null;
  /** Milter socket path or address. */
  socket?: string | null;
  /** PID file path. */
  pid_file?: string | null;
  /** Active configuration file path. */
  config_path: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config Test Result
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConfigTestResult {
  success: boolean;
  output: string;
  errors: string[];
}

/** Sensible defaults for a fresh OpenDKIM connect form. */
export function defaultOpendkimConnectionConfig(): OpendkimConnectionConfig {
  return {
    host: "",
    port: 22,
    ssh_user: "",
    ssh_password: "",
    ssh_key: "",
    timeout_secs: 30,
    opendkim_bin: "",
    config_path: "",
    key_dir: "",
  };
}
