// ── sorng-etcd/src/commands.rs ───────────────────────────────────────────────
//! Tauri commands – thin wrappers around `EtcdService`.

use tauri::State;

use crate::service::EtcdServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_connect(
    state: State<'_, EtcdServiceState>,
    id: String,
    config: EtcdConnectionConfig,
) -> CmdResult<EtcdConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_disconnect(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn etcd_list_connections(
    state: State<'_, EtcdServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

// ── Dashboard ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_get_dashboard(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<EtcdDashboard> {
    state.lock().await.get_dashboard(&id).await.map_err(map_err)
}

// ── KV ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_kv_get(
    state: State<'_, EtcdServiceState>,
    id: String,
    key: String,
) -> CmdResult<Option<EtcdKeyValue>> {
    state.lock().await.kv_get(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_kv_put(
    state: State<'_, EtcdServiceState>,
    id: String,
    key: String,
    value: String,
    lease: Option<i64>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .kv_put(&id, &key, &value, lease)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_kv_delete(
    state: State<'_, EtcdServiceState>,
    id: String,
    key: String,
) -> CmdResult<i64> {
    state.lock().await.kv_delete(&id, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_kv_range(
    state: State<'_, EtcdServiceState>,
    id: String,
    key: String,
    range_end: Option<String>,
    limit: Option<i64>,
) -> CmdResult<EtcdRangeResponse> {
    state
        .lock()
        .await
        .kv_range(&id, &key, range_end, limit)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_kv_get_history(
    state: State<'_, EtcdServiceState>,
    id: String,
    key: String,
) -> CmdResult<Vec<EtcdKeyValue>> {
    state
        .lock()
        .await
        .kv_get_history(&id, &key)
        .await
        .map_err(map_err)
}

// ── Leases ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_lease_grant(
    state: State<'_, EtcdServiceState>,
    id: String,
    ttl: i64,
) -> CmdResult<EtcdLease> {
    state.lock().await.lease_grant(&id, ttl).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_lease_revoke(
    state: State<'_, EtcdServiceState>,
    id: String,
    lease_id: i64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .lease_revoke(&id, lease_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_lease_list(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<Vec<EtcdLease>> {
    state.lock().await.lease_list(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_lease_ttl(
    state: State<'_, EtcdServiceState>,
    id: String,
    lease_id: i64,
) -> CmdResult<EtcdLeaseTimeToLive> {
    state
        .lock()
        .await
        .lease_ttl(&id, lease_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_lease_keep_alive(
    state: State<'_, EtcdServiceState>,
    id: String,
    lease_id: i64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .lease_keep_alive(&id, lease_id)
        .await
        .map_err(map_err)
}

// ── Cluster ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_member_list(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<Vec<EtcdMember>> {
    state.lock().await.member_list(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_member_add(
    state: State<'_, EtcdServiceState>,
    id: String,
    peer_urls: Vec<String>,
    is_learner: Option<bool>,
) -> CmdResult<EtcdMember> {
    state
        .lock()
        .await
        .member_add(&id, peer_urls, is_learner)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_member_remove(
    state: State<'_, EtcdServiceState>,
    id: String,
    member_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .member_remove(&id, member_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_member_update(
    state: State<'_, EtcdServiceState>,
    id: String,
    member_id: u64,
    peer_urls: Vec<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .member_update(&id, member_id, peer_urls)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_member_promote(
    state: State<'_, EtcdServiceState>,
    id: String,
    member_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .member_promote(&id, member_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_cluster_health(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<EtcdClusterHealth> {
    state
        .lock()
        .await
        .cluster_health(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_endpoint_status(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<Vec<EtcdEndpointStatus>> {
    state
        .lock()
        .await
        .endpoint_status(&id)
        .await
        .map_err(map_err)
}

// ── Auth ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_auth_enable(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.auth_enable(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_auth_disable(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.auth_disable(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_user_list(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<Vec<EtcdUser>> {
    state.lock().await.user_list(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_user_add(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
    password: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .user_add(&id, &name, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_user_delete(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .user_delete(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_user_get(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
) -> CmdResult<EtcdUser> {
    state
        .lock()
        .await
        .user_get(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_user_change_password(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
    password: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .user_change_password(&id, &name, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_user_grant_role(
    state: State<'_, EtcdServiceState>,
    id: String,
    user: String,
    role: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .user_grant_role(&id, &user, &role)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_user_revoke_role(
    state: State<'_, EtcdServiceState>,
    id: String,
    user: String,
    role: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .user_revoke_role(&id, &user, &role)
        .await
        .map_err(map_err)
}

// ── Roles ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_role_list(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<Vec<EtcdRole>> {
    state.lock().await.role_list(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_role_add(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .role_add(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_role_delete(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .role_delete(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_role_get(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
) -> CmdResult<EtcdRole> {
    state
        .lock()
        .await
        .role_get(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_role_grant_permission(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
    permission: EtcdPermission,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .role_grant_permission(&id, &name, &permission)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_role_revoke_permission(
    state: State<'_, EtcdServiceState>,
    id: String,
    name: String,
    key: String,
    range_end: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .role_revoke_permission(&id, &name, &key, &range_end)
        .await
        .map_err(map_err)
}

// ── Maintenance ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn etcd_alarm_list(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<Vec<EtcdAlarm>> {
    state.lock().await.alarm_list(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_alarm_disarm(
    state: State<'_, EtcdServiceState>,
    id: String,
    member_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .alarm_disarm(&id, member_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_defragment(
    state: State<'_, EtcdServiceState>,
    id: String,
    endpoint: String,
) -> CmdResult<EtcdDefragResult> {
    state
        .lock()
        .await
        .defragment(&id, &endpoint)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_status(
    state: State<'_, EtcdServiceState>,
    id: String,
) -> CmdResult<EtcdStatusResponse> {
    state.lock().await.status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn etcd_move_leader(
    state: State<'_, EtcdServiceState>,
    id: String,
    target_id: u64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .move_leader(&id, target_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn etcd_compact(
    state: State<'_, EtcdServiceState>,
    id: String,
    revision: i64,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .kv_compact(&id, revision)
        .await
        .map_err(map_err)
}
