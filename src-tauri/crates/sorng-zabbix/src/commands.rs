// ── sorng-zabbix/src/commands.rs ─────────────────────────────────────────────
// Tauri commands – thin wrappers around `ZabbixService`.

use serde_json::Value;
use tauri::State;

use super::service::ZabbixServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_connect(
    state: State<'_, ZabbixServiceState>,
    id: String,
    config: ZabbixConnectionConfig,
) -> CmdResult<ZabbixConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_disconnect(state: State<'_, ZabbixServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_list_connections(
    state: State<'_, ZabbixServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn zabbix_get_dashboard(
    state: State<'_, ZabbixServiceState>,
    id: String,
) -> CmdResult<ZabbixDashboard> {
    state.lock().await.get_dashboard(&id).await.map_err(map_err)
}

// ── Hosts ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_hosts(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixHost>> {
    state
        .lock()
        .await
        .list_hosts(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_get_host(
    state: State<'_, ZabbixServiceState>,
    id: String,
    hostid: String,
) -> CmdResult<ZabbixHost> {
    state
        .lock()
        .await
        .get_host(&id, &hostid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_host(
    state: State<'_, ZabbixServiceState>,
    id: String,
    host: ZabbixHost,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_host(&id, host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_update_host(
    state: State<'_, ZabbixServiceState>,
    id: String,
    host: ZabbixHost,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .update_host(&id, host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_hosts(
    state: State<'_, ZabbixServiceState>,
    id: String,
    hostids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_hosts(&id, hostids)
        .await
        .map_err(map_err)
}

// ── Templates ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_templates(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixTemplate>> {
    state
        .lock()
        .await
        .list_templates(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_get_template(
    state: State<'_, ZabbixServiceState>,
    id: String,
    templateid: String,
) -> CmdResult<ZabbixTemplate> {
    state
        .lock()
        .await
        .get_template(&id, &templateid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_template(
    state: State<'_, ZabbixServiceState>,
    id: String,
    template: ZabbixTemplate,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_template(&id, template)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_templates(
    state: State<'_, ZabbixServiceState>,
    id: String,
    templateids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_templates(&id, templateids)
        .await
        .map_err(map_err)
}

// ── Items ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_items(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixItem>> {
    state
        .lock()
        .await
        .list_items(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_get_item(
    state: State<'_, ZabbixServiceState>,
    id: String,
    itemid: String,
) -> CmdResult<ZabbixItem> {
    state
        .lock()
        .await
        .get_item(&id, &itemid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_item(
    state: State<'_, ZabbixServiceState>,
    id: String,
    item: ZabbixItem,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_item(&id, item)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_items(
    state: State<'_, ZabbixServiceState>,
    id: String,
    itemids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_items(&id, itemids)
        .await
        .map_err(map_err)
}

// ── Triggers ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_triggers(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixTrigger>> {
    state
        .lock()
        .await
        .list_triggers(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_get_trigger(
    state: State<'_, ZabbixServiceState>,
    id: String,
    triggerid: String,
) -> CmdResult<ZabbixTrigger> {
    state
        .lock()
        .await
        .get_trigger(&id, &triggerid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_trigger(
    state: State<'_, ZabbixServiceState>,
    id: String,
    trigger: ZabbixTrigger,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_trigger(&id, trigger)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_triggers(
    state: State<'_, ZabbixServiceState>,
    id: String,
    triggerids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_triggers(&id, triggerids)
        .await
        .map_err(map_err)
}

// ── Actions ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_actions(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixAction>> {
    state
        .lock()
        .await
        .list_actions(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_get_action(
    state: State<'_, ZabbixServiceState>,
    id: String,
    actionid: String,
) -> CmdResult<ZabbixAction> {
    state
        .lock()
        .await
        .get_action(&id, &actionid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_action(
    state: State<'_, ZabbixServiceState>,
    id: String,
    action: ZabbixAction,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_action(&id, action)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_actions(
    state: State<'_, ZabbixServiceState>,
    id: String,
    actionids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_actions(&id, actionids)
        .await
        .map_err(map_err)
}

// ── Alerts ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_alerts(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixAlert>> {
    state
        .lock()
        .await
        .list_alerts(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

// ── Graphs ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_graphs(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixGraph>> {
    state
        .lock()
        .await
        .list_graphs(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_graph(
    state: State<'_, ZabbixServiceState>,
    id: String,
    graph: ZabbixGraph,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_graph(&id, graph)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_graphs(
    state: State<'_, ZabbixServiceState>,
    id: String,
    graphids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_graphs(&id, graphids)
        .await
        .map_err(map_err)
}

// ── Discovery ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_discovery_rules(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixDiscoveryRule>> {
    state
        .lock()
        .await
        .list_discovery_rules(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_discovery_rule(
    state: State<'_, ZabbixServiceState>,
    id: String,
    rule: ZabbixDiscoveryRule,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_discovery_rule(&id, rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_discovery_rules(
    state: State<'_, ZabbixServiceState>,
    id: String,
    ids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_discovery_rules(&id, ids)
        .await
        .map_err(map_err)
}

// ── Maintenance ───────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_maintenance(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixMaintenance>> {
    state
        .lock()
        .await
        .list_maintenance(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_maintenance(
    state: State<'_, ZabbixServiceState>,
    id: String,
    maintenance: ZabbixMaintenance,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_maintenance(&id, maintenance)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_update_maintenance(
    state: State<'_, ZabbixServiceState>,
    id: String,
    maintenance: ZabbixMaintenance,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .update_maintenance(&id, maintenance)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_maintenance(
    state: State<'_, ZabbixServiceState>,
    id: String,
    ids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_maintenance(&id, ids)
        .await
        .map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_users(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixUser>> {
    state
        .lock()
        .await
        .list_users(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_get_user(
    state: State<'_, ZabbixServiceState>,
    id: String,
    userid: String,
) -> CmdResult<ZabbixUser> {
    state
        .lock()
        .await
        .get_user(&id, &userid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_user(
    state: State<'_, ZabbixServiceState>,
    id: String,
    user: ZabbixUser,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_user(&id, user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_update_user(
    state: State<'_, ZabbixServiceState>,
    id: String,
    user: ZabbixUser,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .update_user(&id, user)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_users(
    state: State<'_, ZabbixServiceState>,
    id: String,
    userids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_users(&id, userids)
        .await
        .map_err(map_err)
}

// ── Media Types ───────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_media_types(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixMediaType>> {
    state
        .lock()
        .await
        .list_media_types(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_media_type(
    state: State<'_, ZabbixServiceState>,
    id: String,
    media_type: ZabbixMediaType,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_media_type(&id, media_type)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_media_types(
    state: State<'_, ZabbixServiceState>,
    id: String,
    ids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_media_types(&id, ids)
        .await
        .map_err(map_err)
}

// ── Host Groups ───────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_host_groups(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixHostGroup>> {
    state
        .lock()
        .await
        .list_host_groups(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_host_group(
    state: State<'_, ZabbixServiceState>,
    id: String,
    group: ZabbixHostGroup,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_host_group(&id, group)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_host_groups(
    state: State<'_, ZabbixServiceState>,
    id: String,
    ids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_host_groups(&id, ids)
        .await
        .map_err(map_err)
}

// ── Proxies ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_proxies(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixProxy>> {
    state
        .lock()
        .await
        .list_proxies(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_get_proxy(
    state: State<'_, ZabbixServiceState>,
    id: String,
    proxyid: String,
) -> CmdResult<ZabbixProxy> {
    state
        .lock()
        .await
        .get_proxy(&id, &proxyid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_create_proxy(
    state: State<'_, ZabbixServiceState>,
    id: String,
    proxy: ZabbixProxy,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .create_proxy(&id, proxy)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_delete_proxies(
    state: State<'_, ZabbixServiceState>,
    id: String,
    ids: Vec<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .delete_proxies(&id, ids)
        .await
        .map_err(map_err)
}

// ── Problems ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn zabbix_list_problems(
    state: State<'_, ZabbixServiceState>,
    id: String,
    params: Option<Value>,
) -> CmdResult<Vec<ZabbixProblem>> {
    state
        .lock()
        .await
        .list_problems(&id, params.unwrap_or_default())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn zabbix_acknowledge_problem(
    state: State<'_, ZabbixServiceState>,
    id: String,
    eventids: Vec<String>,
    message: Option<String>,
) -> CmdResult<Value> {
    state
        .lock()
        .await
        .acknowledge_problem(&id, eventids, message)
        .await
        .map_err(map_err)
}
