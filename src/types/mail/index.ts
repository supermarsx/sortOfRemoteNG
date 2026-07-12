// Unified Mail Server integration — shared types + barrel (t42 Wave M, lead
// t42-mail-L).
//
// This panel folds 8 independent mail-chain crates (postfix, dovecot, amavis,
// opendkim, cyrus-sasl, procmail, rspamd, clamav) into one panel of self-managed
// sub-tabs. Each crate owns its own config/summary/domain types in a sibling
// file `./<crate>.ts`; those re-exports are appended to the marked region at the
// end of this file by the per-crate integrator. Keep this file's own shared
// declarations above that region.
//
// IMPORTANT — every crate's `*ConnectionConfig` is snake_case (NO
// `#[serde(rename_all)]` on the config struct). Mirror struct fields as
// snake_case in TS; the objects passed to `<x>_connect` use these keys verbatim.
// See `.orchestration/logs/t42-mail-categories.md` for the per-crate contract,
// the command prefixes (opendkim → `dkim_*`, cyrus-sasl → `sasl_*`), and the
// serde note.

/** The SSH-transport connection base shared by the 6 SSH-managed mail crates
 *  (postfix, dovecot, opendkim, cyrus-sasl, procmail, clamav). Mirrors the common
 *  head of each crate's `*ConnectionConfig` struct verbatim (snake_case). Each
 *  crate's own config `extends` this and adds its binary/config-path fields.
 *
 *  NOT used by `amavis` (username/password/private_key) or `rspamd`
 *  (base_url/password) — those carry a different config shape; see their own
 *  `./amavis.ts` / `./rspamd.ts`. */
export interface MailSshConnectionFields {
  /** SSH hostname or IP. */
  host: string;
  /** SSH port (default 22 server-side). */
  port?: number;
  /** SSH username. */
  ssh_user?: string;
  /** SSH password (omit when using key auth). */
  ssh_password?: string;
  /** Path to an SSH private key. */
  ssh_key?: string;
  /** SSH command timeout in seconds. */
  timeout_secs?: number;
}

// ── per-crate type namespaces (appended by the per-crate integrator) ─────────
// NAMESPACED, not flat `export * from`: these 8 crates were authored
// independently and a few generic helper types collide by name across them
// (e.g. `ConfigTestResult`, `SshOutput`), which a flat re-export cannot merge
// (TS2308). Each crate is exposed under its own namespace instead. Consume a
// crate's types either as `mail.postfix.PostfixConnectionConfig` (via this
// barrel) or, as every sub-tab does, by importing directly from `./postfix`.
export * as postfix from "./postfix";
export * as dovecot from "./dovecot";
export * as amavis from "./amavis";
export * as opendkim from "./opendkim";
export * as cyrusSasl from "./cyrusSasl";
export * as procmail from "./procmail";
export * as rspamd from "./rspamd";
export * as clamav from "./clamav";

// `ConfigTestResult` (opendkim/postfix/dovecot) and `SshOutput` (postfix/amavis)
// are declared per-crate with crate-specific shapes, so a plain star re-export is
// ambiguous (TS2308). Disambiguate the barrel to the Postfix variant; a consumer
// needing another crate's shape should import it from that crate's own module
// (e.g. `import type { ConfigTestResult } from "../../types/mail/dovecot"`).
export type { ConfigTestResult, SshOutput } from "./postfix";
