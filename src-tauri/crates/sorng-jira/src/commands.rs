// ── sorng-jira/src/commands.rs ─────────────────────────────────────────────────
use crate::service::JiraServiceState;
use crate::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;
fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_connect(
    state: State<'_, JiraServiceState>,
    id: String,
    config: JiraConnectionConfig,
) -> CmdResult<JiraConnectionStatus> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_disconnect(state: State<'_, JiraServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn jira_list_connections(state: State<'_, JiraServiceState>) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn jira_ping(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<JiraConnectionStatus> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Issues ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_get_issue(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    expand: Option<String>,
) -> CmdResult<JiraIssue> {
    state
        .lock()
        .await
        .get_issue(&id, &issue_key, expand)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_create_issue(
    state: State<'_, JiraServiceState>,
    id: String,
    request: CreateIssueRequest,
) -> CmdResult<JiraIssue> {
    state
        .lock()
        .await
        .create_issue(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_bulk_create_issues(
    state: State<'_, JiraServiceState>,
    id: String,
    request: BulkCreateIssueRequest,
) -> CmdResult<BulkCreateIssueResponse> {
    state
        .lock()
        .await
        .bulk_create_issues(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_update_issue(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    request: UpdateIssueRequest,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_issue(&id, &issue_key, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_delete_issue(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    delete_subtasks: Option<bool>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_issue(&id, &issue_key, delete_subtasks.unwrap_or(false))
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_search_issues(
    state: State<'_, JiraServiceState>,
    id: String,
    request: JiraSearchRequest,
) -> CmdResult<JiraSearchResponse> {
    state
        .lock()
        .await
        .search_issues(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_transitions(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
) -> CmdResult<Vec<JiraTransition>> {
    state
        .lock()
        .await
        .get_transitions(&id, &issue_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_transition_issue(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    request: TransitionRequest,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .transition_issue(&id, &issue_key, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_assign_issue(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    account_id: Option<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .assign_issue(&id, &issue_key, account_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_issue_changelog(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
) -> CmdResult<Vec<JiraChangelogEntry>> {
    state
        .lock()
        .await
        .get_issue_changelog(&id, &issue_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_link_issues(
    state: State<'_, JiraServiceState>,
    id: String,
    link_type: String,
    inward_key: String,
    outward_key: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .link_issues(&id, link_type, inward_key, outward_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_watchers(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
) -> CmdResult<Vec<JiraUser>> {
    state
        .lock()
        .await
        .get_watchers(&id, &issue_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_add_watcher(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    account_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_watcher(&id, &issue_key, account_id)
        .await
        .map_err(map_err)
}

// ── Projects ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_projects(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<JiraProject>> {
    state.lock().await.list_projects(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_project(
    state: State<'_, JiraServiceState>,
    id: String,
    project_key: String,
) -> CmdResult<JiraProject> {
    state
        .lock()
        .await
        .get_project(&id, &project_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_create_project(
    state: State<'_, JiraServiceState>,
    id: String,
    request: CreateProjectRequest,
) -> CmdResult<JiraProject> {
    state
        .lock()
        .await
        .create_project(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_delete_project(
    state: State<'_, JiraServiceState>,
    id: String,
    project_key: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_project(&id, &project_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_project_statuses(
    state: State<'_, JiraServiceState>,
    id: String,
    project_key: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state
        .lock()
        .await
        .get_project_statuses(&id, &project_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_project_components(
    state: State<'_, JiraServiceState>,
    id: String,
    project_key: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state
        .lock()
        .await
        .get_project_components(&id, &project_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_project_versions(
    state: State<'_, JiraServiceState>,
    id: String,
    project_key: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state
        .lock()
        .await
        .get_project_versions(&id, &project_key)
        .await
        .map_err(map_err)
}

// ── Comments ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_comments(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    start_at: Option<u32>,
    max_results: Option<u32>,
) -> CmdResult<CommentsResponse> {
    state
        .lock()
        .await
        .list_comments(&id, &issue_key, start_at, max_results)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_comment(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    comment_id: String,
) -> CmdResult<JiraComment> {
    state
        .lock()
        .await
        .get_comment(&id, &issue_key, &comment_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_add_comment(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    request: AddCommentRequest,
) -> CmdResult<JiraComment> {
    state
        .lock()
        .await
        .add_comment(&id, &issue_key, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_update_comment(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    comment_id: String,
    request: AddCommentRequest,
) -> CmdResult<JiraComment> {
    state
        .lock()
        .await
        .update_comment(&id, &issue_key, &comment_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_delete_comment(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    comment_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_comment(&id, &issue_key, &comment_id)
        .await
        .map_err(map_err)
}

// ── Attachments ───────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_attachments(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
) -> CmdResult<Vec<JiraAttachment>> {
    state
        .lock()
        .await
        .list_attachments(&id, &issue_key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_attachment(
    state: State<'_, JiraServiceState>,
    id: String,
    attachment_id: String,
) -> CmdResult<JiraAttachment> {
    state
        .lock()
        .await
        .get_attachment(&id, &attachment_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_add_attachment(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    filename: String,
    data_base64: String,
) -> CmdResult<Vec<JiraAttachment>> {
    state
        .lock()
        .await
        .add_attachment(&id, &issue_key, filename, data_base64)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_delete_attachment(
    state: State<'_, JiraServiceState>,
    id: String,
    attachment_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_attachment(&id, &attachment_id)
        .await
        .map_err(map_err)
}

// ── Worklogs ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_worklogs(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    start_at: Option<u32>,
    max_results: Option<u32>,
) -> CmdResult<WorklogsResponse> {
    state
        .lock()
        .await
        .list_worklogs(&id, &issue_key, start_at, max_results)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_worklog(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    worklog_id: String,
) -> CmdResult<JiraWorklog> {
    state
        .lock()
        .await
        .get_worklog(&id, &issue_key, &worklog_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_add_worklog(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    request: AddWorklogRequest,
) -> CmdResult<JiraWorklog> {
    state
        .lock()
        .await
        .add_worklog(&id, &issue_key, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_update_worklog(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    worklog_id: String,
    request: AddWorklogRequest,
) -> CmdResult<JiraWorklog> {
    state
        .lock()
        .await
        .update_worklog(&id, &issue_key, &worklog_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_delete_worklog(
    state: State<'_, JiraServiceState>,
    id: String,
    issue_key: String,
    worklog_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_worklog(&id, &issue_key, &worklog_id)
        .await
        .map_err(map_err)
}

// ── Boards ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_boards(
    state: State<'_, JiraServiceState>,
    id: String,
    start_at: Option<u32>,
    max_results: Option<u32>,
    project_key: Option<String>,
    board_type: Option<String>,
) -> CmdResult<BoardsResponse> {
    state
        .lock()
        .await
        .list_boards(&id, start_at, max_results, project_key, board_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_board(
    state: State<'_, JiraServiceState>,
    id: String,
    board_id: i64,
) -> CmdResult<JiraBoard> {
    state
        .lock()
        .await
        .get_board(&id, board_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_board_issues(
    state: State<'_, JiraServiceState>,
    id: String,
    board_id: i64,
    start_at: Option<u32>,
    max_results: Option<u32>,
    jql: Option<String>,
) -> CmdResult<JiraSearchResponse> {
    state
        .lock()
        .await
        .get_board_issues(&id, board_id, start_at, max_results, jql)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_board_backlog(
    state: State<'_, JiraServiceState>,
    id: String,
    board_id: i64,
    start_at: Option<u32>,
    max_results: Option<u32>,
) -> CmdResult<JiraSearchResponse> {
    state
        .lock()
        .await
        .get_board_backlog(&id, board_id, start_at, max_results)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_board_configuration(
    state: State<'_, JiraServiceState>,
    id: String,
    board_id: i64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .get_board_configuration(&id, board_id)
        .await
        .map_err(map_err)
}

// ── Sprints ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_sprints(
    state: State<'_, JiraServiceState>,
    id: String,
    board_id: i64,
    start_at: Option<u32>,
    max_results: Option<u32>,
    sprint_state: Option<String>,
) -> CmdResult<SprintsResponse> {
    state
        .lock()
        .await
        .list_sprints(&id, board_id, start_at, max_results, sprint_state)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_sprint(
    state: State<'_, JiraServiceState>,
    id: String,
    sprint_id: i64,
) -> CmdResult<JiraSprint> {
    state
        .lock()
        .await
        .get_sprint(&id, sprint_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_create_sprint(
    state: State<'_, JiraServiceState>,
    id: String,
    request: CreateSprintRequest,
) -> CmdResult<JiraSprint> {
    state
        .lock()
        .await
        .create_sprint(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_update_sprint(
    state: State<'_, JiraServiceState>,
    id: String,
    sprint_id: i64,
    request: UpdateSprintRequest,
) -> CmdResult<JiraSprint> {
    state
        .lock()
        .await
        .update_sprint(&id, sprint_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_delete_sprint(
    state: State<'_, JiraServiceState>,
    id: String,
    sprint_id: i64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_sprint(&id, sprint_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_sprint_issues(
    state: State<'_, JiraServiceState>,
    id: String,
    sprint_id: i64,
    start_at: Option<u32>,
    max_results: Option<u32>,
) -> CmdResult<JiraSearchResponse> {
    state
        .lock()
        .await
        .get_sprint_issues(&id, sprint_id, start_at, max_results)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_move_issues_to_sprint(
    state: State<'_, JiraServiceState>,
    id: String,
    sprint_id: i64,
    request: MoveIssuesToSprintRequest,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .move_issues_to_sprint(&id, sprint_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_start_sprint(
    state: State<'_, JiraServiceState>,
    id: String,
    sprint_id: i64,
) -> CmdResult<JiraSprint> {
    state
        .lock()
        .await
        .start_sprint(&id, sprint_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_complete_sprint(
    state: State<'_, JiraServiceState>,
    id: String,
    sprint_id: i64,
) -> CmdResult<JiraSprint> {
    state
        .lock()
        .await
        .complete_sprint(&id, sprint_id)
        .await
        .map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_get_myself(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<JiraUser> {
    state.lock().await.get_myself(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_user(
    state: State<'_, JiraServiceState>,
    id: String,
    account_id: String,
) -> CmdResult<JiraUser> {
    state
        .lock()
        .await
        .get_user(&id, &account_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_search_users(
    state: State<'_, JiraServiceState>,
    id: String,
    query: String,
    start_at: Option<u32>,
    max_results: Option<u32>,
) -> CmdResult<Vec<JiraUser>> {
    state
        .lock()
        .await
        .search_users(&id, query, start_at, max_results)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_find_assignable_users(
    state: State<'_, JiraServiceState>,
    id: String,
    project: String,
    query: Option<String>,
) -> CmdResult<Vec<JiraUser>> {
    state
        .lock()
        .await
        .find_assignable_users(&id, project, query)
        .await
        .map_err(map_err)
}

// ── Fields ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_fields(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<JiraField>> {
    state.lock().await.list_fields(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_all_issue_types(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<JiraIssueType>> {
    state
        .lock()
        .await
        .get_all_issue_types(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_priorities(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<JiraPriority>> {
    state
        .lock()
        .await
        .get_priorities(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_statuses(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<JiraStatus>> {
    state.lock().await.get_statuses(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_resolutions(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state
        .lock()
        .await
        .get_resolutions(&id)
        .await
        .map_err(map_err)
}

// ── Dashboards ────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_list_dashboards(
    state: State<'_, JiraServiceState>,
    id: String,
    start_at: Option<u32>,
    max_results: Option<u32>,
) -> CmdResult<DashboardsResponse> {
    state
        .lock()
        .await
        .list_dashboards(&id, start_at, max_results)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_dashboard(
    state: State<'_, JiraServiceState>,
    id: String,
    dashboard_id: String,
) -> CmdResult<JiraDashboard> {
    state
        .lock()
        .await
        .get_dashboard(&id, &dashboard_id)
        .await
        .map_err(map_err)
}

// ── Filters ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn jira_get_filter(
    state: State<'_, JiraServiceState>,
    id: String,
    filter_id: String,
) -> CmdResult<JiraFilter> {
    state
        .lock()
        .await
        .get_filter(&id, &filter_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_favourite_filters(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<JiraFilter>> {
    state
        .lock()
        .await
        .get_favourite_filters(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_get_my_filters(
    state: State<'_, JiraServiceState>,
    id: String,
) -> CmdResult<Vec<JiraFilter>> {
    state
        .lock()
        .await
        .get_my_filters(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_create_filter(
    state: State<'_, JiraServiceState>,
    id: String,
    request: CreateFilterRequest,
) -> CmdResult<JiraFilter> {
    state
        .lock()
        .await
        .create_filter(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_update_filter(
    state: State<'_, JiraServiceState>,
    id: String,
    filter_id: String,
    request: UpdateFilterRequest,
) -> CmdResult<JiraFilter> {
    state
        .lock()
        .await
        .update_filter(&id, &filter_id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn jira_delete_filter(
    state: State<'_, JiraServiceState>,
    id: String,
    filter_id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_filter(&id, &filter_id)
        .await
        .map_err(map_err)
}
