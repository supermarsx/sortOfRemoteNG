// Jira integration — shared/config types + barrel (t42 §4b, crate lead
// t42-jira-L).
//
// Mirror of the connection types in `src-tauri/crates/sorng-jira/src/types.rs`.
//
// IMPORTANT — SERDE CONVENTION (read `.orchestration/logs/t42-jira-categories.md`):
// this crate carries **NO** `#[serde(rename_all)]` on any struct or enum. Instead
// each type is mirrored field-by-field against the WIRE name:
//   • `JiraConnectionConfig` fields are plain Rust snake_case (`api_version`,
//     `timeout_seconds`, `skip_tls_verify`) — pass them verbatim to `jira_connect`.
//   • Response/request structs are a MIX: default snake_case with per-field
//     `#[serde(rename = "...")]` where the Jira REST API wants camelCase
//     (`maxResults`, `accountId`, `issueUpdates`, ...). NEVER assume blanket
//     camelCase or snake_case — mirror each field's real wire name.
//   • `JiraAuthMethod` is an **externally-tagged** serde enum (no rename), so its
//     wire form is a single-key object keyed by the PascalCase variant name:
//       { Basic: { username, password } } | { ApiToken: { email, token } }
//       | { Bearer: { token } } | { Pat: { token } }
//   • Only the top-level command ARGUMENT names (id/config/issueKey/...) follow
//     Tauri's camelCase conversion — struct fields do not.
//
// Domain types (issues/comments/attachments/worklogs/users/fields and projects/
// boards/sprints/dashboards/filters) live in the per-category files `./issues.ts`
// and `./agile.ts`, each owned by one category executor. Their re-exports are
// appended to the marked region at the end of this file by the per-crate
// integrator — keep this file's own declarations above that region.

/** The four Jira auth mechanisms, in serde's externally-tagged WIRE form (the
 *  object passed as `config.auth`). Each is a single-key object whose key is the
 *  PascalCase Rust variant name; the inner fields are snake_case (no rename). */
export type JiraAuthMethod =
  | { Basic: { username: string; password: string } }
  | { ApiToken: { email: string; token: string } }
  | { Bearer: { token: string } }
  | { Pat: { token: string } };

/** UI-facing discriminator for the auth-method selector. Maps 1:1 to the wire
 *  variants: `basic`→Basic (Jira Server/DC username+password), `apiToken`→ApiToken
 *  (Jira Cloud email + API token), `bearer`→Bearer (OAuth/bearer token),
 *  `pat`→Pat (Jira Server/DC personal access token). */
export type JiraAuthMethodKind = "basic" | "apiToken" | "bearer" | "pat";

/** `JiraConnectionConfig` — the connect form's payload. Field names mirror the
 *  Rust struct exactly (all snake_case, NO serde rename). `api_version` defaults
 *  "2", `timeout_seconds` 30, `skip_tls_verify` false server-side. */
export interface JiraConnectionConfig {
  name: string;
  /** Base URL, e.g. `https://myorg.atlassian.net` or `https://jira.corp.com`. */
  host: string;
  auth: JiraAuthMethod;
  /** REST API version — "2" (Server/DC) or "3" (Cloud). Defaults "2". */
  api_version?: string;
  timeout_seconds?: number;
  skip_tls_verify?: boolean;
}

/** Result of `jira_connect` / `jira_ping` — server identity + reachability
 *  (mirror of the Rust `JiraConnectionStatus`; snake_case, no rename). */
export interface JiraConnectionStatus {
  connected: boolean;
  server_title?: string | null;
  version?: string | null;
  deployment_type?: string | null;
  message?: string | null;
}

// ── shared core entity + reference types ─────────────────────────────────────
// These are owned by the LEAD (not the category execs) because they are
// referenced across BOTH command categories, so putting them here keeps `issues`
// and `agile` fully disjoint — neither imports the other's file, both depend only
// on this barrel (which ships first). Category execs MUST import these from
// `../../../types/jira` and must NOT redefine them. Everything else (per-domain
// request/response types) lives in the category files. Wire names mirror the Rust
// per-field `#[serde(rename)]`s exactly (many are already camelCase; some, like
// `rendered_fields`, stay snake_case — see each field).

/** A Jira user (mirror of `JiraUser`). Referenced by issues, changelogs, project
 *  leads, dashboard/filter owners. `self` is the Rust `self_url` (renamed "self"). */
export interface JiraUser {
  self?: string;
  accountId?: string | null;
  emailAddress?: string | null;
  displayName?: string | null;
  active?: boolean | null;
  avatarUrls?: Record<string, string> | null;
  key?: string | null;
  name?: string | null;
  timeZone?: string | null;
}

/** Status-category grouping for a `JiraStatus` (e.g. To Do / In Progress / Done). */
export interface JiraStatusCategory {
  id?: number | null;
  key?: string | null;
  name?: string | null;
  colorName?: string | null;
}

/** A workflow status (mirror of `JiraStatus`). `self` is the Rust `self_url`. */
export interface JiraStatus {
  self?: string;
  id?: string | null;
  name?: string | null;
  description?: string | null;
  statusCategory?: JiraStatusCategory | null;
}

/** A priority level (mirror of `JiraPriority`). */
export interface JiraPriority {
  self?: string;
  id?: string | null;
  name?: string | null;
  description?: string | null;
  iconUrl?: string | null;
}

/** An issue type (mirror of `JiraIssueType`). Referenced by issues and by
 *  `JiraProject.issueTypes`. */
export interface JiraIssueType {
  self?: string;
  id?: string | null;
  name?: string | null;
  description?: string | null;
  subtask?: boolean | null;
  iconUrl?: string | null;
}

/** One field-change within a changelog entry (mirror of `JiraChangeItem`). */
export interface JiraChangeItem {
  field?: string | null;
  fieldtype?: string | null;
  fromString?: string | null;
  toString?: string | null;
}

/** One changelog entry (mirror of `JiraChangelogEntry`). */
export interface JiraChangelogEntry {
  id?: string | null;
  created?: string | null;
  author?: JiraUser | null;
  items: JiraChangeItem[];
}

/** Issue changelog wrapper (mirror of `JiraChangelog`). */
export interface JiraChangelog {
  histories: JiraChangelogEntry[];
}

/** An available workflow transition (mirror of `JiraTransition`). */
export interface JiraTransition {
  id: string;
  name?: string | null;
  to?: JiraStatus | null;
  fields: Record<string, unknown>;
}

/** The core Jira issue entity (mirror of `JiraIssue`). Shared because board/
 *  sprint issue lists (`agile`) and the issue views (`issues`) both consume it.
 *  NOTE: `self` is the Rust `self_url`; `rendered_fields` keeps its snake_case
 *  wire name (it carries NO serde rename). */
export interface JiraIssue {
  id: string;
  self: string;
  key: string;
  fields: Record<string, unknown>;
  changelog?: JiraChangelog | null;
  rendered_fields?: Record<string, unknown> | null;
  transitions?: JiraTransition[] | null;
}

/** A JQL/board/sprint issue-list page (mirror of `JiraSearchResponse`). Returned
 *  by `jira_search_issues` (issues) AND `jira_get_board_issues` /
 *  `jira_get_board_backlog` / `jira_get_sprint_issues` (agile). */
export interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

// ── category type re-exports (appended by the per-crate integrator) ──────────
export * from "./issues";
export * from "./agile";
