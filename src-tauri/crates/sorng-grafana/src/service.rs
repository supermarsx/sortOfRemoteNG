// ── sorng-grafana/src/service.rs ──────────────────────────────────────────────
//! Aggregate Grafana façade – holds connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

use crate::dashboards::DashboardManager;
use crate::datasources::DatasourceManager;
use crate::folders::FolderManager;
use crate::users::UserManager;
use crate::orgs::OrgManager;
use crate::alerts::AlertManager;
use crate::annotations::AnnotationManager;
use crate::playlists::PlaylistManager;
use crate::panels::PanelManager;
use crate::api_keys::ApiKeyManager;
use crate::teams::TeamManager;
use crate::plugins::PluginManager;
use crate::snapshots::SnapshotManager;
use crate::admin::AdminManager;

/// Shared Tauri state handle.
pub type GrafanaServiceState = Arc<Mutex<GrafanaService>>;

/// Main Grafana service managing connections.
pub struct GrafanaService {
    connections: HashMap<String, GrafanaClient>,
}

impl GrafanaService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: GrafanaConnectionConfig) -> GrafanaResult<GrafanaConnectionSummary> {
        let client = GrafanaClient::new(config)?;
        let health = AdminManager::get_health(&client).await.ok();
        let summary = GrafanaConnectionSummary {
            host: client.config.host.clone(),
            version: health.as_ref().and_then(|h| h.version.clone()),
            org_name: None,
            edition: None,
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> GrafanaResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| GrafanaError::not_connected(format!("No connection '{id}'")))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> GrafanaResult<&GrafanaClient> {
        self.connections.get(id)
            .ok_or_else(|| GrafanaError::not_connected(format!("No connection '{id}'")))
    }

    // ── Dashboards ───────────────────────────────────────────────

    pub async fn list_dashboards(&self, id: &str) -> GrafanaResult<Vec<DashboardSearchResult>> {
        DashboardManager::list_dashboards(self.client(id)?).await
    }

    pub async fn search_dashboards(&self, id: &str, query: &DashboardSearchQuery) -> GrafanaResult<Vec<DashboardSearchResult>> {
        DashboardManager::search_dashboards(self.client(id)?, query).await
    }

    pub async fn get_dashboard(&self, id: &str, uid: &str) -> GrafanaResult<serde_json::Value> {
        DashboardManager::get_dashboard(self.client(id)?, uid).await
    }

    pub async fn get_dashboard_by_uid(&self, id: &str, uid: &str) -> GrafanaResult<serde_json::Value> {
        DashboardManager::get_dashboard_by_uid(self.client(id)?, uid).await
    }

    pub async fn create_dashboard(&self, id: &str, req: &CreateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        DashboardManager::create_dashboard(self.client(id)?, req).await
    }

    pub async fn update_dashboard(&self, id: &str, req: &UpdateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        DashboardManager::update_dashboard(self.client(id)?, req).await
    }

    pub async fn delete_dashboard(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        DashboardManager::delete_dashboard(self.client(id)?, uid).await
    }

    pub async fn get_dashboard_versions(&self, id: &str, dashboard_id: i64) -> GrafanaResult<Vec<DashboardVersion>> {
        DashboardManager::get_dashboard_versions(self.client(id)?, dashboard_id).await
    }

    pub async fn restore_dashboard_version(&self, id: &str, dashboard_id: i64, version: i64) -> GrafanaResult<serde_json::Value> {
        DashboardManager::restore_dashboard_version(self.client(id)?, dashboard_id, version).await
    }

    pub async fn get_dashboard_permissions(&self, id: &str, uid: &str) -> GrafanaResult<Vec<DashboardPermission>> {
        DashboardManager::get_dashboard_permissions(self.client(id)?, uid).await
    }

    pub async fn update_dashboard_permissions(&self, id: &str, uid: &str, req: &UpdatePermissionsRequest) -> GrafanaResult<()> {
        DashboardManager::update_dashboard_permissions(self.client(id)?, uid, req).await
    }

    pub async fn get_dashboard_tags(&self, id: &str) -> GrafanaResult<Vec<serde_json::Value>> {
        DashboardManager::get_dashboard_tags(self.client(id)?).await
    }

    pub async fn export_dashboard(&self, id: &str, uid: &str) -> GrafanaResult<serde_json::Value> {
        DashboardManager::export_dashboard(self.client(id)?, uid).await
    }

