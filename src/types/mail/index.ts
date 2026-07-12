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

// ── per-crate type re-exports (appended by the per-crate integrator) ─────────
export * from "./opendkim";
