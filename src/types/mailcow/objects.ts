// mailcow "objects" category — Domains, Mailboxes, Aliases, Domain Aliases,
// DKIM, Resources & App Passwords (t42-mailcow-c1).
//
// Mirrors the request/response structs in
// `src-tauri/crates/sorng-mailcow/src/types.rs` for the provisioning command
// surface (the "Mail Setup" half of the mailcow admin UI).
//
// IMPORTANT — this crate is snake_case. None of these structs carry
// `#[serde(rename_all)]`, so serde serialises/deserialises their fields with the
// raw Rust snake_case names. Every field below is therefore snake_case verbatim
// (`domain_name`, `max_aliases`, `local_part`, `force_pw_update`, `tls_enforce_in`,
// `alias_domain`, `target_domain`, `dkim_selector`, `key_size`,
// `multiple_bookings`, …). Only the top-level command ARGUMENT names
// (id/req/domain/username/…) follow Tauri's camelCase conversion — those live in
// `useMailcowObjects.ts`, not here. See
// `.orchestration/logs/t42-mailcow-categories.md` (serde convention note).

// ═══════════════════════════════════════════════════════════════════════════════
// Domains
// ═══════════════════════════════════════════════════════════════════════════════

export interface MailcowDomain {
  domain_name: string;
  description: string;
  aliases: number;
  mailboxes: number;
  max_aliases: number;
  max_mailboxes: number;
  max_quota: number;
  quota: number;
  relay_all_recipients: boolean;
  relay_host: string;
  backupmx: boolean;
  active: boolean;
  created: string;
  modified: string;
}

export interface CreateDomainRequest {
  domain: string;
  description?: string;
  aliases?: number;
  mailboxes?: number;
  max_quota?: number;
  quota?: number;
  active?: boolean;
  restart_sogo?: boolean;
}

export interface UpdateDomainRequest {
  description?: string;
  aliases?: number;
  mailboxes?: number;
  max_quota?: number;
  quota?: number;
  relay_all_recipients?: boolean;
  relay_host?: string;
  backupmx?: boolean;
  active?: boolean;
  restart_sogo?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailboxes
// ═══════════════════════════════════════════════════════════════════════════════

export interface MailcowMailbox {
  username: string;
  domain: string;
  name: string;
  local_part: string;
  quota: number;
  percent_in_use: number;
  messages: number;
  active: boolean;
  created: string;
  modified: string;
  last_imap_login?: string | null;
  last_smtp_login?: string | null;
  last_pop3_login?: string | null;
  spam_aliases: number;
  tls_enforce_in: boolean;
  tls_enforce_out: boolean;
}

export interface CreateMailboxRequest {
  local_part: string;
  domain: string;
  name: string;
  password: string;
  quota?: number;
  active?: boolean;
  force_pw_update?: boolean;
  tls_enforce_in?: boolean;
  tls_enforce_out?: boolean;
}

export interface UpdateMailboxRequest {
  name?: string;
  password?: string;
  quota?: number;
  active?: boolean;
  force_pw_update?: boolean;
  tls_enforce_in?: boolean;
  tls_enforce_out?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aliases
// ═══════════════════════════════════════════════════════════════════════════════

export interface MailcowAlias {
  id: number;
  address: string;
  goto: string;
  domain: string;
  active: boolean;
  created: string;
  modified: string;
  in_primary_domain?: string | null;
  is_catch_all: boolean;
}

export interface CreateAliasRequest {
  address: string;
  goto: string;
  active?: boolean;
}

export interface UpdateAliasRequest {
  address?: string;
  goto?: string;
  active?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Domain aliases
// ═══════════════════════════════════════════════════════════════════════════════

export interface MailcowDomainAlias {
  alias_domain: string;
  target_domain: string;
  active: boolean;
  created: string;
  modified: string;
}

export interface CreateDomainAliasRequest {
  alias_domain: string;
  target_domain: string;
  active?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DKIM
// ═══════════════════════════════════════════════════════════════════════════════

export interface MailcowDkimKey {
  domain: string;
  dkim_txt: string;
  dkim_selector: string;
  length: number;
  privkey: string;
  pubkey: string;
}

export interface GenerateDkimRequest {
  domains: string[];
  dkim_selector?: string;
  key_size?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Resources
// ═══════════════════════════════════════════════════════════════════════════════

export interface MailcowResource {
  name: string;
  kind: string;
  domain: string;
  active: boolean;
  multiple_bookings: boolean;
  description: string;
}

export interface CreateResourceRequest {
  name: string;
  kind: string;
  domain: string;
  active?: boolean;
  description?: string;
  multiple_bookings?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// App passwords
// ═══════════════════════════════════════════════════════════════════════════════

export interface MailcowAppPassword {
  id: number;
  name: string;
  active: boolean;
  created: string;
}

export interface CreateAppPasswordRequest {
  username: string;
  name: string;
  password: string;
  active?: boolean;
}
