// Jira integration hooks — barrel (t42 §4b, crate lead t42-jira-L).
//
// The connection lifecycle (jira_connect/disconnect/list_connections/ping) is
// owned by the shell and lives in `useJiraConnection`. The per-category invoke
// slices + hooks (`useJiraIssues`, `useJiraAgile`) are added by the category
// executors; their re-exports are appended to the marked region below by the
// per-crate integrator.

export * from "./useJiraConnection";

// ── category hook re-exports (appended by the per-crate integrator) ──────────
// export * from "./useJiraIssues";
// export * from "./useJiraAgile";
