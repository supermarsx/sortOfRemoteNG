// ── sorng-mac/src/commands.rs ─────────────────────────────────────────────────
//! Tauri commands — thin wrappers around `MacService`.

use tauri::State;

use crate::service::MacServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mac_connect(
    state: State<'_, MacServiceState>,
    id: String,
    config: MacConnectionConfig,
) -> CmdResult<MacConnectionSummary> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn mac_disconnect(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn mac_list_connections(
    state: State<'_, MacServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn mac_detect_system(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<MacSystemType> {
    state.lock().await.detect_system(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn mac_get_dashboard(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<MacDashboard> {
    state
        .lock()
        .await
        .get_dashboard(&id)
        .await
        .map_err(map_err)
}

// ── SELinux ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn mac_selinux_status(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<SelinuxStatus> {
    state
        .lock()
        .await
        .selinux_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_get_mode(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<SelinuxMode> {
    state
        .lock()
        .await
        .selinux_get_mode(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_set_mode(
    state: State<'_, MacServiceState>,
    id: String,
    request: SetModeRequest,
) -> CmdResult<SelinuxMode> {
    state
        .lock()
        .await
        .selinux_set_mode(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_list_booleans(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SelinuxBoolean>> {
    state
        .lock()
        .await
        .selinux_list_booleans(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_get_boolean(
    state: State<'_, MacServiceState>,
    id: String,
    name: String,
) -> CmdResult<SelinuxBoolean> {
    state
        .lock()
        .await
        .selinux_get_boolean(&id, &name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_set_boolean(
    state: State<'_, MacServiceState>,
    id: String,
    request: SetBooleanRequest,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .selinux_set_boolean(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_list_modules(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SelinuxModule>> {
    state
        .lock()
        .await
        .selinux_list_modules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_manage_module(
    state: State<'_, MacServiceState>,
    id: String,
    request: ManageModuleRequest,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .selinux_manage_module(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_list_file_contexts(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SelinuxFileContext>> {
    state
        .lock()
        .await
        .selinux_list_file_contexts(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_add_file_context(
    state: State<'_, MacServiceState>,
    id: String,
    request: AddFileContextRequest,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .selinux_add_file_context(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_remove_file_context(
    state: State<'_, MacServiceState>,
    id: String,
    pattern: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .selinux_remove_file_context(&id, &pattern)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_restorecon(
    state: State<'_, MacServiceState>,
    id: String,
    path: String,
    recursive: bool,
) -> CmdResult<Vec<String>> {
    state
        .lock()
        .await
        .selinux_restorecon(&id, &path, recursive)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_list_ports(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SelinuxPort>> {
    state
        .lock()
        .await
        .selinux_list_ports(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_add_port_context(
    state: State<'_, MacServiceState>,
    id: String,
    request: AddPortContextRequest,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .selinux_add_port_context(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_list_users(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SelinuxUser>> {
    state
        .lock()
        .await
        .selinux_list_users(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_list_roles(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SelinuxRole>> {
    state
        .lock()
        .await
        .selinux_list_roles(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_get_policy_info(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<SelinuxPolicy> {
    state
        .lock()
        .await
        .selinux_get_policy_info(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_audit_log(
    state: State<'_, MacServiceState>,
    id: String,
    limit: u32,
) -> CmdResult<Vec<SelinuxAuditEntry>> {
    state
        .lock()
        .await
        .selinux_audit_log(&id, limit)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_selinux_audit2allow(
    state: State<'_, MacServiceState>,
    id: String,
    audit_lines: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .selinux_audit2allow(&id, &audit_lines)
        .await
        .map_err(map_err)
}

// ── AppArmor ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn mac_apparmor_status(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<AppArmorStatus> {
    state
        .lock()
        .await
        .apparmor_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_list_profiles(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<AppArmorProfile>> {
    state
        .lock()
        .await
        .apparmor_list_profiles(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_set_profile_mode(
    state: State<'_, MacServiceState>,
    id: String,
    request: SetProfileModeRequest,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .apparmor_set_profile_mode(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_reload_profile(
    state: State<'_, MacServiceState>,
    id: String,
    profile_name: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .apparmor_reload_profile(&id, &profile_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_create_profile(
    state: State<'_, MacServiceState>,
    id: String,
    request: CreateProfileRequest,
) -> CmdResult<AppArmorProfile> {
    state
        .lock()
        .await
        .apparmor_create_profile(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_delete_profile(
    state: State<'_, MacServiceState>,
    id: String,
    profile_name: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .apparmor_delete_profile(&id, &profile_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_get_profile_content(
    state: State<'_, MacServiceState>,
    id: String,
    profile_name: String,
) -> CmdResult<String> {
    state
        .lock()
        .await
        .apparmor_get_profile_content(&id, &profile_name)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_update_profile_content(
    state: State<'_, MacServiceState>,
    id: String,
    profile_name: String,
    content: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .apparmor_update_profile_content(&id, &profile_name, &content)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_apparmor_audit_log(
    state: State<'_, MacServiceState>,
    id: String,
    limit: u32,
) -> CmdResult<Vec<AppArmorLogEntry>> {
    state
        .lock()
        .await
        .apparmor_audit_log(&id, limit)
        .await
        .map_err(map_err)
}

// ── TOMOYO ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mac_tomoyo_status(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<TomoyoStatus> {
    state
        .lock()
        .await
        .tomoyo_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_tomoyo_list_domains(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<TomoyoDomain>> {
    state
        .lock()
        .await
        .tomoyo_list_domains(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_tomoyo_set_domain_mode(
    state: State<'_, MacServiceState>,
    id: String,
    request: SetDomainModeRequest,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .tomoyo_set_domain_mode(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_tomoyo_list_rules(
    state: State<'_, MacServiceState>,
    id: String,
    domain: String,
) -> CmdResult<Vec<TomoyoRule>> {
    state
        .lock()
        .await
        .tomoyo_list_rules(&id, &domain)
        .await
        .map_err(map_err)
}

// ── SMACK ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mac_smack_status(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<SmackStatus> {
    state
        .lock()
        .await
        .smack_status(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_smack_list_labels(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SmackLabel>> {
    state
        .lock()
        .await
        .smack_list_labels(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_smack_list_rules(
    state: State<'_, MacServiceState>,
    id: String,
) -> CmdResult<Vec<SmackRule>> {
    state
        .lock()
        .await
        .smack_list_rules(&id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_smack_add_rule(
    state: State<'_, MacServiceState>,
    id: String,
    request: AddSmackRuleRequest,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .smack_add_rule(&id, request)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn mac_smack_remove_rule(
    state: State<'_, MacServiceState>,
    id: String,
    subject: String,
    object: String,
) -> CmdResult<bool> {
    state
        .lock()
        .await
        .smack_remove_rule(&id, &subject, &object)
        .await
        .map_err(map_err)
}

// ── Compliance ────────────────────────────────────────────────────

#[tauri::command]
pub async fn mac_compliance_check(
    state: State<'_, MacServiceState>,
    id: String,
    framework: String,
) -> CmdResult<ComplianceResult> {
    state
        .lock()
        .await
        .compliance_check(&id, &framework)
        .await
        .map_err(map_err)
}
