// ── sorng-cyrus-sasl/src/commands.rs ─────────────────────────────────────────
// Tauri commands – thin wrappers around `CyrusSaslService`.

use std::collections::HashMap;
use tauri::State;

use super::service::CyrusSaslServiceState;
use super::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_connect(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    config: CyrusSaslConnectionConfig,
) -> CmdResult<CyrusSaslConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_disconnect(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn sasl_list_connections(
    state: State<'_, CyrusSaslServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn sasl_ping(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<bool> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Mechanisms ────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_list_mechanisms(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<SaslMechanism>> {
    state
        .lock()
        .await
        .list_mechanisms(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_get_mechanism(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    name: String,
) -> CmdResult<SaslMechanism> {
    state
        .lock()
        .await
        .get_mechanism(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_list_available_mechanisms(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<SaslMechanism>> {
    state
        .lock()
        .await
        .list_available_mechanisms(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_list_enabled_mechanisms(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .list_enabled_mechanisms(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_enable_mechanism(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .enable_mechanism(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_disable_mechanism(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .disable_mechanism(&id, &name)
        .await
        .map_err(map_err)
}

// ── Users ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_list_users(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<SaslUser>> {
    state.lock().await.list_users(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_get_user(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    realm: String,
) -> CmdResult<SaslUser> {
    state
        .lock()
        .await
        .get_user(&id, &username, &realm)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_create_user(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    request: CreateSaslUserRequest,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .create_user(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_update_user(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    realm: String,
    request: UpdateSaslUserRequest,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .update_user(&id, &username, &realm, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_delete_user(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    realm: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_user(&id, &username, &realm)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_test_auth(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    realm: String,
    password: String,
) -> CmdResult<SaslTestResult> {
    state
        .lock()
        .await
        .test_auth(&id, &username, &realm, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_list_realms(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_realms(&id).await.map_err(map_err)
}

// ── Saslauthd ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_get_saslauthd_config(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<SaslauthConfig> {
    state
        .lock()
        .await
        .get_saslauthd_config(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_set_saslauthd_config(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    config: SaslauthConfig,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_saslauthd_config(&id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_get_saslauthd_status(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<SaslauthStatus> {
    state
        .lock()
        .await
        .get_saslauthd_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_start_saslauthd(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .start_saslauthd(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_stop_saslauthd(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .stop_saslauthd(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_restart_saslauthd(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .restart_saslauthd(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_set_saslauthd_mechanism(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    mech: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_saslauthd_mechanism(&id, &mech)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_set_saslauthd_flags(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    flags: Vec<String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_saslauthd_flags(&id, flags)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_test_saslauthd_auth(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    password: String,
    service: String,
    realm: String,
) -> CmdResult<SaslTestResult> {
    state
        .lock()
        .await
        .test_saslauthd_auth(&id, &username, &password, &service, &realm)
        .await
        .map_err(map_err)
}

// ── App Config ────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_list_apps(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<String>> {
    state.lock().await.list_apps(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_get_app_config(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    app_name: String,
) -> CmdResult<SaslAppConfig> {
    state
        .lock()
        .await
        .get_app_config(&id, &app_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_set_app_config(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    app_name: String,
    config: SaslAppConfig,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_app_config(&id, &app_name, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_delete_app_config(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    app_name: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_app_config(&id, &app_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_get_app_param(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    app_name: String,
    key: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .get_app_param(&id, &app_name, &key)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_set_app_param(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    app_name: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_app_param(&id, &app_name, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_delete_app_param(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    app_name: String,
    key: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_app_param(&id, &app_name, &key)
        .await
        .map_err(map_err)
}

// ── Auxprop ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_list_auxprop(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<AuxpropPlugin>> {
    state.lock().await.list_auxprop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_get_auxprop(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    name: String,
) -> CmdResult<AuxpropPlugin> {
    state
        .lock()
        .await
        .get_auxprop(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_configure_auxprop(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    name: String,
    settings: HashMap<String, String>,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .configure_auxprop(&id, &name, settings)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_test_auxprop(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    name: String,
) -> CmdResult<SaslTestResult> {
    state
        .lock()
        .await
        .test_auxprop(&id, &name)
        .await
        .map_err(map_err)
}

// ── SaslDB ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_list_db_entries(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<Vec<SaslDbEntry>> {
    state
        .lock()
        .await
        .list_db_entries(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_get_db_entry(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    realm: String,
) -> CmdResult<Vec<SaslDbEntry>> {
    state
        .lock()
        .await
        .get_db_entry(&id, &username, &realm)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_set_db_password(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    realm: String,
    password: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .set_db_password(&id, &username, &realm, &password)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_delete_db_entry(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    username: String,
    realm: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .delete_db_entry(&id, &username, &realm)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn sasl_dump_db(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.dump_db(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_import_db(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
    data: String,
) -> CmdResult<()> {
    state
        .lock()
        .await
        .import_db(&id, data)
        .await
        .map_err(map_err)
}

// ── Process ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn sasl_start(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.start(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_stop(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.stop(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_restart(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.restart(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_reload(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<()> {
    state.lock().await.reload(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_status(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<String> {
    state.lock().await.status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_version(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<String> {
    state.lock().await.version(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_info(state: State<'_, CyrusSaslServiceState>, id: String) -> CmdResult<SaslInfo> {
    state.lock().await.info(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn sasl_test_config(
    state: State<'_, CyrusSaslServiceState>,
    id: String,
) -> CmdResult<SaslTestResult> {
    state.lock().await.test_config(&id).await.map_err(map_err)
}
