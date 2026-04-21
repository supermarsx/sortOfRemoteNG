// ── sorng-grafana/src/service.rs ────────────────────────────────────────────
//! Aggregate Grafana service – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

use crate::alerts;
use crate::annotations;
use crate::dashboards;
use crate::datasources;
use crate::folders;
use crate::orgs;
use crate::panels;
use crate::playlists;
use crate::snapshots;
use crate::teams;
use crate::users;

/// Shared Tauri state handle.
pub type GrafanaServiceState = Arc<Mutex<GrafanaService>>;

/// Main Grafana service managing connections.
pub struct GrafanaService {
    connections: HashMap<String, GrafanaClient>,
}

impl Default for GrafanaService {
    fn default() -> Self {
        Self::new()
    }
}

impl GrafanaService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: GrafanaConnectionConfig,
    ) -> GrafanaResult<GrafanaConnectionSummary> {
        let client = GrafanaClient::new(config)?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> GrafanaResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| GrafanaError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> GrafanaResult<&GrafanaClient> {
        self.connections
            .get(id)
            .ok_or_else(|| GrafanaError::not_connected(format!("No connection '{id}'")))
    }

    pub async fn ping(&self, id: &str) -> GrafanaResult<GrafanaConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Dashboards ───────────────────────────────────────────────

    pub async fn search_dashboards(
        &self,
        id: &str,
        query: &SearchQuery,
    ) -> GrafanaResult<Vec<Dashboard>> {
        dashboards::DashboardManager::search(self.client(id)?, query).await
    }

    pub async fn get_dashboard(&self, id: &str, uid: &str) -> GrafanaResult<DashboardDetail> {
        dashboards::DashboardManager::get_by_uid(self.client(id)?, uid).await
    }

    pub async fn save_dashboard(
        &self,
        id: &str,
        request: &SaveDashboardRequest,
    ) -> GrafanaResult<SaveDashboardResponse> {
        dashboards::DashboardManager::save(self.client(id)?, request).await
    }

    pub async fn delete_dashboard(&self, id: &str, uid: &str) -> GrafanaResult<serde_json::Value> {
        dashboards::DashboardManager::delete_by_uid(self.client(id)?, uid).await
    }

    pub async fn get_home_dashboard(&self, id: &str) -> GrafanaResult<DashboardDetail> {
        dashboards::DashboardManager::get_home(self.client(id)?).await
    }

    pub async fn list_dashboard_versions(
        &self,
        id: &str,
        dashboard_id: u64,
    ) -> GrafanaResult<Vec<DashboardVersion>> {
        dashboards::DashboardManager::list_versions(self.client(id)?, dashboard_id).await
    }

    pub async fn get_dashboard_version(
        &self,
        id: &str,
        dashboard_id: u64,
        version: u64,
    ) -> GrafanaResult<DashboardVersion> {
        dashboards::DashboardManager::get_version(self.client(id)?, dashboard_id, version).await
    }

    pub async fn restore_dashboard_version(
        &self,
        id: &str,
        dashboard_id: u64,
        version: u64,
    ) -> GrafanaResult<serde_json::Value> {
        dashboards::DashboardManager::restore_version(self.client(id)?, dashboard_id, version).await
    }

    pub async fn get_dashboard_permissions(
        &self,
        id: &str,
        uid: &str,
    ) -> GrafanaResult<serde_json::Value> {
        dashboards::DashboardManager::get_permissions(self.client(id)?, uid).await
    }

    pub async fn update_dashboard_permissions(
        &self,
        id: &str,
        uid: &str,
        permissions: &serde_json::Value,
    ) -> GrafanaResult<serde_json::Value> {
        dashboards::DashboardManager::update_permissions(self.client(id)?, uid, permissions).await
    }

    pub async fn get_dashboard_tags(&self, id: &str) -> GrafanaResult<Vec<(String, u64)>> {
        dashboards::DashboardManager::get_tags(self.client(id)?).await
    }

    // ── Datasources ──────────────────────────────────────────────

    pub async fn list_datasources(&self, id: &str) -> GrafanaResult<Vec<Datasource>> {
        datasources::DatasourceManager::list(self.client(id)?).await
    }

    pub async fn get_datasource(&self, id: &str, ds_id: u64) -> GrafanaResult<Datasource> {
        datasources::DatasourceManager::get_by_id(self.client(id)?, ds_id).await
    }

    pub async fn get_datasource_by_uid(&self, id: &str, uid: &str) -> GrafanaResult<Datasource> {
        datasources::DatasourceManager::get_by_uid(self.client(id)?, uid).await
    }

    pub async fn get_datasource_by_name(&self, id: &str, name: &str) -> GrafanaResult<Datasource> {
        datasources::DatasourceManager::get_by_name(self.client(id)?, name).await
    }

    pub async fn create_datasource(
        &self,
        id: &str,
        request: &DatasourceCreateRequest,
    ) -> GrafanaResult<serde_json::Value> {
        datasources::DatasourceManager::create(self.client(id)?, request).await
    }

    pub async fn update_datasource(
        &self,
        id: &str,
        ds_id: u64,
        request: &DatasourceCreateRequest,
    ) -> GrafanaResult<serde_json::Value> {
        datasources::DatasourceManager::update(self.client(id)?, ds_id, request).await
    }

    pub async fn delete_datasource(
        &self,
        id: &str,
        ds_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        datasources::DatasourceManager::delete_by_id(self.client(id)?, ds_id).await
    }

    pub async fn test_datasource(&self, id: &str, ds_id: u64) -> GrafanaResult<bool> {
        datasources::DatasourceManager::test(self.client(id)?, ds_id).await
    }

    // ── Folders ──────────────────────────────────────────────────

    pub async fn list_folders(&self, id: &str) -> GrafanaResult<Vec<Folder>> {
        folders::FolderManager::list(self.client(id)?).await
    }

    pub async fn get_folder(&self, id: &str, uid: &str) -> GrafanaResult<Folder> {
        folders::FolderManager::get_by_uid(self.client(id)?, uid).await
    }

    pub async fn create_folder(
        &self,
        id: &str,
        uid: Option<&str>,
        title: &str,
    ) -> GrafanaResult<Folder> {
        folders::FolderManager::create(self.client(id)?, uid, title).await
    }

    pub async fn update_folder(
        &self,
        id: &str,
        uid: &str,
        title: &str,
        version: Option<u64>,
    ) -> GrafanaResult<Folder> {
        folders::FolderManager::update(self.client(id)?, uid, title, version).await
    }

    pub async fn delete_folder(&self, id: &str, uid: &str) -> GrafanaResult<serde_json::Value> {
        folders::FolderManager::delete_by_uid(self.client(id)?, uid).await
    }

    // ── Organizations ────────────────────────────────────────────

    pub async fn list_orgs(&self, id: &str) -> GrafanaResult<Vec<Organization>> {
        orgs::OrgManager::list(self.client(id)?).await
    }

    pub async fn get_org(&self, id: &str, org_id: u64) -> GrafanaResult<Organization> {
        orgs::OrgManager::get(self.client(id)?, org_id).await
    }

    pub async fn create_org(&self, id: &str, name: &str) -> GrafanaResult<serde_json::Value> {
        orgs::OrgManager::create(self.client(id)?, name).await
    }

    pub async fn delete_org(&self, id: &str, org_id: u64) -> GrafanaResult<serde_json::Value> {
        orgs::OrgManager::delete(self.client(id)?, org_id).await
    }

    pub async fn get_current_org(&self, id: &str) -> GrafanaResult<Organization> {
        orgs::OrgManager::get_current(self.client(id)?).await
    }

    pub async fn switch_org(&self, id: &str, org_id: u64) -> GrafanaResult<serde_json::Value> {
        orgs::OrgManager::switch_org(self.client(id)?, org_id).await
    }

    pub async fn list_org_users(
        &self,
        id: &str,
        org_id: u64,
    ) -> GrafanaResult<Vec<serde_json::Value>> {
        orgs::OrgManager::list_users(self.client(id)?, org_id).await
    }

    pub async fn add_org_user(
        &self,
        id: &str,
        org_id: u64,
        login_or_email: &str,
        role: &str,
    ) -> GrafanaResult<serde_json::Value> {
        orgs::OrgManager::add_user(self.client(id)?, org_id, login_or_email, role).await
    }

    pub async fn remove_org_user(
        &self,
        id: &str,
        org_id: u64,
        user_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        orgs::OrgManager::remove_user(self.client(id)?, org_id, user_id).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> GrafanaResult<Vec<GrafanaUser>> {
        users::UserManager::list(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, user_id: u64) -> GrafanaResult<GrafanaUser> {
        users::UserManager::get(self.client(id)?, user_id).await
    }

    pub async fn create_user(
        &self,
        id: &str,
        name: Option<&str>,
        login: &str,
        email: Option<&str>,
        password: &str,
        org_id: Option<u64>,
    ) -> GrafanaResult<serde_json::Value> {
        users::UserManager::create(self.client(id)?, name, login, email, password, org_id).await
    }

    pub async fn delete_user(&self, id: &str, user_id: u64) -> GrafanaResult<serde_json::Value> {
        users::UserManager::delete(self.client(id)?, user_id).await
    }

    pub async fn get_current_user(&self, id: &str) -> GrafanaResult<GrafanaUser> {
        users::UserManager::get_current(self.client(id)?).await
    }

    pub async fn set_user_admin(
        &self,
        id: &str,
        user_id: u64,
        is_admin: bool,
    ) -> GrafanaResult<serde_json::Value> {
        users::UserManager::set_admin(self.client(id)?, user_id, is_admin).await
    }

    // ── Teams ────────────────────────────────────────────────────

    pub async fn list_teams(&self, id: &str, query: Option<&str>) -> GrafanaResult<Vec<Team>> {
        teams::TeamManager::list(self.client(id)?, query).await
    }

    pub async fn get_team(&self, id: &str, team_id: u64) -> GrafanaResult<Team> {
        teams::TeamManager::get(self.client(id)?, team_id).await
    }

    pub async fn create_team(
        &self,
        id: &str,
        name: &str,
        email: Option<&str>,
    ) -> GrafanaResult<serde_json::Value> {
        teams::TeamManager::create(self.client(id)?, name, email).await
    }

    pub async fn delete_team(&self, id: &str, team_id: u64) -> GrafanaResult<serde_json::Value> {
        teams::TeamManager::delete(self.client(id)?, team_id).await
    }

    pub async fn list_team_members(
        &self,
        id: &str,
        team_id: u64,
    ) -> GrafanaResult<Vec<TeamMember>> {
        teams::TeamManager::list_members(self.client(id)?, team_id).await
    }

    pub async fn add_team_member(
        &self,
        id: &str,
        team_id: u64,
        user_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        teams::TeamManager::add_member(self.client(id)?, team_id, user_id).await
    }

    pub async fn remove_team_member(
        &self,
        id: &str,
        team_id: u64,
        user_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        teams::TeamManager::remove_member(self.client(id)?, team_id, user_id).await
    }

    // ── Alerts ───────────────────────────────────────────────────

    pub async fn list_alert_rules(
        &self,
        id: &str,
        folder_uid: Option<&str>,
        rule_group: Option<&str>,
    ) -> GrafanaResult<Vec<AlertRule>> {
        alerts::AlertManager::list_rules(self.client(id)?, folder_uid, rule_group).await
    }

    pub async fn get_alert_rule(&self, id: &str, uid: &str) -> GrafanaResult<AlertRule> {
        alerts::AlertManager::get_rule(self.client(id)?, uid).await
    }

    pub async fn create_alert_rule(&self, id: &str, rule: &AlertRule) -> GrafanaResult<AlertRule> {
        alerts::AlertManager::create_rule(self.client(id)?, rule).await
    }

    pub async fn update_alert_rule(
        &self,
        id: &str,
        uid: &str,
        rule: &AlertRule,
    ) -> GrafanaResult<AlertRule> {
        alerts::AlertManager::update_rule(self.client(id)?, uid, rule).await
    }

    pub async fn delete_alert_rule(&self, id: &str, uid: &str) -> GrafanaResult<serde_json::Value> {
        alerts::AlertManager::delete_rule(self.client(id)?, uid).await
    }

    pub async fn pause_alert_rule(
        &self,
        id: &str,
        uid: &str,
        paused: bool,
    ) -> GrafanaResult<AlertRule> {
        alerts::AlertManager::pause_rule(self.client(id)?, uid, paused).await
    }

    pub async fn list_alert_notifications(
        &self,
        id: &str,
    ) -> GrafanaResult<Vec<AlertNotification>> {
        alerts::AlertManager::list_notifications(self.client(id)?).await
    }

    pub async fn create_alert_notification(
        &self,
        id: &str,
        config: &AlertNotification,
    ) -> GrafanaResult<AlertNotification> {
        alerts::AlertManager::create_notification(self.client(id)?, config).await
    }

    pub async fn delete_alert_notification(
        &self,
        id: &str,
        notif_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        alerts::AlertManager::delete_notification(self.client(id)?, notif_id).await
    }

    // ── Annotations ──────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub async fn list_annotations(
        &self,
        id: &str,
        from: Option<u64>,
        to: Option<u64>,
        dashboard_id: Option<u64>,
        panel_id: Option<u64>,
        tags: Option<&[String]>,
        limit: Option<u64>,
    ) -> GrafanaResult<Vec<Annotation>> {
        annotations::AnnotationManager::list(
            self.client(id)?,
            from,
            to,
            dashboard_id,
            panel_id,
            tags,
            limit,
        )
        .await
    }

    pub async fn create_annotation(
        &self,
        id: &str,
        request: &CreateAnnotationRequest,
    ) -> GrafanaResult<Annotation> {
        annotations::AnnotationManager::create(self.client(id)?, request).await
    }

    pub async fn delete_annotation(
        &self,
        id: &str,
        ann_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        annotations::AnnotationManager::delete(self.client(id)?, ann_id).await
    }

    // ── Playlists ────────────────────────────────────────────────

    pub async fn list_playlists(&self, id: &str) -> GrafanaResult<Vec<Playlist>> {
        playlists::PlaylistManager::list(self.client(id)?).await
    }

    pub async fn get_playlist(&self, id: &str, playlist_id: u64) -> GrafanaResult<Playlist> {
        playlists::PlaylistManager::get(self.client(id)?, playlist_id).await
    }

    pub async fn create_playlist(
        &self,
        id: &str,
        name: &str,
        interval: &str,
        items: &[PlaylistItem],
    ) -> GrafanaResult<Playlist> {
        playlists::PlaylistManager::create(self.client(id)?, name, interval, items).await
    }

    pub async fn delete_playlist(
        &self,
        id: &str,
        playlist_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        playlists::PlaylistManager::delete(self.client(id)?, playlist_id).await
    }

    // ── Snapshots ────────────────────────────────────────────────

    pub async fn list_snapshots(&self, id: &str) -> GrafanaResult<Vec<Snapshot>> {
        snapshots::SnapshotManager::list(self.client(id)?).await
    }

    pub async fn create_snapshot(
        &self,
        id: &str,
        dashboard: &serde_json::Value,
        name: Option<&str>,
        expires: Option<u64>,
    ) -> GrafanaResult<serde_json::Value> {
        snapshots::SnapshotManager::create(self.client(id)?, dashboard, name, expires).await
    }

    pub async fn get_snapshot(&self, id: &str, key: &str) -> GrafanaResult<Snapshot> {
        snapshots::SnapshotManager::get_by_key(self.client(id)?, key).await
    }

    pub async fn delete_snapshot(&self, id: &str, key: &str) -> GrafanaResult<serde_json::Value> {
        snapshots::SnapshotManager::delete_by_key(self.client(id)?, key).await
    }

    // ── Panels ───────────────────────────────────────────────────

    pub async fn list_panel_plugins(&self, id: &str) -> GrafanaResult<Vec<PanelPlugin>> {
        panels::PanelManager::list_plugins(self.client(id)?).await
    }

    pub async fn get_panel_plugin(&self, id: &str, plugin_id: &str) -> GrafanaResult<PanelPlugin> {
        panels::PanelManager::get_plugin(self.client(id)?, plugin_id).await
    }
}
