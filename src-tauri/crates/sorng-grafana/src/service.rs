//! Service facade for Grafana operations.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::alerting::AlertManager;
use crate::annotations::AnnotationManager;
use crate::client::GrafanaClient;
use crate::dashboards::DashboardManager;
use crate::datasources::DatasourceManager;
use crate::error::{GrafanaError, GrafanaResult};
use crate::folders::FolderManager;
use crate::organizations::OrgManager;
use crate::plugins::PluginManager;
use crate::preferences::PreferencesManager;
use crate::teams::TeamManager;
use crate::types::*;
use crate::users::UserManager;

pub type GrafanaServiceState = Arc<Mutex<GrafanaService>>;

pub struct GrafanaService {
    client: Option<GrafanaClient>,
}

impl GrafanaService {
    pub fn new() -> GrafanaServiceState {
        Arc::new(Mutex::new(Self { client: None }))
    }

    fn client(&self) -> GrafanaResult<&GrafanaClient> {
        self.client.as_ref().ok_or_else(GrafanaError::not_connected)
    }

    // ── Connection ──────────────────────────────────────────────────────────

    pub async fn connect(&mut self, config: GrafanaConnectionConfig) -> GrafanaResult<GrafanaConnectionSummary> {
        if self.client.is_some() {
            return Err(GrafanaError::already_connected());
        }
        let client = GrafanaClient::new(config)?;
        // Verify connectivity by fetching health
        let health: serde_json::Value = client.api_get("/health").await?;
        let version = health.get("version").and_then(|v| v.as_str()).map(String::from);
        let summary = GrafanaConnectionSummary {
            host: client.config.host.clone(),
            version,
            edition: health.get("edition").and_then(|v| v.as_str()).map(String::from),
            database_type: health.get("database").and_then(|v| v.as_str()).map(String::from),
            license_status: None,
            org_name: None,
        };
        self.client = Some(client);
        Ok(summary)
    }

    pub fn disconnect(&mut self) -> GrafanaResult<()> {
        self.client.take().ok_or_else(GrafanaError::not_connected)?;
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.client.is_some()
    }

    pub async fn get_status(&self) -> GrafanaResult<GrafanaConnectionSummary> {
        let c = self.client()?;
        let health: serde_json::Value = c.api_get("/health").await?;
        Ok(GrafanaConnectionSummary {
            host: c.config.host.clone(),
            version: health.get("version").and_then(|v| v.as_str()).map(String::from),
            edition: health.get("edition").and_then(|v| v.as_str()).map(String::from),
            database_type: health.get("database").and_then(|v| v.as_str()).map(String::from),
            license_status: None,
            org_name: None,
        })
    }

    // ── Dashboards ──────────────────────────────────────────────────────────

    pub async fn search_dashboards(&self, req: Option<SearchDashboardRequest>) -> GrafanaResult<Vec<GrafanaDashboard>> {
        DashboardManager::new(self.client()?).search(req).await
    }

    pub async fn get_dashboard(&self, uid: &str) -> GrafanaResult<DashboardDetail> {
        DashboardManager::new(self.client()?).get_by_uid(uid).await
    }

