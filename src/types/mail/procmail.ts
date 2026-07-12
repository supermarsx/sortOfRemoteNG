// Procmail (delivery) types — 1:1 mirror of
// `src-tauri/crates/sorng-procmail/src/types.rs` (t42 Wave M, sub-tab
// t42-mail-procmail).
//
// Every struct in the crate is plain snake_case (NO `#[serde(rename_all)]` on the
// data structs), so these field names are the wire shape: the `config` passed to
// `procmail_connect` and every request body uses these keys verbatim. Only the
// top-level command ARG names (`id`, `config`, `user`, `recipeId`, …) follow
// Tauri's camelCase conversion — see `useProcmail.ts`.
//
// NOTE: procmail has NO ping command (connect / disconnect / list_connections
// only). All management commands are keyed by `(id, user)` — `user` selects whose
// `~/.procmailrc` (or the global rc) is operated on.

import type { MailSshConnectionFields } from "./index";

// ── Connection ───────────────────────────────────────────────────────────────

/** Snake_case connection config for `procmail_connect`. Extends the shared SSH
 *  transport base with Procmail's binary / rc / log paths. */
export interface ProcmailConnectionConfig extends MailSshConnectionFields {
  /** Path to the `procmail` binary (default `/usr/bin/procmail`). */
  procmail_bin?: string;
  /** Path to the global procmailrc (default `/etc/procmailrc`). */
  procmailrc_path?: string;
  /** Path to the procmail log file (default `/var/log/procmail.log`). */
  log_path?: string;
}

export interface ProcmailConnectionSummary {
  host: string;
  version?: string;
  recipe_count: number;
  log_path: string;
}

// ── Recipes ──────────────────────────────────────────────────────────────────

export interface ProcmailRecipe {
  id: string;
  /** Condition lines (each starting with `*`). */
  condition_lines: string[];
  /** Action line (delivery target / pipe / forward). */
  action: string;
  /** Recipe flags (e.g. `HBDfhbcwWieaA`). */
  flags: string;
  /** Optional lockfile path. */
  lockfile?: string;
  /** Optional human-readable comment. */
  comment?: string;
  enabled: boolean;
  /** Position in the procmailrc file (0-based). */
  position: number;
  /** Raw text of this recipe block. */
  raw: string;
}

export interface CreateRecipeRequest {
  condition_lines: string[];
  action: string;
  flags?: string;
  lockfile?: string;
  comment?: string;
  enabled?: boolean;
  position?: number;
}

export interface UpdateRecipeRequest {
  condition_lines?: string[];
  action?: string;
  flags?: string;
  lockfile?: string;
  comment?: string;
  enabled?: boolean;
  position?: number;
}

// ── Rules (named groups of recipes) ──────────────────────────────────────────

export interface ProcmailRule {
  id: string;
  name: string;
  description?: string;
  recipes: ProcmailRecipe[];
  enabled: boolean;
  priority: number;
}

export interface CreateRuleRequest {
  name: string;
  description?: string;
  recipes: CreateRecipeRequest[];
  enabled?: boolean;
  priority?: number;
}

export interface UpdateRuleRequest {
  name?: string;
  description?: string;
  recipes?: CreateRecipeRequest[];
  enabled?: boolean;
  priority?: number;
}

// ── Variables ────────────────────────────────────────────────────────────────

export interface ProcmailVariable {
  name: string;
  value: string;
  comment?: string;
}

// ── Includes ─────────────────────────────────────────────────────────────────

export interface ProcmailInclude {
  path: string;
  comment?: string;
  enabled: boolean;
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export interface ProcmailLogEntry {
  timestamp?: string;
  from_address?: string;
  to_folder?: string;
  subject?: string;
  size_bytes?: number;
  procmail_flags?: string;
  result?: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface ProcmailConfig {
  recipes: ProcmailRecipe[];
  variables: ProcmailVariable[];
  includes: ProcmailInclude[];
  raw_content: string;
}

// ── Delivery / Testing ───────────────────────────────────────────────────────

/** `#[serde(rename_all = "snake_case")]` on the Rust enum. */
export type DeliveryTargetType =
  | "maildir"
  | "mbox"
  | "pipe"
  | "forward"
  | "dev_null";

export interface DeliveryTarget {
  target_type: DeliveryTargetType;
  path_or_command: string;
}

export interface RecipeTestResult {
  matched: boolean;
  matching_recipe_id?: string;
  delivery_target?: DeliveryTarget;
  log_output: string;
}
