// Jira `issues` invoke slice + hook — Issues, Comments, Attachments, Worklogs,
// Users and Fields (t42-jira-c1).
//
// `jiraIssuesApi` is a thin 1:1 wrapper over the 36 c1 `jira_*` commands. Every
// command's first arg is the live connection `id` (the shell's `connectionId`).
// Command PARAM names follow Tauri's camelCase convention (`issueKey`,
// `deleteSubtasks`, `accountId`, `dataBase64`, …) per the arg tables in
// `.orchestration/logs/t42-jira-categories.md`. Request-bearing commands pass the
// body as `request` (NOT `req` — that was the cPanel crate's convention).
//
// Request/response STRUCT field names are MIXED snake+camel with per-field serde
// renames — see `../../../types/jira/issues`. Shared core types come from the
// lead-owned barrel `../../../types/jira`.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  JiraUser,
  JiraIssue,
  JiraSearchResponse,
  JiraTransition,
  JiraChangelogEntry,
  JiraIssueType,
  JiraPriority,
  JiraStatus,
} from "../../../types/jira";
import type {
  AddCommentRequest,
  AddWorklogRequest,
  BulkCreateIssueRequest,
  BulkCreateIssueResponse,
  CommentsResponse,
  CreateIssueRequest,
  JiraAttachment,
  JiraComment,
  JiraField,
  JiraSearchRequest,
  JiraWorklog,
  TransitionRequest,
  UpdateIssueRequest,
  WorklogsResponse,
} from "../../../types/jira/issues";