    pub async fn create_dashboard(&self, req: CreateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).create(req).await
    }

    pub async fn update_dashboard(&self, req: CreateDashboardRequest) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).update(req).await
    }

    pub async fn delete_dashboard(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).delete(uid).await
    }

    pub async fn get_dashboard_versions(&self, dashboard_id: i64) -> GrafanaResult<Vec<DashboardVersion>> {
        DashboardManager::new(self.client()?).get_versions(dashboard_id).await
    }

    pub async fn get_dashboard_version(&self, dashboard_id: i64, version: i64) -> GrafanaResult<DashboardVersion> {
        DashboardManager::new(self.client()?).get_version(dashboard_id, version).await
    }

    pub async fn restore_dashboard_version(&self, dashboard_id: i64, version: i64) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).restore_version(dashboard_id, version).await
    }

    pub async fn get_dashboard_permissions(&self, dashboard_id: i64) -> GrafanaResult<Vec<DashboardPermission>> {
        DashboardManager::new(self.client()?).get_permissions(dashboard_id).await
    }

    pub async fn update_dashboard_permissions(&self, dashboard_id: i64, permissions: Vec<DashboardPermission>) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).update_permissions(dashboard_id, permissions).await
    }

    pub async fn star_dashboard(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).star(dashboard_id).await
    }

    pub async fn unstar_dashboard(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).unstar(dashboard_id).await
    }

    pub async fn get_home_dashboard(&self) -> GrafanaResult<DashboardDetail> {
        DashboardManager::new(self.client()?).get_home().await
    }

    pub async fn set_home_dashboard(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).set_home(dashboard_id).await
    }

    pub async fn import_dashboard(&self, json: serde_json::Value) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).import(json).await
    }

    pub async fn export_dashboard(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).export(uid).await
    }

    pub async fn get_dashboard_tags(&self) -> GrafanaResult<Vec<serde_json::Value>> {
        DashboardManager::new(self.client()?).get_tags().await
    }

    pub async fn calculate_dashboard_diff(
        &self,
        base_id: i64,
        base_version: i64,
        new_id: i64,
        new_version: i64,
        diff_type: Option<String>,
    ) -> GrafanaResult<serde_json::Value> {
        DashboardManager::new(self.client()?).calculate_diff(base_id, base_version, new_id, new_version, diff_type).await
    }

    // ── Datasources ─────────────────────────────────────────────────────────

    pub async fn list_datasources(&self) -> GrafanaResult<Vec<GrafanaDatasource>> {
        DatasourceManager::new(self.client()?).list().await
    }

    pub async fn get_datasource_by_id(&self, id: i64) -> GrafanaResult<GrafanaDatasource> {
        DatasourceManager::new(self.client()?).get_by_id(id).await
    }

    pub async fn get_datasource_by_uid(&self, uid: &str) -> GrafanaResult<GrafanaDatasource> {
        DatasourceManager::new(self.client()?).get_by_uid(uid).await
    }

    pub async fn get_datasource_by_name(&self, name: &str) -> GrafanaResult<GrafanaDatasource> {
        DatasourceManager::new(self.client()?).get_by_name(name).await
    }

    pub async fn create_datasource(&self, req: CreateDatasourceRequest) -> GrafanaResult<serde_json::Value> {
        DatasourceManager::new(self.client()?).create(req).await
    }

    pub async fn update_datasource(&self, id: i64, req: UpdateDatasourceRequest) -> GrafanaResult<serde_json::Value> {
        DatasourceManager::new(self.client()?).update(id, req).await
    }

    pub async fn delete_datasource(&self, id: i64) -> GrafanaResult<serde_json::Value> {
        DatasourceManager::new(self.client()?).delete(id).await
    }

    pub async fn datasource_health_check(&self, uid: &str) -> GrafanaResult<DatasourceHealth> {
        DatasourceManager::new(self.client()?).health_check(uid).await
    }

    pub async fn get_datasource_id_by_name(&self, name: &str) -> GrafanaResult<i64> {
        DatasourceManager::new(self.client()?).get_id_by_name(name).await
    }

    pub async fn datasource_proxy_request(&self, datasource_id: i64, path: &str) -> GrafanaResult<serde_json::Value> {
        DatasourceManager::new(self.client()?).proxy_request(datasource_id, path).await
    }

    // ── Folders ─────────────────────────────────────────────────────────────

    pub async fn list_folders(&self) -> GrafanaResult<Vec<GrafanaFolder>> {
        FolderManager::new(self.client()?).list().await
    }

    pub async fn get_folder(&self, uid: &str) -> GrafanaResult<GrafanaFolder> {
        FolderManager::new(self.client()?).get_by_uid(uid).await
    }

    pub async fn create_folder(&self, req: CreateFolderRequest) -> GrafanaResult<GrafanaFolder> {
        FolderManager::new(self.client()?).create(req).await
    }

    pub async fn update_folder(&self, uid: &str, req: UpdateFolderRequest) -> GrafanaResult<GrafanaFolder> {
        FolderManager::new(self.client()?).update(uid, req).await
    }

    pub async fn delete_folder(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        FolderManager::new(self.client()?).delete(uid).await
    }

    pub async fn get_folder_permissions(&self, uid: &str) -> GrafanaResult<Vec<FolderPermission>> {
        FolderManager::new(self.client()?).get_permissions(uid).await
    }

    pub async fn update_folder_permissions(&self, uid: &str, permissions: Vec<FolderPermission>) -> GrafanaResult<serde_json::Value> {
        FolderManager::new(self.client()?).update_permissions(uid, permissions).await
    }

    // ── Organizations ───────────────────────────────────────────────────────

    pub async fn list_orgs(&self) -> GrafanaResult<Vec<GrafanaOrg>> {
        OrgManager::new(self.client()?).list().await
    }

    pub async fn get_org(&self, org_id: i64) -> GrafanaResult<GrafanaOrg> {
        OrgManager::new(self.client()?).get(org_id).await
    }

    pub async fn create_org(&self, req: CreateOrgRequest) -> GrafanaResult<serde_json::Value> {
        OrgManager::new(self.client()?).create(req).await
    }

    pub async fn update_org(&self, org_id: i64, req: UpdateOrgRequest) -> GrafanaResult<serde_json::Value> {
        OrgManager::new(self.client()?).update(org_id, req).await
    }

    pub async fn delete_org(&self, org_id: i64) -> GrafanaResult<serde_json::Value> {
        OrgManager::new(self.client()?).delete(org_id).await
    }

    pub async fn list_org_users(&self, org_id: i64) -> GrafanaResult<Vec<OrgUser>> {
        OrgManager::new(self.client()?).list_users(org_id).await
    }

    pub async fn add_org_user(&self, org_id: i64, login_or_email: &str, role: OrgRole) -> GrafanaResult<serde_json::Value> {
        OrgManager::new(self.client()?).add_user(org_id, login_or_email, role).await
    }

    pub async fn update_org_user_role(&self, org_id: i64, user_id: i64, role: OrgRole) -> GrafanaResult<serde_json::Value> {
        OrgManager::new(self.client()?).update_user_role(org_id, user_id, role).await
    }

    pub async fn remove_org_user(&self, org_id: i64, user_id: i64) -> GrafanaResult<serde_json::Value> {
        OrgManager::new(self.client()?).remove_user(org_id, user_id).await
    }

    pub async fn get_current_org(&self) -> GrafanaResult<GrafanaOrg> {
        OrgManager::new(self.client()?).get_current().await
    }

    pub async fn switch_org(&self, org_id: i64) -> GrafanaResult<serde_json::Value> {
        OrgManager::new(self.client()?).switch_current(org_id).await
    }

    // ── Users ───────────────────────────────────────────────────────────────

    pub async fn list_users(&self) -> GrafanaResult<Vec<GlobalUser>> {
        UserManager::new(self.client()?).list().await
    }

    pub async fn get_user(&self, user_id: i64) -> GrafanaResult<GrafanaUser> {
        UserManager::new(self.client()?).get(user_id).await
    }

    pub async fn create_user(&self, req: CreateUserRequest) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).create(req).await
    }

    pub async fn update_user(&self, user_id: i64, req: UpdateUserRequest) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).update(user_id, req).await
    }

    pub async fn delete_user(&self, user_id: i64) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).delete(user_id).await
    }

    pub async fn get_user_by_login(&self, login: &str) -> GrafanaResult<GrafanaUser> {
        UserManager::new(self.client()?).get_by_login(login).await
    }

    pub async fn get_user_by_email(&self, email: &str) -> GrafanaResult<GrafanaUser> {
        UserManager::new(self.client()?).get_by_email(email).await
    }

    pub async fn get_user_orgs(&self, user_id: i64) -> GrafanaResult<Vec<UserOrg>> {
        UserManager::new(self.client()?).get_orgs(user_id).await
    }

    pub async fn set_user_password(&self, user_id: i64, new_password: &str) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).set_password(user_id, new_password).await
    }

    pub async fn enable_user(&self, user_id: i64) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).enable(user_id).await
    }

    pub async fn disable_user(&self, user_id: i64) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).disable(user_id).await
    }

    pub async fn list_user_auth_tokens(&self, user_id: i64) -> GrafanaResult<Vec<serde_json::Value>> {
        UserManager::new(self.client()?).list_auth_tokens(user_id).await
    }

    pub async fn revoke_user_auth_token(&self, user_id: i64, token_id: i64) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).revoke_auth_token(user_id, token_id).await
    }

    pub async fn get_user_preferences(&self) -> GrafanaResult<UserPreferences> {
        UserManager::new(self.client()?).get_preferences().await
    }

    pub async fn update_user_preferences(&self, prefs: UserPreferences) -> GrafanaResult<serde_json::Value> {
        UserManager::new(self.client()?).update_preferences(prefs).await
    }

    // ── Teams ───────────────────────────────────────────────────────────────

    pub async fn list_teams(&self, query: Option<String>, page: Option<i64>, per_page: Option<i64>) -> GrafanaResult<Vec<GrafanaTeam>> {
        TeamManager::new(self.client()?).list(query.as_deref(), page, per_page).await
    }

    pub async fn get_team(&self, team_id: i64) -> GrafanaResult<GrafanaTeam> {
        TeamManager::new(self.client()?).get(team_id).await
    }

    pub async fn create_team(&self, req: CreateTeamRequest) -> GrafanaResult<serde_json::Value> {
        TeamManager::new(self.client()?).create(req).await
    }

    pub async fn update_team(&self, team_id: i64, req: CreateTeamRequest) -> GrafanaResult<serde_json::Value> {
        TeamManager::new(self.client()?).update(team_id, req).await
    }

    pub async fn delete_team(&self, team_id: i64) -> GrafanaResult<serde_json::Value> {
        TeamManager::new(self.client()?).delete(team_id).await
    }

    pub async fn list_team_members(&self, team_id: i64) -> GrafanaResult<Vec<TeamMember>> {
        TeamManager::new(self.client()?).list_members(team_id).await
    }

    pub async fn add_team_member(&self, team_id: i64, req: AddTeamMemberRequest) -> GrafanaResult<serde_json::Value> {
        TeamManager::new(self.client()?).add_member(team_id, req).await
    }

    pub async fn remove_team_member(&self, team_id: i64, user_id: i64) -> GrafanaResult<serde_json::Value> {
        TeamManager::new(self.client()?).remove_member(team_id, user_id).await
    }

    pub async fn get_team_preferences(&self, team_id: i64) -> GrafanaResult<TeamPreferences> {
        TeamManager::new(self.client()?).get_preferences(team_id).await
    }

    pub async fn update_team_preferences(&self, team_id: i64, prefs: TeamPreferences) -> GrafanaResult<serde_json::Value> {
        TeamManager::new(self.client()?).update_preferences(team_id, prefs).await
    }

    // ── Alerting ────────────────────────────────────────────────────────────

    pub async fn list_alert_rules(&self) -> GrafanaResult<Vec<AlertRule>> {
        AlertManager::new(self.client()?).list_rules().await
    }

    pub async fn get_alert_rule(&self, uid: &str) -> GrafanaResult<AlertRule> {
        AlertManager::new(self.client()?).get_rule(uid).await
    }

    pub async fn create_alert_rule(&self, req: CreateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        AlertManager::new(self.client()?).create_rule(req).await
    }

    pub async fn update_alert_rule(&self, uid: &str, req: CreateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        AlertManager::new(self.client()?).update_rule(uid, req).await
    }

    pub async fn delete_alert_rule(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        AlertManager::new(self.client()?).delete_rule(uid).await
    }

    pub async fn list_alert_rule_groups(&self, folder_uid: &str) -> GrafanaResult<Vec<AlertRuleGroup>> {
        AlertManager::new(self.client()?).list_rule_groups(folder_uid).await
    }

    pub async fn get_alert_rule_group(&self, folder_uid: &str, group_name: &str) -> GrafanaResult<AlertRuleGroup> {
        AlertManager::new(self.client()?).get_rule_group(folder_uid, group_name).await
    }

    pub async fn set_alert_rule_group_interval(&self, folder_uid: &str, group_name: &str, interval_secs: i64) -> GrafanaResult<serde_json::Value> {
        AlertManager::new(self.client()?).set_rule_group_interval(folder_uid, group_name, interval_secs).await
    }

    pub async fn list_contact_points(&self) -> GrafanaResult<Vec<ContactPoint>> {
        AlertManager::new(self.client()?).list_contact_points().await
    }

    pub async fn create_contact_point(&self, cp: ContactPoint) -> GrafanaResult<ContactPoint> {
        AlertManager::new(self.client()?).create_contact_point(cp).await
    }

    pub async fn update_contact_point(&self, uid: &str, cp: ContactPoint) -> GrafanaResult<serde_json::Value> {
        AlertManager::new(self.client()?).update_contact_point(uid, cp).await
    }

    pub async fn delete_contact_point(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        AlertManager::new(self.client()?).delete_contact_point(uid).await
    }

    pub async fn get_notification_policy(&self) -> GrafanaResult<NotificationPolicy> {
        AlertManager::new(self.client()?).get_notification_policy().await
    }

    pub async fn set_notification_policy(&self, policy: NotificationPolicy) -> GrafanaResult<serde_json::Value> {
        AlertManager::new(self.client()?).set_notification_policy(policy).await
    }

    pub async fn list_mute_timings(&self) -> GrafanaResult<Vec<MuteTimeInterval>> {
        AlertManager::new(self.client()?).list_mute_timings().await
    }

    pub async fn create_mute_timing(&self, mute: MuteTimeInterval) -> GrafanaResult<MuteTimeInterval> {
        AlertManager::new(self.client()?).create_mute_timing(mute).await
    }

    pub async fn update_mute_timing(&self, name: &str, mute: MuteTimeInterval) -> GrafanaResult<MuteTimeInterval> {
        AlertManager::new(self.client()?).update_mute_timing(name, mute).await
    }

    pub async fn delete_mute_timing(&self, name: &str) -> GrafanaResult<serde_json::Value> {
        AlertManager::new(self.client()?).delete_mute_timing(name).await
    }

    pub async fn list_alert_instances(&self) -> GrafanaResult<Vec<AlertInstance>> {
        AlertManager::new(self.client()?).list_alert_instances().await
    }

    pub async fn get_alert_state_history(&self, rule_uid: &str) -> GrafanaResult<AlertStateHistory> {
        AlertManager::new(self.client()?).get_state_history(rule_uid).await
    }

    pub async fn test_alert_receivers(&self, receivers: serde_json::Value) -> GrafanaResult<serde_json::Value> {
        AlertManager::new(self.client()?).test_receivers(receivers).await
    }

    // ── Annotations ─────────────────────────────────────────────────────────

    pub async fn list_annotations(
        &self,
        from: Option<i64>,
        to: Option<i64>,
        dashboard_id: Option<i64>,
        panel_id: Option<i64>,
        tags: Option<Vec<String>>,
        limit: Option<i64>,
    ) -> GrafanaResult<Vec<GrafanaAnnotation>> {
        AnnotationManager::new(self.client()?).list(from, to, dashboard_id, panel_id, tags, limit).await
    }

    pub async fn create_annotation(&self, req: CreateAnnotationRequest) -> GrafanaResult<serde_json::Value> {
        AnnotationManager::new(self.client()?).create(req).await
    }

    pub async fn update_annotation(&self, id: i64, req: UpdateAnnotationRequest) -> GrafanaResult<serde_json::Value> {
        AnnotationManager::new(self.client()?).update(id, req).await
    }

    pub async fn delete_annotation(&self, id: i64) -> GrafanaResult<serde_json::Value> {
        AnnotationManager::new(self.client()?).delete(id).await
    }

    pub async fn get_annotation(&self, id: i64) -> GrafanaResult<GrafanaAnnotation> {
        AnnotationManager::new(self.client()?).get_by_id(id).await
    }

    pub async fn create_graphite_annotation(
        &self,
        what: &str,
        tags: Vec<String>,
        when: Option<i64>,
        data: Option<String>,
    ) -> GrafanaResult<serde_json::Value> {
        AnnotationManager::new(self.client()?).create_graphite(what, tags, when, data.as_deref()).await
    }

    pub async fn list_annotation_tags(&self) -> GrafanaResult<serde_json::Value> {
        AnnotationManager::new(self.client()?).list_tags().await
    }

    pub async fn mass_delete_annotations(
        &self,
        dashboard_id: Option<i64>,
        panel_id: Option<i64>,
    ) -> GrafanaResult<serde_json::Value> {
        AnnotationManager::new(self.client()?).mass_delete(dashboard_id, panel_id).await
    }

    // ── Plugins ─────────────────────────────────────────────────────────────

    pub async fn list_plugins(&self) -> GrafanaResult<Vec<GrafanaPlugin>> {
        PluginManager::new(self.client()?).list().await
    }

    pub async fn get_plugin(&self, plugin_id: &str) -> GrafanaResult<GrafanaPlugin> {
        PluginManager::new(self.client()?).get(plugin_id).await
    }

    pub async fn install_plugin(&self, plugin_id: &str, version: Option<String>) -> GrafanaResult<serde_json::Value> {
        PluginManager::new(self.client()?).install(plugin_id, version.as_deref()).await
    }

    pub async fn uninstall_plugin(&self, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        PluginManager::new(self.client()?).uninstall(plugin_id).await
    }

    pub async fn get_plugin_settings(&self, plugin_id: &str) -> GrafanaResult<PluginSetting> {
        PluginManager::new(self.client()?).get_settings(plugin_id).await
    }

    pub async fn update_plugin_settings(&self, plugin_id: &str, settings: PluginSetting) -> GrafanaResult<serde_json::Value> {
        PluginManager::new(self.client()?).update_settings(plugin_id, settings).await
    }

    pub async fn get_plugin_health(&self, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        PluginManager::new(self.client()?).get_health(plugin_id).await
    }

    pub async fn get_plugin_metrics(&self, plugin_id: &str) -> GrafanaResult<serde_json::Value> {
        PluginManager::new(self.client()?).get_metrics(plugin_id).await
    }

    // ── Preferences ─────────────────────────────────────────────────────────

    pub async fn get_prefs_user(&self) -> GrafanaResult<UserPreferences> {
        PreferencesManager::new(self.client()?).get_user_prefs().await
    }

    pub async fn update_prefs_user(&self, prefs: UserPreferences) -> GrafanaResult<serde_json::Value> {
        PreferencesManager::new(self.client()?).update_user_prefs(prefs).await
    }

    pub async fn get_prefs_org(&self) -> GrafanaResult<OrgPreferences> {
        PreferencesManager::new(self.client()?).get_org_prefs().await
    }

    pub async fn update_prefs_org(&self, prefs: OrgPreferences) -> GrafanaResult<serde_json::Value> {
        PreferencesManager::new(self.client()?).update_org_prefs(prefs).await
    }

    pub async fn prefs_star_dashboard(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        PreferencesManager::new(self.client()?).star_dashboard(dashboard_id).await
    }

    pub async fn prefs_unstar_dashboard(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        PreferencesManager::new(self.client()?).unstar_dashboard(dashboard_id).await
    }

    pub async fn prefs_list_starred(&self) -> GrafanaResult<Vec<GrafanaDashboard>> {
        PreferencesManager::new(self.client()?).list_starred().await
    }
}
