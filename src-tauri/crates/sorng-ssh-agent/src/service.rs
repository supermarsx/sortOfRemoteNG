//! # SSH Agent Service
//!
//! Top-level orchestrator that combines the built-in agent, system agent
//! bridge, forwarding manager, audit logger, and socket listener into a
//! single manageable service with start/stop lifecycle.

use crate::agent::BuiltinAgent;
use crate::audit::AuditLogger;
use crate::bridge::SystemAgentBridge;
use crate::forwarding::ForwardingManager;
use crate::types::*;
use log::info;
use sha2::Digest;
use tokio::sync::broadcast;

const MAX_CONFIG_KEYS: usize = 1024;
const MAX_CONFIG_PATHS: usize = 64;
const MAX_CONFIG_PATH_LEN: usize = 4096;
const MAX_FORWARDING_DEPTH: u32 = 16;

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

impl Default for SshAgentService {
    fn default() -> Self {
        Self::new()
    }
}

impl SshAgentService {
    /// Create a new service with default configuration.
    pub fn new() -> Self {
        Self::with_config(AgentConfig::default())
    }

    /// Create a new service with the given configuration.
    pub fn with_config(config: AgentConfig) -> Self {
        let (event_tx, _) = broadcast::channel(256);

        let system_bridge = if let Some(path) = config.system_agent_socket.as_deref() {
            SystemAgentBridge::with_socket(path, config.system_agent_cache_ttl)
        } else {
            SystemAgentBridge::new(
                config.system_agent_enabled && config.auto_connect_system_agent,
                config.system_agent_cache_ttl,
            )
        };

        let forwarding =
            ForwardingManager::new(config.max_forwarding_depth, config.allow_forwarding);

        let audit = AuditLogger::new(config.audit_enabled, config.audit_max_entries, None);

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
        validate_config(&self.config)?;
        if !self.config.enabled {
            return Err("SSH agent is disabled by configuration".to_string());
        }
        if self.config.start_locked {
            return Err(
                "start_locked cannot be honoured without a securely supplied unlock secret"
                    .to_string(),
            );
        }
        if self.config.socket_path.is_some() || self.config.tcp_listen {
            return Err(
                "SSH-agent listener startup is not wired to the service; refusing simulated state"
                    .to_string(),
            );
        }
        if self.config.auto_load_default_keys || !self.config.auto_load_paths.is_empty() {
            return Err("Automatic key loading is not implemented safely".to_string());
        }
        if !self.config.storage_dir.is_empty() {
            return Err("Persistent key storage is not implemented safely".to_string());
        }
        if !self.config.audit_file.is_empty() {
            return Err("Persistent audit files are not implemented safely".to_string());
        }
        if self.config.allow_forwarding {
            return Err("Agent forwarding transport is not implemented safely".to_string());
        }
        if !self.config.pkcs11_providers.is_empty() {
            return Err("PKCS#11 provider loading is not implemented".to_string());
        }

        info!("Starting SSH agent service");

        // Connect to system agent if configured
        if self.config.system_agent_enabled && self.config.auto_connect_system_agent {
            self.system_bridge.connect().await?;
            self.status.system_agent_connected = true;
            info!("Connected to system SSH agent");
        }

        // Set up shutdown channel
        let (shutdown_tx, _) = broadcast::channel(1);
        self.shutdown_tx = Some(shutdown_tx);

        self.status.running = true;
        self.status.started_at = Some(chrono::Utc::now());
        self.status.socket_path = None;
        self.status.locked = self.agent.store.is_locked();

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
        self.status.socket_path = None;
        self.status.started_at = None;

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
    pub fn update_config(&mut self, config: AgentConfig) -> Result<(), String> {
        if self.status.running {
            return Err("Stop the SSH agent before updating its configuration".to_string());
        }
        validate_config(&config)?;
        self.agent.update_config(config.clone())?;
        self.forwarding.set_max_depth(config.max_forwarding_depth);
        self.forwarding.set_enabled(config.allow_forwarding);
        self.audit.set_enabled(config.audit_enabled);
        self.audit.set_log_file(None)?;
        self.system_bridge = if let Some(path) = config.system_agent_socket.as_deref() {
            SystemAgentBridge::with_socket(path, config.system_agent_cache_ttl)
        } else {
            SystemAgentBridge::new(
                config.system_agent_enabled && config.auto_connect_system_agent,
                config.system_agent_cache_ttl,
            )
        };
        self.config = config;
        info!("Agent configuration updated");
        Ok(())
    }

    /// Subscribe to agent events.
    pub fn subscribe_events(&self) -> broadcast::Receiver<AgentEvent> {
        self.event_tx.subscribe()
    }

    // ── Key Management ──────────────────────────────────────────────

    /// List all keys (built-in + system agent).
    pub async fn list_all_keys(&mut self) -> Vec<AgentKey> {
        if self.status.locked {
            return Vec::new();
        }
        let mut keys: Vec<AgentKey> = self.agent.store.all_keys().into_iter().cloned().collect();

        // Merge system agent keys if connected
        if self.status.system_agent_connected && self.config.merge_system_keys {
            if self.system_bridge.is_cache_stale()
                && self.system_bridge.refresh_identities().await.is_err()
            {
                self.system_bridge.disconnect();
                self.status.system_agent_connected = false;
            }
            for id in if self.status.system_agent_connected {
                self.system_bridge.cached_identities()
            } else {
                &[]
            } {
                // Check if we already have this key
                let already_have = keys.iter().any(|k| k.public_key_blob == id.key_blob);
                if !already_have {
                    let algorithm = protocol_key_algorithm(&id.key_blob);
                    let Some(algorithm) = algorithm else {
                        continue;
                    };
                    let fingerprint = format!(
                        "SHA256:{}",
                        base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD_NO_PAD,
                            sha2::Sha256::digest(&id.key_blob),
                        )
                    );
                    keys.push(AgentKey {
                        id: format!("system:{}", fingerprint),
                        comment: id.comment.clone(),
                        algorithm,
                        bits: algorithm.default_bits(),
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

        self.status.loaded_keys = u32::try_from(keys.len()).unwrap_or(u32::MAX);
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
        let _ = (session_id, remote_host, remote_user, depth);
        Err("Agent forwarding transport is not implemented; refusing simulated state".to_string())
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
        if !self.status.running {
            return Err("Start the SSH agent before connecting its system bridge".to_string());
        }
        if !self.config.system_agent_enabled {
            return Err("System-agent bridging is disabled".to_string());
        }
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
    pub fn set_system_agent_path(&mut self, path: &str) -> Result<(), String> {
        if self.status.running {
            return Err("Stop the SSH agent before changing its system socket".to_string());
        }
        validate_path("System-agent socket path", path)?;
        self.system_bridge.set_socket_path(path)?;
        self.config.system_agent_socket = Some(path.to_string());
        Ok(())
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
            self.audit
                .log_custom("key_expired", None, true, &format!("Key {} expired", id));
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
        let _ = provider_path;
        Err("PKCS#11 provider loading is not implemented".to_string())
    }

    /// Unload a PKCS#11 provider and remove keys that came from it.
    pub fn unload_pkcs11_provider(&mut self, provider_path: &str) -> Result<(), String> {
        let _ = provider_path;
        Err("PKCS#11 provider unloading is not implemented".to_string())
    }

    /// List all loaded PKCS#11 providers with their status.
    pub fn list_pkcs11_providers(&self) -> Vec<Pkcs11ProviderStatus> {
        self.config
            .pkcs11_providers
            .iter()
            .map(|path| Pkcs11ProviderStatus {
                library_path: path.clone(),
                loaded: false,
                key_count: 0,
                slots: vec![],
                error: Some("PKCS#11 integration is not implemented".to_string()),
            })
            .collect()
    }

    /// Get slot information for a loaded PKCS#11 provider.
    pub fn get_pkcs11_slots(&self, provider_path: &str) -> Result<Vec<Pkcs11SlotInfo>, String> {
        let _ = provider_path;
        Err("PKCS#11 slot enumeration is not implemented".to_string())
    }

    /// Add keys from a smart card / PKCS#11 token.
    pub fn add_smartcard_key(
        &mut self,
        provider: &str,
        pin: Option<&str>,
    ) -> Result<usize, String> {
        let _ = (provider, pin);
        Err("Smart-card key loading is not implemented".to_string())
    }

    /// Remove keys that came from a smart card provider.
    pub fn remove_smartcard_key(&mut self, provider: &str) -> Result<usize, String> {
        let _ = provider;
        Err("Smart-card provider operations are not implemented".to_string())
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
    #[allow(clippy::too_many_arguments)]
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
        let _ = (
            sk_provider,
            application,
            user,
            pin_required,
            touch_required,
            verify_required,
            resident,
        );
        Err("FIDO2 security-key enrollment is not implemented".to_string())
    }

    /// Return all pending sign-request confirmations.
    pub fn get_pending_confirmations(&self) -> Vec<PendingSignRequest> {
        self.agent.get_pending_confirmations()
    }

    /// Approve or deny a pending sign request.
    pub fn confirm_sign_request(&mut self, request_id: &str, approved: bool) -> Result<(), String> {
        if request_id.is_empty()
            || request_id.len() > 128
            || request_id.chars().any(char::is_control)
        {
            return Err("Invalid signing confirmation identifier".to_string());
        }

        let result = self.agent.resolve_confirmation(request_id, approved);
        match &result {
            Ok(()) => self.audit.log_event(&AgentEvent::ConfirmationResponse {
                request_id: request_id.to_string(),
                approved: false,
            }),
            Err(_) => self.audit.log_custom(
                "confirmation_response_rejected",
                None,
                false,
                "Signing confirmation response was rejected",
            ),
        }
        result
    }

    /// Get detailed information about a specific key.
    pub fn get_key_details(&self, key_id: &str) -> Result<AgentKey, String> {
        self.agent
            .get_key(key_id)
            .ok_or_else(|| format!("Key not found: {}", key_id))
    }

    /// Update the comment on a loaded key.
    pub fn update_key_comment(&mut self, key_id: &str, comment: &str) -> Result<(), String> {
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
            "openssh" if !key.public_key_openssh.is_empty() => Ok(key.public_key_openssh),
            "openssh" => Ok(format!(
                "{} {} {}",
                key.algorithm.ssh_name(),
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    key.public_key_blob.as_slice(),
                ),
                key.comment
            )),
            "pem" => Err("PEM/SPKI public-key export is not implemented".to_string()),
            _ => Err(format!("Unsupported format: {}", format)),
        }
    }
}

fn validate_config(config: &AgentConfig) -> Result<(), String> {
    if config.name.is_empty()
        || config.name.len() > 128
        || config.name.chars().any(char::is_control)
    {
        return Err("Invalid SSH-agent instance name".to_string());
    }
    if config.max_keys == 0
        || config.max_keys > MAX_CONFIG_KEYS
        || config.max_loaded_keys == 0
        || config.max_loaded_keys > MAX_CONFIG_KEYS
    {
        return Err("Invalid SSH-agent key limit".to_string());
    }
    if config.max_forwarding_depth > MAX_FORWARDING_DEPTH {
        return Err("Invalid maximum forwarding depth".to_string());
    }
    if config.audit_max_entries == 0
        || config.audit_max_entries > 10_000
        || config.max_audit_events == 0
        || config.max_audit_events > 10_000
    {
        return Err("Invalid SSH-agent audit limit".to_string());
    }
    if config.system_agent_cache_ttl > 86_400 {
        return Err("System-agent cache TTL exceeds the supported limit".to_string());
    }
    if config.auto_load_paths.len() > MAX_CONFIG_PATHS
        || config.pkcs11_providers.len() > MAX_CONFIG_PATHS
    {
        return Err("Too many configured SSH-agent paths".to_string());
    }
    for path in config
        .auto_load_paths
        .iter()
        .chain(config.pkcs11_providers.iter())
    {
        validate_path("SSH-agent path", path)?;
    }
    if let Some(path) = config.socket_path.as_deref() {
        validate_path("SSH-agent socket path", path)?;
    }
    if let Some(path) = config.system_agent_socket.as_deref() {
        validate_path("System-agent socket path", path)?;
    }
    validate_path("SSH-agent storage directory", &config.storage_dir)?;
    validate_path("SSH-agent audit file", &config.audit_file)?;
    if config.auto_connect_system_agent && !config.system_agent_enabled {
        return Err("System-agent auto-connect requires the bridge to be enabled".to_string());
    }
    if config.merge_system_keys && !config.system_agent_enabled {
        return Err("System-agent key merging requires the bridge to be enabled".to_string());
    }
    Ok(())
}

fn validate_path(label: &str, path: &str) -> Result<(), String> {
    if path.len() > MAX_CONFIG_PATH_LEN || path.contains('\0') {
        Err(format!("{} exceeds the supported limit", label))
    } else {
        Ok(())
    }
}

fn protocol_key_algorithm(blob: &[u8]) -> Option<KeyAlgorithm> {
    let (name, _) = crate::protocol::read_utf8_string(blob, 0).ok()?;
    KeyAlgorithm::try_from_ssh_name(&name)
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
    async fn test_forwarding_is_unavailable_without_a_transport() {
        let mut svc = SshAgentService::new();
        svc.start().await.unwrap();
        assert!(svc.start_forwarding("s1", "host.com", "user", 1).is_err());
        assert_eq!(svc.status().forwarding_sessions, 0);
    }

    #[tokio::test]
    async fn test_config_update() {
        let mut svc = SshAgentService::new();
        let mut config = svc.config().clone();
        config.max_forwarding_depth = 10;
        svc.update_config(config).unwrap();
        assert_eq!(svc.config().max_forwarding_depth, 10);
    }
}
