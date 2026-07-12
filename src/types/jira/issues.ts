// Jira `issues` category types — Issues, Comments, Attachments, Worklogs and
// Fields (t42-jira-c1). Mirror of the c1-owned structs in
// `src-tauri/crates/sorng-jira/src/types.rs`.
//
// SERDE (read `.orchestration/logs/t42-jira-categories.md`): this crate carries
// NO blanket `#[serde(rename_all)]`. Each field below mirrors its Rust struct's
// WIRE name exactly — default snake_case with per-field `#[serde(rename)]` where
// the Jira REST API wants camelCase. The #1 footgun lives in `JiraSearchRequest`:
// `start_at` stays snake_case (no rename) while `maxResults` in the SAME struct
// is renamed. `body`/`comment` payloads are `serde_json::Value` (ADF object on
// Cloud v3, plain string on Server v2) → `unknown`.
//
// Shared core + reference types (JiraUser, JiraIssue, JiraSearchResponse,
// JiraTransition, JiraChangelogEntry, JiraIssueType, JiraPriority, JiraStatus)
// are LEAD-owned in `../../../types/jira` — import them there, do NOT redefine.

import type { JiraUser } from "../jira";

// ── Issues ─────────────────────────────────────────────────────────────────────

/** Body of `jira_create_issue` (mirror of `CreateIssueRequest`). `fields` is the
 *  raw Jira field map (project/issuetype/summary/…); `update` is the optional
 *  field-operations map. Both are opaque `serde_json::Value` maps. */
export interface CreateIssueRequest {
  fields: Record<string, unknown>;
  update?: Record<string, unknown>;
}

/** Body of `jira_update_issue` (mirror of `UpdateIssueRequest`). Both optional —
 *  send `fields` for value replacement and/or `update` for field operations. */
export interface UpdateIssueRequest {
  fields?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

/** Body of `jira_bulk_create_issues` (mirror of `BulkCreateIssueRequest`). NOTE:
 *  `issueUpdates` carries a `#[serde(rename)]` — it is NOT `issue_updates`. */
export interface BulkCreateIssueRequest {
  issueUpdates: CreateIssueRequest[];
}

/** Result of `jira_bulk_create_issues` (mirror of `BulkCreateIssueResponse`).
 *  `errors` are opaque per-item error objects. */
export interface BulkCreateIssueResponse {
  issues: import("../jira").JiraIssue[];
  errors: unknown[];
}

/** The target transition id wrapper (mirror of `TransitionId`). */
export interface TransitionId {
  id: string;
}

/** Body of `jira_transition_issue` (mirror of `TransitionRequest`). `fields` /
 *  `update` optionally set values as part of the transition. */
export interface TransitionRequest {
  transition: TransitionId;
  fields?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

/** Body of `jira_search_issues` (mirror of `JiraSearchRequest`). ⚠ MIXED serde:
 *  `start_at` stays snake_case (NO rename) but `maxResults` in the same struct is
 *  renamed to camelCase. `fields`/`expand` are optional string lists. */
export interface JiraSearchRequest {
  jql: string;
  /** Page offset — snake_case wire name (no serde rename). */
  start_at?: number;
  /** Page size — renamed to camelCase on the wire. */
  maxResults?: number;
  fields?: string[];
  expand?: string[];
}

// ── Comments ───────────────────────────────────────────────────────────────────

/** A comment on an issue (mirror of `JiraComment`). `body` is ADF (Cloud v3
 *  object) or plain text (Server v2 string). `self` is the Rust `self_url`. */
export interface JiraComment {
  self?: string;
  id?: string | null;
  author?: JiraUser | null;
  updateAuthor?: JiraUser | null;
  body?: unknown;
  created?: string | null;
  updated?: string | null;
  jsdPublic?: boolean | null;
}

/** Restricts a comment to a project role or group (mirror of `CommentVisibility`).
 *  `type` carries a `#[serde(rename = "type")]` off the Rust field `vis_type`. */
export interface CommentVisibility {
  type: string;
  value: string;
}

/** Body of `jira_add_comment` / `jira_update_comment` (mirror of
 *  `AddCommentRequest`). `body` is ADF (object) or plain text (string). */
export interface AddCommentRequest {
  body: unknown;
  visibility?: CommentVisibility;
}

/** A page of comments (mirror of `CommentsResponse`). */
export interface CommentsResponse {
  startAt: number;
  maxResults: number;
  total: number;
  comments: JiraComment[];
}

// ── Attachments ─────────────────────────────────────────────────────────────────

/** An issue attachment (mirror of `JiraAttachment`). `content`/`thumbnail` are
 *  download URLs; `self` is the Rust `self_url`; `mimeType` is renamed. */
export interface JiraAttachment {
  self?: string;
  id?: string | null;
  filename?: string | null;
  author?: JiraUser | null;
  created?: string | null;
  size?: number | null;
  mimeType?: string | null;
  content?: string | null;
  thumbnail?: string | null;
}

// ── Worklogs ────────────────────────────────────────────────────────────────────

/** A worklog entry (mirror of `JiraWorklog`). `comment` is ADF/plain text;
 *  `timeSpent`/`timeSpentSeconds`/`updateAuthor` are renamed; `self` is
 *  `self_url`. */
export interface JiraWorklog {
  self?: string;
  id?: string | null;
  author?: JiraUser | null;
  updateAuthor?: JiraUser | null;
  comment?: unknown;
  started?: string | null;
  timeSpent?: string | null;
  timeSpentSeconds?: number | null;
  created?: string | null;
  updated?: string | null;
}

/** Body of `jira_add_worklog` / `jira_update_worklog` (mirror of
 *  `AddWorklogRequest`). Provide either `timeSpentSeconds` or `timeSpent` (both
 *  renamed). `comment` is ADF/plain text; `started` is snake_case (no rename). */
export interface AddWorklogRequest {
  timeSpentSeconds?: number;
  timeSpent?: string;
  comment?: unknown;
  started?: string;
}

/** A page of worklogs (mirror of `WorklogsResponse`). */
export interface WorklogsResponse {
  startAt: number;
  maxResults: number;
  total: number;
  worklogs: JiraWorklog[];
}

// ── Fields ──────────────────────────────────────────────────────────────────────

/** Schema descriptor for a field (mirror of `JiraFieldSchema`). `type` is the
 *  renamed Rust `field_type`; `customId` is renamed. */
export interface JiraFieldSchema {
  type?: string | null;
  system?: string | null;
  custom?: string | null;
  customId?: number | null;
}

/** A Jira field definition (mirror of `JiraField`). `clauseNames` is renamed
 *  (Rust `clause_names`); everything else is plain snake_case that happens to be
 *  single-word. */
export interface JiraField {
  id?: string | null;
  name?: string | null;
  custom?: boolean | null;
  orderable?: boolean | null;
  navigable?: boolean | null;
  searchable?: boolean | null;
  clauseNames: string[];
  schema?: JiraFieldSchema | null;
}
