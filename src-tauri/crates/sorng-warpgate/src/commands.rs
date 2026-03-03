// ── sorng-warpgate/src/commands.rs ──────────────────────────────────────────
//! Tauri commands – thin wrappers around `WarpgateService`.

use tauri::State;
use crate::service::WarpgateServiceState;
use crate::types::*;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_connect(
    state: State<'_, WarpgateServiceState>,
    id: String,
    config: WarpgateConnectionConfig,
) -> CmdResult<WarpgateConnectionStatus> {
    state.lock().await.connect(id, config).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_disconnect(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_list_connections(
    state: State<'_, WarpgateServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn warpgate_ping(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<WarpgateConnectionStatus> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Targets ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_targets(
    state: State<'_, WarpgateServiceState>,
    id: String,
    search: Option<String>,
    group_id: Option<String>,
) -> CmdResult<Vec<WarpgateTarget>> {
    state.lock().await.list_targets(&id, search, group_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_target(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: TargetDataRequest,
) -> CmdResult<WarpgateTarget> {
    state.lock().await.create_target(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_target(
    state: State<'_, WarpgateServiceState>,
    id: String,
    target_id: String,
) -> CmdResult<WarpgateTarget> {
    state.lock().await.get_target(&id, &target_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_target(
    state: State<'_, WarpgateServiceState>,
    id: String,
    target_id: String,
    request: TargetDataRequest,
) -> CmdResult<WarpgateTarget> {
    state.lock().await.update_target(&id, &target_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_target(
    state: State<'_, WarpgateServiceState>,
    id: String,
    target_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_target(&id, &target_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_target_ssh_host_keys(
    state: State<'_, WarpgateServiceState>,
    id: String,
    target_id: String,
) -> CmdResult<Vec<WarpgateKnownHost>> {
    state.lock().await.get_target_ssh_host_keys(&id, &target_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_target_roles(
    state: State<'_, WarpgateServiceState>,
    id: String,
    target_id: String,
) -> CmdResult<Vec<WarpgateRole>> {
    state.lock().await.get_target_roles(&id, &target_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_add_target_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    target_id: String,
    role_id: String,
) -> CmdResult<()> {
    state.lock().await.add_target_role(&id, &target_id, &role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_remove_target_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    target_id: String,
    role_id: String,
) -> CmdResult<()> {
    state.lock().await.remove_target_role(&id, &target_id, &role_id).await.map_err(map_err)
}

// ── Target Groups ────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_target_groups(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<Vec<WarpgateTargetGroup>> {
    state.lock().await.list_target_groups(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_target_group(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: TargetGroupDataRequest,
) -> CmdResult<WarpgateTargetGroup> {
    state.lock().await.create_target_group(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_target_group(
    state: State<'_, WarpgateServiceState>,
    id: String,
    group_id: String,
) -> CmdResult<WarpgateTargetGroup> {
    state.lock().await.get_target_group(&id, &group_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_target_group(
    state: State<'_, WarpgateServiceState>,
    id: String,
    group_id: String,
    request: TargetGroupDataRequest,
) -> CmdResult<WarpgateTargetGroup> {
    state.lock().await.update_target_group(&id, &group_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_target_group(
    state: State<'_, WarpgateServiceState>,
    id: String,
    group_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_target_group(&id, &group_id).await.map_err(map_err)
}

// ── Users ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_users(
    state: State<'_, WarpgateServiceState>,
    id: String,
    search: Option<String>,
) -> CmdResult<Vec<WarpgateUser>> {
    state.lock().await.list_users(&id, search).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_user(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: CreateUserRequest,
) -> CmdResult<WarpgateUser> {
    state.lock().await.create_user(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_user(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<WarpgateUser> {
    state.lock().await.get_user(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_user(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    request: UpdateUserRequest,
) -> CmdResult<WarpgateUser> {
    state.lock().await.update_user(&id, &user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_user(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_user(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_user_roles(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<Vec<WarpgateRole>> {
    state.lock().await.get_user_roles(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_add_user_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    role_id: String,
) -> CmdResult<()> {
    state.lock().await.add_user_role(&id, &user_id, &role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_remove_user_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    role_id: String,
) -> CmdResult<()> {
    state.lock().await.remove_user_role(&id, &user_id, &role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_unlink_user_ldap(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<WarpgateUser> {
    state.lock().await.unlink_user_ldap(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_auto_link_user_ldap(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<WarpgateUser> {
    state.lock().await.auto_link_user_ldap(&id, &user_id).await.map_err(map_err)
}

// ── Roles ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_roles(
    state: State<'_, WarpgateServiceState>,
    id: String,
    search: Option<String>,
) -> CmdResult<Vec<WarpgateRole>> {
    state.lock().await.list_roles(&id, search).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: RoleDataRequest,
) -> CmdResult<WarpgateRole> {
    state.lock().await.create_role(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    role_id: String,
) -> CmdResult<WarpgateRole> {
    state.lock().await.get_role(&id, &role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    role_id: String,
    request: RoleDataRequest,
) -> CmdResult<WarpgateRole> {
    state.lock().await.update_role(&id, &role_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_role(
    state: State<'_, WarpgateServiceState>,
    id: String,
    role_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_role(&id, &role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_role_targets(
    state: State<'_, WarpgateServiceState>,
    id: String,
    role_id: String,
) -> CmdResult<Vec<WarpgateTarget>> {
    state.lock().await.get_role_targets(&id, &role_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_role_users(
    state: State<'_, WarpgateServiceState>,
    id: String,
    role_id: String,
) -> CmdResult<Vec<WarpgateUser>> {
    state.lock().await.get_role_users(&id, &role_id).await.map_err(map_err)
}

// ── Sessions ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_sessions(
    state: State<'_, WarpgateServiceState>,
    id: String,
    offset: Option<u64>,
    limit: Option<u64>,
    active_only: Option<bool>,
    logged_in_only: Option<bool>,
) -> CmdResult<SessionListResponse> {
    state.lock().await.list_sessions(&id, offset, limit, active_only, logged_in_only).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_session(
    state: State<'_, WarpgateServiceState>,
    id: String,
    session_id: String,
) -> CmdResult<WarpgateSession> {
    state.lock().await.get_session(&id, &session_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_close_session(
    state: State<'_, WarpgateServiceState>,
    id: String,
    session_id: String,
) -> CmdResult<()> {
    state.lock().await.close_session(&id, &session_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_close_all_sessions(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.close_all_sessions(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_session_recordings(
    state: State<'_, WarpgateServiceState>,
    id: String,
    session_id: String,
) -> CmdResult<Vec<WarpgateRecording>> {
    state.lock().await.get_session_recordings(&id, &session_id).await.map_err(map_err)
}

// ── Recordings ───────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_get_recording(
    state: State<'_, WarpgateServiceState>,
    id: String,
    recording_id: String,
) -> CmdResult<WarpgateRecording> {
    state.lock().await.get_recording(&id, &recording_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_recording_cast(
    state: State<'_, WarpgateServiceState>,
    id: String,
    recording_id: String,
) -> CmdResult<String> {
    state.lock().await.get_recording_cast(&id, &recording_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_recording_tcpdump(
    state: State<'_, WarpgateServiceState>,
    id: String,
    recording_id: String,
) -> CmdResult<Vec<u8>> {
    state.lock().await.get_recording_tcpdump(&id, &recording_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_recording_kubernetes(
    state: State<'_, WarpgateServiceState>,
    id: String,
    recording_id: String,
) -> CmdResult<serde_json::Value> {
    state.lock().await.get_recording_kubernetes(&id, &recording_id).await.map_err(map_err)
}

// ── Tickets ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_tickets(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<Vec<WarpgateTicket>> {
    state.lock().await.list_tickets(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_ticket(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: CreateTicketRequest,
) -> CmdResult<TicketAndSecret> {
    state.lock().await.create_ticket(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_ticket(
    state: State<'_, WarpgateServiceState>,
    id: String,
    ticket_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_ticket(&id, &ticket_id).await.map_err(map_err)
}

// ── Password Credentials ────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_password_credentials(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<Vec<PasswordCredential>> {
    state.lock().await.list_password_credentials(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_password_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    request: NewPasswordCredential,
) -> CmdResult<PasswordCredential> {
    state.lock().await.create_password_credential(&id, &user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_password_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_password_credential(&id, &user_id, &cred_id).await.map_err(map_err)
}

// ── Public Key Credentials ──────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_public_key_credentials(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<Vec<PublicKeyCredential>> {
    state.lock().await.list_public_key_credentials(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_public_key_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    request: NewPublicKeyCredential,
) -> CmdResult<PublicKeyCredential> {
    state.lock().await.create_public_key_credential(&id, &user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_public_key_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
    request: NewPublicKeyCredential,
) -> CmdResult<PublicKeyCredential> {
    state.lock().await.update_public_key_credential(&id, &user_id, &cred_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_public_key_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_public_key_credential(&id, &user_id, &cred_id).await.map_err(map_err)
}

// ── SSO Credentials ─────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_sso_credentials(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<Vec<SsoCredential>> {
    state.lock().await.list_sso_credentials(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_sso_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    request: NewSsoCredential,
) -> CmdResult<SsoCredential> {
    state.lock().await.create_sso_credential(&id, &user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_sso_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
    request: NewSsoCredential,
) -> CmdResult<SsoCredential> {
    state.lock().await.update_sso_credential(&id, &user_id, &cred_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_sso_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_sso_credential(&id, &user_id, &cred_id).await.map_err(map_err)
}

// ── OTP Credentials ─────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_otp_credentials(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<Vec<OtpCredential>> {
    state.lock().await.list_otp_credentials(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_otp_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    request: NewOtpCredential,
) -> CmdResult<OtpCredential> {
    state.lock().await.create_otp_credential(&id, &user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_otp_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_otp_credential(&id, &user_id, &cred_id).await.map_err(map_err)
}

// ── Certificate Credentials ─────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_certificate_credentials(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
) -> CmdResult<Vec<CertificateCredential>> {
    state.lock().await.list_certificate_credentials(&id, &user_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_issue_certificate_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    request: IssueCertificateRequest,
) -> CmdResult<IssuedCertificate> {
    state.lock().await.issue_certificate_credential(&id, &user_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_certificate_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
    request: UpdateCertificateLabel,
) -> CmdResult<CertificateCredential> {
    state.lock().await.update_certificate_credential(&id, &user_id, &cred_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_revoke_certificate_credential(
    state: State<'_, WarpgateServiceState>,
    id: String,
    user_id: String,
    cred_id: String,
) -> CmdResult<()> {
    state.lock().await.revoke_certificate_credential(&id, &user_id, &cred_id).await.map_err(map_err)
}

// ── SSH Keys ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_get_ssh_own_keys(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<Vec<WarpgateSshKey>> {
    state.lock().await.get_ssh_own_keys(&id).await.map_err(map_err)
}

// ── Known Hosts ──────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_known_hosts(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<Vec<WarpgateKnownHost>> {
    state.lock().await.list_known_hosts(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_add_known_host(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: AddKnownHostRequest,
) -> CmdResult<WarpgateKnownHost> {
    state.lock().await.add_known_host(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_known_host(
    state: State<'_, WarpgateServiceState>,
    id: String,
    host_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_known_host(&id, &host_id).await.map_err(map_err)
}

// ── SSH Connection Test ──────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_check_ssh_host_key(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: CheckSshHostKeyRequest,
) -> CmdResult<CheckSshHostKeyResponse> {
    state.lock().await.check_ssh_host_key(&id, request).await.map_err(map_err)
}

// ── LDAP Servers ─────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_list_ldap_servers(
    state: State<'_, WarpgateServiceState>,
    id: String,
    search: Option<String>,
) -> CmdResult<Vec<WarpgateLdapServer>> {
    state.lock().await.list_ldap_servers(&id, search).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_create_ldap_server(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: CreateLdapServerRequest,
) -> CmdResult<WarpgateLdapServer> {
    state.lock().await.create_ldap_server(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_ldap_server(
    state: State<'_, WarpgateServiceState>,
    id: String,
    server_id: String,
) -> CmdResult<WarpgateLdapServer> {
    state.lock().await.get_ldap_server(&id, &server_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_ldap_server(
    state: State<'_, WarpgateServiceState>,
    id: String,
    server_id: String,
    request: UpdateLdapServerRequest,
) -> CmdResult<WarpgateLdapServer> {
    state.lock().await.update_ldap_server(&id, &server_id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_delete_ldap_server(
    state: State<'_, WarpgateServiceState>,
    id: String,
    server_id: String,
) -> CmdResult<()> {
    state.lock().await.delete_ldap_server(&id, &server_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_test_ldap_connection(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: TestLdapServerRequest,
) -> CmdResult<TestLdapServerResponse> {
    state.lock().await.test_ldap_connection(&id, request).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_get_ldap_users(
    state: State<'_, WarpgateServiceState>,
    id: String,
    server_id: String,
) -> CmdResult<Vec<LdapUser>> {
    state.lock().await.get_ldap_users(&id, &server_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_import_ldap_users(
    state: State<'_, WarpgateServiceState>,
    id: String,
    server_id: String,
    request: ImportLdapUsersRequest,
) -> CmdResult<Vec<String>> {
    state.lock().await.import_ldap_users(&id, &server_id, request).await.map_err(map_err)
}

// ── Logs ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_query_logs(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: GetLogsRequest,
) -> CmdResult<Vec<WarpgateLogEntry>> {
    state.lock().await.query_logs(&id, request).await.map_err(map_err)
}

// ── Parameters ───────────────────────────────────────────────────

#[tauri::command]
pub async fn warpgate_get_parameters(
    state: State<'_, WarpgateServiceState>,
    id: String,
) -> CmdResult<WarpgateParameters> {
    state.lock().await.get_parameters(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn warpgate_update_parameters(
    state: State<'_, WarpgateServiceState>,
    id: String,
    request: UpdateParametersRequest,
) -> CmdResult<()> {
    state.lock().await.update_parameters(&id, request).await.map_err(map_err)
}
