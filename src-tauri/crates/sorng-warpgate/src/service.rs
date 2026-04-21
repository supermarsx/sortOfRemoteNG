// ── sorng-warpgate/src/service.rs ───────────────────────────────────────────
//! Aggregate Warpgate façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::WarpgateClient;
use crate::error::{WarpgateError, WarpgateResult};
use crate::types::*;

use crate::credentials::CredentialManager;
use crate::known_hosts::KnownHostManager;
use crate::ldap::LdapManager;
use crate::logs::LogManager;
use crate::parameters::ParameterManager;
use crate::recordings::RecordingManager;
use crate::roles::RoleManager;
use crate::sessions::SessionManager;
use crate::ssh_keys::SshKeyManager;
use crate::ssh_test::SshTestManager;
use crate::target_groups::TargetGroupManager;
use crate::targets::TargetManager;
use crate::tickets::TicketManager;
use crate::users::UserManager;

/// Shared Tauri state handle.
pub type WarpgateServiceState = Arc<Mutex<WarpgateService>>;

/// Main Warpgate service managing connections.
pub struct WarpgateService {
    connections: HashMap<String, WarpgateClient>,
}

impl Default for WarpgateService {
    fn default() -> Self {
        Self::new()
    }
}

impl WarpgateService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: WarpgateConnectionConfig,
    ) -> WarpgateResult<WarpgateConnectionStatus> {
        let mut client = WarpgateClient::from_config(&config)?;
        client.login().await?;
        let status = client.ping().await?;
        self.connections.insert(id, client);
        Ok(status)
    }

    pub fn disconnect(&mut self, id: &str) -> WarpgateResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| WarpgateError::session(&format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> WarpgateResult<&WarpgateClient> {
        self.connections
            .get(id)
            .ok_or_else(|| WarpgateError::session(&format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> WarpgateResult<WarpgateConnectionStatus> {
        self.client(id)?.ping().await
    }

    // ── Targets ──────────────────────────────────────────────────

    pub async fn list_targets(
        &self,
        id: &str,
        search: Option<String>,
        group_id: Option<String>,
    ) -> WarpgateResult<Vec<WarpgateTarget>> {
        TargetManager::list(self.client(id)?, search.as_deref(), group_id.as_deref()).await
    }

    pub async fn create_target(
        &self,
        id: &str,
        req: TargetDataRequest,
    ) -> WarpgateResult<WarpgateTarget> {
        TargetManager::create(self.client(id)?, &req).await
    }

    pub async fn get_target(&self, id: &str, target_id: &str) -> WarpgateResult<WarpgateTarget> {
        TargetManager::get(self.client(id)?, target_id).await
    }

    pub async fn update_target(
        &self,
        id: &str,
        target_id: &str,
        req: TargetDataRequest,
    ) -> WarpgateResult<WarpgateTarget> {
        TargetManager::update(self.client(id)?, target_id, &req).await
    }

    pub async fn delete_target(&self, id: &str, target_id: &str) -> WarpgateResult<()> {
        TargetManager::delete(self.client(id)?, target_id).await
    }

    pub async fn get_target_ssh_host_keys(
        &self,
        id: &str,
        target_id: &str,
    ) -> WarpgateResult<Vec<WarpgateKnownHost>> {
        TargetManager::get_known_ssh_host_keys(self.client(id)?, target_id).await
    }

    pub async fn get_target_roles(
        &self,
        id: &str,
        target_id: &str,
    ) -> WarpgateResult<Vec<WarpgateRole>> {
        TargetManager::get_roles(self.client(id)?, target_id).await
    }

    pub async fn add_target_role(
        &self,
        id: &str,
        target_id: &str,
        role_id: &str,
    ) -> WarpgateResult<()> {
        TargetManager::add_role(self.client(id)?, target_id, role_id).await
    }

    pub async fn remove_target_role(
        &self,
        id: &str,
        target_id: &str,
        role_id: &str,
    ) -> WarpgateResult<()> {
        TargetManager::remove_role(self.client(id)?, target_id, role_id).await
    }

    // ── Target Groups ────────────────────────────────────────────

    pub async fn list_target_groups(&self, id: &str) -> WarpgateResult<Vec<WarpgateTargetGroup>> {
        TargetGroupManager::list(self.client(id)?).await
    }

    pub async fn create_target_group(
        &self,
        id: &str,
        req: TargetGroupDataRequest,
    ) -> WarpgateResult<WarpgateTargetGroup> {
        TargetGroupManager::create(self.client(id)?, &req).await
    }

    pub async fn get_target_group(
        &self,
        id: &str,
        group_id: &str,
    ) -> WarpgateResult<WarpgateTargetGroup> {
        TargetGroupManager::get(self.client(id)?, group_id).await
    }

    pub async fn update_target_group(
        &self,
        id: &str,
        group_id: &str,
        req: TargetGroupDataRequest,
    ) -> WarpgateResult<WarpgateTargetGroup> {
        TargetGroupManager::update(self.client(id)?, group_id, &req).await
    }

    pub async fn delete_target_group(&self, id: &str, group_id: &str) -> WarpgateResult<()> {
        TargetGroupManager::delete(self.client(id)?, group_id).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(
        &self,
        id: &str,
        search: Option<String>,
    ) -> WarpgateResult<Vec<WarpgateUser>> {
        UserManager::list(self.client(id)?, search.as_deref()).await
    }

    pub async fn create_user(
        &self,
        id: &str,
        req: CreateUserRequest,
    ) -> WarpgateResult<WarpgateUser> {
        UserManager::create(self.client(id)?, &req).await
    }

    pub async fn get_user(&self, id: &str, user_id: &str) -> WarpgateResult<WarpgateUser> {
        UserManager::get(self.client(id)?, user_id).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        user_id: &str,
        req: UpdateUserRequest,
    ) -> WarpgateResult<WarpgateUser> {
        UserManager::update(self.client(id)?, user_id, &req).await
    }

    pub async fn delete_user(&self, id: &str, user_id: &str) -> WarpgateResult<()> {
        UserManager::delete(self.client(id)?, user_id).await
    }

    pub async fn get_user_roles(
        &self,
        id: &str,
        user_id: &str,
    ) -> WarpgateResult<Vec<WarpgateRole>> {
        UserManager::get_roles(self.client(id)?, user_id).await
    }

    pub async fn add_user_role(
        &self,
        id: &str,
        user_id: &str,
        role_id: &str,
    ) -> WarpgateResult<()> {
        UserManager::add_role(self.client(id)?, user_id, role_id).await
    }

    pub async fn remove_user_role(
        &self,
        id: &str,
        user_id: &str,
        role_id: &str,
    ) -> WarpgateResult<()> {
        UserManager::remove_role(self.client(id)?, user_id, role_id).await
    }

    pub async fn unlink_user_ldap(&self, id: &str, user_id: &str) -> WarpgateResult<WarpgateUser> {
        UserManager::unlink_ldap(self.client(id)?, user_id).await
    }

    pub async fn auto_link_user_ldap(
        &self,
        id: &str,
        user_id: &str,
    ) -> WarpgateResult<WarpgateUser> {
        UserManager::auto_link_ldap(self.client(id)?, user_id).await
    }

    // ── Roles ────────────────────────────────────────────────────

    pub async fn list_roles(
        &self,
        id: &str,
        search: Option<String>,
    ) -> WarpgateResult<Vec<WarpgateRole>> {
        RoleManager::list(self.client(id)?, search.as_deref()).await
    }

    pub async fn create_role(
        &self,
        id: &str,
        req: RoleDataRequest,
    ) -> WarpgateResult<WarpgateRole> {
        RoleManager::create(self.client(id)?, &req).await
    }

    pub async fn get_role(&self, id: &str, role_id: &str) -> WarpgateResult<WarpgateRole> {
        RoleManager::get(self.client(id)?, role_id).await
    }

    pub async fn update_role(
        &self,
        id: &str,
        role_id: &str,
        req: RoleDataRequest,
    ) -> WarpgateResult<WarpgateRole> {
        RoleManager::update(self.client(id)?, role_id, &req).await
    }

    pub async fn delete_role(&self, id: &str, role_id: &str) -> WarpgateResult<()> {
        RoleManager::delete(self.client(id)?, role_id).await
    }

    pub async fn get_role_targets(
        &self,
        id: &str,
        role_id: &str,
    ) -> WarpgateResult<Vec<WarpgateTarget>> {
        RoleManager::get_targets(self.client(id)?, role_id).await
    }

    pub async fn get_role_users(
        &self,
        id: &str,
        role_id: &str,
    ) -> WarpgateResult<Vec<WarpgateUser>> {
        RoleManager::get_users(self.client(id)?, role_id).await
    }

    // ── Sessions ─────────────────────────────────────────────────

    pub async fn list_sessions(
        &self,
        id: &str,
        offset: Option<u64>,
        limit: Option<u64>,
        active_only: Option<bool>,
        logged_in_only: Option<bool>,
    ) -> WarpgateResult<SessionListResponse> {
        SessionManager::list(self.client(id)?, offset, limit, active_only, logged_in_only).await
    }

    pub async fn get_session(&self, id: &str, session_id: &str) -> WarpgateResult<WarpgateSession> {
        SessionManager::get(self.client(id)?, session_id).await
    }

    pub async fn close_session(&self, id: &str, session_id: &str) -> WarpgateResult<()> {
        SessionManager::close(self.client(id)?, session_id).await
    }

    pub async fn close_all_sessions(&self, id: &str) -> WarpgateResult<()> {
        SessionManager::close_all(self.client(id)?).await
    }

    pub async fn get_session_recordings(
        &self,
        id: &str,
        session_id: &str,
    ) -> WarpgateResult<Vec<WarpgateRecording>> {
        SessionManager::get_recordings(self.client(id)?, session_id).await
    }

    // ── Recordings ───────────────────────────────────────────────

    pub async fn get_recording(
        &self,
        id: &str,
        recording_id: &str,
    ) -> WarpgateResult<WarpgateRecording> {
        RecordingManager::get(self.client(id)?, recording_id).await
    }

    pub async fn get_recording_cast(&self, id: &str, recording_id: &str) -> WarpgateResult<String> {
        RecordingManager::get_cast(self.client(id)?, recording_id).await
    }

    pub async fn get_recording_tcpdump(
        &self,
        id: &str,
        recording_id: &str,
    ) -> WarpgateResult<Vec<u8>> {
        RecordingManager::get_tcpdump(self.client(id)?, recording_id).await
    }

    pub async fn get_recording_kubernetes(
        &self,
        id: &str,
        recording_id: &str,
    ) -> WarpgateResult<serde_json::Value> {
        RecordingManager::get_kubernetes(self.client(id)?, recording_id).await
    }

    // ── Tickets ──────────────────────────────────────────────────

    pub async fn list_tickets(&self, id: &str) -> WarpgateResult<Vec<WarpgateTicket>> {
        TicketManager::list(self.client(id)?).await
    }

    pub async fn create_ticket(
        &self,
        id: &str,
        req: CreateTicketRequest,
    ) -> WarpgateResult<TicketAndSecret> {
        TicketManager::create(self.client(id)?, &req).await
    }

    pub async fn delete_ticket(&self, id: &str, ticket_id: &str) -> WarpgateResult<()> {
        TicketManager::delete(self.client(id)?, ticket_id).await
    }

    // ── Credentials ──────────────────────────────────────────────

    // Password
    pub async fn list_password_credentials(
        &self,
        id: &str,
        user_id: &str,
    ) -> WarpgateResult<Vec<PasswordCredential>> {
        CredentialManager::list_passwords(self.client(id)?, user_id).await
    }

    pub async fn create_password_credential(
        &self,
        id: &str,
        user_id: &str,
        req: NewPasswordCredential,
    ) -> WarpgateResult<PasswordCredential> {
        CredentialManager::create_password(self.client(id)?, user_id, &req).await
    }

    pub async fn delete_password_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
    ) -> WarpgateResult<()> {
        CredentialManager::delete_password(self.client(id)?, user_id, cred_id).await
    }

    // Public key
    pub async fn list_public_key_credentials(
        &self,
        id: &str,
        user_id: &str,
    ) -> WarpgateResult<Vec<PublicKeyCredential>> {
        CredentialManager::list_public_keys(self.client(id)?, user_id).await
    }

    pub async fn create_public_key_credential(
        &self,
        id: &str,
        user_id: &str,
        req: NewPublicKeyCredential,
    ) -> WarpgateResult<PublicKeyCredential> {
        CredentialManager::create_public_key(self.client(id)?, user_id, &req).await
    }

    pub async fn update_public_key_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
        req: NewPublicKeyCredential,
    ) -> WarpgateResult<PublicKeyCredential> {
        CredentialManager::update_public_key(self.client(id)?, user_id, cred_id, &req).await
    }

    pub async fn delete_public_key_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
    ) -> WarpgateResult<()> {
        CredentialManager::delete_public_key(self.client(id)?, user_id, cred_id).await
    }

    // SSO
    pub async fn list_sso_credentials(
        &self,
        id: &str,
        user_id: &str,
    ) -> WarpgateResult<Vec<SsoCredential>> {
        CredentialManager::list_sso(self.client(id)?, user_id).await
    }

    pub async fn create_sso_credential(
        &self,
        id: &str,
        user_id: &str,
        req: NewSsoCredential,
    ) -> WarpgateResult<SsoCredential> {
        CredentialManager::create_sso(self.client(id)?, user_id, &req).await
    }

    pub async fn update_sso_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
        req: NewSsoCredential,
    ) -> WarpgateResult<SsoCredential> {
        CredentialManager::update_sso(self.client(id)?, user_id, cred_id, &req).await
    }

    pub async fn delete_sso_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
    ) -> WarpgateResult<()> {
        CredentialManager::delete_sso(self.client(id)?, user_id, cred_id).await
    }

    // OTP
    pub async fn list_otp_credentials(
        &self,
        id: &str,
        user_id: &str,
    ) -> WarpgateResult<Vec<OtpCredential>> {
        CredentialManager::list_otp(self.client(id)?, user_id).await
    }

    pub async fn create_otp_credential(
        &self,
        id: &str,
        user_id: &str,
        req: NewOtpCredential,
    ) -> WarpgateResult<OtpCredential> {
        CredentialManager::create_otp(self.client(id)?, user_id, &req).await
    }

    pub async fn delete_otp_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
    ) -> WarpgateResult<()> {
        CredentialManager::delete_otp(self.client(id)?, user_id, cred_id).await
    }

    // Certificate
    pub async fn list_certificate_credentials(
        &self,
        id: &str,
        user_id: &str,
    ) -> WarpgateResult<Vec<CertificateCredential>> {
        CredentialManager::list_certificates(self.client(id)?, user_id).await
    }

    pub async fn issue_certificate_credential(
        &self,
        id: &str,
        user_id: &str,
        req: IssueCertificateRequest,
    ) -> WarpgateResult<IssuedCertificate> {
        CredentialManager::issue_certificate(self.client(id)?, user_id, &req).await
    }

    pub async fn update_certificate_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
        req: UpdateCertificateLabel,
    ) -> WarpgateResult<CertificateCredential> {
        CredentialManager::update_certificate(self.client(id)?, user_id, cred_id, &req).await
    }

    pub async fn revoke_certificate_credential(
        &self,
        id: &str,
        user_id: &str,
        cred_id: &str,
    ) -> WarpgateResult<()> {
        CredentialManager::revoke_certificate(self.client(id)?, user_id, cred_id).await
    }

    // ── SSH Keys ─────────────────────────────────────────────────

    pub async fn get_ssh_own_keys(&self, id: &str) -> WarpgateResult<Vec<WarpgateSshKey>> {
        SshKeyManager::get_own_keys(self.client(id)?).await
    }

    // ── Known Hosts ──────────────────────────────────────────────

    pub async fn list_known_hosts(&self, id: &str) -> WarpgateResult<Vec<WarpgateKnownHost>> {
        KnownHostManager::list(self.client(id)?).await
    }

    pub async fn add_known_host(
        &self,
        id: &str,
        req: AddKnownHostRequest,
    ) -> WarpgateResult<WarpgateKnownHost> {
        KnownHostManager::add(self.client(id)?, &req).await
    }

    pub async fn delete_known_host(&self, id: &str, host_id: &str) -> WarpgateResult<()> {
        KnownHostManager::delete(self.client(id)?, host_id).await
    }

    // ── SSH Connection Test ──────────────────────────────────────

    pub async fn check_ssh_host_key(
        &self,
        id: &str,
        req: CheckSshHostKeyRequest,
    ) -> WarpgateResult<CheckSshHostKeyResponse> {
        SshTestManager::check_host_key(self.client(id)?, &req).await
    }

    // ── LDAP Servers ─────────────────────────────────────────────

    pub async fn list_ldap_servers(
        &self,
        id: &str,
        search: Option<String>,
    ) -> WarpgateResult<Vec<WarpgateLdapServer>> {
        LdapManager::list(self.client(id)?, search.as_deref()).await
    }

    pub async fn create_ldap_server(
        &self,
        id: &str,
        req: CreateLdapServerRequest,
    ) -> WarpgateResult<WarpgateLdapServer> {
        LdapManager::create(self.client(id)?, &req).await
    }

    pub async fn get_ldap_server(
        &self,
        id: &str,
        server_id: &str,
    ) -> WarpgateResult<WarpgateLdapServer> {
        LdapManager::get(self.client(id)?, server_id).await
    }

    pub async fn update_ldap_server(
        &self,
        id: &str,
        server_id: &str,
        req: UpdateLdapServerRequest,
    ) -> WarpgateResult<WarpgateLdapServer> {
        LdapManager::update(self.client(id)?, server_id, &req).await
    }

    pub async fn delete_ldap_server(&self, id: &str, server_id: &str) -> WarpgateResult<()> {
        LdapManager::delete(self.client(id)?, server_id).await
    }

    pub async fn test_ldap_connection(
        &self,
        id: &str,
        req: TestLdapServerRequest,
    ) -> WarpgateResult<TestLdapServerResponse> {
        LdapManager::test_connection(self.client(id)?, &req).await
    }

    pub async fn get_ldap_users(&self, id: &str, server_id: &str) -> WarpgateResult<Vec<LdapUser>> {
        LdapManager::get_users(self.client(id)?, server_id).await
    }

    pub async fn import_ldap_users(
        &self,
        id: &str,
        server_id: &str,
        req: ImportLdapUsersRequest,
    ) -> WarpgateResult<Vec<String>> {
        LdapManager::import_users(self.client(id)?, server_id, &req).await
    }

    // ── Logs ─────────────────────────────────────────────────────

    pub async fn query_logs(
        &self,
        id: &str,
        req: GetLogsRequest,
    ) -> WarpgateResult<Vec<WarpgateLogEntry>> {
        LogManager::query(self.client(id)?, &req).await
    }

    // ── Parameters ───────────────────────────────────────────────

    pub async fn get_parameters(&self, id: &str) -> WarpgateResult<WarpgateParameters> {
        ParameterManager::get(self.client(id)?).await
    }

    pub async fn update_parameters(
        &self,
        id: &str,
        req: UpdateParametersRequest,
    ) -> WarpgateResult<()> {
        ParameterManager::update(self.client(id)?, &req).await
    }
}
