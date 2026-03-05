//! # GPG Agent Service
//!
//! Top-level orchestrator combining keyring, signing, encryption, trust,
//! card, config, protocol, and audit into a single service with lifecycle
//! management.

use crate::audit::GpgAuditLogger;
use crate::card::CardManager;
use crate::config::GpgConfigManager;
use crate::encryption::EncryptionEngine;
use crate::keyring::KeyringManager;
use crate::protocol::AssuanClient;
use crate::signing::SigningEngine;
use crate::trust::TrustManager;
use crate::types::*;
use log::{info, warn};

/// The main GPG agent service — orchestrates all modules.
pub struct GpgAgentService {
    /// Keyring manager.
    pub keyring: KeyringManager,
    /// Signing engine.
    pub signing: SigningEngine,
    /// Encryption engine.
    pub encryption: EncryptionEngine,
    /// Trust manager.
    pub trust: TrustManager,
    /// Smart card manager.
    pub card: CardManager,
    /// Configuration manager.
    pub config: GpgConfigManager,
    /// Assuan protocol client.
    pub protocol: AssuanClient,
    /// Audit logger.
    pub audit: GpgAuditLogger,
    /// Current agent status.
    pub status: GpgAgentStatus,
}

impl GpgAgentService {
    /// Create a new GPG agent service.
    pub fn new() -> Self {
        let config = GpgConfigManager::new();
        let gpg = config.gpg_binary.clone();
        let home: Option<String> = None;
        let keyserver = "hkps://keys.openpgp.org";

        Self {
            keyring: KeyringManager::new(&gpg, home.clone(), keyserver),
            signing: SigningEngine::new(&gpg, home.clone()),
            encryption: EncryptionEngine::new(&gpg, home.clone()),
            trust: TrustManager::new(&gpg, home.clone()),
            card: CardManager::new(&gpg, home.clone()),
            config,
            protocol: AssuanClient::new(&gpg),
            audit: GpgAuditLogger::default_logger(),
            status: GpgAgentStatus::default(),
        }
    }

    /// Detect the environment — find gpg, agent, scdaemon, home dir.
    pub async fn detect_environment(&mut self) -> Result<GpgAgentConfig, String> {
        // Detect GPG binary
        let _gpg = self.config.detect_gpg().await.unwrap_or_else(|e| {
            warn!("Could not detect gpg: {}", e);
            "gpg".to_string()
        });

        // Detect gpg-agent
        let _agent = self.config.detect_gpg_agent().await.unwrap_or_else(|e| {
            warn!("Could not detect gpg-agent: {}", e);
            "gpg-agent".to_string()
        });

        // Get home dir
        let _home = self.config.get_gpg_home().await.unwrap_or_else(|e| {
            warn!("Could not detect GPG home: {}", e);
            String::new()
        });

        // Reinitialize sub-components with detected paths
        let gpg = self.config.gpg_binary.clone();
        let home = Some(self.config.home_dir.clone()).filter(|s| !s.is_empty());
        let keyserver = "hkps://keys.openpgp.org";

        self.keyring = KeyringManager::new(&gpg, home.clone(), keyserver);
        self.signing = SigningEngine::new(&gpg, home.clone());
        self.encryption = EncryptionEngine::new(&gpg, home.clone());
        self.trust = TrustManager::new(&gpg, home.clone());
        self.card = CardManager::new(&gpg, home.clone());
        self.protocol = AssuanClient::new(&gpg);

        // Read full config
        let cfg = self.config.read_config().await?;
        info!(
            "GPG environment detected: binary={}, home={}",
            cfg.gpg_binary, cfg.home_dir
        );

        self.audit.log_event(
            GpgAuditAction::AgentStart,
            None,
            None,
            "Environment detected",
            true,
            None,
        );

        Ok(cfg)
    }

