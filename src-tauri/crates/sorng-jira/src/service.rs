// ── sorng-jira/src/service.rs ──────────────────────────────────────────────────
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::JiraClient;
use crate::error::{JiraError, JiraResult};
use crate::types::*;

use crate::issues::IssueManager;
use crate::projects::ProjectManager;
use crate::comments::CommentManager;
use crate::attachments::AttachmentManager;
use crate::worklogs::WorklogManager;
use crate::boards::BoardManager;
use crate::sprints::SprintManager;
use crate::users::JiraUserManager;
use crate::fields::FieldManager;
use crate::dashboards::DashboardManager;
use crate::filters::FilterManager;

pub type JiraServiceState = Arc<Mutex<JiraService>>;

pub struct JiraService {
    connections: HashMap<String, JiraClient>,
}

impl JiraService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: JiraConnectionConfig) -> JiraResult<JiraConnectionStatus> {
        let client = JiraClient::from_config(&config)?;
        let status = client.ping().await?;
        self.connections.insert(id, client);
        Ok(status)
    }

    pub fn disconnect(&mut self, id: &str) -> JiraResult<()> {
        self.connections.remove(id).map(|_| ())
            .ok_or_else(|| JiraError::session(&format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> JiraResult<&JiraClient> {
        self.connections.get(id)
            .ok_or_else(|| JiraError::session(&format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> JiraResult<JiraConnectionStatus> {
        self.client(id)?.ping().await
    }

    // ── Issues ───────────────────────────────────────────────────

    pub async fn get_issue(&self, id: &str, issue_key: &str, expand: Option<String>) -> JiraResult<JiraIssue> {
        IssueManager::get(self.client(id)?, issue_key, expand.as_deref()).await
    }

    pub async fn create_issue(&self, id: &str, req: CreateIssueRequest) -> JiraResult<JiraIssue> {
        IssueManager::create(self.client(id)?, &req).await
    }

    pub async fn bulk_create_issues(&self, id: &str, req: BulkCreateIssueRequest) -> JiraResult<BulkCreateIssueResponse> {
        IssueManager::bulk_create(self.client(id)?, &req).await
    }

    pub async fn update_issue(&self, id: &str, issue_key: &str, req: UpdateIssueRequest) -> JiraResult<()> {
        IssueManager::update(self.client(id)?, issue_key, &req).await
    }

    pub async fn delete_issue(&self, id: &str, issue_key: &str, delete_subtasks: bool) -> JiraResult<()> {
        IssueManager::delete(self.client(id)?, issue_key, delete_subtasks).await
    }

    pub async fn search_issues(&self, id: &str, req: JiraSearchRequest) -> JiraResult<JiraSearchResponse> {
        IssueManager::search(self.client(id)?, &req).await
    }

    pub async fn get_transitions(&self, id: &str, issue_key: &str) -> JiraResult<Vec<JiraTransition>> {
        IssueManager::get_transitions(self.client(id)?, issue_key).await
    }

    pub async fn transition_issue(&self, id: &str, issue_key: &str, req: TransitionRequest) -> JiraResult<()> {
        IssueManager::transition(self.client(id)?, issue_key, &req).await
    }

    pub async fn assign_issue(&self, id: &str, issue_key: &str, account_id: Option<String>) -> JiraResult<()> {
        IssueManager::assign(self.client(id)?, issue_key, account_id.as_deref()).await
    }

    pub async fn get_issue_changelog(&self, id: &str, issue_key: &str) -> JiraResult<Vec<JiraChangelogEntry>> {
        IssueManager::get_changelog(self.client(id)?, issue_key).await
    }

    pub async fn link_issues(&self, id: &str, link_type: String, inward_key: String, outward_key: String) -> JiraResult<()> {
        IssueManager::link(self.client(id)?, &link_type, &inward_key, &outward_key).await
    }

    pub async fn get_watchers(&self, id: &str, issue_key: &str) -> JiraResult<Vec<JiraUser>> {
        IssueManager::get_watchers(self.client(id)?, issue_key).await
    }

    pub async fn add_watcher(&self, id: &str, issue_key: &str, account_id: String) -> JiraResult<()> {
        IssueManager::add_watcher(self.client(id)?, issue_key, &account_id).await
    }

    // ── Projects ─────────────────────────────────────────────────

    pub async fn list_projects(&self, id: &str) -> JiraResult<Vec<JiraProject>> {
        ProjectManager::list(self.client(id)?).await
    }

    pub async fn get_project(&self, id: &str, project_key: &str) -> JiraResult<JiraProject> {
        ProjectManager::get(self.client(id)?, project_key).await
    }

    pub async fn create_project(&self, id: &str, req: CreateProjectRequest) -> JiraResult<JiraProject> {
        ProjectManager::create(self.client(id)?, &req).await
    }

    pub async fn delete_project(&self, id: &str, project_key: &str) -> JiraResult<()> {
        ProjectManager::delete(self.client(id)?, project_key).await
    }

    pub async fn get_project_statuses(&self, id: &str, project_key: &str) -> JiraResult<Vec<serde_json::Value>> {
        ProjectManager::get_statuses(self.client(id)?, project_key).await
    }

    pub async fn get_project_components(&self, id: &str, project_key: &str) -> JiraResult<Vec<serde_json::Value>> {
        ProjectManager::get_components(self.client(id)?, project_key).await
    }

    pub async fn get_project_versions(&self, id: &str, project_key: &str) -> JiraResult<Vec<serde_json::Value>> {
        ProjectManager::get_versions(self.client(id)?, project_key).await
    }

    // ── Comments ─────────────────────────────────────────────────

    pub async fn list_comments(&self, id: &str, issue_key: &str, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<CommentsResponse> {
        CommentManager::list(self.client(id)?, issue_key, start_at, max_results).await
    }

    pub async fn get_comment(&self, id: &str, issue_key: &str, comment_id: &str) -> JiraResult<JiraComment> {
        CommentManager::get(self.client(id)?, issue_key, comment_id).await
    }

    pub async fn add_comment(&self, id: &str, issue_key: &str, req: AddCommentRequest) -> JiraResult<JiraComment> {
        CommentManager::add(self.client(id)?, issue_key, &req).await
    }

    pub async fn update_comment(&self, id: &str, issue_key: &str, comment_id: &str, req: AddCommentRequest) -> JiraResult<JiraComment> {
        CommentManager::update(self.client(id)?, issue_key, comment_id, &req).await
    }

    pub async fn delete_comment(&self, id: &str, issue_key: &str, comment_id: &str) -> JiraResult<()> {
        CommentManager::delete(self.client(id)?, issue_key, comment_id).await
    }

    // ── Attachments ──────────────────────────────────────────────

    pub async fn list_attachments(&self, id: &str, issue_key: &str) -> JiraResult<Vec<JiraAttachment>> {
        AttachmentManager::list(self.client(id)?, issue_key).await
    }

    pub async fn get_attachment(&self, id: &str, attachment_id: &str) -> JiraResult<JiraAttachment> {
        AttachmentManager::get(self.client(id)?, attachment_id).await
    }

    pub async fn add_attachment(&self, id: &str, issue_key: &str, filename: String, data_base64: String) -> JiraResult<Vec<JiraAttachment>> {
        AttachmentManager::add(self.client(id)?, issue_key, &filename, &data_base64).await
    }

    pub async fn delete_attachment(&self, id: &str, attachment_id: &str) -> JiraResult<()> {
        AttachmentManager::delete(self.client(id)?, attachment_id).await
    }

    // ── Worklogs ─────────────────────────────────────────────────

    pub async fn list_worklogs(&self, id: &str, issue_key: &str, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<WorklogsResponse> {
        WorklogManager::list(self.client(id)?, issue_key, start_at, max_results).await
    }

    pub async fn get_worklog(&self, id: &str, issue_key: &str, worklog_id: &str) -> JiraResult<JiraWorklog> {
        WorklogManager::get(self.client(id)?, issue_key, worklog_id).await
    }

    pub async fn add_worklog(&self, id: &str, issue_key: &str, req: AddWorklogRequest) -> JiraResult<JiraWorklog> {
        WorklogManager::add(self.client(id)?, issue_key, &req).await
    }

    pub async fn update_worklog(&self, id: &str, issue_key: &str, worklog_id: &str, req: AddWorklogRequest) -> JiraResult<JiraWorklog> {
        WorklogManager::update(self.client(id)?, issue_key, worklog_id, &req).await
    }

    pub async fn delete_worklog(&self, id: &str, issue_key: &str, worklog_id: &str) -> JiraResult<()> {
        WorklogManager::delete(self.client(id)?, issue_key, worklog_id).await
    }

    // ── Boards ───────────────────────────────────────────────────

    pub async fn list_boards(&self, id: &str, start_at: Option<u32>, max_results: Option<u32>, project_key: Option<String>, board_type: Option<String>) -> JiraResult<BoardsResponse> {
        BoardManager::list(self.client(id)?, start_at, max_results, project_key.as_deref(), board_type.as_deref()).await
    }

    pub async fn get_board(&self, id: &str, board_id: i64) -> JiraResult<JiraBoard> {
        BoardManager::get(self.client(id)?, board_id).await
    }

    pub async fn get_board_issues(&self, id: &str, board_id: i64, start_at: Option<u32>, max_results: Option<u32>, jql: Option<String>) -> JiraResult<JiraSearchResponse> {
        BoardManager::get_issues(self.client(id)?, board_id, start_at, max_results, jql.as_deref()).await
    }

    pub async fn get_board_backlog(&self, id: &str, board_id: i64, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<JiraSearchResponse> {
        BoardManager::get_backlog(self.client(id)?, board_id, start_at, max_results).await
    }

    pub async fn get_board_configuration(&self, id: &str, board_id: i64) -> JiraResult<serde_json::Value> {
        BoardManager::get_configuration(self.client(id)?, board_id).await
    }

    // ── Sprints ──────────────────────────────────────────────────

    pub async fn list_sprints(&self, id: &str, board_id: i64, start_at: Option<u32>, max_results: Option<u32>, state: Option<String>) -> JiraResult<SprintsResponse> {
        SprintManager::list(self.client(id)?, board_id, start_at, max_results, state.as_deref()).await
    }

    pub async fn get_sprint(&self, id: &str, sprint_id: i64) -> JiraResult<JiraSprint> {
        SprintManager::get(self.client(id)?, sprint_id).await
    }

    pub async fn create_sprint(&self, id: &str, req: CreateSprintRequest) -> JiraResult<JiraSprint> {
        SprintManager::create(self.client(id)?, &req).await
    }

    pub async fn update_sprint(&self, id: &str, sprint_id: i64, req: UpdateSprintRequest) -> JiraResult<JiraSprint> {
        SprintManager::update(self.client(id)?, sprint_id, &req).await
    }

    pub async fn delete_sprint(&self, id: &str, sprint_id: i64) -> JiraResult<()> {
        SprintManager::delete(self.client(id)?, sprint_id).await
    }

    pub async fn get_sprint_issues(&self, id: &str, sprint_id: i64, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<JiraSearchResponse> {
        SprintManager::get_issues(self.client(id)?, sprint_id, start_at, max_results).await
    }

    pub async fn move_issues_to_sprint(&self, id: &str, sprint_id: i64, req: MoveIssuesToSprintRequest) -> JiraResult<()> {
        SprintManager::move_issues(self.client(id)?, sprint_id, &req).await
    }

    pub async fn start_sprint(&self, id: &str, sprint_id: i64) -> JiraResult<JiraSprint> {
        SprintManager::start(self.client(id)?, sprint_id).await
    }

    pub async fn complete_sprint(&self, id: &str, sprint_id: i64) -> JiraResult<JiraSprint> {
        SprintManager::complete(self.client(id)?, sprint_id).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn get_myself(&self, id: &str) -> JiraResult<JiraUser> {
        JiraUserManager::get_myself(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, account_id: &str) -> JiraResult<JiraUser> {
        JiraUserManager::get(self.client(id)?, account_id).await
    }

    pub async fn search_users(&self, id: &str, query: String, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<Vec<JiraUser>> {
        JiraUserManager::search(self.client(id)?, &query, start_at, max_results).await
    }

    pub async fn find_assignable_users(&self, id: &str, project: String, query: Option<String>) -> JiraResult<Vec<JiraUser>> {
        JiraUserManager::find_assignable(self.client(id)?, &project, query.as_deref()).await
    }

    // ── Fields ───────────────────────────────────────────────────

    pub async fn list_fields(&self, id: &str) -> JiraResult<Vec<JiraField>> {
        FieldManager::list(self.client(id)?).await
    }

    pub async fn get_all_issue_types(&self, id: &str) -> JiraResult<Vec<JiraIssueType>> {
        FieldManager::get_all_issue_types(self.client(id)?).await
    }

    pub async fn get_priorities(&self, id: &str) -> JiraResult<Vec<JiraPriority>> {
        FieldManager::get_priorities(self.client(id)?).await
    }

    pub async fn get_statuses(&self, id: &str) -> JiraResult<Vec<JiraStatus>> {
        FieldManager::get_statuses(self.client(id)?).await
    }

    pub async fn get_resolutions(&self, id: &str) -> JiraResult<Vec<serde_json::Value>> {
        FieldManager::get_resolutions(self.client(id)?).await
    }

    // ── Dashboards ───────────────────────────────────────────────

    pub async fn list_dashboards(&self, id: &str, start_at: Option<u32>, max_results: Option<u32>) -> JiraResult<DashboardsResponse> {
        DashboardManager::list(self.client(id)?, start_at, max_results).await
    }

    pub async fn get_dashboard(&self, id: &str, dashboard_id: &str) -> JiraResult<JiraDashboard> {
        DashboardManager::get(self.client(id)?, dashboard_id).await
    }

    // ── Filters ──────────────────────────────────────────────────

    pub async fn get_filter(&self, id: &str, filter_id: &str) -> JiraResult<JiraFilter> {
        FilterManager::get(self.client(id)?, filter_id).await
    }

    pub async fn get_favourite_filters(&self, id: &str) -> JiraResult<Vec<JiraFilter>> {
        FilterManager::get_favourites(self.client(id)?).await
    }

    pub async fn get_my_filters(&self, id: &str) -> JiraResult<Vec<JiraFilter>> {
        FilterManager::get_my_filters(self.client(id)?).await
    }

    pub async fn create_filter(&self, id: &str, req: CreateFilterRequest) -> JiraResult<JiraFilter> {
        FilterManager::create(self.client(id)?, &req).await
    }

    pub async fn update_filter(&self, id: &str, filter_id: &str, req: UpdateFilterRequest) -> JiraResult<JiraFilter> {
        FilterManager::update(self.client(id)?, filter_id, &req).await
    }

    pub async fn delete_filter(&self, id: &str, filter_id: &str) -> JiraResult<()> {
        FilterManager::delete(self.client(id)?, filter_id).await
    }
}
