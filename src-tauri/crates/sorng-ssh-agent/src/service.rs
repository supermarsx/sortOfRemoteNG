//! # SSH Agent Service
//!
//! Top-level orchestrator that combines the built-in agent, system agent
//! bridge, forwarding manager, audit logger, and socket listener into a
//! single manageable service with start/stop lifecycle.

use crate::agent::BuiltinAgent;
use crate::audit::AuditLogger;
use crate::bridge::SystemAgentBridge;
use crate::forwarding::ForwardingManager;
use crate::protocol::AgentMessage;
use crate::types::*;
use log::{error, info, warn};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

/// The main SSH agent service.
pub struct SshAgentService {
    /// Built-in agent (key store + request handler).
    pub agent: BuiltinAgent,
    /// Bridge to the system SSH agent.
    pub system_bridge: SystemAgentBridge,
    /// Forwarding session manager.
    pub forwarding: ForwardingManager,
    /// Audit logger.
    pub audit: AuditLogger,
    /// Overall agent status.
    pub status: AgentStatus,
    /// Event broadcaster.
    event_tx: broadcast::Sender<AgentEvent>,
    /// Shutdown signal sender.
    shutdown_tx: Option<broadcast::Sender<()>>,
    /// Configuration.
    config: AgentConfig,
}

impl SshAgentService {
    /// Create a new service with default configuration.
    pub fn new() -> Self {
        Self::with_config(AgentConfig::default())
    }

    /// Create a new service with the given configuration.
    pub fn with_config(config: AgentConfig) -> Self {
        let (event_tx, _) = broadcast::channel(256);

        let system_bridge = SystemAgentBridge::new(
            config.auto_connect_system_agent,
            config.system_agent_cache_ttl,
        );

        let forwarding = ForwardingManager::new(
            config.max_forwarding_depth,
            config.allow_forwarding,
        );

        let audit = AuditLogger::new(
            config.audit_enabled,
            config.audit_max_entries,
            if config.audit_file.is_empty() {
                None
            } else {
                Some(PathBuf::from(&config.audit_file))
            },
        );

        let agent = BuiltinAgent::new(config.clone(), event_tx.clone());

        Self {
            agent,
            system_bridge,
            forwarding,
            audit,
            status: AgentStatus::default(),
            event_tx,
            shutdown_tx: None,
            config,
        }
    }

    /// Start the SSH agent service.
    pub async fn start(&mut self) -> Result<(), String> {
        if self.status.running {
            return Err("Agent is already running".to_string());
        }

        info!("Starting SSH agent service");

        // Connect to system agent if configured
        if self.config.auto_connect_system_agent {
            match self.system_bridge.connect().await {
                Ok(()) => {
                    self.status.system_agent_connected = true;
                    info!("Connected to system SSH agent");
                }
                Err(e) => {
                    warn!("Could not connect to system agent: {}", e);
                    self.status.system_agent_connected = false;
                }
            }
        }

        // Set up shutdown channel
        let (shutdown_tx, _) = broadcast::channel(1);
        self.shutdown_tx = Some(shutdown_tx);

        self.status.running = true;
        self.status.started_at = Some(chrono::Utc::now());
        self.status.socket_path = self.config.socket_path.clone();

        let _ = self.event_tx.send(AgentEvent::Started);
        self.audit.log_event(&AgentEvent::Started);

        info!("SSH agent service started");
        Ok(())
    }

    /// Stop the SSH agent service.
    pub async fn stop(&mut self) -> Result<(), String> {
        if !self.status.running {
            return Err("Agent is not running".to_string());
        }

        info!("Stopping SSH agent service");

        // Send shutdown signal
        if let Some(ref tx) = self.shutdown_tx {
            let _ = tx.send(());
        }
        self.shutdown_tx = None;

        // Stop all forwarding sessions
        self.forwarding.stop_all_sessions();

        // Disconnect from system agent
        self.system_bridge.disconnect();

        self.status.running = false;
        self.status.system_agent_connected = false;

        let _ = self.event_tx.send(AgentEvent::Stopped);
        self.audit.log_event(&AgentEvent::Stopped);

        info!("SSH agent service stopped");
        Ok(())
    }

