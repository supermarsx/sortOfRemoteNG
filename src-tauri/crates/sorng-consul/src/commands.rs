// ── sorng-consul/src/commands.rs ─────────────────────────────────────────────
//! Tauri commands – thin wrappers around `ConsulServiceHolder`.

use std::collections::HashMap;
use tauri::State;
use crate::service::ConsulServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_connect(
    state: State<'_, ConsulServiceState>,
    id: String,
    config: ConsulConnectionConfig,
) -> CmdResult<ConsulConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_disconnect(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn consul_list_connections(
    state: State<'_, ConsulServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Dashboard ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_get_dashboard(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<ConsulDashboard> {
    state.lock().await.get_dashboard(&id).await.map_err(map_err)
}

// ── KV ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_kv_get(
    state: State<'_, ConsulServiceState>,
    id: String,
    key: String,
) -> CmdResult<ConsulKeyValue> {
    state.lock().await.kv_get(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_kv_put(
    state: State<'_, ConsulServiceState>,
    id: String,
    key: String,
    value: String,
) -> CmdResult<bool> {
    state.lock().await.kv_put(&id, &key, &value).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_kv_delete(
    state: State<'_, ConsulServiceState>,
    id: String,
    key: String,
) -> CmdResult<bool> {
    state.lock().await.kv_delete(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_kv_list(
    state: State<'_, ConsulServiceState>,
    id: String,
    prefix: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.kv_list(&id, &prefix).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_kv_get_tree(
    state: State<'_, ConsulServiceState>,
    id: String,
    prefix: String,
) -> CmdResult<Vec<ConsulKeyValue>> {
    state.lock().await.kv_get_tree(&id, &prefix).await.map_err(map_err)
}

// ── Services ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_list_services(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<HashMap<String, Vec<String>>> {
    state.lock().await.list_services(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_get_service(
    state: State<'_, ConsulServiceState>,
    id: String,
    name: String,
) -> CmdResult<Vec<ConsulServiceEntry>> {
    state.lock().await.get_service(&id, &name).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_register_service(
    state: State<'_, ConsulServiceState>,
    id: String,
    registration: ServiceRegistration,
) -> CmdResult<()> {
    state.lock().await.register_service(&id, &registration).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_deregister_service(
    state: State<'_, ConsulServiceState>,
    id: String,
    service_id: String,
) -> CmdResult<()> {
    state.lock().await.deregister_service(&id, &service_id).await.map_err(map_err)
}

// ── Catalog ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_list_nodes(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<Vec<ConsulNode>> {
    state.lock().await.list_nodes(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_get_node(
    state: State<'_, ConsulServiceState>,
    id: String,
    node_name: String,
) -> CmdResult<CatalogNode> {
    state.lock().await.get_node(&id, &node_name).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_list_datacenters(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_datacenters(&id).await.map_err(map_err)
}

// ── Health ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_node_health(
    state: State<'_, ConsulServiceState>,
    id: String,
    node: String,
) -> CmdResult<Vec<ConsulHealthCheck>> {
    state.lock().await.node_health(&id, &node).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_service_health(
    state: State<'_, ConsulServiceState>,
    id: String,
    service: String,
) -> CmdResult<Vec<ConsulServiceEntry>> {
    state.lock().await.service_health(&id, &service).await.map_err(map_err)
}

// ── Agent ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_agent_info(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<ConsulAgentInfo> {
    state.lock().await.agent_info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_agent_members(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<Vec<AgentMember>> {
    state.lock().await.agent_members(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_agent_join(
    state: State<'_, ConsulServiceState>,
    id: String,
    address: String,
) -> CmdResult<()> {
    state.lock().await.agent_join(&id, &address).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_agent_leave(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.agent_leave(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_agent_metrics(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<ConsulAgentMetrics> {
    state.lock().await.agent_metrics(&id).await.map_err(map_err)
}

// ── ACL ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_acl_list_tokens(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<Vec<ConsulAclToken>> {
    state.lock().await.acl_list_tokens(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_acl_create_token(
    state: State<'_, ConsulServiceState>,
    id: String,
    request: AclTokenCreateRequest,
) -> CmdResult<ConsulAclToken> {
    state.lock().await.acl_create_token(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_acl_list_policies(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<Vec<ConsulAclPolicy>> {
    state.lock().await.acl_list_policies(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_acl_create_policy(
    state: State<'_, ConsulServiceState>,
    id: String,
    request: AclPolicyCreateRequest,
) -> CmdResult<ConsulAclPolicy> {
    state.lock().await.acl_create_policy(&id, &request).await.map_err(map_err)
}

// ── Sessions ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_sessions_list(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<Vec<ConsulSession>> {
    state.lock().await.session_list(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_sessions_create(
    state: State<'_, ConsulServiceState>,
    id: String,
    request: SessionCreateRequest,
) -> CmdResult<String> {
    state.lock().await.session_create(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_sessions_delete(
    state: State<'_, ConsulServiceState>,
    id: String,
    session_id: String,
) -> CmdResult<()> {
    state.lock().await.session_delete(&id, &session_id).await.map_err(map_err)
}

// ── Events ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn consul_fire_event(
    state: State<'_, ConsulServiceState>,
    id: String,
    request: EventFireRequest,
) -> CmdResult<ConsulEvent> {
    state.lock().await.fire_event(&id, &request).await.map_err(map_err)
}

#[tauri::command]
pub async fn consul_list_events(
    state: State<'_, ConsulServiceState>,
    id: String,
) -> CmdResult<Vec<ConsulEvent>> {
    state.lock().await.list_events(&id).await.map_err(map_err)
}
