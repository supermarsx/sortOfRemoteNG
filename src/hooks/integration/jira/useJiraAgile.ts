// useJiraAgile — real Tauri `invoke(...)` wrappers for the sorng-jira `agile`
// category (t42-jira-c2): projects, boards, sprints, dashboards, filters — 29
// commands total.
//
// Pairs 1:1 with the "Projects", "Boards", "Sprints", "Dashboards" and "Filters"
// command blocks in `src-tauri/crates/sorng-jira/src/commands.rs`.
//
// Every command takes the connection `id` as its first argument (the shell's live
// `connectionId`, passed into the tab as `JiraTabProps.connectionId`). Top-level
// arg keys follow Tauri's camelCase convention (`projectKey`, `boardId`,
// `sprintId`, …); request-bearing commands pass the struct as `request`. Struct
// FIELD casing is a per-field mix — see `../../../types/jira/agile`. Board/sprint
// ids are Rust i64 → pass a JS `number`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { JiraSearchResponse } from "../../../types/jira";
import type {
  BoardsResponse,
  CreateFilterRequest,
  CreateProjectRequest,
  CreateSprintRequest,
  DashboardsResponse,
  JiraBoard,
  JiraDashboard,
  JiraFilter,
  JiraProject,
  JiraSprint,
  MoveIssuesToSprintRequest,
  SprintsResponse,
  UpdateFilterRequest,
  UpdateSprintRequest,
} from "../../../types/jira/agile";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const jiraAgileApi = {
  // ── Projects (7) ──────────────────────────────────────────────────────────--
  listProjects: (id: string) =>
    invoke<JiraProject[]>("jira_list_projects", { id }),
  getProject: (id: string, projectKey: string) =>
    invoke<JiraProject>("jira_get_project", { id, projectKey }),
  createProject: (id: string, request: CreateProjectRequest) =>
    invoke<JiraProject>("jira_create_project", { id, request }),
  deleteProject: (id: string, projectKey: string) =>
    invoke<void>("jira_delete_project", { id, projectKey }),
  getProjectStatuses: (id: string, projectKey: string) =>
    invoke<unknown[]>("jira_get_project_statuses", { id, projectKey }),
  getProjectComponents: (id: string, projectKey: string) =>
    invoke<unknown[]>("jira_get_project_components", { id, projectKey }),
  getProjectVersions: (id: string, projectKey: string) =>
    invoke<unknown[]>("jira_get_project_versions", { id, projectKey }),

  // ── Boards (5) ────────────────────────────────────────────────────────────--
  listBoards: (
    id: string,
    startAt?: number,
    maxResults?: number,
    projectKey?: string,
    boardType?: string,
  ) =>
    invoke<BoardsResponse>("jira_list_boards", {
      id,
      startAt,
      maxResults,
      projectKey,
      boardType,
    }),
  getBoard: (id: string, boardId: number) =>
    invoke<JiraBoard>("jira_get_board", { id, boardId }),
  getBoardIssues: (
    id: string,
    boardId: number,
    startAt?: number,
    maxResults?: number,
    jql?: string,
  ) =>
    invoke<JiraSearchResponse>("jira_get_board_issues", {
      id,
      boardId,
      startAt,
      maxResults,
      jql,
    }),
  getBoardBacklog: (
    id: string,
    boardId: number,
    startAt?: number,
    maxResults?: number,
  ) =>
    invoke<JiraSearchResponse>("jira_get_board_backlog", {
      id,
      boardId,
      startAt,
      maxResults,
    }),
  getBoardConfiguration: (id: string, boardId: number) =>
    invoke<unknown>("jira_get_board_configuration", { id, boardId }),

  // ── Sprints (9) ───────────────────────────────────────────────────────────--
  listSprints: (
    id: string,
    boardId: number,
    startAt?: number,
    maxResults?: number,
    sprintState?: string,
  ) =>
    invoke<SprintsResponse>("jira_list_sprints", {
      id,
      boardId,
      startAt,
      maxResults,
      sprintState,
    }),
  getSprint: (id: string, sprintId: number) =>
    invoke<JiraSprint>("jira_get_sprint", { id, sprintId }),
  createSprint: (id: string, request: CreateSprintRequest) =>
    invoke<JiraSprint>("jira_create_sprint", { id, request }),
  updateSprint: (id: string, sprintId: number, request: UpdateSprintRequest) =>
    invoke<JiraSprint>("jira_update_sprint", { id, sprintId, request }),
  deleteSprint: (id: string, sprintId: number) =>
    invoke<void>("jira_delete_sprint", { id, sprintId }),
  getSprintIssues: (
    id: string,
    sprintId: number,
    startAt?: number,
    maxResults?: number,
  ) =>
    invoke<JiraSearchResponse>("jira_get_sprint_issues", {
      id,
      sprintId,
      startAt,
      maxResults,
    }),
  moveIssuesToSprint: (
    id: string,
    sprintId: number,
    request: MoveIssuesToSprintRequest,
  ) => invoke<void>("jira_move_issues_to_sprint", { id, sprintId, request }),
  startSprint: (id: string, sprintId: number) =>
    invoke<JiraSprint>("jira_start_sprint", { id, sprintId }),
  completeSprint: (id: string, sprintId: number) =>
    invoke<JiraSprint>("jira_complete_sprint", { id, sprintId }),

  // ── Dashboards (2) ────────────────────────────────────────────────────────--
  listDashboards: (id: string, startAt?: number, maxResults?: number) =>
    invoke<DashboardsResponse>("jira_list_dashboards", {
      id,
      startAt,
      maxResults,
    }),
  getDashboard: (id: string, dashboardId: string) =>
    invoke<JiraDashboard>("jira_get_dashboard", { id, dashboardId }),

  // ── Filters (6) ───────────────────────────────────────────────────────────--
  getFilter: (id: string, filterId: string) =>
    invoke<JiraFilter>("jira_get_filter", { id, filterId }),
  getFavouriteFilters: (id: string) =>
    invoke<JiraFilter[]>("jira_get_favourite_filters", { id }),
  getMyFilters: (id: string) =>
    invoke<JiraFilter[]>("jira_get_my_filters", { id }),
  createFilter: (id: string, request: CreateFilterRequest) =>
    invoke<JiraFilter>("jira_create_filter", { id, request }),
  updateFilter: (id: string, filterId: string, request: UpdateFilterRequest) =>
    invoke<JiraFilter>("jira_update_filter", { id, filterId, request }),
  deleteFilter: (id: string, filterId: string) =>
    invoke<void>("jira_delete_filter", { id, filterId }),
};

export type JiraAgileApi = typeof jiraAgileApi;

// ─── React hook ─────────────────────────────────────────────────────────────--

/**
 * Loading/error lifecycle for the Jira Projects & Agile tab. `run` wraps any
 * `jiraAgileApi` call, tracking `isLoading` and surfacing errors with the shared
 * error idiom (Tauri rejects with a plain string); it resolves to the value, or
 * `undefined` on failure.
 */
export function useJiraAgile() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(fn: (api: JiraAgileApi) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(jiraAgileApi);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { api: jiraAgileApi, run, isLoading, error, clearError };
}

export type JiraAgileManager = ReturnType<typeof useJiraAgile>;
