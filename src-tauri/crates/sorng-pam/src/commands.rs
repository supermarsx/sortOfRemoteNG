// ── sorng-pam/src/commands.rs ─────────────────────────────────────────────────
//! Tauri commands – thin wrappers around `PamService_` and host-scoped operations.

use std::collections::HashMap;
use tauri::State;

use crate::service::{self, PamServiceState};
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Host CRUD ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn pam_add_host(state: State<'_, PamServiceState>, host: PamHost) -> CmdResult<()> {
    state.lock().await.add_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn pam_remove_host(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<PamHost> {
    state.lock().await.remove_host(&host_id).map_err(map_err)
}

#[tauri::command]
pub async fn pam_update_host(state: State<'_, PamServiceState>, host: PamHost) -> CmdResult<()> {
    state.lock().await.update_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn pam_get_host(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<PamHost> {
    state.lock().await.clone_host(&host_id).map_err(map_err)
}

#[tauri::command]
pub async fn pam_list_hosts(state: State<'_, PamServiceState>) -> CmdResult<Vec<PamHost>> {
    Ok(state.lock().await.list_hosts())
}

// ── Services (services.rs) ────────────────────────────────────────

#[tauri::command]
pub async fn pam_list_services(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<Vec<PamService>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_list_services(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn pam_get_service(
    state: State<'_, PamServiceState>,
    host_id: String,
    name: String,
) -> CmdResult<PamService> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_service(&host, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_create_service(
    state: State<'_, PamServiceState>,
    host_id: String,
    name: String,
    lines_json: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let lines: Vec<PamModuleLine> = serde_json::from_str(&lines_json).map_err(map_err)?;
    service::host_create_service(&host, &name, &lines)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_update_service(
    state: State<'_, PamServiceState>,
    host_id: String,
    name: String,
    lines_json: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let lines: Vec<PamModuleLine> = serde_json::from_str(&lines_json).map_err(map_err)?;
    service::host_update_service(&host, &name, &lines)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_delete_service(
    state: State<'_, PamServiceState>,
    host_id: String,
    name: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_delete_service(&host, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_backup_service(
    state: State<'_, PamServiceState>,
    host_id: String,
    name: String,
) -> CmdResult<String> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_backup_service(&host, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_restore_service(
    state: State<'_, PamServiceState>,
    host_id: String,
    name: String,
    content: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_restore_service(&host, &name, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_validate_service(
    state: State<'_, PamServiceState>,
    host_id: String,
    name: String,
) -> CmdResult<Vec<String>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_validate_service(&host, &name)
        .await
        .map_err(map_err)
}

// ── Modules (modules.rs) ─────────────────────────────────────────

#[tauri::command]
pub async fn pam_list_modules(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<Vec<PamModuleInfo>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_list_modules(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn pam_get_module_info(
    state: State<'_, PamServiceState>,
    host_id: String,
    module_name: String,
) -> CmdResult<PamModuleInfo> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_module_info(&host, &module_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_find_module_users(
    state: State<'_, PamServiceState>,
    host_id: String,
    module_name: String,
) -> CmdResult<Vec<String>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_find_module_users(&host, &module_name)
        .await
        .map_err(map_err)
}

// ── Limits (limits.rs) ───────────────────────────────────────────

#[tauri::command]
pub async fn pam_get_limits(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<Vec<PamLimit>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_limits(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn pam_set_limit(
    state: State<'_, PamServiceState>,
    host_id: String,
    domain: String,
    limit_type: String,
    item: String,
    value: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let lt = LimitType::parse(&limit_type)
        .ok_or_else(|| format!("invalid limit type: '{limit_type}'"))?;
    let it = PamLimitItem::parse(&item).ok_or_else(|| format!("invalid limit item: '{item}'"))?;
    let limit = PamLimit {
        domain,
        limit_type: lt,
        item: it,
        value,
    };
    service::host_set_limit(&host, &limit)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_remove_limit(
    state: State<'_, PamServiceState>,
    host_id: String,
    domain: String,
    item: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let it = PamLimitItem::parse(&item).ok_or_else(|| format!("invalid limit item: '{item}'"))?;
    service::host_remove_limit(&host, &domain, it)
        .await
        .map_err(map_err)
}

// ── Access (access.rs) ───────────────────────────────────────────

#[tauri::command]
pub async fn pam_get_access_rules(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<Vec<PamAccessRule>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_access_rules(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn pam_add_access_rule(
    state: State<'_, PamServiceState>,
    host_id: String,
    permission: String,
    users: Vec<String>,
    origins: Vec<String>,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let rule = PamAccessRule {
        permission,
        users,
        origins,
    };
    service::host_add_access_rule(&host, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_remove_access_rule(
    state: State<'_, PamServiceState>,
    host_id: String,
    index: usize,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_remove_access_rule(&host, index)
        .await
        .map_err(map_err)
}

// ── Time (time_conf.rs) ──────────────────────────────────────────

#[tauri::command]
pub async fn pam_get_time_rules(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<Vec<PamTimeRule>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_time_rules(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn pam_add_time_rule(
    state: State<'_, PamServiceState>,
    host_id: String,
    services: String,
    ttys: String,
    users: String,
    times: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let rule = PamTimeRule {
        services,
        ttys,
        users,
        times,
    };
    service::host_add_time_rule(&host, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_remove_time_rule(
    state: State<'_, PamServiceState>,
    host_id: String,
    index: usize,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_remove_time_rule(&host, index)
        .await
        .map_err(map_err)
}

// ── Password Quality (pwquality.rs) ──────────────────────────────

#[tauri::command]
pub async fn pam_get_pwquality(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<PwQualityConfig> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_pwquality(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn pam_set_pwquality(
    state: State<'_, PamServiceState>,
    host_id: String,
    config_json: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let config: PwQualityConfig = serde_json::from_str(&config_json).map_err(map_err)?;
    service::host_set_pwquality(&host, &config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_test_password(
    state: State<'_, PamServiceState>,
    host_id: String,
    password: String,
) -> CmdResult<Vec<String>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_test_password(&host, &password)
        .await
        .map_err(map_err)
}

// ── Namespace (namespace.rs) ─────────────────────────────────────

#[tauri::command]
pub async fn pam_get_namespace_rules(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<Vec<PamNamespaceRule>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_namespace_rules(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_add_namespace_rule(
    state: State<'_, PamServiceState>,
    host_id: String,
    polydir: String,
    method: String,
    options: Vec<String>,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    let rule = PamNamespaceRule {
        polydir,
        instance_method: method,
        method_options: options,
    };
    service::host_add_namespace_rule(&host, &rule)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_remove_namespace_rule(
    state: State<'_, PamServiceState>,
    host_id: String,
    index: usize,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_remove_namespace_rule(&host, index)
        .await
        .map_err(map_err)
}

// ── Login Defs (login_defs.rs) ───────────────────────────────────

#[tauri::command]
pub async fn pam_get_login_defs(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<LoginDefs> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_login_defs(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn pam_set_login_def(
    state: State<'_, PamServiceState>,
    host_id: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_set_login_def(&host, &key, &value)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn pam_get_password_policy(
    state: State<'_, PamServiceState>,
    host_id: String,
) -> CmdResult<HashMap<String, String>> {
    let host = state.lock().await.clone_host(&host_id).map_err(map_err)?;
    service::host_get_password_policy(&host)
        .await
        .map_err(map_err)
}
