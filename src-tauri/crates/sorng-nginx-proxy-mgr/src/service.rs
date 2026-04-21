// ── sorng-nginx-proxy-mgr/src/service.rs ─────────────────────────────────────
//! Aggregate Nginx Proxy Manager façade – single entry point that holds
//! connections and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::NpmClient;
use crate::error::{NpmError, NpmResult};
use crate::types::*;

use crate::access_lists::AccessListManager;
use crate::certificates::CertificateManager;
use crate::dead_hosts::DeadHostManager;
use crate::proxy_hosts::ProxyHostManager;
use crate::redirection_hosts::RedirectionHostManager;
use crate::settings::SettingsManager;
use crate::streams::StreamManager;
use crate::users::UserManager;

/// Shared Tauri state handle.
pub type NpmServiceState = Arc<Mutex<NpmService>>;

/// Main Nginx Proxy Manager service managing connections.
pub struct NpmService {
    connections: HashMap<String, NpmClient>,
}

impl Default for NpmService {
    fn default() -> Self {
        Self::new()
    }
}

impl NpmService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(
        &mut self,
        id: String,
        config: NpmConnectionConfig,
    ) -> NpmResult<NpmConnectionSummary> {
        let client = NpmClient::new(config)?;
        client.login().await?;
        let summary = client.ping().await?;
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> NpmResult<()> {
        self.connections
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| NpmError::not_connected(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> NpmResult<&NpmClient> {
        self.connections
            .get(id)
            .ok_or_else(|| NpmError::not_connected(format!("No connection '{}'", id)))
    }

    pub async fn ping(&self, id: &str) -> NpmResult<NpmConnectionSummary> {
        self.client(id)?.ping().await
    }

    // ── Proxy Hosts ──────────────────────────────────────────────

    pub async fn list_proxy_hosts(&self, id: &str) -> NpmResult<Vec<NpmProxyHost>> {
        ProxyHostManager::list(self.client(id)?).await
    }

    pub async fn get_proxy_host(&self, id: &str, host_id: u64) -> NpmResult<NpmProxyHost> {
        ProxyHostManager::get(self.client(id)?, host_id).await
    }

    pub async fn create_proxy_host(
        &self,
        id: &str,
        req: CreateProxyHostRequest,
    ) -> NpmResult<NpmProxyHost> {
        ProxyHostManager::create(self.client(id)?, &req).await
    }

    pub async fn update_proxy_host(
        &self,
        id: &str,
        host_id: u64,
        req: UpdateProxyHostRequest,
    ) -> NpmResult<NpmProxyHost> {
        ProxyHostManager::update(self.client(id)?, host_id, &req).await
    }

    pub async fn delete_proxy_host(&self, id: &str, host_id: u64) -> NpmResult<()> {
        ProxyHostManager::delete(self.client(id)?, host_id).await
    }

    pub async fn enable_proxy_host(&self, id: &str, host_id: u64) -> NpmResult<NpmProxyHost> {
        ProxyHostManager::enable(self.client(id)?, host_id).await
    }

    pub async fn disable_proxy_host(&self, id: &str, host_id: u64) -> NpmResult<NpmProxyHost> {
        ProxyHostManager::disable(self.client(id)?, host_id).await
    }

    // ── Redirection Hosts ────────────────────────────────────────

    pub async fn list_redirection_hosts(&self, id: &str) -> NpmResult<Vec<NpmRedirectionHost>> {
        RedirectionHostManager::list(self.client(id)?).await
    }

    pub async fn get_redirection_host(
        &self,
        id: &str,
        host_id: u64,
    ) -> NpmResult<NpmRedirectionHost> {
        RedirectionHostManager::get(self.client(id)?, host_id).await
    }

    pub async fn create_redirection_host(
        &self,
        id: &str,
        req: CreateRedirectionHostRequest,
    ) -> NpmResult<NpmRedirectionHost> {
        RedirectionHostManager::create(self.client(id)?, &req).await
    }

    pub async fn update_redirection_host(
        &self,
        id: &str,
        host_id: u64,
        req: CreateRedirectionHostRequest,
    ) -> NpmResult<NpmRedirectionHost> {
        RedirectionHostManager::update(self.client(id)?, host_id, &req).await
    }

    pub async fn delete_redirection_host(&self, id: &str, host_id: u64) -> NpmResult<()> {
        RedirectionHostManager::delete(self.client(id)?, host_id).await
    }

    // ── Dead Hosts ───────────────────────────────────────────────

    pub async fn list_dead_hosts(&self, id: &str) -> NpmResult<Vec<NpmDeadHost>> {
        DeadHostManager::list(self.client(id)?).await
    }

    pub async fn get_dead_host(&self, id: &str, host_id: u64) -> NpmResult<NpmDeadHost> {
        DeadHostManager::get(self.client(id)?, host_id).await
    }

    pub async fn create_dead_host(
        &self,
        id: &str,
        req: CreateDeadHostRequest,
    ) -> NpmResult<NpmDeadHost> {
        DeadHostManager::create(self.client(id)?, &req).await
    }

    pub async fn update_dead_host(
        &self,
        id: &str,
        host_id: u64,
        req: CreateDeadHostRequest,
    ) -> NpmResult<NpmDeadHost> {
        DeadHostManager::update(self.client(id)?, host_id, &req).await
    }

    pub async fn delete_dead_host(&self, id: &str, host_id: u64) -> NpmResult<()> {
        DeadHostManager::delete(self.client(id)?, host_id).await
    }

    // ── Streams ──────────────────────────────────────────────────

    pub async fn list_streams(&self, id: &str) -> NpmResult<Vec<NpmStream>> {
        StreamManager::list(self.client(id)?).await
    }

    pub async fn get_stream(&self, id: &str, stream_id: u64) -> NpmResult<NpmStream> {
        StreamManager::get(self.client(id)?, stream_id).await
    }

    pub async fn create_stream(&self, id: &str, req: CreateStreamRequest) -> NpmResult<NpmStream> {
        StreamManager::create(self.client(id)?, &req).await
    }

    pub async fn update_stream(
        &self,
        id: &str,
        stream_id: u64,
        req: CreateStreamRequest,
    ) -> NpmResult<NpmStream> {
        StreamManager::update(self.client(id)?, stream_id, &req).await
    }

    pub async fn delete_stream(&self, id: &str, stream_id: u64) -> NpmResult<()> {
        StreamManager::delete(self.client(id)?, stream_id).await
    }

    // ── Certificates ─────────────────────────────────────────────

    pub async fn list_certificates(&self, id: &str) -> NpmResult<Vec<NpmCertificate>> {
        CertificateManager::list(self.client(id)?).await
    }

    pub async fn get_certificate(&self, id: &str, cert_id: u64) -> NpmResult<NpmCertificate> {
        CertificateManager::get(self.client(id)?, cert_id).await
    }

    pub async fn create_letsencrypt_certificate(
        &self,
        id: &str,
        req: CreateLetsEncryptCertRequest,
    ) -> NpmResult<NpmCertificate> {
        CertificateManager::create_letsencrypt(self.client(id)?, &req).await
    }

    pub async fn upload_custom_certificate(
        &self,
        id: &str,
        req: UploadCustomCertRequest,
    ) -> NpmResult<NpmCertificate> {
        CertificateManager::upload_custom(self.client(id)?, &req).await
    }

    pub async fn delete_certificate(&self, id: &str, cert_id: u64) -> NpmResult<()> {
        CertificateManager::delete(self.client(id)?, cert_id).await
    }

    pub async fn renew_certificate(&self, id: &str, cert_id: u64) -> NpmResult<NpmCertificate> {
        CertificateManager::renew(self.client(id)?, cert_id).await
    }

    pub async fn validate_certificate(
        &self,
        id: &str,
        cert_id: u64,
    ) -> NpmResult<serde_json::Value> {
        CertificateManager::validate(self.client(id)?, cert_id).await
    }

    // ── Users ────────────────────────────────────────────────────

    pub async fn list_users(&self, id: &str) -> NpmResult<Vec<NpmUser>> {
        UserManager::list(self.client(id)?).await
    }

    pub async fn get_user(&self, id: &str, user_id: u64) -> NpmResult<NpmUser> {
        UserManager::get(self.client(id)?, user_id).await
    }

    pub async fn create_user(&self, id: &str, req: CreateUserRequest) -> NpmResult<NpmUser> {
        UserManager::create(self.client(id)?, &req).await
    }

    pub async fn update_user(
        &self,
        id: &str,
        user_id: u64,
        req: UpdateUserRequest,
    ) -> NpmResult<NpmUser> {
        UserManager::update(self.client(id)?, user_id, &req).await
    }

    pub async fn delete_user(&self, id: &str, user_id: u64) -> NpmResult<()> {
        UserManager::delete(self.client(id)?, user_id).await
    }

    pub async fn change_user_password(
        &self,
        id: &str,
        user_id: u64,
        req: ChangePasswordRequest,
    ) -> NpmResult<()> {
        UserManager::change_password(self.client(id)?, user_id, &req).await
    }

    pub async fn get_me(&self, id: &str) -> NpmResult<NpmUser> {
        UserManager::get_me(self.client(id)?).await
    }

    // ── Access Lists ─────────────────────────────────────────────

    pub async fn list_access_lists(&self, id: &str) -> NpmResult<Vec<NpmAccessList>> {
        AccessListManager::list(self.client(id)?).await
    }

    pub async fn get_access_list(&self, id: &str, list_id: u64) -> NpmResult<NpmAccessList> {
        AccessListManager::get(self.client(id)?, list_id).await
    }

    pub async fn create_access_list(
        &self,
        id: &str,
        req: CreateAccessListRequest,
    ) -> NpmResult<NpmAccessList> {
        AccessListManager::create(self.client(id)?, &req).await
    }

    pub async fn update_access_list(
        &self,
        id: &str,
        list_id: u64,
        req: CreateAccessListRequest,
    ) -> NpmResult<NpmAccessList> {
        AccessListManager::update(self.client(id)?, list_id, &req).await
    }

    pub async fn delete_access_list(&self, id: &str, list_id: u64) -> NpmResult<()> {
        AccessListManager::delete(self.client(id)?, list_id).await
    }

    // ── Settings ─────────────────────────────────────────────────

    pub async fn list_settings(&self, id: &str) -> NpmResult<Vec<NpmSetting>> {
        SettingsManager::list(self.client(id)?).await
    }

    pub async fn get_setting(&self, id: &str, setting_id: &str) -> NpmResult<NpmSetting> {
        SettingsManager::get(self.client(id)?, setting_id).await
    }

    pub async fn update_setting(
        &self,
        id: &str,
        setting_id: &str,
        value: serde_json::Value,
    ) -> NpmResult<NpmSetting> {
        SettingsManager::update(self.client(id)?, setting_id, &value).await
    }

    pub async fn get_reports(&self, id: &str) -> NpmResult<NpmReports> {
        SettingsManager::get_reports(self.client(id)?).await
    }

    pub async fn get_audit_log(&self, id: &str) -> NpmResult<Vec<NpmAuditLogEntry>> {
        SettingsManager::get_audit_log(self.client(id)?).await
    }

    pub async fn get_health(&self, id: &str) -> NpmResult<NpmHealthStatus> {
        SettingsManager::get_health(self.client(id)?).await
    }
}
