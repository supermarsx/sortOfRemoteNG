// ── sorng-opendkim/src/commands.rs ────────────────────────────────────────────
// Tauri commands – thin wrappers around `OpendkimService`.

use tauri::State;

use super::service::OpendkimServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_connect(
    state: State<'_, OpendkimServiceState>,
    id: String,
    config: OpendkimConnectionConfig,
) -> CmdResult<OpendkimConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_disconnect(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn dkim_list_connections(
    state: State<'_, OpendkimServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn dkim_ping(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<bool> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Keys ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_list_keys(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<Vec<DkimKey>> {
    state.lock().await.list_keys(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_key(
    state: State<'_, OpendkimServiceState>,
    id: String,
    selector: String,
    domain: String,
) -> CmdResult<DkimKey> {
    state
        .lock()
        .await
        .get_key(&id, &selector, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_generate_key(
    state: State<'_, OpendkimServiceState>,
    id: String,
    request: CreateKeyRequest,
) -> CmdResult<DkimKey> {
    state
        .lock()
        .await
        .generate_key(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_rotate_key(
    state: State<'_, OpendkimServiceState>,
    id: String,
    request: RotateKeyRequest,
) -> CmdResult<DkimKey> {
    state
        .lock()
        .await
        .rotate_key(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_delete_key(
    state: State<'_, OpendkimServiceState>,
    id: String,
    selector: String,
    domain: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_key(&id, &selector, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_dns_record(
    state: State<'_, OpendkimServiceState>,
    id: String,
    selector: String,
    domain: String,
) -> CmdResult<DnsRecord> {
    state
        .lock()
        .await
        .get_dns_record(&id, &selector, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_verify_dns(
    state: State<'_, OpendkimServiceState>,
    id: String,
    selector: String,
    domain: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .verify_dns(&id, &selector, &domain)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_export_public_key(
    state: State<'_, OpendkimServiceState>,
    id: String,
    selector: String,
    domain: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .export_public_key(&id, &selector, &domain)
        .await
        .map_err(map_err)
}

// ── Signing Table ─────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_list_signing_table(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<Vec<SigningTableEntry>> {
    state
        .lock()
        .await
        .list_signing_table(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_signing_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    pattern: String,
) -> CmdResult<SigningTableEntry> {
    state
        .lock()
        .await
        .get_signing_entry(&id, &pattern)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_add_signing_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    entry: SigningTableEntry,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_signing_entry(&id, entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_update_signing_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    pattern: String,
    entry: SigningTableEntry,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_signing_entry(&id, &pattern, entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_remove_signing_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    pattern: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_signing_entry(&id, &pattern)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_rebuild_signing_table(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rebuild_signing_table(&id)
        .await
        .map_err(map_err)
}

// ── Key Table ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_list_key_table(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<Vec<KeyTableEntry>> {
    state
        .lock()
        .await
        .list_key_table(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_key_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    key_name: String,
) -> CmdResult<KeyTableEntry> {
    state
        .lock()
        .await
        .get_key_entry(&id, &key_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_add_key_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    entry: KeyTableEntry,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_key_entry(&id, entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_update_key_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    key_name: String,
    entry: KeyTableEntry,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_key_entry(&id, &key_name, entry)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_remove_key_entry(
    state: State<'_, OpendkimServiceState>,
    id: String,
    key_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_key_entry(&id, &key_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_rebuild_key_table(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .rebuild_key_table(&id)
        .await
        .map_err(map_err)
}

// ── Trusted Hosts ─────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_list_trusted_hosts(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<Vec<TrustedHost>> {
    state
        .lock()
        .await
        .list_trusted_hosts(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_add_trusted_host(
    state: State<'_, OpendkimServiceState>,
    id: String,
    host: TrustedHost,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_trusted_host(&id, host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_remove_trusted_host(
    state: State<'_, OpendkimServiceState>,
    id: String,
    host: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_trusted_host(&id, &host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_list_internal_hosts(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<Vec<InternalHost>> {
    state
        .lock()
        .await
        .list_internal_hosts(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_add_internal_host(
    state: State<'_, OpendkimServiceState>,
    id: String,
    host: InternalHost,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .add_internal_host(&id, host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_remove_internal_host(
    state: State<'_, OpendkimServiceState>,
    id: String,
    host: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .remove_internal_host(&id, &host)
        .await
        .map_err(map_err)
}

// ── Config ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_get_config(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<Vec<OpendkimConfig>> {
    state.lock().await.get_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_config_param(
    state: State<'_, OpendkimServiceState>,
    id: String,
    key: String,
) -> CmdResult<OpendkimConfig> {
    state
        .lock()
        .await
        .get_config_param(&id, &key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_set_config_param(
    state: State<'_, OpendkimServiceState>,
    id: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_config_param(&id, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_delete_config_param(
    state: State<'_, OpendkimServiceState>,
    id: String,
    key: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_config_param(&id, &key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_test_config(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<ConfigTestResult> {
    state.lock().await.test_config(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_mode(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_mode(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_set_mode(
    state: State<'_, OpendkimServiceState>,
    id: String,
    mode: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_mode(&id, &mode)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_socket(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.get_socket(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_set_socket(
    state: State<'_, OpendkimServiceState>,
    id: String,
    socket: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_socket(&id, &socket)
        .await
        .map_err(map_err)
}

// ── Stats ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_get_stats(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<OpendkimStats> {
    state.lock().await.get_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_reset_stats(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reset_stats(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_get_last_messages(
    state: State<'_, OpendkimServiceState>,
    id: String,
    count: Option<u32>,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .get_last_messages(&id, count.unwrap_or(50))
        .await
        .map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn dkim_start(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_stop(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_restart(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_reload(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_status(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_version(state: State<'_, OpendkimServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn dkim_info(
    state: State<'_, OpendkimServiceState>,
    id: String,
) -> CmdResult<OpendkimInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}
