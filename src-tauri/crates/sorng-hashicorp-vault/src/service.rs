// ── sorng-hashicorp-vault/src/service.rs ──────────────────────────────────────
//! Aggregate Vault façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::VaultClient;
use crate::error::{VaultError, VaultResult};
use crate::types::*;

use crate::kv::KvManager;
use crate::transit::TransitManager;
use crate::pki::PkiManager;
use crate::auth_methods::AuthMethodManager;
use crate::policies::PolicyManager;
use crate::audit::AuditManager;
use crate::tokens::TokenManager;
use crate::leases::LeaseManager;
use crate::sys::SysManager;
use serde_json::Value;

/// Shared Tauri state handle.
pub type VaultServiceState = Arc<Mutex<VaultService>>;

/// Main Vault service managing connections.
pub struct VaultService {
    connections: HashMap<String, VaultClient>,
}

impl VaultService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ─────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: VaultConnectionConfig) -> VaultResult<VaultConnectionSummary> {
        let client = VaultClient::new(&config)?;
        let health = client.health().await?;
        let seal = client.seal_status().await?;
        let summary = VaultConnectionSummary {
            id: id.clone(),
            addr: config.addr.clone(),
            namespace: config.namespace.clone(),
            version: health.version.clone(),
            cluster_name: health.cluster_name.clone(),
            sealed: seal.sealed,
            initialized: seal.initialized,
            connected_at: chrono::Utc::now().to_rfc3339(),
        };
        self.connections.insert(id, client);
        Ok(summary)
    }

    pub fn disconnect(&mut self, id: &str) -> VaultResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| VaultError::not_found(format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> VaultResult<&VaultClient> {
        self.connections.get(id)
            .ok_or_else(|| VaultError::not_found(format!("No connection '{}'", id)))
    }

    pub async fn get_dashboard(&self, id: &str) -> VaultResult<VaultDashboard> {
        let c = self.client(id)?;
        let health = c.health().await?;
        let seal = c.seal_status().await?;
        let leader = c.leader().await.ok();
        let engines = c.list_secret_engines().await.unwrap_or_default();
        let auth_methods = c.list_auth_methods().await.unwrap_or_default();
        let policies = c.list_policies().await.unwrap_or_default();
        Ok(VaultDashboard {
            sealed: seal.sealed,
            initialized: seal.initialized,
            cluster_name: health.cluster_name,
            version: health.version,
            secret_engine_count: engines.len() as u64,
            auth_method_count: auth_methods.len() as u64,
            policy_count: policies.len() as u64,
            ha_enabled: leader.as_ref().map(|l| l.ha_enabled).unwrap_or(false),
            active_node: leader.and_then(|l| l.leader_address),
        })
    }

    // ── Sys ──────────────────────────────────────────────────────

    pub async fn seal_status(&self, id: &str) -> VaultResult<VaultSealStatus> {
        SysManager::seal_status(self.client(id)?).await
    }

    pub async fn seal(&self, id: &str) -> VaultResult<()> {
        SysManager::seal(self.client(id)?).await
    }

    pub async fn unseal(&self, id: &str, key: &str, reset: bool, migrate: bool) -> VaultResult<VaultSealStatus> {
        SysManager::unseal(self.client(id)?, key, reset, migrate).await
    }

    pub async fn health(&self, id: &str) -> VaultResult<VaultHealthResponse> {
        SysManager::health(self.client(id)?).await
    }

    pub async fn leader(&self, id: &str) -> VaultResult<VaultLeader> {
        SysManager::leader(self.client(id)?).await
    }

    pub async fn list_secret_engines(&self, id: &str) -> VaultResult<Vec<VaultSecretEngine>> {
        SysManager::list_secret_engines(self.client(id)?).await
    }

    pub async fn mount_secret_engine(&self, id: &str, path: &str, engine_type: &str, config: Option<&Value>) -> VaultResult<()> {
        SysManager::mount_secret_engine(self.client(id)?, path, engine_type, config).await
    }

    pub async fn unmount_secret_engine(&self, id: &str, path: &str) -> VaultResult<()> {
        SysManager::unmount_secret_engine(self.client(id)?, path).await
    }

    // ── KV ───────────────────────────────────────────────────────

    pub async fn kv_read(&self, id: &str, mount: &str, path: &str) -> VaultResult<VaultKvEntry> {
        KvManager::read_secret(self.client(id)?, mount, path).await
    }

    pub async fn kv_write(&self, id: &str, mount: &str, path: &str, data: Value) -> VaultResult<Value> {
        KvManager::write_secret(self.client(id)?, mount, path, data).await
    }

    pub async fn kv_delete(&self, id: &str, mount: &str, path: &str) -> VaultResult<()> {
        KvManager::delete_secret(self.client(id)?, mount, path).await
    }

    pub async fn kv_list(&self, id: &str, mount: &str, path: &str) -> VaultResult<Vec<String>> {
        KvManager::list_secrets(self.client(id)?, mount, path).await
    }

    pub async fn kv_undelete(&self, id: &str, mount: &str, path: &str, versions: Vec<u64>) -> VaultResult<()> {
        KvManager::undelete_secret(self.client(id)?, mount, path, versions).await
    }

    pub async fn kv_destroy(&self, id: &str, mount: &str, path: &str, versions: Vec<u64>) -> VaultResult<()> {
        KvManager::destroy_secret(self.client(id)?, mount, path, versions).await
    }

    pub async fn kv_metadata(&self, id: &str, mount: &str, path: &str) -> VaultResult<VaultKvMetadata> {
        KvManager::read_metadata(self.client(id)?, mount, path).await
    }

    // ── Transit ──────────────────────────────────────────────────

    pub async fn transit_create_key(&self, id: &str, name: &str, key_type: Option<&str>) -> VaultResult<()> {
        TransitManager::create_key(self.client(id)?, name, key_type).await
    }

    pub async fn transit_list_keys(&self, id: &str) -> VaultResult<Vec<String>> {
        TransitManager::list_keys(self.client(id)?).await
    }

    pub async fn transit_read_key(&self, id: &str, name: &str) -> VaultResult<VaultTransitKey> {
        TransitManager::read_key(self.client(id)?, name).await
    }

    pub async fn transit_encrypt(&self, id: &str, name: &str, plaintext: &str, context: Option<&str>) -> VaultResult<VaultEncryptResponse> {
        TransitManager::encrypt(self.client(id)?, name, plaintext, context).await
    }

    pub async fn transit_decrypt(&self, id: &str, name: &str, ciphertext: &str, context: Option<&str>) -> VaultResult<VaultDecryptResponse> {
        TransitManager::decrypt(self.client(id)?, name, ciphertext, context).await
    }

    pub async fn transit_rotate_key(&self, id: &str, name: &str) -> VaultResult<()> {
        TransitManager::rotate_key(self.client(id)?, name).await
    }

    pub async fn transit_sign(&self, id: &str, name: &str, input: &str) -> VaultResult<Value> {
        TransitManager::sign(self.client(id)?, name, input).await
    }

    pub async fn transit_verify(&self, id: &str, name: &str, input: &str, signature: &str) -> VaultResult<Value> {
        TransitManager::verify(self.client(id)?, name, input, signature).await
    }

    // ── PKI ──────────────────────────────────────────────────────

    pub async fn pki_read_ca(&self, id: &str, mount: &str) -> VaultResult<VaultCaInfo> {
        PkiManager::read_ca_cert(self.client(id)?, mount).await
    }

    pub async fn pki_issue_cert(&self, id: &str, mount: &str, role: &str, params: &VaultPkiIssueCert) -> VaultResult<VaultCertificate> {
        PkiManager::issue_cert(self.client(id)?, mount, role, params).await
    }

    pub async fn pki_list_certs(&self, id: &str, mount: &str) -> VaultResult<Vec<String>> {
        PkiManager::list_certs(self.client(id)?, mount).await
    }

    pub async fn pki_revoke_cert(&self, id: &str, mount: &str, serial: &str) -> VaultResult<Value> {
        PkiManager::revoke_cert(self.client(id)?, mount, serial).await
    }

    pub async fn pki_list_roles(&self, id: &str, mount: &str) -> VaultResult<Vec<String>> {
        PkiManager::list_roles(self.client(id)?, mount).await
    }

    pub async fn pki_create_role(&self, id: &str, mount: &str, name: &str, config: &Value) -> VaultResult<Value> {
        PkiManager::create_role(self.client(id)?, mount, name, config).await
    }

    // ── Auth Methods ─────────────────────────────────────────────

    pub async fn list_auth_methods(&self, id: &str) -> VaultResult<Vec<VaultAuthMount>> {
        AuthMethodManager::list_auth_methods(self.client(id)?).await
    }

    pub async fn enable_auth(&self, id: &str, path: &str, auth_type: &str, config: Option<&Value>) -> VaultResult<()> {
        AuthMethodManager::enable_auth_method(self.client(id)?, path, auth_type, config).await
    }

    pub async fn disable_auth(&self, id: &str, path: &str) -> VaultResult<()> {
        AuthMethodManager::disable_auth_method(self.client(id)?, path).await
    }

    pub async fn userpass_create(&self, id: &str, mount: &str, username: &str, password: &str, policies: &[String]) -> VaultResult<()> {
        AuthMethodManager::userpass_create_user(self.client(id)?, mount, username, password, policies).await
    }

    pub async fn userpass_list(&self, id: &str, mount: &str) -> VaultResult<Vec<String>> {
        AuthMethodManager::userpass_list_users(self.client(id)?, mount).await
    }

    pub async fn userpass_delete(&self, id: &str, mount: &str, username: &str) -> VaultResult<()> {
        AuthMethodManager::userpass_delete_user(self.client(id)?, mount, username).await
    }

    // ── Policies ─────────────────────────────────────────────────

    pub async fn list_policies(&self, id: &str) -> VaultResult<Vec<String>> {
        PolicyManager::list_policies(self.client(id)?).await
    }

    pub async fn read_policy(&self, id: &str, name: &str) -> VaultResult<VaultPolicy> {
        PolicyManager::read_policy(self.client(id)?, name).await
    }

    pub async fn write_policy(&self, id: &str, name: &str, policy_text: &str) -> VaultResult<()> {
        PolicyManager::create_or_update_policy(self.client(id)?, name, policy_text).await
    }

    pub async fn delete_policy(&self, id: &str, name: &str) -> VaultResult<()> {
        PolicyManager::delete_policy(self.client(id)?, name).await
    }

    // ── Audit ────────────────────────────────────────────────────

    pub async fn list_audit_devices(&self, id: &str) -> VaultResult<Vec<VaultAuditDevice>> {
        AuditManager::list_audit_devices(self.client(id)?).await
    }

    pub async fn enable_audit(&self, id: &str, path: &str, audit_type: &str, options: &Value) -> VaultResult<()> {
        AuditManager::enable_audit_device(self.client(id)?, path, audit_type, options).await
    }

    pub async fn disable_audit(&self, id: &str, path: &str) -> VaultResult<()> {
        AuditManager::disable_audit_device(self.client(id)?, path).await
    }

    // ── Tokens ───────────────────────────────────────────────────

    pub async fn create_token(&self, id: &str, request: &VaultTokenCreateRequest) -> VaultResult<VaultTokenInfo> {
        TokenManager::create_token(self.client(id)?, request).await
    }

    pub async fn lookup_token(&self, id: &str, token: &str) -> VaultResult<VaultTokenInfo> {
        TokenManager::lookup_token(self.client(id)?, token).await
    }

    pub async fn revoke_token(&self, id: &str, token: &str) -> VaultResult<()> {
        TokenManager::revoke_token(self.client(id)?, token).await
    }

    pub async fn renew_token(&self, id: &str, token: &str, increment: Option<&str>) -> VaultResult<Value> {
        TokenManager::renew_token(self.client(id)?, token, increment).await
    }

    // ── Leases ───────────────────────────────────────────────────

    pub async fn read_lease(&self, id: &str, lease_id: &str) -> VaultResult<Value> {
        LeaseManager::read_lease(self.client(id)?, lease_id).await
    }

    pub async fn list_leases(&self, id: &str, prefix: &str) -> VaultResult<Vec<String>> {
        LeaseManager::list_leases(self.client(id)?, prefix).await
    }

    pub async fn renew_lease(&self, id: &str, lease_id: &str, increment: Option<&str>) -> VaultResult<Value> {
        LeaseManager::renew_lease(self.client(id)?, lease_id, increment).await
    }

    pub async fn revoke_lease(&self, id: &str, lease_id: &str) -> VaultResult<()> {
        LeaseManager::revoke_lease(self.client(id)?, lease_id).await
    }
}
