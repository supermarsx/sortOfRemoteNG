//! Tauri command handlers for Grafana operations.

use tauri::State;

use crate::service::GrafanaServiceState;
use crate::types::*;

fn err_str(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ── Connection ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_connect(
    state: State<'_, GrafanaServiceState>,
    config: GrafanaConnectionConfig,
) -> Result<GrafanaConnectionSummary, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_disconnect(state: State<'_, GrafanaServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().map_err(err_str)
}

#[tauri::command]
pub async fn graf_is_connected(state: State<'_, GrafanaServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn graf_get_status(
    state: State<'_, GrafanaServiceState>,
) -> Result<GrafanaConnectionSummary, String> {
    let svc = state.lock().await;
    svc.get_status().await.map_err(err_str)
}

// ── Dashboards ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_search_dashboards(
    state: State<'_, GrafanaServiceState>,
    req: Option<SearchDashboardRequest>,
) -> Result<Vec<GrafanaDashboard>, String> {
    let svc = state.lock().await;
    svc.search_dashboards(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_dashboard(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<DashboardDetail, String> {
    let svc = state.lock().await;
    svc.get_dashboard(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_dashboard(
    state: State<'_, GrafanaServiceState>,
    req: CreateDashboardRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_dashboard(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_dashboard(
    state: State<'_, GrafanaServiceState>,
    req: CreateDashboardRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_dashboard(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_dashboard(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_dashboard(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_dashboard_versions(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
) -> Result<Vec<DashboardVersion>, String> {
    let svc = state.lock().await;
    svc.get_dashboard_versions(dashboard_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_dashboard_version(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
    version: i64,
) -> Result<DashboardVersion, String> {
    let svc = state.lock().await;
    svc.get_dashboard_version(dashboard_id, version).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_restore_dashboard_version(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
    version: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.restore_dashboard_version(dashboard_id, version).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_dashboard_permissions(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
) -> Result<Vec<DashboardPermission>, String> {
    let svc = state.lock().await;
    svc.get_dashboard_permissions(dashboard_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_dashboard_permissions(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
    permissions: Vec<DashboardPermission>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_dashboard_permissions(dashboard_id, permissions).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_star_dashboard(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.star_dashboard(dashboard_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_unstar_dashboard(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.unstar_dashboard(dashboard_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_home_dashboard(
    state: State<'_, GrafanaServiceState>,
) -> Result<DashboardDetail, String> {
    let svc = state.lock().await;
    svc.get_home_dashboard().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_set_home_dashboard(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.set_home_dashboard(dashboard_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_import_dashboard(
    state: State<'_, GrafanaServiceState>,
    json: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.import_dashboard(json).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_export_dashboard(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.export_dashboard(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_dashboard_tags(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.get_dashboard_tags().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_calculate_dashboard_diff(
    state: State<'_, GrafanaServiceState>,
    base_id: i64,
    base_version: i64,
    new_id: i64,
    new_version: i64,
    diff_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.calculate_dashboard_diff(base_id, base_version, new_id, new_version, diff_type)
        .await
        .map_err(err_str)
}

// ── Datasources ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_datasources(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<GrafanaDatasource>, String> {
    let svc = state.lock().await;
    svc.list_datasources().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_datasource_by_id(
    state: State<'_, GrafanaServiceState>,
    id: i64,
) -> Result<GrafanaDatasource, String> {
    let svc = state.lock().await;
    svc.get_datasource_by_id(id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_datasource_by_uid(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<GrafanaDatasource, String> {
    let svc = state.lock().await;
    svc.get_datasource_by_uid(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_datasource_by_name(
    state: State<'_, GrafanaServiceState>,
    name: String,
) -> Result<GrafanaDatasource, String> {
    let svc = state.lock().await;
    svc.get_datasource_by_name(&name).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_datasource(
    state: State<'_, GrafanaServiceState>,
    req: CreateDatasourceRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_datasource(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_datasource(
    state: State<'_, GrafanaServiceState>,
    id: i64,
    req: UpdateDatasourceRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_datasource(id, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_datasource(
    state: State<'_, GrafanaServiceState>,
    id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_datasource(id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_datasource_health_check(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<DatasourceHealth, String> {
    let svc = state.lock().await;
    svc.datasource_health_check(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_datasource_id_by_name(
    state: State<'_, GrafanaServiceState>,
    name: String,
) -> Result<i64, String> {
    let svc = state.lock().await;
    svc.get_datasource_id_by_name(&name).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_datasource_proxy_request(
    state: State<'_, GrafanaServiceState>,
    datasource_id: i64,
    path: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.datasource_proxy_request(datasource_id, &path).await.map_err(err_str)
}

// ── Folders ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_folders(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<GrafanaFolder>, String> {
    let svc = state.lock().await;
    svc.list_folders().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_folder(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<GrafanaFolder, String> {
    let svc = state.lock().await;
    svc.get_folder(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_folder(
    state: State<'_, GrafanaServiceState>,
    req: CreateFolderRequest,
) -> Result<GrafanaFolder, String> {
    let svc = state.lock().await;
    svc.create_folder(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_folder(
    state: State<'_, GrafanaServiceState>,
    uid: String,
    req: UpdateFolderRequest,
) -> Result<GrafanaFolder, String> {
    let svc = state.lock().await;
    svc.update_folder(&uid, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_folder(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_folder(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_folder_permissions(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<Vec<FolderPermission>, String> {
    let svc = state.lock().await;
    svc.get_folder_permissions(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_folder_permissions(
    state: State<'_, GrafanaServiceState>,
    uid: String,
    permissions: Vec<FolderPermission>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_folder_permissions(&uid, permissions).await.map_err(err_str)
}

// ── Organizations ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_orgs(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<GrafanaOrg>, String> {
    let svc = state.lock().await;
    svc.list_orgs().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_org(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
) -> Result<GrafanaOrg, String> {
    let svc = state.lock().await;
    svc.get_org(org_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_org(
    state: State<'_, GrafanaServiceState>,
    req: CreateOrgRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_org(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_org(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
    req: UpdateOrgRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_org(org_id, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_org(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_org(org_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_org_users(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
) -> Result<Vec<OrgUser>, String> {
    let svc = state.lock().await;
    svc.list_org_users(org_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_add_org_user(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
    login_or_email: String,
    role: OrgRole,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.add_org_user(org_id, &login_or_email, role).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_org_user_role(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
    user_id: i64,
    role: OrgRole,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_org_user_role(org_id, user_id, role).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_remove_org_user(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
    user_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.remove_org_user(org_id, user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_current_org(
    state: State<'_, GrafanaServiceState>,
) -> Result<GrafanaOrg, String> {
    let svc = state.lock().await;
    svc.get_current_org().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_switch_org(
    state: State<'_, GrafanaServiceState>,
    org_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.switch_org(org_id).await.map_err(err_str)
}

// ── Users ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_users(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<GlobalUser>, String> {
    let svc = state.lock().await;
    svc.list_users().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_user(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
) -> Result<GrafanaUser, String> {
    let svc = state.lock().await;
    svc.get_user(user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_user(
    state: State<'_, GrafanaServiceState>,
    req: CreateUserRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_user(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_user(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
    req: UpdateUserRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_user(user_id, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_user(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_user(user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_user_by_login(
    state: State<'_, GrafanaServiceState>,
    login: String,
) -> Result<GrafanaUser, String> {
    let svc = state.lock().await;
    svc.get_user_by_login(&login).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_user_by_email(
    state: State<'_, GrafanaServiceState>,
    email: String,
) -> Result<GrafanaUser, String> {
    let svc = state.lock().await;
    svc.get_user_by_email(&email).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_user_orgs(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
) -> Result<Vec<UserOrg>, String> {
    let svc = state.lock().await;
    svc.get_user_orgs(user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_set_user_password(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
    new_password: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.set_user_password(user_id, &new_password).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_enable_user(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.enable_user(user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_disable_user(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.disable_user(user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_user_auth_tokens(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let svc = state.lock().await;
    svc.list_user_auth_tokens(user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_revoke_user_auth_token(
    state: State<'_, GrafanaServiceState>,
    user_id: i64,
    token_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.revoke_user_auth_token(user_id, token_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_user_preferences(
    state: State<'_, GrafanaServiceState>,
) -> Result<UserPreferences, String> {
    let svc = state.lock().await;
    svc.get_user_preferences().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_user_preferences(
    state: State<'_, GrafanaServiceState>,
    prefs: UserPreferences,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_user_preferences(prefs).await.map_err(err_str)
}

// ── Teams ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_teams(
    state: State<'_, GrafanaServiceState>,
    query: Option<String>,
    page: Option<i64>,
    per_page: Option<i64>,
) -> Result<Vec<GrafanaTeam>, String> {
    let svc = state.lock().await;
    svc.list_teams(query, page, per_page).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_team(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
) -> Result<GrafanaTeam, String> {
    let svc = state.lock().await;
    svc.get_team(team_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_team(
    state: State<'_, GrafanaServiceState>,
    req: CreateTeamRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_team(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_team(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
    req: CreateTeamRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_team(team_id, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_team(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_team(team_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_team_members(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
) -> Result<Vec<TeamMember>, String> {
    let svc = state.lock().await;
    svc.list_team_members(team_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_add_team_member(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
    req: AddTeamMemberRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.add_team_member(team_id, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_remove_team_member(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
    user_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.remove_team_member(team_id, user_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_team_preferences(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
) -> Result<TeamPreferences, String> {
    let svc = state.lock().await;
    svc.get_team_preferences(team_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_team_preferences(
    state: State<'_, GrafanaServiceState>,
    team_id: i64,
    prefs: TeamPreferences,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_team_preferences(team_id, prefs).await.map_err(err_str)
}

// ── Alerting ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_alert_rules(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<AlertRule>, String> {
    let svc = state.lock().await;
    svc.list_alert_rules().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_alert_rule(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<AlertRule, String> {
    let svc = state.lock().await;
    svc.get_alert_rule(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_alert_rule(
    state: State<'_, GrafanaServiceState>,
    req: CreateAlertRuleRequest,
) -> Result<AlertRule, String> {
    let svc = state.lock().await;
    svc.create_alert_rule(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_alert_rule(
    state: State<'_, GrafanaServiceState>,
    uid: String,
    req: CreateAlertRuleRequest,
) -> Result<AlertRule, String> {
    let svc = state.lock().await;
    svc.update_alert_rule(&uid, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_alert_rule(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_alert_rule(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_alert_rule_groups(
    state: State<'_, GrafanaServiceState>,
    folder_uid: String,
) -> Result<Vec<AlertRuleGroup>, String> {
    let svc = state.lock().await;
    svc.list_alert_rule_groups(&folder_uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_alert_rule_group(
    state: State<'_, GrafanaServiceState>,
    folder_uid: String,
    group_name: String,
) -> Result<AlertRuleGroup, String> {
    let svc = state.lock().await;
    svc.get_alert_rule_group(&folder_uid, &group_name).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_set_alert_rule_group_interval(
    state: State<'_, GrafanaServiceState>,
    folder_uid: String,
    group_name: String,
    interval_secs: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.set_alert_rule_group_interval(&folder_uid, &group_name, interval_secs)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_contact_points(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<ContactPoint>, String> {
    let svc = state.lock().await;
    svc.list_contact_points().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_contact_point(
    state: State<'_, GrafanaServiceState>,
    cp: ContactPoint,
) -> Result<ContactPoint, String> {
    let svc = state.lock().await;
    svc.create_contact_point(cp).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_contact_point(
    state: State<'_, GrafanaServiceState>,
    uid: String,
    cp: ContactPoint,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_contact_point(&uid, cp).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_contact_point(
    state: State<'_, GrafanaServiceState>,
    uid: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_contact_point(&uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_notification_policy(
    state: State<'_, GrafanaServiceState>,
) -> Result<NotificationPolicy, String> {
    let svc = state.lock().await;
    svc.get_notification_policy().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_set_notification_policy(
    state: State<'_, GrafanaServiceState>,
    policy: NotificationPolicy,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.set_notification_policy(policy).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_mute_timings(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<MuteTimeInterval>, String> {
    let svc = state.lock().await;
    svc.list_mute_timings().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_mute_timing(
    state: State<'_, GrafanaServiceState>,
    mute: MuteTimeInterval,
) -> Result<MuteTimeInterval, String> {
    let svc = state.lock().await;
    svc.create_mute_timing(mute).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_mute_timing(
    state: State<'_, GrafanaServiceState>,
    name: String,
    mute: MuteTimeInterval,
) -> Result<MuteTimeInterval, String> {
    let svc = state.lock().await;
    svc.update_mute_timing(&name, mute).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_mute_timing(
    state: State<'_, GrafanaServiceState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_mute_timing(&name).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_alert_instances(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<AlertInstance>, String> {
    let svc = state.lock().await;
    svc.list_alert_instances().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_alert_state_history(
    state: State<'_, GrafanaServiceState>,
    rule_uid: String,
) -> Result<AlertStateHistory, String> {
    let svc = state.lock().await;
    svc.get_alert_state_history(&rule_uid).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_test_alert_receivers(
    state: State<'_, GrafanaServiceState>,
    receivers: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.test_alert_receivers(receivers).await.map_err(err_str)
}

// ── Annotations ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_annotations(
    state: State<'_, GrafanaServiceState>,
    from: Option<i64>,
    to: Option<i64>,
    dashboard_id: Option<i64>,
    panel_id: Option<i64>,
    tags: Option<Vec<String>>,
    limit: Option<i64>,
) -> Result<Vec<GrafanaAnnotation>, String> {
    let svc = state.lock().await;
    svc.list_annotations(from, to, dashboard_id, panel_id, tags, limit)
        .await
        .map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_annotation(
    state: State<'_, GrafanaServiceState>,
    req: CreateAnnotationRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_annotation(req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_annotation(
    state: State<'_, GrafanaServiceState>,
    annotation_id: i64,
    req: UpdateAnnotationRequest,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_annotation(annotation_id, req).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_delete_annotation(
    state: State<'_, GrafanaServiceState>,
    annotation_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_annotation(annotation_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_annotation(
    state: State<'_, GrafanaServiceState>,
    annotation_id: i64,
) -> Result<GrafanaAnnotation, String> {
    let svc = state.lock().await;
    svc.get_annotation(annotation_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_create_graphite_annotation(
    state: State<'_, GrafanaServiceState>,
    what: String,
    tags: Vec<String>,
    when: Option<i64>,
    data: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_graphite_annotation(&what, tags, when, data).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_list_annotation_tags(
    state: State<'_, GrafanaServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.list_annotation_tags().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_mass_delete_annotations(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: Option<i64>,
    panel_id: Option<i64>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.mass_delete_annotations(dashboard_id, panel_id).await.map_err(err_str)
}

// ── Plugins ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_list_plugins(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<GrafanaPlugin>, String> {
    let svc = state.lock().await;
    svc.list_plugins().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_plugin(
    state: State<'_, GrafanaServiceState>,
    plugin_id: String,
) -> Result<GrafanaPlugin, String> {
    let svc = state.lock().await;
    svc.get_plugin(&plugin_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_install_plugin(
    state: State<'_, GrafanaServiceState>,
    plugin_id: String,
    version: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.install_plugin(&plugin_id, version).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_uninstall_plugin(
    state: State<'_, GrafanaServiceState>,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.uninstall_plugin(&plugin_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_plugin_settings(
    state: State<'_, GrafanaServiceState>,
    plugin_id: String,
) -> Result<PluginSetting, String> {
    let svc = state.lock().await;
    svc.get_plugin_settings(&plugin_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_plugin_settings(
    state: State<'_, GrafanaServiceState>,
    plugin_id: String,
    settings: PluginSetting,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_plugin_settings(&plugin_id, settings).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_plugin_health(
    state: State<'_, GrafanaServiceState>,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_plugin_health(&plugin_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_plugin_metrics(
    state: State<'_, GrafanaServiceState>,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_plugin_metrics(&plugin_id).await.map_err(err_str)
}

// ── Preferences ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn graf_get_prefs_user(
    state: State<'_, GrafanaServiceState>,
) -> Result<UserPreferences, String> {
    let svc = state.lock().await;
    svc.get_prefs_user().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_prefs_user(
    state: State<'_, GrafanaServiceState>,
    prefs: UserPreferences,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_prefs_user(prefs).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_get_prefs_org(
    state: State<'_, GrafanaServiceState>,
) -> Result<OrgPreferences, String> {
    let svc = state.lock().await;
    svc.get_prefs_org().await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_update_prefs_org(
    state: State<'_, GrafanaServiceState>,
    prefs: OrgPreferences,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.update_prefs_org(prefs).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_prefs_star_dashboard(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.prefs_star_dashboard(dashboard_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_prefs_unstar_dashboard(
    state: State<'_, GrafanaServiceState>,
    dashboard_id: i64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.prefs_unstar_dashboard(dashboard_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn graf_prefs_list_starred(
    state: State<'_, GrafanaServiceState>,
) -> Result<Vec<GrafanaDashboard>, String> {
    let svc = state.lock().await;
    svc.prefs_list_starred().await.map_err(err_str)
}
