// Jira integration — `agile` category domain types (t42-jira-c2).
//
// Mirror of the projects / boards / sprints / dashboards / filters structs in
// `src-tauri/crates/sorng-jira/src/types.rs`. This file is DISJOINT from
// `./issues.ts`: it declares only the request/response entities this category
// owns. Shared core + reference types (`JiraUser`, `JiraIssueType`,
// `JiraSearchResponse`) are LEAD-owned in `./index.ts` — imported here, never
// redefined.
//
// SERDE CONVENTION (read `.orchestration/logs/t42-jira-categories.md`): this crate
// carries NO `#[serde(rename_all)]`. Each field is mirrored against its real WIRE
// name — a MIX of snake_case defaults and per-field `#[serde(rename)]` camelCase.
// Footguns mirrored below with care:
//   • `CreateProjectRequest.lead_account_id` stays snake_case (NO rename), while
//     its siblings `projectTypeKey` / `assigneeType` are renamed camelCase.
//   • `JiraBoard.type` is the wire name of the Rust `board_type` field.
//   • `*Response` paging fields (`startAt` / `maxResults` / `isLast`) are all
//     renamed camelCase; note `BoardsResponse.total` is nullable and
//     `SprintsResponse` has NO `total` field.
//   • Entity `self` mirrors the Rust `self_url` (renamed "self").

import type { JiraUser, JiraIssueType } from "./index";

// ── Projects ─────────────────────────────────────────────────────────────────

/** A Jira project (mirror of `JiraProject`). `self` is the Rust `self_url`;
 *  `projectTypeKey` / `avatarUrls` / `issueTypes` are renamed camelCase. */
export interface JiraProject {
  self?: string;
  id?: string | null;
  key?: string | null;
  name?: string | null;
  description?: string | null;
  lead?: JiraUser | null;
  projectTypeKey?: string | null;
  avatarUrls?: Record<string, string> | null;
  issueTypes: JiraIssueType[];
  url?: string | null;
  archived: boolean;
}

/** Payload for `jira_create_project` (mirror of `CreateProjectRequest`). NOTE the
 *  mixed casing: `projectTypeKey` / `assigneeType` are renamed camelCase, but
 *  `lead_account_id` keeps its snake_case wire name (NO rename). */
export interface CreateProjectRequest {
  key: string;
  name: string;
  projectTypeKey: string;
  lead_account_id?: string;
  description?: string;
  url?: string;
  assigneeType?: string;
}

// ── Boards ───────────────────────────────────────────────────────────────────

/** Where a board lives (mirror of `BoardLocation`; all fields renamed camelCase). */
export interface BoardLocation {
  projectId?: number | null;
  displayName?: string | null;
  projectName?: string | null;
  projectKey?: string | null;
}

/** An agile board (mirror of `JiraBoard`). `id` is an i64 (pass as `number`);
 *  `type` is the wire name of the Rust `board_type` field. */
export interface JiraBoard {
  id: number;
  self?: string;
  name?: string | null;
  type?: string | null;
  location?: BoardLocation | null;
}

/** A page of boards (mirror of `BoardsResponse`). `total` is nullable here. */
export interface BoardsResponse {
  maxResults: number;
  startAt: number;
  total?: number | null;
  isLast: boolean;
  values: JiraBoard[];
}

// ── Sprints ──────────────────────────────────────────────────────────────────

/** A sprint (mirror of `JiraSprint`). `id` / `originBoardId` are i64 (`number`);
 *  `startDate` / `endDate` / `completeDate` / `originBoardId` renamed camelCase. */
export interface JiraSprint {
  id: number;
  self?: string;
  name?: string | null;
  state?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  completeDate?: string | null;
  originBoardId?: number | null;
  goal?: string | null;
}

/** A page of sprints (mirror of `SprintsResponse`). NOTE: no `total` field. */
export interface SprintsResponse {
  maxResults: number;
  startAt: number;
  isLast: boolean;
  values: JiraSprint[];
}

/** Payload for `jira_create_sprint` (mirror of `CreateSprintRequest`).
 *  `originBoardId` is required (i64); `startDate` / `endDate` renamed camelCase. */
export interface CreateSprintRequest {
  name: string;
  originBoardId: number;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

/** Payload for `jira_update_sprint` (mirror of `UpdateSprintRequest`). All
 *  optional; `startDate` / `endDate` renamed camelCase (`state` drives
 *  start/complete when set to "active"/"closed"). */
export interface UpdateSprintRequest {
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

/** Payload for `jira_move_issues_to_sprint` (mirror of `MoveIssuesToSprintRequest`). */
export interface MoveIssuesToSprintRequest {
  issues: string[];
}

// ── Dashboards ───────────────────────────────────────────────────────────────

/** A dashboard (mirror of `JiraDashboard`). `isFavourite` renamed camelCase. */
export interface JiraDashboard {
  id?: string | null;
  self?: string;
  name?: string | null;
  owner?: JiraUser | null;
  isFavourite?: boolean | null;
  popularity?: number | null;
  view?: string | null;
}

/** A page of dashboards (mirror of `DashboardsResponse`). */
export interface DashboardsResponse {
  startAt: number;
  maxResults: number;
  total: number;
  dashboards: JiraDashboard[];
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** A saved filter (mirror of `JiraFilter`). `viewUrl` / `searchUrl` renamed
 *  camelCase; `self` is the Rust `self_url`. */
export interface JiraFilter {
  self?: string;
  id?: string | null;
  name?: string | null;
  description?: string | null;
  jql?: string | null;
  owner?: JiraUser | null;
  viewUrl?: string | null;
  searchUrl?: string | null;
  favourite?: boolean | null;
}

/** Payload for `jira_create_filter` (mirror of `CreateFilterRequest`). */
export interface CreateFilterRequest {
  name: string;
  jql: string;
  description?: string;
  favourite?: boolean;
}

/** Payload for `jira_update_filter` (mirror of `UpdateFilterRequest`). All optional. */
export interface UpdateFilterRequest {
  name?: string;
  jql?: string;
  description?: string;
  favourite?: boolean;
}