    /// Start the gpg-agent.
    pub async fn start_agent(&mut self) -> Result<(), String> {
        if self.status.running {
            return Ok(());
        }

        info!("Starting gpg-agent");

        // gpg-agent is auto-started by gpg, but we can explicitly start it
        let output = tokio::process::Command::new(&self.config.gpg_agent_binary)
            .args(["--daemon", "--quiet"])
            .output()
            .await
            .map_err(|e| format!("Failed to start gpg-agent: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Agent may already be running
            if stderr.contains("already running") {
                info!("gpg-agent already running");
            } else {
                warn!("gpg-agent start output: {}", stderr);
            }
        }

        // Connect the protocol client
        if let Err(e) = self.protocol.connect().await {
            warn!("Could not connect to agent via Assuan: {}", e);
        }

        // Update status
        self.refresh_status().await;
        self.status.running = true;

        self.audit.log_event(
            GpgAuditAction::AgentStart,
            None,
            None,
            "gpg-agent started",
            true,
            None,
        );

        Ok(())
    }

    /// Stop the gpg-agent.
    pub async fn stop_agent(&mut self) -> Result<(), String> {
        info!("Stopping gpg-agent");

        // Try killagent via protocol, fall back to gpgconf
        if let Err(_) = self.protocol.killagent().await {
            self.config.gpgconf_kill("gpg-agent").await?;
        }

        self.protocol.disconnect().await;
        self.status.running = false;

        self.audit.log_event(
            GpgAuditAction::AgentStop,
            None,
            None,
            "gpg-agent stopped",
            true,
            None,
        );

        Ok(())
    }

    /// Restart the gpg-agent.
    pub async fn restart_agent(&mut self) -> Result<(), String> {
        self.stop_agent().await?;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        self.start_agent().await
    }

    /// Get the current status.
    pub async fn get_status(&mut self) -> GpgAgentStatus {
        self.refresh_status().await;
        self.status.clone()
    }

    /// Refresh the status by querying gpg-agent.
    async fn refresh_status(&mut self) {
        // Try to get version info
        if let Ok(version) = self.protocol.get_info("version").await {
            self.status.version = version;
            self.status.running = true;
        }

        // Socket path
        if let Ok(socket) = self.config.get_agent_socket_path().await {
            self.status.socket_path = socket;
        }

        // SSH socket
        if let Ok(ssh_socket) = self.config.get_agent_ssh_socket().await {
            self.status.ssh_socket_path = ssh_socket;
        }

        // Cached keys count
        if let Ok(keyinfo) = self.protocol.keyinfo("").await {
            self.status.keys_cached = keyinfo.len() as u32;
        }

        self.status.total_operations = self.audit.total_logged();
    }

    /// Get the current config.
    pub async fn get_config(&mut self) -> Result<GpgAgentConfig, String> {
        self.config.read_config().await
    }

    /// Update the config.
    pub async fn update_config(&mut self, cfg: GpgAgentConfig) -> Result<(), String> {
        self.config.write_agent_conf(&cfg).await?;
        // Reload agent to pick up changes
        self.config.gpgconf_reload("gpg-agent").await?;
        Ok(())
    }

    // ── Keyring delegations ─────────────────────────────────────────

    pub async fn list_keys(&self, secret_only: bool) -> Result<Vec<GpgKey>, String> {
        self.keyring.list_keys(secret_only).await
    }

    pub async fn get_key(&self, key_id: &str) -> Result<Option<GpgKey>, String> {
        self.keyring.get_key(key_id).await
    }

    pub async fn generate_key(&mut self, params: &KeyGenParams) -> Result<GpgKey, String> {
        let result = self.keyring.generate_key(params).await?;
        self.audit.log_event(
            GpgAuditAction::KeyGenerate,
            Some(result.fingerprint.clone()),
            Some(format!("{} <{}>", params.name, params.email)),
            "Key generated",
            true,
            None,
        );
        Ok(result)
    }

    pub async fn import_key(&mut self, data: &[u8], armor: bool) -> Result<KeyImportResult, String> {
        let result = self.keyring.import_key(data, armor).await?;
        self.audit.log_event(
            GpgAuditAction::KeyImport,
            None,
            None,
            &format!("Imported {} key(s)", result.imported),
            true,
            None,
        );
        Ok(result)
    }

    pub async fn import_key_file(&mut self, path: &str) -> Result<KeyImportResult, String> {
        let result = self.keyring.import_from_file(path).await?;
        self.audit.log_event(
            GpgAuditAction::KeyImport,
            None,
            None,
            &format!("Imported from file: {}", path),
            true,
            None,
        );
        Ok(result)
    }

    pub async fn export_key(&self, key_id: &str, options: &KeyExportOptions) -> Result<Vec<u8>, String> {
        self.keyring.export_key(key_id, options).await
    }

    pub async fn export_secret_key(&self, key_id: &str) -> Result<Vec<u8>, String> {
        self.keyring.export_secret_key(key_id).await
    }

    pub async fn delete_key(&mut self, key_id: &str, secret_too: bool) -> Result<bool, String> {
        let result = self.keyring.delete_key(key_id, secret_too).await?;
        self.audit.log_event(
            GpgAuditAction::KeyDelete,
            Some(key_id.to_string()),
            None,
            "Key deleted",
            true,
            None,
        );
        Ok(result)
    }

    pub async fn add_uid(
        &self,
        key_id: &str,
        name: &str,
        email: &str,
        comment: &str,
    ) -> Result<bool, String> {
        self.keyring.add_uid(key_id, name, email, comment).await
    }

    pub async fn revoke_uid(
        &self,
        key_id: &str,
        uid_index: usize,
        reason: u8,
        description: &str,
    ) -> Result<bool, String> {
        self.keyring
            .revoke_uid(key_id, uid_index, reason, description)
            .await
    }

    pub async fn add_subkey(
        &self,
        key_id: &str,
        algorithm: &GpgKeyAlgorithm,
        capabilities: &[KeyCapability],
        expiration: Option<&str>,
    ) -> Result<bool, String> {
        self.keyring
            .add_subkey(key_id, algorithm, capabilities, expiration)
            .await
    }

    pub async fn revoke_subkey(
        &self,
        key_id: &str,
        subkey_index: usize,
        reason: u8,
        description: &str,
    ) -> Result<bool, String> {
        self.keyring
            .revoke_subkey(key_id, subkey_index, reason, description)
            .await
    }

    pub async fn set_expiration(
        &self,
        key_id: &str,
        expiration: Option<&str>,
    ) -> Result<bool, String> {
        self.keyring.set_expiration(key_id, expiration).await
    }

    pub async fn generate_revocation_cert(
        &self,
        key_id: &str,
        reason: u8,
        description: &str,
    ) -> Result<String, String> {
        self.keyring
            .generate_revocation_cert(key_id, reason, description)
            .await
    }

    // ── Signing delegations ─────────────────────────────────────────

    pub async fn sign_data(
        &mut self,
        key_id: &str,
        data: &[u8],
        detached: bool,
        armor: bool,
        hash_algo: Option<&str>,
    ) -> Result<SignatureResult, String> {
        let result = self
            .signing
            .sign_data(key_id, data, detached, armor, hash_algo)
            .await?;
        self.audit.log_event(
            GpgAuditAction::Sign,
            Some(key_id.to_string()),
            None,
            "Data signed",
            result.success,
            None,
        );
        Ok(result)
    }

    pub async fn verify_signature(
        &mut self,
        data: &[u8],
        signature: Option<&[u8]>,
    ) -> Result<VerificationResult, String> {
        let result = self.signing.verify_signature(data, signature).await?;
        self.audit.log_event(
            GpgAuditAction::Verify,
            Some(result.signer_key_id.clone()),
            None,
            &format!("Verification: {}", result.signature_status),
            result.valid,
            None,
        );
        Ok(result)
    }

    pub async fn sign_key(
        &mut self,
        signer_id: &str,
        target_id: &str,
        uid_names: &[String],
        local_only: bool,
        trust_level: u8,
        exportable: bool,
    ) -> Result<bool, String> {
        let result = self
            .signing
            .sign_key(signer_id, target_id, uid_names, local_only, trust_level, exportable)
            .await?;
        self.audit.log_event(
            GpgAuditAction::KeySign,
            Some(target_id.to_string()),
            None,
            &format!("Key signed by {}", signer_id),
            result,
            None,
        );
        Ok(result)
    }

    // ── Encryption delegations ──────────────────────────────────────

    pub async fn encrypt_data(
        &mut self,
        recipients: &[String],
        data: &[u8],
        armor: bool,
        sign: bool,
        signer: Option<&str>,
    ) -> Result<EncryptionResult, String> {
        let result = self
            .encryption
            .encrypt_data(recipients, data, armor, sign, signer)
            .await?;
        self.audit.log_event(
            GpgAuditAction::Encrypt,
            None,
            None,
            &format!("Encrypted for {} recipients", recipients.len()),
            result.success,
            None,
        );
        Ok(result)
    }

    pub async fn decrypt_data(&mut self, data: &[u8]) -> Result<DecryptionResult, String> {
        let result = self.encryption.decrypt_data(data).await?;
        self.audit.log_event(
            GpgAuditAction::Decrypt,
            None,
            None,
            "Data decrypted",
            result.success,
            None,
        );
        Ok(result)
    }

    // ── Trust delegations ───────────────────────────────────────────

    pub async fn set_owner_trust(
        &mut self,
        key_id: &str,
        trust: KeyOwnerTrust,
    ) -> Result<bool, String> {
        let result = self.trust.set_owner_trust(key_id, trust).await?;
        self.audit.log_event(
            GpgAuditAction::KeyTrust,
            Some(key_id.to_string()),
            None,
            &format!("Trust set to {}", trust),
            result,
            None,
        );
        Ok(result)
    }

    pub async fn get_trust_db_stats(&self) -> Result<TrustDbStats, String> {
        self.trust.get_trust_db_stats().await
    }

    pub async fn update_trust_db(&self) -> Result<bool, String> {
        self.trust.update_trust_db().await
    }

    // ── Keyserver delegations ───────────────────────────────────────

    pub async fn search_keyserver(&self, query: &str) -> Result<Vec<KeyServerResult>, String> {
        self.keyring.search_keyserver(query).await
    }

    pub async fn fetch_from_keyserver(&mut self, key_id: &str) -> Result<KeyImportResult, String> {
        let result = self.keyring.fetch_key_from_keyserver(key_id).await?;
        self.audit.log_event(
            GpgAuditAction::KeyserverFetch,
            Some(key_id.to_string()),
            None,
            "Key fetched from keyserver",
            true,
            None,
        );
        Ok(result)
    }

    pub async fn send_to_keyserver(&mut self, key_id: &str) -> Result<bool, String> {
        let result = self.keyring.send_key_to_keyserver(key_id).await?;
        self.audit.log_event(
            GpgAuditAction::KeyserverSend,
            Some(key_id.to_string()),
            None,
            "Key sent to keyserver",
            true,
            None,
        );
        Ok(result)
    }

    pub async fn refresh_keys(&self) -> Result<KeyImportResult, String> {
        self.keyring.refresh_keys_from_keyserver().await
    }

    // ── Card delegations ────────────────────────────────────────────

    pub async fn get_card_status(&self) -> Result<Option<SmartCardInfo>, String> {
        self.card.get_card_status().await
    }

    pub async fn list_cards(&self) -> Result<Vec<SmartCardInfo>, String> {
        self.card.list_cards().await
    }

    pub async fn card_change_pin(&mut self, pin_type: &str) -> Result<bool, String> {
        let result = self.card.change_pin(pin_type).await?;
        self.audit.log_event(
            GpgAuditAction::PinChange,
            None,
            None,
            &format!("PIN change: {}", pin_type),
            result,
            None,
        );
        Ok(result)
    }

    pub async fn card_factory_reset(&mut self) -> Result<bool, String> {
        let result = self.card.factory_reset().await?;
        self.audit.log_event(
            GpgAuditAction::CardOperation,
            None,
            None,
            "Factory reset",
            result,
            None,
        );
        Ok(result)
    }

    pub async fn card_set_attr(&self, attr: &str, value: &str) -> Result<bool, String> {
        match attr.to_lowercase().as_str() {
            "name" | "holder" => self.card.set_card_holder(value).await,
            "url" => self.card.set_card_url(value).await,
            "login" => self.card.set_card_login(value).await,
            "lang" | "language" => self.card.set_card_lang(value).await,
            "sex" => {
                let ch = value.chars().next().unwrap_or(' ');
                self.card.set_card_sex(ch).await
            }
            _ => Err(format!("Unknown card attribute: {}", attr)),
        }
    }

    pub async fn card_gen_key(
        &mut self,
        slot: CardSlot,
        algorithm: &GpgKeyAlgorithm,
    ) -> Result<bool, String> {
        let result = self.card.generate_key_on_card(slot, algorithm).await?;
        self.audit.log_event(
            GpgAuditAction::CardOperation,
            None,
            None,
            &format!("Key generated on card slot {}", slot),
            result,
            None,
        );
        Ok(result)
    }

    pub async fn card_move_key(
        &self,
        key_id: &str,
        subkey_index: usize,
        slot: CardSlot,
    ) -> Result<bool, String> {
        self.card
            .move_key_to_card(key_id, subkey_index, slot)
            .await
    }

    pub async fn card_fetch_key(&self) -> Result<KeyImportResult, String> {
        self.card.fetch_key_from_card().await
    }

    // ── Audit delegations ───────────────────────────────────────────

    pub fn audit_log(&self, limit: usize) -> Vec<GpgAuditEntry> {
        self.audit.get_entries(limit)
    }

    pub fn audit_export(&self) -> Result<String, String> {
        self.audit.export_json()
    }

    pub fn audit_clear(&mut self) {
        self.audit.clear();
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_new() {
        let service = GpgAgentService::new();
        assert!(!service.status.running);
        assert_eq!(service.config.gpg_binary, "gpg");
    }

    #[test]
    fn test_service_audit() {
        let mut service = GpgAgentService::new();
        service.audit.log_event(
            GpgAuditAction::Sign,
            Some("TEST123".to_string()),
            None,
            "test sign",
            true,
            None,
        );
        let entries = service.audit_log(10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, GpgAuditAction::Sign);
    }

    #[test]
    fn test_service_audit_clear() {
        let mut service = GpgAgentService::new();
        service.audit.log_event(
            GpgAuditAction::Encrypt,
            None,
            None,
            "test",
            true,
            None,
        );
        assert_eq!(service.audit.entry_count(), 1);
        service.audit_clear();
        assert_eq!(service.audit.entry_count(), 0);
    }

    #[test]
    fn test_service_status_default() {
        let service = GpgAgentService::new();
        assert!(!service.status.running);
        assert!(service.status.version.is_empty());
        assert_eq!(service.status.keys_cached, 0);
    }
}