export const jiraIssuesApi = {
  // ── Issues (13) ────────────────────────────────────────────────
  getIssue: (id: string, issueKey: string, expand?: string) =>
    invoke<JiraIssue>("jira_get_issue", { id, issueKey, expand }),
  createIssue: (id: string, request: CreateIssueRequest) =>
    invoke<JiraIssue>("jira_create_issue", { id, request }),
  bulkCreateIssues: (id: string, request: BulkCreateIssueRequest) =>
    invoke<BulkCreateIssueResponse>("jira_bulk_create_issues", { id, request }),
  updateIssue: (id: string, issueKey: string, request: UpdateIssueRequest) =>
    invoke<void>("jira_update_issue", { id, issueKey, request }),
  deleteIssue: (id: string, issueKey: string, deleteSubtasks?: boolean) =>
    invoke<void>("jira_delete_issue", { id, issueKey, deleteSubtasks }),
  searchIssues: (id: string, request: JiraSearchRequest) =>
    invoke<JiraSearchResponse>("jira_search_issues", { id, request }),
  getTransitions: (id: string, issueKey: string) =>
    invoke<JiraTransition[]>("jira_get_transitions", { id, issueKey }),
  transitionIssue: (id: string, issueKey: string, request: TransitionRequest) =>
    invoke<void>("jira_transition_issue", { id, issueKey, request }),
  assignIssue: (id: string, issueKey: string, accountId?: string) =>
    invoke<void>("jira_assign_issue", { id, issueKey, accountId }),
  getIssueChangelog: (id: string, issueKey: string) =>
    invoke<JiraChangelogEntry[]>("jira_get_issue_changelog", { id, issueKey }),
  // No request struct — four plain args (link type + both issue keys).
  linkIssues: (
    id: string,
    linkType: string,
    inwardKey: string,
    outwardKey: string,
  ) =>
    invoke<void>("jira_link_issues", { id, linkType, inwardKey, outwardKey }),
  getWatchers: (id: string, issueKey: string) =>
    invoke<JiraUser[]>("jira_get_watchers", { id, issueKey }),
  addWatcher: (id: string, issueKey: string, accountId: string) =>
    invoke<void>("jira_add_watcher", { id, issueKey, accountId }),

  // ── Comments (5) ───────────────────────────────────────────────
  listComments: (
    id: string,
    issueKey: string,
    startAt?: number,
    maxResults?: number,
  ) =>
    invoke<CommentsResponse>("jira_list_comments", {
      id,
      issueKey,
      startAt,
      maxResults,
    }),
  getComment: (id: string, issueKey: string, commentId: string) =>
    invoke<JiraComment>("jira_get_comment", { id, issueKey, commentId }),
  addComment: (id: string, issueKey: string, request: AddCommentRequest) =>
    invoke<JiraComment>("jira_add_comment", { id, issueKey, request }),
  updateComment: (
    id: string,
    issueKey: string,
    commentId: string,
    request: AddCommentRequest,
  ) =>
    invoke<JiraComment>("jira_update_comment", {
      id,
      issueKey,
      commentId,
      request,
    }),
  deleteComment: (id: string, issueKey: string, commentId: string) =>
    invoke<void>("jira_delete_comment", { id, issueKey, commentId }),

  // ── Attachments (4) ────────────────────────────────────────────
  listAttachments: (id: string, issueKey: string) =>
    invoke<JiraAttachment[]>("jira_list_attachments", { id, issueKey }),
  getAttachment: (id: string, attachmentId: string) =>
    invoke<JiraAttachment>("jira_get_attachment", { id, attachmentId }),
  // `dataBase64` is a base64-encoded file body; returns the updated list.
  addAttachment: (
    id: string,
    issueKey: string,
    filename: string,
    dataBase64: string,
  ) =>
    invoke<JiraAttachment[]>("jira_add_attachment", {
      id,
      issueKey,
      filename,
      dataBase64,
    }),
  deleteAttachment: (id: string, attachmentId: string) =>
    invoke<void>("jira_delete_attachment", { id, attachmentId }),

  // ── Worklogs (5) ───────────────────────────────────────────────
  listWorklogs: (
    id: string,
    issueKey: string,
    startAt?: number,
    maxResults?: number,
  ) =>
    invoke<WorklogsResponse>("jira_list_worklogs", {
      id,
      issueKey,
      startAt,
      maxResults,
    }),
  getWorklog: (id: string, issueKey: string, worklogId: string) =>
    invoke<JiraWorklog>("jira_get_worklog", { id, issueKey, worklogId }),
  addWorklog: (id: string, issueKey: string, request: AddWorklogRequest) =>
    invoke<JiraWorklog>("jira_add_worklog", { id, issueKey, request }),
  updateWorklog: (
    id: string,
    issueKey: string,
    worklogId: string,
    request: AddWorklogRequest,
  ) =>
    invoke<JiraWorklog>("jira_update_worklog", {
      id,
      issueKey,
      worklogId,
      request,
    }),
  deleteWorklog: (id: string, issueKey: string, worklogId: string) =>
    invoke<void>("jira_delete_worklog", { id, issueKey, worklogId }),

  // ── Users (4) ──────────────────────────────────────────────────
  getMyself: (id: string) => invoke<JiraUser>("jira_get_myself", { id }),
  getUser: (id: string, accountId: string) =>
    invoke<JiraUser>("jira_get_user", { id, accountId }),
  searchUsers: (
    id: string,
    query: string,
    startAt?: number,
    maxResults?: number,
  ) =>
    invoke<JiraUser[]>("jira_search_users", {
      id,
      query,
      startAt,
      maxResults,
    }),
  findAssignableUsers: (id: string, project: string, query?: string) =>
    invoke<JiraUser[]>("jira_find_assignable_users", { id, project, query }),

  // ── Fields (5) ─────────────────────────────────────────────────
  listFields: (id: string) => invoke<JiraField[]>("jira_list_fields", { id }),
  getAllIssueTypes: (id: string) =>
    invoke<JiraIssueType[]>("jira_get_all_issue_types", { id }),
  getPriorities: (id: string) =>
    invoke<JiraPriority[]>("jira_get_priorities", { id }),
  getStatuses: (id: string) => invoke<JiraStatus[]>("jira_get_statuses", { id }),
  // Returns `serde_json::Value` server-side → opaque list.
  getResolutions: (id: string) =>
    invoke<unknown[]>("jira_get_resolutions", { id }),
};

export type JiraIssuesApi = typeof jiraIssuesApi;

/**
 * Convenience hook for the Issues tab. Exposes the invoke slice plus shared
 * `isLoading`/`error` state and a `run` helper that binds the live
 * `connectionId`, wraps a call, and funnels failures into `error`
 * (`typeof e === 'string' ? e : (e as Error).message`).
 */
export function useJiraIssues(connectionId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: (id: string) => Promise<T>): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn(connectionId);
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId],
  );

  return {
    api: jiraIssuesApi,
    connectionId,
    isLoading,
    error,
    setError,
    run,
  };
}

export type UseJiraIssues = ReturnType<typeof useJiraIssues>;