    pub async fn import_dashboard(&self, id: &str, req: &ImportDashboardRequest) -> GrafanaResult<serde_json::Value> {
        DashboardManager::import_dashboard(self.client(id)?, req).await
    }

    pub async fn star_dashboard(&self, id: &str, dashboard_id: i64) -> GrafanaResult<()> {
        DashboardManager::star_dashboard(self.client(id)?, dashboard_id).await
    }

    pub async fn unstar_dashboard(&self, id: &str, dashboard_id: i64) -> GrafanaResult<()> {
        DashboardManager::unstar_dashboard(self.client(id)?, dashboard_id).await
    }

    pub async fn get_home_dashboard(&self, id: &str) -> GrafanaResult<serde_json::Value> {
        DashboardManager::get_home_dashboard(self.client(id)?).await
    }

    pub async fn set_home_dashboard(&self, id: &str, dashboard_id: i64) -> GrafanaResult<()> {
        DashboardManager::set_home_dashboard(self.client(id)?, dashboard_id).await
    }

    pub async fn calculate_diff(&self, id: &str, req: &DashboardDiffRequest) -> GrafanaResult<DashboardDiff> {
        DashboardManager::calculate_diff(self.client(id)?, req).await
    }

    // ── Datasources ──────────────────────────────────────────────

    pub async fn list_datasources(&self, id: &str) -> GrafanaResult<Vec<Datasource>> {
        DatasourceManager::list_datasources(self.client(id)?).await
    }

    pub async fn get_datasource(&self, id: &str, ds_id: i64) -> GrafanaResult<Datasource> {
        DatasourceManager::get_datasource(self.client(id)?, ds_id).await
    }

    pub async fn get_datasource_by_uid(&self, id: &str, uid: &str) -> GrafanaResult<Datasource> {
        DatasourceManager::get_datasource_by_uid(self.client(id)?, uid).await
    }

    pub async fn create_datasource(&self, id: &str, req: &CreateDatasourceRequest) -> GrafanaResult<Datasource> {
        DatasourceManager::create_datasource(self.client(id)?, req).await
    }

    pub async fn update_datasource(&self, id: &str, ds_id: i64, req: &UpdateDatasourceRequest) -> GrafanaResult<Datasource> {
        DatasourceManager::update_datasource(self.client(id)?, ds_id, req).await
    }

    pub async fn delete_datasource(&self, id: &str, ds_id: i64) -> GrafanaResult<()> {
        DatasourceManager::delete_datasource(self.client(id)?, ds_id).await
    }

    pub async fn test_datasource(&self, id: &str, ds_id: i64) -> GrafanaResult<DatasourceHealth> {
        DatasourceManager::test_datasource(self.client(id)?, ds_id).await
    }

    pub async fn get_datasource_health(&self, id: &str, uid: &str) -> GrafanaResult<DatasourceHealth> {
        DatasourceManager::get_datasource_health(self.client(id)?, uid).await
    }

    pub async fn list_datasource_types(&self, id: &str) -> GrafanaResult<Vec<DatasourceType>> {
        DatasourceManager::list_datasource_types(self.client(id)?).await
    }

    pub async fn get_datasource_proxy(&self, id: &str, ds_id: i64, path: &str) -> GrafanaResult<String> {
        DatasourceManager::get_datasource_proxy(self.client(id)?, ds_id, path).await
    }

    pub async fn query_datasource(&self, id: &str, req: &QueryDatasourceRequest) -> GrafanaResult<serde_json::Value> {
        DatasourceManager::query_datasource(self.client(id)?, req).await
    }

    // ── Folders ──────────────────────────────────────────────────

    pub async fn list_folders(&self, id: &str) -> GrafanaResult<Vec<Folder>> {
        FolderManager::list_folders(self.client(id)?).await
    }

    pub async fn get_folder(&self, id: &str, folder_id: i64) -> GrafanaResult<Folder> {
        FolderManager::get_folder(self.client(id)?, folder_id).await
    }

    pub async fn get_folder_by_uid(&self, id: &str, uid: &str) -> GrafanaResult<Folder> {
        FolderManager::get_folder_by_uid(self.client(id)?, uid).await
    }

    pub async fn create_folder(&self, id: &str, req: &CreateFolderRequest) -> GrafanaResult<Folder> {
        FolderManager::create_folder(self.client(id)?, req).await
    }

    pub async fn update_folder(&self, id: &str, uid: &str, req: &UpdateFolderRequest) -> GrafanaResult<Folder> {
        FolderManager::update_folder(self.client(id)?, uid, req).await
    }

