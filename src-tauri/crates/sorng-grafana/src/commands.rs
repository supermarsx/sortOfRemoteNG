// ── sorng-grafana/src/commands.rs ───────────────────────────────────────────
// Tauri commands – thin wrappers around `GrafanaService`.

use tauri::State;

use super::service::GrafanaServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_connect(
    state: State<'_, GrafanaServiceState>,
    id: String,
    config: GrafanaConnectionConfig,
) -> CmdResult<GrafanaConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
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

#[tauri::command]
pub async fn grafana_ping(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Dashboards ────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_search_dashboards(
    state: State<'_, GrafanaServiceState>,
    id: String,
    query: SearchQuery,
) -> CmdResult<Vec<Dashboard>> {
    state
        .lock()
        .await
        .search_dashboards(&id, &query)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<DashboardDetail> {
    state
        .lock()
        .await
        .get_dashboard(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_save_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: SaveDashboardRequest,
) -> CmdResult<SaveDashboardResponse> {
    state
        .lock()
        .await
        .save_dashboard(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_dashboard(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_home_dashboard(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<DashboardDetail> {
    state
        .lock()
        .await
        .get_home_dashboard(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_dashboard_versions(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard_id: u64,
) -> CmdResult<Vec<DashboardVersion>> {
    state
        .lock()
        .await
        .list_dashboard_versions(&id, dashboard_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_dashboard_tags(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<(String, u64)>> {
    state
        .lock()
        .await
        .get_dashboard_tags(&id)
        .await
        .map_err(map_err)
}

// ── Datasources ───────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_datasources(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Datasource>> {
    state
        .lock()
        .await
        .list_datasources(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: u64,
) -> CmdResult<Datasource> {
    state
        .lock()
        .await
        .get_datasource(&id, ds_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: DatasourceCreateRequest,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_datasource(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_datasource(&id, ds_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_test_datasource(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ds_id: u64,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .test_datasource(&id, ds_id)
        .await
        .map_err(map_err)
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
    uid: String,
) -> CmdResult<Folder> {
    state
        .lock()
        .await
        .get_folder(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_folder(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: Option<String>,
    title: String,
) -> CmdResult<Folder> {
    state
        .lock()
        .await
        .create_folder(&id, uid.as_deref(), &title)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_folder(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_folder(&id, &uid)
        .await
        .map_err(map_err)
}

// ── Organizations ─────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_orgs(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Organization>> {
    state.lock().await.list_orgs(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: u64,
) -> CmdResult<Organization> {
    state
        .lock()
        .await
        .get_org(&id, org_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    name: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_org(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_org(&id, org_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_current_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Organization> {
    state
        .lock()
        .await
        .get_current_org(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_switch_org(
    state: State<'_, GrafanaServiceState>,
    id: String,
    org_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .switch_org(&id, org_id)
        .await
        .map_err(map_err)
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
    user_id: u64,
) -> CmdResult<GrafanaUser> {
    state
        .lock()
        .await
        .get_user(&id, user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    name: Option<String>,
    login: String,
    email: Option<String>,
    password: String,
    org_id: Option<u64>,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_user(
            &id,
            name.as_deref(),
            &login,
            email.as_deref(),
            &password,
            org_id,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
    user_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_user(&id, user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_current_user(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<GrafanaUser> {
    state
        .lock()
        .await
        .get_current_user(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_set_user_admin(
    state: State<'_, GrafanaServiceState>,
    id: String,
    user_id: u64,
    is_admin: bool,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .set_user_admin(&id, user_id, is_admin)
        .await
        .map_err(map_err)
}

// ── Teams ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_teams(
    state: State<'_, GrafanaServiceState>,
    id: String,
    query: Option<String>,
) -> CmdResult<Vec<Team>> {
    state
        .lock()
        .await
        .list_teams(&id, query.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_team(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: u64,
) -> CmdResult<Team> {
    state
        .lock()
        .await
        .get_team(&id, team_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_team(
    state: State<'_, GrafanaServiceState>,
    id: String,
    name: String,
    email: Option<String>,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_team(&id, &name, email.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_team(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_team(&id, team_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_team_members(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: u64,
) -> CmdResult<Vec<TeamMember>> {
    state
        .lock()
        .await
        .list_team_members(&id, team_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_add_team_member(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: u64,
    user_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .add_team_member(&id, team_id, user_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_remove_team_member(
    state: State<'_, GrafanaServiceState>,
    id: String,
    team_id: u64,
    user_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .remove_team_member(&id, team_id, user_id)
        .await
        .map_err(map_err)
}

// ── Alerts ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_alert_rules(
    state: State<'_, GrafanaServiceState>,
    id: String,
    folder_uid: Option<String>,
    rule_group: Option<String>,
) -> CmdResult<Vec<AlertRule>> {
    state
        .lock()
        .await
        .list_alert_rules(&id, folder_uid.as_deref(), rule_group.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<AlertRule> {
    state
        .lock()
        .await
        .get_alert_rule(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    rule: AlertRule,
) -> CmdResult<AlertRule> {
    state
        .lock()
        .await
        .create_alert_rule(&id, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_alert_rule(&id, &uid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_pause_alert_rule(
    state: State<'_, GrafanaServiceState>,
    id: String,
    uid: String,
    paused: bool,
) -> CmdResult<AlertRule> {
    state
        .lock()
        .await
        .pause_alert_rule(&id, &uid, paused)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_list_alert_notifications(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<AlertNotification>> {
    state
        .lock()
        .await
        .list_alert_notifications(&id)
        .await
        .map_err(map_err)
}

// ── Annotations ───────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn grafana_list_annotations(
    state: State<'_, GrafanaServiceState>,
    id: String,
    from: Option<u64>,
    to: Option<u64>,
    dashboard_id: Option<u64>,
    panel_id: Option<u64>,
    tags: Option<Vec<String>>,
    limit: Option<u64>,
) -> CmdResult<Vec<Annotation>> {
    state
        .lock()
        .await
        .list_annotations(
            &id,
            from,
            to,
            dashboard_id,
            panel_id,
            tags.as_deref(),
            limit,
        )
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_annotation(
    state: State<'_, GrafanaServiceState>,
    id: String,
    request: CreateAnnotationRequest,
) -> CmdResult<Annotation> {
    state
        .lock()
        .await
        .create_annotation(&id, &request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_annotation(
    state: State<'_, GrafanaServiceState>,
    id: String,
    ann_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_annotation(&id, ann_id)
        .await
        .map_err(map_err)
}

// ── Playlists ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_playlists(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Playlist>> {
    state
        .lock()
        .await
        .list_playlists(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    playlist_id: u64,
) -> CmdResult<Playlist> {
    state
        .lock()
        .await
        .get_playlist(&id, playlist_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_playlist(
    state: State<'_, GrafanaServiceState>,
    id: String,
    playlist_id: u64,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_playlist(&id, playlist_id)
        .await
        .map_err(map_err)
}

// ── Snapshots ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_snapshots(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<Snapshot>> {
    state
        .lock()
        .await
        .list_snapshots(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_create_snapshot(
    state: State<'_, GrafanaServiceState>,
    id: String,
    dashboard: serde_json::Value,
    name: Option<String>,
    expires: Option<u64>,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .create_snapshot(&id, &dashboard, name.as_deref(), expires)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_delete_snapshot(
    state: State<'_, GrafanaServiceState>,
    id: String,
    key: String,
) -> CmdResult<serde_json::Value> {
    state
        .lock()
        .await
        .delete_snapshot(&id, &key)
        .await
        .map_err(map_err)
}

// ── Panels ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafana_list_panel_plugins(
    state: State<'_, GrafanaServiceState>,
    id: String,
) -> CmdResult<Vec<PanelPlugin>> {
    state
        .lock()
        .await
        .list_panel_plugins(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn grafana_get_panel_plugin(
    state: State<'_, GrafanaServiceState>,
    id: String,
    plugin_id: String,
) -> CmdResult<PanelPlugin> {
    state
        .lock()
        .await
        .get_panel_plugin(&id, &plugin_id)
        .await
        .map_err(map_err)
}