    /// Restart the service.
    pub async fn restart(&mut self) -> Result<(), String> {
        if self.status.running {
            self.stop().await?;
        }
        self.start().await
    }

    /// Get the current status.
    pub fn status(&self) -> &AgentStatus {
        &self.status
    }

    /// Get the current configuration.
    pub fn config(&self) -> &AgentConfig {
        &self.config
    }

    /// Update the agent configuration.
    pub fn update_config(&mut self, config: AgentConfig) {
        self.forwarding.set_max_depth(config.max_forwarding_depth);
        self.forwarding.set_enabled(config.allow_forwarding);
        self.audit.set_enabled(config.audit_enabled);
        if !config.audit_file.is_empty() {
            self.audit.set_log_file(Some(PathBuf::from(&config.audit_file)));
        }
        self.agent.update_config(config.clone());
        self.config = config;
        info!("Agent configuration updated");
    }

    /// Subscribe to agent events.
    pub fn subscribe_events(&self) -> broadcast::Receiver<AgentEvent> {
        self.event_tx.subscribe()
    }

    // ── Key Management ──────────────────────────────────────────────

    /// List all keys (built-in + system agent).
    pub async fn list_all_keys(&mut self) -> Vec<AgentKey> {
        let mut keys: Vec<AgentKey> = self.agent.store.all_keys().into_iter().cloned().collect();

        // Merge system agent keys if connected
        if self.status.system_agent_connected {
            if self.system_bridge.is_cache_stale() {
                let _ = self.system_bridge.refresh_identities().await;
            }
            for id in self.system_bridge.cached_identities() {
                // Check if we already have this key
                let already_have = keys.iter().any(|k| k.public_key_blob == id.key_blob);
                if !already_have {
                    let fingerprint = format!(
                        "SHA256:{}",
                        base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD_NO_PAD,
                            sha2::Digest::digest(&sha2::Sha256::new_with_prefix(&id.key_blob)),
                        )
                    );
                    keys.push(AgentKey {
                        id: uuid::Uuid::new_v4().to_string(),
                        comment: id.comment.clone(),
                        algorithm: KeyAlgorithm::Ed25519, // Best guess; real impl parses blob
                        bits: 0,
                        fingerprint_sha256: fingerprint,
                        fingerprint_md5: String::new(),
                        public_key_blob: id.key_blob.clone(),
                        public_key_openssh: String::new(),
                        source: KeySource::SystemAgent,
                        constraints: Vec::new(),
                        certificate: None,
                        added_at: chrono::Utc::now(),
                        last_used_at: None,
                        sign_count: 0,
                        metadata: std::collections::HashMap::new(),
                    });
                }
            }
        }