    pub async fn delete_folder(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        FolderManager::delete_folder(self.client(id)?, uid).await
    }

    pub async fn get_folder_permissions(&self, id: &str, uid: &str) -> GrafanaResult<Vec<FolderPermission>> {
        FolderManager::get_folder_permissions(self.client(id)?, uid).await
    }

    pub async fn update_folder_permissions(&self, id: &str, uid: &str, req: &UpdateFolderPermissionsRequest) -> GrafanaResult<()> {
        FolderManager::update_folder_permissions(self.client(id)?, uid, req).await
    }

    pub async fn move_dashboard_to_folder(&self, id: &str, dashboard_uid: &str, req: &MoveDashboardRequest) -> GrafanaResult<()> {
        FolderManager::move_dashboard_to_folder(self.client(id)?, dashboard_uid, req).await
    }

    pub async fn list_folder_dashboards(&self, id: &str, uid: &str) -> GrafanaResult<Vec<DashboardSearchResult>> {
        FolderManager::list_folder_dashboards(self.client(id)?, uid).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> GrafanaResult<Vec<GrafanaUser>> {
        UserManager::list_users(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, user_id: i64) -> GrafanaResult<GrafanaUser> {
        UserManager::get_user(self.client(id)?, user_id).await
    }

    pub async fn get_user_by_login(&self, id: &str, login: &str) -> GrafanaResult<GrafanaUser> {
        UserManager::get_user_by_login(self.client(id)?, login).await
    }

    pub async fn create_user(&self, id: &str, req: &CreateUserRequest) -> GrafanaResult<GrafanaUser> {
        UserManager::create_user(self.client(id)?, req).await
    }

    pub async fn update_user(&self, id: &str, user_id: i64, req: &UpdateUserRequest) -> GrafanaResult<()> {
        UserManager::update_user(self.client(id)?, user_id, req).await
    }

    pub async fn delete_user(&self, id: &str, user_id: i64) -> GrafanaResult<()> {
        UserManager::delete_user(self.client(id)?, user_id).await
    }

    pub async fn get_user_orgs(&self, id: &str, user_id: i64) -> GrafanaResult<Vec<UserOrg>> {
        UserManager::get_user_orgs(self.client(id)?, user_id).await
    }

    pub async fn add_user_to_org(&self, id: &str, org_id: i64, req: &AddUserToOrgRequest) -> GrafanaResult<()> {
        UserManager::add_user_to_org(self.client(id)?, org_id, req).await
    }

    pub async fn remove_user_from_org(&self, id: &str, org_id: i64, user_id: i64) -> GrafanaResult<()> {
        UserManager::remove_user_from_org(self.client(id)?, org_id, user_id).await
    }

    pub async fn update_user_role(&self, id: &str, org_id: i64, user_id: i64, req: &UpdateUserRoleRequest) -> GrafanaResult<()> {
        UserManager::update_user_role(self.client(id)?, org_id, user_id, req).await
    }

    pub async fn get_user_preferences(&self, id: &str) -> GrafanaResult<UserPreferences> {
        UserManager::get_user_preferences(self.client(id)?).await
    }

    pub async fn update_user_preferences(&self, id: &str, prefs: &UserPreferences) -> GrafanaResult<()> {
        UserManager::update_user_preferences(self.client(id)?, prefs).await
    }

    pub async fn change_user_password(&self, id: &str, req: &ChangePasswordRequest) -> GrafanaResult<()> {
        UserManager::change_user_password(self.client(id)?, req).await
    }

    pub async fn get_current_user(&self, id: &str) -> GrafanaResult<GrafanaUser> {
        UserManager::get_current_user(self.client(id)?).await
    }

    pub async fn update_current_user(&self, id: &str, req: &UpdateUserRequest) -> GrafanaResult<()> {
        UserManager::update_current_user(self.client(id)?, req).await
    }

    pub async fn star_dashboard_for_user(&self, id: &str, dashboard_id: i64) -> GrafanaResult<()> {
        UserManager::star_dashboard_for_user(self.client(id)?, dashboard_id).await
    }

    // ── Organizations ────────────────────────────────────────────

    pub async fn list_orgs(&self, id: &str) -> GrafanaResult<Vec<GrafanaOrg>> {
        OrgManager::list_orgs(self.client(id)?).await
    }

    pub async fn get_org(&self, id: &str, org_id: i64) -> GrafanaResult<GrafanaOrg> {
        OrgManager::get_org(self.client(id)?, org_id).await
    }

    pub async fn get_org_by_name(&self, id: &str, name: &str) -> GrafanaResult<GrafanaOrg> {
        OrgManager::get_org_by_name(self.client(id)?, name).await
    }

    pub async fn create_org(&self, id: &str, req: &CreateOrgRequest) -> GrafanaResult<GrafanaOrg> {
        OrgManager::create_org(self.client(id)?, req).await
    }

    pub async fn update_org(&self, id: &str, org_id: i64, req: &UpdateOrgRequest) -> GrafanaResult<()> {
        OrgManager::update_org(self.client(id)?, org_id, req).await
    }

    pub async fn delete_org(&self, id: &str, org_id: i64) -> GrafanaResult<()> {
        OrgManager::delete_org(self.client(id)?, org_id).await
    }

    pub async fn list_org_users(&self, id: &str, org_id: i64) -> GrafanaResult<Vec<OrgUser>> {
        OrgManager::list_org_users(self.client(id)?, org_id).await
    }

    pub async fn add_user_to_org_role(&self, id: &str, org_id: i64, req: &AddOrgUserRequest) -> GrafanaResult<()> {
        OrgManager::add_user_to_org_role(self.client(id)?, org_id, req).await
    }

    pub async fn update_org_user_role(&self, id: &str, org_id: i64, user_id: i64, req: &UpdateOrgUserRoleRequest) -> GrafanaResult<()> {
        OrgManager::update_org_user_role(self.client(id)?, org_id, user_id, req).await
    }

    pub async fn remove_user_from_org_mgmt(&self, id: &str, org_id: i64, user_id: i64) -> GrafanaResult<()> {
        OrgManager::remove_user_from_org_mgmt(self.client(id)?, org_id, user_id).await
    }

    pub async fn get_current_org(&self, id: &str) -> GrafanaResult<GrafanaOrg> {
        OrgManager::get_current_org(self.client(id)?).await
    }

    pub async fn update_current_org(&self, id: &str, req: &UpdateOrgRequest) -> GrafanaResult<()> {
        OrgManager::update_current_org(self.client(id)?, req).await
    }

    pub async fn get_org_preferences(&self, id: &str) -> GrafanaResult<OrgPreferences> {
        OrgManager::get_org_preferences(self.client(id)?).await
    }

    pub async fn update_org_preferences(&self, id: &str, prefs: &OrgPreferences) -> GrafanaResult<()> {
        OrgManager::update_org_preferences(self.client(id)?, prefs).await
    }

    // ── Alerts ───────────────────────────────────────────────────

    pub async fn list_alert_rules(&self, id: &str) -> GrafanaResult<Vec<AlertRule>> {
        AlertManager::list_alert_rules(self.client(id)?).await
    }

    pub async fn get_alert_rule(&self, id: &str, uid: &str) -> GrafanaResult<AlertRule> {
        AlertManager::get_alert_rule(self.client(id)?, uid).await
    }

    pub async fn create_alert_rule(&self, id: &str, req: &CreateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        AlertManager::create_alert_rule(self.client(id)?, req).await
    }

    pub async fn update_alert_rule(&self, id: &str, uid: &str, req: &UpdateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        AlertManager::update_alert_rule(self.client(id)?, uid, req).await
    }

    pub async fn delete_alert_rule(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        AlertManager::delete_alert_rule(self.client(id)?, uid).await
    }

    pub async fn list_alert_instances(&self, id: &str) -> GrafanaResult<Vec<AlertInstance>> {
        AlertManager::list_alert_instances(self.client(id)?).await
    }

    pub async fn get_alert_rule_groups(&self, id: &str, folder_uid: &str) -> GrafanaResult<Vec<AlertRuleGroup>> {
        AlertManager::get_alert_rule_groups(self.client(id)?, folder_uid).await
    }

    pub async fn list_contact_points(&self, id: &str) -> GrafanaResult<Vec<ContactPoint>> {
        AlertManager::list_contact_points(self.client(id)?).await
    }

    pub async fn create_contact_point(&self, id: &str, req: &CreateContactPointRequest) -> GrafanaResult<ContactPoint> {
        AlertManager::create_contact_point(self.client(id)?, req).await
    }

    pub async fn update_contact_point(&self, id: &str, uid: &str, req: &UpdateContactPointRequest) -> GrafanaResult<()> {
        AlertManager::update_contact_point(self.client(id)?, uid, req).await
    }

    pub async fn delete_contact_point(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        AlertManager::delete_contact_point(self.client(id)?, uid).await
    }

    pub async fn list_notification_policies(&self, id: &str) -> GrafanaResult<NotificationPolicy> {
        AlertManager::list_notification_policies(self.client(id)?).await
    }

    pub async fn update_notification_policy(&self, id: &str, policy: &NotificationPolicy) -> GrafanaResult<()> {
        AlertManager::update_notification_policy(self.client(id)?, policy).await
    }

    pub async fn list_silences(&self, id: &str) -> GrafanaResult<Vec<AlertSilence>> {
        AlertManager::list_silences(self.client(id)?).await
    }

    pub async fn create_silence(&self, id: &str, req: &CreateSilenceRequest) -> GrafanaResult<AlertSilence> {
        AlertManager::create_silence(self.client(id)?, req).await
    }

    pub async fn delete_silence(&self, id: &str, silence_id: &str) -> GrafanaResult<()> {
        AlertManager::delete_silence(self.client(id)?, silence_id).await
    }

    pub async fn list_mute_timings(&self, id: &str) -> GrafanaResult<Vec<MuteTiming>> {
        AlertManager::list_mute_timings(self.client(id)?).await
    }

    pub async fn create_mute_timing(&self, id: &str, req: &CreateMuteTimingRequest) -> GrafanaResult<MuteTiming> {
        AlertManager::create_mute_timing(self.client(id)?, req).await
    }

    pub async fn update_mute_timing(&self, id: &str, name: &str, req: &UpdateMuteTimingRequest) -> GrafanaResult<()> {
        AlertManager::update_mute_timing(self.client(id)?, name, req).await
    }

    pub async fn delete_mute_timing(&self, id: &str, name: &str) -> GrafanaResult<()> {
        AlertManager::delete_mute_timing(self.client(id)?, name).await
    }

    pub async fn test_contact_point(&self, id: &str, req: &CreateContactPointRequest) -> GrafanaResult<()> {
        AlertManager::test_contact_point(self.client(id)?, req).await
    }

    pub async fn get_alert_state_history(&self, id: &str, rule_uid: &str) -> GrafanaResult<AlertStateHistory> {
        AlertManager::get_alert_state_history(self.client(id)?, rule_uid).await
    }

    // ── Annotations ──────────────────────────────────────────────

    pub async fn list_annotations(&self, id: &str, query: &AnnotationQuery) -> GrafanaResult<Vec<Annotation>> {
        AnnotationManager::list_annotations(self.client(id)?, query).await
    }

    pub async fn get_annotation(&self, id: &str, annotation_id: i64) -> GrafanaResult<Annotation> {
        AnnotationManager::get_annotation(self.client(id)?, annotation_id).await
    }

    pub async fn create_annotation(&self, id: &str, req: &CreateAnnotationRequest) -> GrafanaResult<Annotation> {
        AnnotationManager::create_annotation(self.client(id)?, req).await
    }

    pub async fn update_annotation(&self, id: &str, annotation_id: i64, req: &UpdateAnnotationRequest) -> GrafanaResult<()> {
        AnnotationManager::update_annotation(self.client(id)?, annotation_id, req).await
    }

    pub async fn delete_annotation(&self, id: &str, annotation_id: i64) -> GrafanaResult<()> {
        AnnotationManager::delete_annotation(self.client(id)?, annotation_id).await
    }

    pub async fn create_graphite_annotation(&self, id: &str, req: &CreateGraphiteAnnotationRequest) -> GrafanaResult<Annotation> {
        AnnotationManager::create_graphite_annotation(self.client(id)?, req).await
    }

    pub async fn find_annotations_by_tag(&self, id: &str, tags: &[String]) -> GrafanaResult<Vec<Annotation>> {
        AnnotationManager::find_annotations_by_tag(self.client(id)?, tags).await
    }

    pub async fn find_annotations_by_dashboard(&self, id: &str, dashboard_id: i64) -> GrafanaResult<Vec<Annotation>> {
        AnnotationManager::find_annotations_by_dashboard(self.client(id)?, dashboard_id).await
    }

    pub async fn mass_delete_annotations(&self, id: &str, req: &MassDeleteAnnotationsRequest) -> GrafanaResult<()> {
        AnnotationManager::mass_delete_annotations(self.client(id)?, req).await
    }

    // ── Playlists ────────────────────────────────────────────────

    pub async fn list_playlists(&self, id: &str) -> GrafanaResult<Vec<Playlist>> {
        PlaylistManager::list_playlists(self.client(id)?).await
    }

    pub async fn get_playlist(&self, id: &str, uid: &str) -> GrafanaResult<Playlist> {
        PlaylistManager::get_playlist(self.client(id)?, uid).await
    }

    pub async fn create_playlist(&self, id: &str, req: &CreatePlaylistRequest) -> GrafanaResult<Playlist> {
        PlaylistManager::create_playlist(self.client(id)?, req).await
    }

    pub async fn update_playlist(&self, id: &str, uid: &str, req: &UpdatePlaylistRequest) -> GrafanaResult<Playlist> {
        PlaylistManager::update_playlist(self.client(id)?, uid, req).await
    }

    pub async fn delete_playlist(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        PlaylistManager::delete_playlist(self.client(id)?, uid).await
    }

    pub async fn get_playlist_items(&self, id: &str, uid: &str) -> GrafanaResult<Vec<PlaylistItem>> {
        PlaylistManager::get_playlist_items(self.client(id)?, uid).await
    }

    pub async fn get_playlist_dashboards(&self, id: &str, uid: &str) -> GrafanaResult<Vec<DashboardSearchResult>> {
        PlaylistManager::get_playlist_dashboards(self.client(id)?, uid).await
    }

    pub async fn start_playlist(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        PlaylistManager::start_playlist(self.client(id)?, uid).await
    }

    pub async fn stop_playlist(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        PlaylistManager::stop_playlist(self.client(id)?, uid).await
    }

    // ── Panels ───────────────────────────────────────────────────

    pub async fn list_panel_types(&self, id: &str) -> GrafanaResult<Vec<PanelType>> {
        PanelManager::list_panel_types(self.client(id)?).await
    }

    pub async fn get_panel_schema(&self, id: &str, panel_type: &str) -> GrafanaResult<PanelSchema> {
        PanelManager::get_panel_schema(self.client(id)?, panel_type).await
    }

    pub async fn list_library_panels(&self, id: &str) -> GrafanaResult<Vec<LibraryPanel>> {
        PanelManager::list_library_panels(self.client(id)?).await
    }

    pub async fn get_library_panel(&self, id: &str, uid: &str) -> GrafanaResult<LibraryPanel> {
        PanelManager::get_library_panel(self.client(id)?, uid).await
    }

    pub async fn create_library_panel(&self, id: &str, req: &CreateLibraryPanelRequest) -> GrafanaResult<LibraryPanel> {
        PanelManager::create_library_panel(self.client(id)?, req).await
    }

    pub async fn update_library_panel(&self, id: &str, uid: &str, req: &UpdateLibraryPanelRequest) -> GrafanaResult<LibraryPanel> {
        PanelManager::update_library_panel(self.client(id)?, uid, req).await
    }

    pub async fn delete_library_panel(&self, id: &str, uid: &str) -> GrafanaResult<()> {
        PanelManager::delete_library_panel(self.client(id)?, uid).await
    }

    pub async fn list_library_panel_connections(&self, id: &str, uid: &str) -> GrafanaResult<Vec<LibraryPanelConnection>> {
        PanelManager::list_library_panel_connections(self.client(id)?, uid).await
    }

    pub async fn get_panel_query_options(&self, id: &str, panel_type: &str) -> GrafanaResult<PanelQueryOptions> {
        PanelManager::get_panel_query_options(self.client(id)?, panel_type).await
    }

    // ── API Keys ─────────────────────────────────────────────────

    pub async fn list_api_keys(&self, id: &str) -> GrafanaResult<Vec<GrafanaApiKey>> {
        ApiKeyManager::list_api_keys(self.client(id)?).await
    }

    pub async fn create_api_key(&self, id: &str, req: &CreateApiKeyRequest) -> GrafanaResult<serde_json::Value> {
        ApiKeyManager::create_api_key(self.client(id)?, req).await
    }

    pub async fn delete_api_key(&self, id: &str, key_id: i64) -> GrafanaResult<()> {
        ApiKeyManager::delete_api_key(self.client(id)?, key_id).await
    }

    pub async fn list_service_accounts(&self, id: &str) -> GrafanaResult<Vec<ServiceAccount>> {
        ApiKeyManager::list_service_accounts(self.client(id)?).await
    }

    pub async fn create_service_account(&self, id: &str, req: &CreateServiceAccountRequest) -> GrafanaResult<ServiceAccount> {
        ApiKeyManager::create_service_account(self.client(id)?, req).await
    }

    pub async fn delete_service_account(&self, id: &str, sa_id: i64) -> GrafanaResult<()> {
        ApiKeyManager::delete_service_account(self.client(id)?, sa_id).await
    }

    pub async fn list_service_account_tokens(&self, id: &str, sa_id: i64) -> GrafanaResult<Vec<ServiceAccountToken>> {
        ApiKeyManager::list_service_account_tokens(self.client(id)?, sa_id).await
    }

    pub async fn create_service_account_token(&self, id: &str, sa_id: i64, req: &CreateServiceAccountTokenRequest) -> GrafanaResult<ServiceAccountToken> {
        ApiKeyManager::create_service_account_token(self.client(id)?, sa_id, req).await
    }

    pub async fn delete_service_account_token(&self, id: &str, sa_id: i64, token_id: i64) -> GrafanaResult<()> {
        ApiKeyManager::delete_service_account_token(self.client(id)?, sa_id, token_id).await
    }

    // ── Teams ────────────────────────────────────────────────────

    pub async fn list_teams(&self, id: &str) -> GrafanaResult<Vec<Team>> {
        TeamManager::list_teams(self.client(id)?).await
    }

    pub async fn get_team(&self, id: &str, team_id: i64) -> GrafanaResult<Team> {
        TeamManager::get_team(self.client(id)?, team_id).await
    }

    pub async fn create_team(&self, id: &str, req: &CreateTeamRequest) -> GrafanaResult<Team> {
        TeamManager::create_team(self.client(id)?, req).await
    }

    pub async fn update_team(&self, id: &str, team_id: i64, req: &UpdateTeamRequest) -> GrafanaResult<()> {
        TeamManager::update_team(self.client(id)?, team_id, req).await
    }

    pub async fn delete_team(&self, id: &str, team_id: i64) -> GrafanaResult<()> {
        TeamManager::delete_team(self.client(id)?, team_id).await
    }

    pub async fn list_team_members(&self, id: &str, team_id: i64) -> GrafanaResult<Vec<TeamMember>> {
        TeamManager::list_team_members(self.client(id)?, team_id).await
    }

    pub async fn add_team_member(&self, id: &str, team_id: i64, req: &AddTeamMemberRequest) -> GrafanaResult<()> {
        TeamManager::add_team_member(self.client(id)?, team_id, req).await
    }

    pub async fn remove_team_member(&self, id: &str, team_id: i64, user_id: i64) -> GrafanaResult<()> {
        TeamManager::remove_team_member(self.client(id)?, team_id, user_id).await
    }

    pub async fn get_team_preferences(&self, id: &str, team_id: i64) -> GrafanaResult<TeamPreferences> {
        TeamManager::get_team_preferences(self.client(id)?, team_id).await
    }

    pub async fn update_team_preferences(&self, id: &str, team_id: i64, prefs: &TeamPreferences) -> GrafanaResult<()> {
        TeamManager::update_team_preferences(self.client(id)?, team_id, prefs).await
    }

    pub async fn list_team_groups(&self, id: &str, team_id: i64) -> GrafanaResult<Vec<TeamGroup>> {
        TeamManager::list_team_groups(self.client(id)?, team_id).await
    }

    pub async fn add_team_group(&self, id: &str, team_id: i64, req: &AddTeamGroupRequest) -> GrafanaResult<()> {
        TeamManager::add_team_group(self.client(id)?, team_id, req).await
    }

    pub async fn remove_team_group(&self, id: &str, team_id: i64, group_id: &str) -> GrafanaResult<()> {
        TeamManager::remove_team_group(self.client(id)?, team_id, group_id).await
    }

    // ── Plugins ──────────────────────────────────────────────────

    pub async fn list_plugins(&self, id: &str) -> GrafanaResult<Vec<GrafanaPlugin>> {
        PluginManager::list_plugins(self.client(id)?).await
    }

    pub async fn get_plugin(&self, id: &str, plugin_id: &str) -> GrafanaResult<GrafanaPlugin> {
        PluginManager::get_plugin(self.client(id)?, plugin_id).await
    }

    pub async fn install_plugin(&self, id: &str, plugin_id: &str, req: &InstallPluginRequest) -> GrafanaResult<()> {
        PluginManager::install_plugin(self.client(id)?, plugin_id, req).await
    }

    pub async fn uninstall_plugin(&self, id: &str, plugin_id: &str) -> GrafanaResult<()> {
        PluginManager::uninstall_plugin(self.client(id)?, plugin_id).await
    }

    pub async fn update_plugin(&self, id: &str, plugin_id: &str, req: &InstallPluginRequest) -> GrafanaResult<()> {
        PluginManager::update_plugin(self.client(id)?, plugin_id, req).await
    }

    pub async fn get_plugin_settings(&self, id: &str, plugin_id: &str) -> GrafanaResult<PluginSettings> {
        PluginManager::get_plugin_settings(self.client(id)?, plugin_id).await
    }

    pub async fn update_plugin_settings(&self, id: &str, plugin_id: &str, req: &UpdatePluginSettingsRequest) -> GrafanaResult<()> {
        PluginManager::update_plugin_settings(self.client(id)?, plugin_id, req).await
    }

    pub async fn get_plugin_health(&self, id: &str, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        PluginManager::get_plugin_health(self.client(id)?, plugin_id).await
    }

    pub async fn list_plugin_dashboards(&self, id: &str, plugin_id: &str) -> GrafanaResult<Vec<DashboardSearchResult>> {
        PluginManager::list_plugin_dashboards(self.client(id)?, plugin_id).await
    }

    // ── Snapshots ────────────────────────────────────────────────

    pub async fn list_snapshots(&self, id: &str) -> GrafanaResult<Vec<GrafanaSnapshot>> {
        SnapshotManager::list_snapshots(self.client(id)?).await
    }

    pub async fn get_snapshot(&self, id: &str, snapshot_id: i64) -> GrafanaResult<GrafanaSnapshot> {
        SnapshotManager::get_snapshot(self.client(id)?, snapshot_id).await
    }

    pub async fn create_snapshot(&self, id: &str, req: &CreateSnapshotRequest) -> GrafanaResult<GrafanaSnapshot> {
        SnapshotManager::create_snapshot(self.client(id)?, req).await
    }

    pub async fn delete_snapshot(&self, id: &str, snapshot_id: i64) -> GrafanaResult<()> {
        SnapshotManager::delete_snapshot(self.client(id)?, snapshot_id).await
    }

    pub async fn get_snapshot_by_key(&self, id: &str, key: &str) -> GrafanaResult<GrafanaSnapshot> {
        SnapshotManager::get_snapshot_by_key(self.client(id)?, key).await
    }

    pub async fn delete_snapshot_by_key(&self, id: &str, delete_key: &str) -> GrafanaResult<()> {
        SnapshotManager::delete_snapshot_by_key(self.client(id)?, delete_key).await
    }

    // ── Admin ────────────────────────────────────────────────────

    pub async fn get_settings(&self, id: &str) -> GrafanaResult<GrafanaSettings> {
        AdminManager::get_settings(self.client(id)?).await
    }

    pub async fn get_stats(&self, id: &str) -> GrafanaResult<GrafanaStats> {
        AdminManager::get_stats(self.client(id)?).await
    }

    pub async fn get_health(&self, id: &str) -> GrafanaResult<GrafanaHealth> {
        AdminManager::get_health(self.client(id)?).await
    }

    pub async fn get_version(&self, id: &str) -> GrafanaResult<GrafanaVersion> {
        AdminManager::get_version(self.client(id)?).await
    }

    pub async fn get_frontend_settings(&self, id: &str) -> GrafanaResult<serde_json::Value> {
        AdminManager::get_frontend_settings(self.client(id)?).await
    }

    pub async fn list_provisioned_dashboards(&self, id: &str) -> GrafanaResult<Vec<serde_json::Value>> {
        AdminManager::list_provisioned_dashboards(self.client(id)?).await
    }

    pub async fn list_provisioned_datasources(&self, id: &str) -> GrafanaResult<Vec<serde_json::Value>> {
        AdminManager::list_provisioned_datasources(self.client(id)?).await
    }

    pub async fn list_provisioned_alert_rules(&self, id: &str) -> GrafanaResult<Vec<serde_json::Value>> {
        AdminManager::list_provisioned_alert_rules(self.client(id)?).await
    }

    pub async fn reload_provisioning(&self, id: &str, provisioner: &str) -> GrafanaResult<()> {
        AdminManager::reload_provisioning(self.client(id)?, provisioner).await
    }

    pub async fn get_usage_stats(&self, id: &str) -> GrafanaResult<UsageStats> {
        AdminManager::get_usage_stats(self.client(id)?).await
    }
}
