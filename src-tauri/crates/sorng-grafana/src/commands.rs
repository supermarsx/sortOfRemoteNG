// ── sorng-grafana/src/commands.rs ─────────────────────────────────────────────
//! Tauri commands – thin wrappers around `GrafanaService`.

use tauri::State;
use crate::service::GrafanaServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_connect(
    state: State<'_, GrafanaServiceState>,
    id: String,
    config: GrafanaConnectionConfig,
) -> CmdResult<GrafanaConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_disconnect(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_connections(
    state: State<'_, GrafanaServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Dashboards ────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_dashboards(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<DashboardSearchResult>> {
    state.lock().await.list_dashboards(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_search_dashboards(
    state: State<'_, GrafanaServiceState>,
    id: String,
    query: DashboardSearchQuery,
) -> CmdResult<Vec<DashboardSearchResult>> {
    state.lock().await.search_dashboards(&id, &query).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_dashboard(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_dashboard_by_uid(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_dashboard_by_uid(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateDashboardRequest,
) -> CmdResult<serde_json::Value> {
    state.lock().await.create_dashboard(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: UpdateDashboardRequest,
) -> CmdResult<serde_json::Value> {
    state.lock().await.update_dashboard(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.delete_dashboard(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_dashboard_versions(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: i64,
) -> CmdResult<Vec<DashboardVersion>> {
    state.lock().await.get_dashboard_versions(&id, dashboard_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_restore_dashboard_version(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: i64,
    version: i64,
) -> CmdResult<serde_json::Value> {
    state.lock().await.restore_dashboard_version(&id, dashboard_id, version).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_dashboard_permissions(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Vec<DashboardPermission>> {
    state.lock().await.get_dashboard_permissions(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_dashboard_permissions(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    request: UpdatePermissionsRequest,
) -> CmdResult<()> {
    state.lock().await.update_dashboard_permissions(&id, &uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_dashboard_tags(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state.lock().await.get_dashboard_tags(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_export_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.export_dashboard(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_import_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: ImportDashboardRequest,
) -> CmdResult<serde_json::Value> {
    state.lock().await.import_dashboard(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_star_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: i64,
) -> CmdResult<()> {
    state.lock().await.star_dashboard(&id, dashboard_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_unstar_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: i64,
) -> CmdResult<()> {
    state.lock().await.unstar_dashboard(&id, dashboard_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_home_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_home_dashboard(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_set_home_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: i64,
) -> CmdResult<()> {
    state.lock().await.set_home_dashboard(&id, dashboard_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_calculate_diff(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: DashboardDiffRequest,
) -> CmdResult<DashboardDiff> {
    state.lock().await.calculate_diff(&id, &request).await.map_err(map_err)
}

// ── Datasources ───────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_datasources(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Datasource>> {
    state.lock().await.list_datasources(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: i64,
) -> CmdResult<Datasource> {
    state.lock().await.get_datasource(&id, ds_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_datasource_by_uid(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Datasource> {
    state.lock().await.get_datasource_by_uid(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateDatasourceRequest,
) -> CmdResult<Datasource> {
    state.lock().await.create_datasource(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: i64,
    request: UpdateDatasourceRequest,
) -> CmdResult<Datasource> {
    state.lock().await.update_datasource(&id, ds_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_datasource(&id, ds_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_test_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: i64,
) -> CmdResult<DatasourceHealth> {
    state.lock().await.test_datasource(&id, ds_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_datasource_health(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<DatasourceHealth> {
    state.lock().await.get_datasource_health(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_datasource_types(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<DatasourceType>> {
    state.lock().await.list_datasource_types(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_datasource_proxy(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: i64,
    path: String,
) -> CmdResult<String> {
    state.lock().await.get_datasource_proxy(&id, ds_id, &path).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_query_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: QueryDatasourceRequest,
) -> CmdResult<serde_json::Value> {
    state.lock().await.query_datasource(&id, &request).await.map_err(map_err)
}

// ── Folders ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_folders(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Folder>> {
    state.lock().await.list_folders(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_folder(
    state: State<'_, GrafanaServiceState>,
    id: String,
    folder_id: i64,
) -> CmdResult<Folder> {
    state.lock().await.get_folder(&id, folder_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_folder_by_uid(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Folder> {
    state.lock().await.get_folder_by_uid(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_folder(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateFolderRequest,
) -> CmdResult<Folder> {
    state.lock().await.create_folder(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_folder(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    request: UpdateFolderRequest,
) -> CmdResult<Folder> {
    state.lock().await.update_folder(&id, &uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_folder(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.delete_folder(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_folder_permissions(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Vec<FolderPermission>> {
    state.lock().await.get_folder_permissions(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_folder_permissions(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    request: UpdateFolderPermissionsRequest,
) -> CmdResult<()> {
    state.lock().await.update_folder_permissions(&id, &uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_move_dashboard_to_folder(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_uid: String,
    request: MoveDashboardRequest,
) -> CmdResult<()> {
    state.lock().await.move_dashboard_to_folder(&id, &dashboard_uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_folder_dashboards(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Vec<DashboardSearchResult>> {
    state.lock().await.list_folder_dashboards(&id, &uid).await.map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_users(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<GrafanaUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    user_id: i64,
) -> CmdResult<GrafanaUser> {
    state.lock().await.get_user(&id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_user_by_login(
    state: State<'_, GrafanaServiceState>,
    id: String,
    login: String,
) -> CmdResult<GrafanaUser> {
    state.lock().await.get_user_by_login(&id, &login).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateUserRequest,
) -> CmdResult<GrafanaUser> {
    state.lock().await.create_user(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    user_id: i64,
    request: UpdateUserRequest,
) -> CmdResult<()> {
    state.lock().await.update_user(&id, user_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    user_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_user(&id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_user_orgs(
    state: State<'_, GrafanaServiceState>,
    id: String,
    user_id: i64,
) -> CmdResult<Vec<UserOrg>> {
    state.lock().await.get_user_orgs(&id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_add_user_to_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
    request: AddUserToOrgRequest,
) -> CmdResult<()> {
    state.lock().await.add_user_to_org(&id, org_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_remove_user_from_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
    user_id: i64,
) -> CmdResult<()> {
    state.lock().await.remove_user_from_org(&id, org_id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_user_role(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
    user_id: i64,
    request: UpdateUserRoleRequest,
) -> CmdResult<()> {
    state.lock().await.update_user_role(&id, org_id, user_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_user_preferences(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<UserPreferences> {
    state.lock().await.get_user_preferences(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_user_preferences(
    state: State<'_, GrafanaServiceState>,
    id: String,
    prefs: UserPreferences,
) -> CmdResult<()> {
    state.lock().await.update_user_preferences(&id, &prefs).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_change_user_password(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: ChangePasswordRequest,
) -> CmdResult<()> {
    state.lock().await.change_user_password(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_current_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaUser> {
    state.lock().await.get_current_user(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_current_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: UpdateUserRequest,
) -> CmdResult<()> {
    state.lock().await.update_current_user(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_star_dashboard_for_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: i64,
) -> CmdResult<()> {
    state.lock().await.star_dashboard_for_user(&id, dashboard_id).await.map_err(map_err)
}

// ── Organizations ─────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_orgs(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<GrafanaOrg>> {
    state.lock().await.list_orgs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
) -> CmdResult<GrafanaOrg> {
    state.lock().await.get_org(&id, org_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_org_by_name(
    state: State<'_, GrafanaServiceState>,
    id: String,
    name: String,
) -> CmdResult<GrafanaOrg> {
    state.lock().await.get_org_by_name(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateOrgRequest,
) -> CmdResult<GrafanaOrg> {
    state.lock().await.create_org(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
    request: UpdateOrgRequest,
) -> CmdResult<()> {
    state.lock().await.update_org(&id, org_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_org(&id, org_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_org_users(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
) -> CmdResult<Vec<OrgUser>> {
    state.lock().await.list_org_users(&id, org_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_add_user_to_org_role(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
    request: AddOrgUserRequest,
) -> CmdResult<()> {
    state.lock().await.add_user_to_org_role(&id, org_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_org_user_role(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
    user_id: i64,
    request: UpdateOrgUserRoleRequest,
) -> CmdResult<()> {
    state.lock().await.update_org_user_role(&id, org_id, user_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_remove_user_from_org_mgmt(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: i64,
    user_id: i64,
) -> CmdResult<()> {
    state.lock().await.remove_user_from_org_mgmt(&id, org_id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_current_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaOrg> {
    state.lock().await.get_current_org(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_current_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: UpdateOrgRequest,
) -> CmdResult<()> {
    state.lock().await.update_current_org(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_org_preferences(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<OrgPreferences> {
    state.lock().await.get_org_preferences(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_org_preferences(
    state: State<'_, GrafanaServiceState>,
    id: String,
    prefs: OrgPreferences,
) -> CmdResult<()> {
    state.lock().await.update_org_preferences(&id, &prefs).await.map_err(map_err)
}

// ── Alerts ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_alert_rules(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<AlertRule>> {
    state.lock().await.list_alert_rules(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<AlertRule> {
    state.lock().await.get_alert_rule(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateAlertRuleRequest,
) -> CmdResult<AlertRule> {
    state.lock().await.create_alert_rule(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    request: UpdateAlertRuleRequest,
) -> CmdResult<AlertRule> {
    state.lock().await.update_alert_rule(&id, &uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.delete_alert_rule(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_alert_instances(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<AlertInstance>> {
    state.lock().await.list_alert_instances(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_alert_rule_groups(
    state: State<'_, GrafanaServiceState>,
    id: String,
    folder_uid: String,
) -> CmdResult<Vec<AlertRuleGroup>> {
    state.lock().await.get_alert_rule_groups(&id, &folder_uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_contact_points(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<ContactPoint>> {
    state.lock().await.list_contact_points(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_contact_point(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateContactPointRequest,
) -> CmdResult<ContactPoint> {
    state.lock().await.create_contact_point(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_contact_point(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    request: UpdateContactPointRequest,
) -> CmdResult<()> {
    state.lock().await.update_contact_point(&id, &uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_contact_point(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.delete_contact_point(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_notification_policies(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<NotificationPolicy> {
    state.lock().await.list_notification_policies(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_notification_policy(
    state: State<'_, GrafanaServiceState>,
    id: String,
    policy: NotificationPolicy,
) -> CmdResult<()> {
    state.lock().await.update_notification_policy(&id, &policy).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_silences(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<AlertSilence>> {
    state.lock().await.list_silences(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_silence(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateSilenceRequest,
) -> CmdResult<AlertSilence> {
    state.lock().await.create_silence(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_silence(
    state: State<'_, GrafanaServiceState>,
    id: String,
    silence_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_silence(&id, &silence_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_mute_timings(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<MuteTiming>> {
    state.lock().await.list_mute_timings(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_mute_timing(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateMuteTimingRequest,
) -> CmdResult<MuteTiming> {
    state.lock().await.create_mute_timing(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_mute_timing(
    state: State<'_, GrafanaServiceState>,
    id: String,
    name: String,
    request: UpdateMuteTimingRequest,
) -> CmdResult<()> {
    state.lock().await.update_mute_timing(&id, &name, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_mute_timing(
    state: State<'_, GrafanaServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state.lock().await.delete_mute_timing(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_test_contact_point(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateContactPointRequest,
) -> CmdResult<()> {
    state.lock().await.test_contact_point(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_alert_state_history(
    state: State<'_, GrafanaServiceState>,
    id: String,
    rule_uid: String,
) -> CmdResult<AlertStateHistory> {
    state.lock().await.get_alert_state_history(&id, &rule_uid).await.map_err(map_err)
}

// ── Annotations ───────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_annotations(
    state: State<'_, GrafanaServiceState>,
    id: String,
    query: AnnotationQuery,
) -> CmdResult<Vec<Annotation>> {
    state.lock().await.list_annotations(&id, &query).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_annotation(
    state: State<'_, GrafanaServiceState>,
    id: String,
    annotation_id: i64,
) -> CmdResult<Annotation> {
    state.lock().await.get_annotation(&id, annotation_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_annotation(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateAnnotationRequest,
) -> CmdResult<Annotation> {
    state.lock().await.create_annotation(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_annotation(
    state: State<'_, GrafanaServiceState>,
    id: String,
    annotation_id: i64,
    request: UpdateAnnotationRequest,
) -> CmdResult<()> {
    state.lock().await.update_annotation(&id, annotation_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_annotation(
    state: State<'_, GrafanaServiceState>,
    id: String,
    annotation_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_annotation(&id, annotation_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_graphite_annotation(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateGraphiteAnnotationRequest,
) -> CmdResult<Annotation> {
    state.lock().await.create_graphite_annotation(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_find_annotations_by_tag(
    state: State<'_, GrafanaServiceState>,
    id: String,
    tags: Vec<String>,
) -> CmdResult<Vec<Annotation>> {
    state.lock().await.find_annotations_by_tag(&id, &tags).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_find_annotations_by_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: i64,
) -> CmdResult<Vec<Annotation>> {
    state.lock().await.find_annotations_by_dashboard(&id, dashboard_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_mass_delete_annotations(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: MassDeleteAnnotationsRequest,
) -> CmdResult<()> {
    state.lock().await.mass_delete_annotations(&id, &request).await.map_err(map_err)
}

// ── Playlists ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_playlists(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Playlist>> {
    state.lock().await.list_playlists(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Playlist> {
    state.lock().await.get_playlist(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreatePlaylistRequest,
) -> CmdResult<Playlist> {
    state.lock().await.create_playlist(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    request: UpdatePlaylistRequest,
) -> CmdResult<Playlist> {
    state.lock().await.update_playlist(&id, &uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.delete_playlist(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_playlist_items(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Vec<PlaylistItem>> {
    state.lock().await.get_playlist_items(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_playlist_dashboards(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Vec<DashboardSearchResult>> {
    state.lock().await.get_playlist_dashboards(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_start_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.start_playlist(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_stop_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.stop_playlist(&id, &uid).await.map_err(map_err)
}

// ── Panels ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_panel_types(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<PanelType>> {
    state.lock().await.list_panel_types(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_panel_schema(
    state: State<'_, GrafanaServiceState>,
    id: String,
    panel_type: String,
) -> CmdResult<PanelSchema> {
    state.lock().await.get_panel_schema(&id, &panel_type).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_library_panels(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<LibraryPanel>> {
    state.lock().await.list_library_panels(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_library_panel(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<LibraryPanel> {
    state.lock().await.get_library_panel(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_library_panel(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateLibraryPanelRequest,
) -> CmdResult<LibraryPanel> {
    state.lock().await.create_library_panel(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_library_panel(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    request: UpdateLibraryPanelRequest,
) -> CmdResult<LibraryPanel> {
    state.lock().await.update_library_panel(&id, &uid, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_library_panel(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<()> {
    state.lock().await.delete_library_panel(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_library_panel_connections(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<Vec<LibraryPanelConnection>> {
    state.lock().await.list_library_panel_connections(&id, &uid).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_panel_query_options(
    state: State<'_, GrafanaServiceState>,
    id: String,
    panel_type: String,
) -> CmdResult<PanelQueryOptions> {
    state.lock().await.get_panel_query_options(&id, &panel_type).await.map_err(map_err)
}

// ── API Keys ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_api_keys(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<GrafanaApiKey>> {
    state.lock().await.list_api_keys(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_api_key(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateApiKeyRequest,
) -> CmdResult<serde_json::Value> {
    state.lock().await.create_api_key(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_api_key(
    state: State<'_, GrafanaServiceState>,
    id: String,
    key_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_api_key(&id, key_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_service_accounts(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<ServiceAccount>> {
    state.lock().await.list_service_accounts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_service_account(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateServiceAccountRequest,
) -> CmdResult<ServiceAccount> {
    state.lock().await.create_service_account(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_service_account(
    state: State<'_, GrafanaServiceState>,
    id: String,
    sa_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_service_account(&id, sa_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_service_account_tokens(
    state: State<'_, GrafanaServiceState>,
    id: String,
    sa_id: i64,
) -> CmdResult<Vec<ServiceAccountToken>> {
    state.lock().await.list_service_account_tokens(&id, sa_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_service_account_token(
    state: State<'_, GrafanaServiceState>,
    id: String,
    sa_id: i64,
    request: CreateServiceAccountTokenRequest,
) -> CmdResult<ServiceAccountToken> {
    state.lock().await.create_service_account_token(&id, sa_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_service_account_token(
    state: State<'_, GrafanaServiceState>,
    id: String,
    sa_id: i64,
    token_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_service_account_token(&id, sa_id, token_id).await.map_err(map_err)
}

// ── Teams ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_teams(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Team>> {
    state.lock().await.list_teams(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_team(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
) -> CmdResult<Team> {
    state.lock().await.get_team(&id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_team(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateTeamRequest,
) -> CmdResult<Team> {
    state.lock().await.create_team(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_team(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
    request: UpdateTeamRequest,
) -> CmdResult<()> {
    state.lock().await.update_team(&id, team_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_team(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_team(&id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_team_members(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
) -> CmdResult<Vec<TeamMember>> {
    state.lock().await.list_team_members(&id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_add_team_member(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
    request: AddTeamMemberRequest,
) -> CmdResult<()> {
    state.lock().await.add_team_member(&id, team_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_remove_team_member(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
    user_id: i64,
) -> CmdResult<()> {
    state.lock().await.remove_team_member(&id, team_id, user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_team_preferences(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
) -> CmdResult<TeamPreferences> {
    state.lock().await.get_team_preferences(&id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_team_preferences(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
    prefs: TeamPreferences,
) -> CmdResult<()> {
    state.lock().await.update_team_preferences(&id, team_id, &prefs).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_team_groups(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
) -> CmdResult<Vec<TeamGroup>> {
    state.lock().await.list_team_groups(&id, team_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_add_team_group(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
    request: AddTeamGroupRequest,
) -> CmdResult<()> {
    state.lock().await.add_team_group(&id, team_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_remove_team_group(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: i64,
    group_id: String,
) -> CmdResult<()> {
    state.lock().await.remove_team_group(&id, team_id, &group_id).await.map_err(map_err)
}

// ── Plugins ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_plugins(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<GrafanaPlugin>> {
    state.lock().await.list_plugins(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_plugin(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
) -> CmdResult<GrafanaPlugin> {
    state.lock().await.get_plugin(&id, &plugin_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_install_plugin(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
    request: InstallPluginRequest,
) -> CmdResult<()> {
    state.lock().await.install_plugin(&id, &plugin_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_uninstall_plugin(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
) -> CmdResult<()> {
    state.lock().await.uninstall_plugin(&id, &plugin_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_plugin(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
    request: InstallPluginRequest,
) -> CmdResult<()> {
    state.lock().await.update_plugin(&id, &plugin_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_plugin_settings(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
) -> CmdResult<PluginSettings> {
    state.lock().await.get_plugin_settings(&id, &plugin_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_update_plugin_settings(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
    request: UpdatePluginSettingsRequest,
) -> CmdResult<()> {
    state.lock().await.update_plugin_settings(&id, &plugin_id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_plugin_health(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_plugin_health(&id, &plugin_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_plugin_dashboards(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
) -> CmdResult<Vec<DashboardSearchResult>> {
    state.lock().await.list_plugin_dashboards(&id, &plugin_id).await.map_err(map_err)
}

// ── Snapshots ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_snapshots(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<GrafanaSnapshot>> {
    state.lock().await.list_snapshots(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_snapshot(
    state: State<'_, GrafanaServiceState>,
    id: String,
    snapshot_id: i64,
) -> CmdResult<GrafanaSnapshot> {
    state.lock().await.get_snapshot(&id, snapshot_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_snapshot(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateSnapshotRequest,
) -> CmdResult<GrafanaSnapshot> {
    state.lock().await.create_snapshot(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_snapshot(
    state: State<'_, GrafanaServiceState>,
    id: String,
    snapshot_id: i64,
) -> CmdResult<()> {
    state.lock().await.delete_snapshot(&id, snapshot_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_snapshot_by_key(
    state: State<'_, GrafanaServiceState>,
    id: String,
    key: String,
) -> CmdResult<GrafanaSnapshot> {
    state.lock().await.get_snapshot_by_key(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_snapshot_by_key(
    state: State<'_, GrafanaServiceState>,
    id: String,
    delete_key: String,
) -> CmdResult<()> {
    state.lock().await.delete_snapshot_by_key(&id, &delete_key).await.map_err(map_err)
}

// ── Admin ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_get_settings(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaSettings> {
    state.lock().await.get_settings(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_stats(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaStats> {
    state.lock().await.get_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_health(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaHealth> {
    state.lock().await.get_health(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_version(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaVersion> {
    state.lock().await.get_version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_frontend_settings(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_frontend_settings(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_provisioned_dashboards(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state.lock().await.list_provisioned_dashboards(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_provisioned_datasources(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state.lock().await.list_provisioned_datasources(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_provisioned_alert_rules(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<serde_json::Value>> {
    state.lock().await.list_provisioned_alert_rules(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_reload_provisioning(
    state: State<'_, GrafanaServiceState>,
    id: String,
    provisioner: String,
) -> CmdResult<()> {
    state.lock().await.reload_provisioning(&id, &provisioner).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_usage_stats(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<UsageStats> {
    state.lock().await.get_usage_stats(&id).await.map_err(map_err)
}