        self.status.loaded_keys = keys.len() as u32;
        keys
    }

    /// Add a key to the built-in agent.
    pub fn add_key(&mut self, key: AgentKey) -> Result<String, String> {
        let result = self.agent.store.add_key(key);
        if result.is_ok() {
            self.status.loaded_keys = self.agent.store.key_count() as u32;
        }
        result
    }

    /// Remove a key by ID.
    pub fn remove_key(&mut self, id: &str) -> Result<(), String> {
        self.agent.store.remove_key(id)?;
        self.status.loaded_keys = self.agent.store.key_count() as u32;
        Ok(())
    }

    /// Remove all keys.
    pub fn remove_all_keys(&mut self) -> usize {
        let count = self.agent.store.remove_all_keys();
        self.status.loaded_keys = 0;
        count
    }

    /// Lock the agent.
    pub fn lock(&mut self, passphrase: &str) -> Result<(), String> {
        self.agent.store.lock(passphrase)?;
        self.status.locked = true;
        let _ = self.event_tx.send(AgentEvent::Locked);
        self.audit.log_event(&AgentEvent::Locked);
        Ok(())
    }

    /// Unlock the agent.
    pub fn unlock(&mut self, passphrase: &str) -> Result<(), String> {
        self.agent.store.unlock(passphrase)?;
        self.status.locked = false;
        let _ = self.event_tx.send(AgentEvent::Unlocked);
        self.audit.log_event(&AgentEvent::Unlocked);
        Ok(())
    }

    // ── Forwarding ──────────────────────────────────────────────────

    /// Start a forwarding session.
    pub fn start_forwarding(
        &mut self,
        session_id: &str,
        remote_host: &str,
        remote_user: &str,
        depth: u32,
    ) -> Result<(), String> {
        self.forwarding
            .start_session(session_id, remote_host, remote_user, depth, None)?;
        self.status.forwarding_sessions = self.forwarding.active_session_count() as u32;

        let _ = self.event_tx.send(AgentEvent::ForwardingStarted {
            session_id: session_id.to_string(),
            remote_host: remote_host.to_string(),
        });
        self.audit.log_event(&AgentEvent::ForwardingStarted {
            session_id: session_id.to_string(),
            remote_host: remote_host.to_string(),
        });
        Ok(())
    }

    /// Stop a forwarding session.
    pub fn stop_forwarding(&mut self, session_id: &str) -> Result<(), String> {
        self.forwarding.stop_session(session_id)?;
        self.status.forwarding_sessions = self.forwarding.active_session_count() as u32;

        let _ = self.event_tx.send(AgentEvent::ForwardingStopped {
            session_id: session_id.to_string(),
        });
        self.audit.log_event(&AgentEvent::ForwardingStopped {
            session_id: session_id.to_string(),
        });
        Ok(())
    }

    // ── System Agent Bridge ─────────────────────────────────────────

    /// Connect to the system SSH agent.
    pub async fn connect_system_agent(&mut self) -> Result<(), String> {
        self.system_bridge.connect().await?;
        self.status.system_agent_connected = true;
        Ok(())
    }

    /// Disconnect from the system SSH agent.
    pub fn disconnect_system_agent(&mut self) {
        self.system_bridge.disconnect();
        self.status.system_agent_connected = false;
    }

    /// Set the system agent socket path.
    pub fn set_system_agent_path(&mut self, path: &str) {
        self.system_bridge.set_socket_path(path);
    }

    // ── Audit ───────────────────────────────────────────────────────

    /// Get recent audit entries.
    pub fn recent_audit_entries(&self, count: usize) -> Vec<&AuditEntry> {
        self.audit.recent(count)
    }

    /// Export audit log as JSON.
    pub fn export_audit_log(&self) -> Result<String, String> {
        self.audit.export_json()
    }

    /// Clear audit log.
    pub fn clear_audit_log(&mut self) {
        self.audit.clear();
    }

    // ── Maintenance ─────────────────────────────────────────────────

    /// Run periodic maintenance (expire keys, clean confirmations, etc.).
    pub fn run_maintenance(&mut self) {
        let expired = self.agent.expire_keys();
        for id in &expired {
            self.audit.log_custom(
                "key_expired",
                None,
                true,
                &format!("Key {} expired", id),
            );
        }
        self.agent.cleanup_expired_confirmations();
        self.status.loaded_keys = self.agent.store.key_count() as u32;
    }

    // ── PKCS#11 / Hardware Key Methods ─────────────────────────────

    /// Load a PKCS#11 provider library and enumerate its slots.
    pub fn load_pkcs11_provider(
        &mut self,
        provider_path: &str,
    ) -> Result<Vec<Pkcs11SlotInfo>, String> {
        log::info!("Loading PKCS#11 provider: {}", provider_path);
        self.audit.log_event(&AgentEvent::Pkcs11Event {
            provider: provider_path.to_string(),
            loaded: true,
            key_count: 0,
        });
        if !std::path::Path::new(provider_path).exists() {
            return Err(format!(
                "PKCS#11 provider library not found: {}",
                provider_path
            ));
        }
        if self
            .config
            .pkcs11_providers
            .contains(&provider_path.to_string())
        {
            return Err(format!("Provider already loaded: {}", provider_path));
        }
        self.config.pkcs11_providers.push(provider_path.to_string());
        // In production this would dlopen the provider and enumerate slots
        Ok(vec![Pkcs11SlotInfo {
            slot_id: 0,
            token_label: format!("Token from {}", provider_path),
            manufacturer: "Unknown".to_string(),
            token_present: true,
            key_count: 0,
        }])
    }

    /// Unload a PKCS#11 provider and remove keys that came from it.
    pub fn unload_pkcs11_provider(&mut self, provider_path: &str) -> Result<(), String> {
        log::info!("Unloading PKCS#11 provider: {}", provider_path);
        self.audit.log_event(&AgentEvent::Pkcs11Event {
            provider: provider_path.to_string(),
            loaded: false,
            key_count: 0,
        });
        self.config.pkcs11_providers.retain(|p| p != provider_path);
        // Remove keys that came from this provider
        self.agent
            .remove_keys_by_source(&format!("pkcs11:{}", provider_path));
        Ok(())
    }

    /// List all loaded PKCS#11 providers with their status.
    pub fn list_pkcs11_providers(&self) -> Vec<Pkcs11ProviderStatus> {
        self.config
            .pkcs11_providers
            .iter()
            .map(|path| Pkcs11ProviderStatus {
                library_path: path.clone(),
                loaded: true,
                key_count: self
                    .agent
                    .count_keys_by_source(&format!("pkcs11:{}", path)),
                slots: vec![],
                error: None,
            })
            .collect()
    }

    /// Get slot information for a loaded PKCS#11 provider.
    pub fn get_pkcs11_slots(
        &self,
        provider_path: &str,
    ) -> Result<Vec<Pkcs11SlotInfo>, String> {
        if !self
            .config
            .pkcs11_providers
            .contains(&provider_path.to_string())
        {
            return Err(format!("Provider not loaded: {}", provider_path));
        }
        Ok(vec![Pkcs11SlotInfo {
            slot_id: 0,
            token_label: format!("Token from {}", provider_path),
            manufacturer: "Unknown".to_string(),
            token_present: true,
            key_count: self
                .agent
                .count_keys_by_source(&format!("pkcs11:{}", provider_path)),
        }])
    }

    /// Add keys from a smart card / PKCS#11 token.
    pub fn add_smartcard_key(
        &mut self,
        provider: &str,
        pin: Option<&str>,
    ) -> Result<usize, String> {
        log::info!("Adding smart card keys from provider: {}", provider);
        self.audit.log_event(&AgentEvent::Pkcs11Event {
            provider: provider.to_string(),
            loaded: true,
            key_count: 0,
        });
        let _ = pin; // Would be used to authenticate to the token
        // In production, this would enumerate keys from the smart card via PKCS#11
        Ok(0)
    }

    /// Remove keys that came from a smart card provider.
    pub fn remove_smartcard_key(&mut self, provider: &str) -> Result<usize, String> {
        log::info!("Removing smart card keys from provider: {}", provider);
        self.audit.log_event(&AgentEvent::Pkcs11Event {
            provider: provider.to_string(),
            loaded: false,
            key_count: 0,
        });
        let count = self
            .agent
            .remove_keys_by_source(&format!("pkcs11:{}", provider));
        Ok(count)
    }

    /// List keys that originate from a FIDO2 / security key.
    pub fn list_security_keys(&self) -> Vec<AgentKey> {
        self.agent
            .list_keys()
            .into_iter()
            .filter(|k| {
                matches!(
                    k.algorithm,
                    KeyAlgorithm::SkEd25519 | KeyAlgorithm::SkEcdsaP256
                ) || matches!(&k.source, KeySource::SecurityKey { .. })
            })
            .collect()
    }

    /// Enroll a new FIDO2 security key.
    pub fn add_security_key(
        &mut self,
        sk_provider: Option<&str>,
        application: Option<&str>,
        user: Option<&str>,
        pin_required: bool,
        touch_required: bool,
        verify_required: bool,
        resident: bool,
    ) -> Result<String, String> {
        let provider = sk_provider.unwrap_or("internal");
        let app = application.unwrap_or("ssh:");
        log::info!(
            "Adding security key: provider={}, app={}, resident={}",
            provider,
            app,
            resident
        );
        self.audit.log_event(&AgentEvent::KeyAdded {
            key_id: "pending".into(),
            algorithm: KeyAlgorithm::SkEd25519,
            comment: format!("sk:{}:{}", provider, app),
            source: KeySource::SecurityKey {
                device: provider.to_string(),
            },
        });
        let _ = (user, pin_required, touch_required, verify_required);
        // In production: invoke ssh-keygen -t ed25519-sk or ecdsa-sk
        let key_id = uuid::Uuid::new_v4().to_string();
        Ok(key_id)
    }

    /// Return all pending sign-request confirmations.
    pub fn get_pending_confirmations(&self) -> Vec<PendingSignRequest> {
        self.agent.get_pending_confirmations()
    }

    /// Approve or deny a pending sign request.
    pub fn confirm_sign_request(
        &mut self,
        request_id: &str,
        approved: bool,
    ) -> Result<(), String> {
        log::info!(
            "Confirming sign request {}: approved={}",
            request_id,
            approved
        );
        self.audit.log_event(&AgentEvent::ConfirmationResponse {
            key_id: request_id.to_string(),
            approved,
        });
        self.agent.resolve_confirmation(request_id, approved)
    }

    /// Get detailed information about a specific key.
    pub fn get_key_details(&self, key_id: &str) -> Result<AgentKey, String> {
        self.agent
            .get_key(key_id)
            .ok_or_else(|| format!("Key not found: {}", key_id))
    }

    /// Update the comment on a loaded key.
    pub fn update_key_comment(
        &mut self,
        key_id: &str,
        comment: &str,
    ) -> Result<(), String> {
        self.agent.update_comment(key_id, comment)
    }

    /// Update the constraints on a loaded key.
    pub fn update_key_constraints(
        &mut self,
        key_id: &str,
        constraints: Vec<KeyConstraint>,
    ) -> Result<(), String> {
        self.agent.update_constraints(key_id, constraints)
    }

    /// Export a public key in the given format ("openssh" or "pem").
    pub fn export_public_key(&self, key_id: &str, format: &str) -> Result<String, String> {
        let key = self
            .agent
            .get_key(key_id)
            .ok_or_else(|| format!("Key not found: {}", key_id))?;
        match format {
            "openssh" => Ok(key.public_key_openssh),
            "pem" => {
                // Encode the public key blob as PEM
                let b64 = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    key.public_key_blob.as_bytes(),
                );
                Ok(format!(
                    "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----",
                    b64
                ))
            }
            _ => Err(format!("Unsupported format: {}", format)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_start_stop() {
        let mut svc = SshAgentService::new();
        svc.start().await.unwrap();
        assert!(svc.status().running);
        svc.stop().await.unwrap();
        assert!(!svc.status().running);
    }

    #[tokio::test]
    async fn test_add_remove_key() {
        let mut svc = SshAgentService::new();
        svc.start().await.unwrap();

        let key = AgentKey {
            id: "k1".to_string(),
            comment: "test".to_string(),
            algorithm: KeyAlgorithm::Ed25519,
            bits: 256,
            fingerprint_sha256: "SHA256:test".to_string(),
            fingerprint_md5: String::new(),
            public_key_blob: vec![1, 2, 3],
            public_key_openssh: String::new(),
            source: KeySource::Generated,
            constraints: Vec::new(),
            certificate: None,
            added_at: chrono::Utc::now(),
            last_used_at: None,
            sign_count: 0,
            metadata: std::collections::HashMap::new(),
        };

        svc.add_key(key).unwrap();
        assert_eq!(svc.status().loaded_keys, 1);

        svc.remove_key("k1").unwrap();
        assert_eq!(svc.status().loaded_keys, 0);
    }

    #[tokio::test]
    async fn test_lock_unlock() {
        let mut svc = SshAgentService::new();
        svc.start().await.unwrap();
        svc.lock("pw").unwrap();
        assert!(svc.status().locked);
        svc.unlock("pw").unwrap();
        assert!(!svc.status().locked);
    }

    #[tokio::test]
    async fn test_forwarding() {
        let mut svc = SshAgentService::new();
        svc.start().await.unwrap();
        svc.start_forwarding("s1", "host.com", "user", 1).unwrap();
        assert_eq!(svc.status().forwarding_sessions, 1);
        svc.stop_forwarding("s1").unwrap();
        assert_eq!(svc.status().forwarding_sessions, 0);
    }

    #[tokio::test]
    async fn test_config_update() {
        let mut svc = SshAgentService::new();
        let mut config = svc.config().clone();
        config.max_forwarding_depth = 10;
        svc.update_config(config);
        assert_eq!(svc.config().max_forwarding_depth, 10);
    }
}
