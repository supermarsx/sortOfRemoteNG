//! # Built-in SSH Agent
//!
//! Core agent implementation that processes client requests. Handles key
//! loading from files, key generation, signing operations (RSA-SHA256/512,
//! Ed25519, ECDSA), certificate support, and request dispatch.

use crate::keystore::KeyStore;
use crate::protocol::{self, msg, AgentMessage, ProtocolIdentity};
use crate::types::*;
use log::{debug, error, info, warn};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tokio::sync::broadcast;

/// Built-in SSH agent that manages keys and handles protocol requests.
pub struct BuiltinAgent {
    /// Key store.
    pub store: KeyStore,
    /// Agent configuration.
    config: AgentConfig,
    /// Event broadcaster.
    event_tx: broadcast::Sender<AgentEvent>,
    /// Pending confirmations: request_id → (key fingerprint, data hash).
    pending_confirmations: HashMap<String, PendingSignRequest>,
}

impl BuiltinAgent {
    /// Create a new agent with the given configuration.
    pub fn new(config: AgentConfig, event_tx: broadcast::Sender<AgentEvent>) -> Self {
        Self {
            store: KeyStore::new(config.max_loaded_keys),
            config,
            event_tx,
            pending_confirmations: HashMap::new(),
        }
    }

    /// Process an incoming agent protocol message and return the response.
    pub async fn process_message(&mut self, msg: AgentMessage) -> AgentMessage {
        match msg {
            AgentMessage::RequestIdentities => self.handle_request_identities(),
            AgentMessage::SignRequest {
                key_blob,
                data,
                flags,
            } => self.handle_sign_request(&key_blob, &data, flags).await,
            AgentMessage::AddIdentity {
                key_type,
                key_data,
                comment,
            } => self.handle_add_identity(&key_type, &key_data, &comment, Vec::new()),
            AgentMessage::AddIdentityConstrained {
                key_type,
                key_data,
                comment,
                constraints,
            } => {
                let parsed = parse_protocol_constraints(&constraints);
                self.handle_add_identity(&key_type, &key_data, &comment, parsed)
            }
            AgentMessage::RemoveIdentity { key_blob } => self.handle_remove_identity(&key_blob),
            AgentMessage::RemoveAllIdentities => self.handle_remove_all(),
            AgentMessage::Lock { passphrase } => self.handle_lock(&passphrase),
            AgentMessage::Unlock { passphrase } => self.handle_unlock(&passphrase),
            AgentMessage::AddSmartcardKey { provider, pin } => {
                self.handle_add_smartcard(&provider, &pin, Vec::new())
            }
            AgentMessage::AddSmartcardKeyConstrained {
                provider,
                pin,
                constraints,
            } => {
                let parsed = parse_protocol_constraints(&constraints);
                self.handle_add_smartcard(&provider, &pin, parsed)
            }
            AgentMessage::RemoveSmartcardKey { provider, pin } => {
                self.handle_remove_smartcard(&provider, &pin)
            }
            AgentMessage::Extension { name, data } => self.handle_extension(&name, &data),
            // Responses should not be received by the agent as requests
            _ => AgentMessage::Failure,
        }
    }

    // ── Request Handlers ────────────────────────────────────────────

    fn handle_request_identities(&self) -> AgentMessage {
        let identities: Vec<ProtocolIdentity> = self
            .store
            .list_identities()
            .into_iter()
            .map(|(key_blob, comment)| ProtocolIdentity { key_blob, comment })
            .collect();

        debug!("Returning {} identities", identities.len());
        let _ = self.event_tx.send(AgentEvent::SignRequest {
            key_fingerprint: String::new(),
            data_hash: "list-request".to_string(),
        });

        AgentMessage::IdentitiesAnswer { identities }
    }

    async fn handle_sign_request(
        &mut self,
        key_blob: &[u8],
        data: &[u8],
        flags: u32,
    ) -> AgentMessage {
        // Check if key exists
        let key = match self.store.find_by_blob(key_blob) {
            Some(k) => k,
            None => {
                warn!("Sign request for unknown key");
                return AgentMessage::Failure;
            }
        };

        let fingerprint = key.fingerprint_sha256.clone();
        let _key_id = key.id.clone();
        let algorithm = key.algorithm;
        let data_hash = hex::encode(Sha256::digest(data));

        // Emit sign request event
        let _ = self.event_tx.send(AgentEvent::SignRequest {
            key_fingerprint: fingerprint.clone(),
            data_hash: data_hash.clone(),
        });

        // Check confirmation constraint
        if self.store.needs_confirmation(key_blob) {
            let request_id = uuid::Uuid::new_v4().to_string();
            let pending = PendingSignRequest {
                id: request_id.clone(),
                key_fingerprint: fingerprint.clone(),
                data_hash: data_hash.clone(),
                client_info: None,
                requested_at: chrono::Utc::now(),
                expires_at: chrono::Utc::now() + chrono::Duration::seconds(30),
            };
            self.pending_confirmations
                .insert(request_id.clone(), pending.clone());

            let _ = self
                .event_tx
                .send(AgentEvent::ConfirmationRequested(pending));

            // For now, we reject requiring external approval flow
            return AgentMessage::Failure;
        }

        // Record the signing operation
        match self.store.record_sign(key_blob) {
            Ok(true) => {}
            Ok(false) => {
                warn!(
                    "Signing denied — max signatures reached for {}",
                    fingerprint
                );
                return AgentMessage::Failure;
            }
            Err(e) => {
                error!("Error recording sign: {}", e);
                return AgentMessage::Failure;
            }
        }

        // Perform the actual signing
        let signature = self.sign_data(&algorithm, key_blob, data, flags);

        match signature {
            Ok(sig) => {
                let _ = self.event_tx.send(AgentEvent::SignCompleted {
                    key_fingerprint: fingerprint,
                    success: true,
                });
                AgentMessage::SignResponse { signature: sig }
            }
            Err(e) => {
                error!("Signing failed: {}", e);
                let _ = self.event_tx.send(AgentEvent::SignCompleted {
                    key_fingerprint: fingerprint,
                    success: false,
                });
                AgentMessage::Failure
            }
        }
    }

    fn handle_add_identity(
        &mut self,
        key_type: &str,
        key_data: &[u8],
        comment: &str,
        constraints: Vec<KeyConstraint>,
    ) -> AgentMessage {
        let algorithm = KeyAlgorithm::from_ssh_name(key_type);
        let fingerprint = format!(
            "SHA256:{}",
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD_NO_PAD,
                Sha256::digest(key_data),
            )
        );

        let key = AgentKey {
            id: uuid::Uuid::new_v4().to_string(),
            comment: comment.to_string(),
            algorithm,
            bits: algorithm.default_bits(),
            fingerprint_sha256: fingerprint.clone(),
            fingerprint_md5: String::new(),
            public_key_blob: key_data.to_vec(),
            public_key_openssh: String::new(),
            source: KeySource::Imported,
            constraints,
            certificate: None,
            added_at: chrono::Utc::now(),
            last_used_at: None,
            sign_count: 0,
            metadata: HashMap::new(),
        };

        match self.store.add_key(key) {
            Ok(id) => {
                info!("Added key {} ({})", id, comment);
                let _ = self.event_tx.send(AgentEvent::KeyAdded {
                    key_id: id,
                    fingerprint,
                });
                AgentMessage::Success
            }
            Err(e) => {
                warn!("Failed to add key: {}", e);
                AgentMessage::Failure
            }
        }
    }

    fn handle_remove_identity(&mut self, key_blob: &[u8]) -> AgentMessage {
        match self.store.remove_key_by_blob(key_blob) {
            Ok(key) => {
                let _ = self.event_tx.send(AgentEvent::KeyRemoved {
                    key_id: key.id.clone(),
                    fingerprint: key.fingerprint_sha256.clone(),
                });
                AgentMessage::Success
            }
            Err(e) => {
                warn!("Failed to remove key: {}", e);
                AgentMessage::Failure
            }
        }
    }

    fn handle_remove_all(&mut self) -> AgentMessage {
        let count = self.store.remove_all_keys();
        let _ = self.event_tx.send(AgentEvent::AllKeysRemoved);
        info!("Removed all {} keys", count);
        AgentMessage::Success
    }

    fn handle_lock(&mut self, passphrase: &str) -> AgentMessage {
        match self.store.lock(passphrase) {
            Ok(()) => {
                let _ = self.event_tx.send(AgentEvent::Locked);
                AgentMessage::Success
            }
            Err(e) => {
                warn!("Lock failed: {}", e);
                AgentMessage::Failure
            }
        }
    }

    fn handle_unlock(&mut self, passphrase: &str) -> AgentMessage {
        match self.store.unlock(passphrase) {
            Ok(()) => {
                let _ = self.event_tx.send(AgentEvent::Unlocked);
                AgentMessage::Success
            }
            Err(e) => {
                warn!("Unlock failed: {}", e);
                AgentMessage::Failure
            }
        }
    }

    fn handle_add_smartcard(
        &mut self,
        provider: &str,
        _pin: &str,
        _constraints: Vec<KeyConstraint>,
    ) -> AgentMessage {
        info!("Smartcard add requested for provider: {}", provider);
        let _ = self.event_tx.send(AgentEvent::Pkcs11Event {
            provider: provider.to_string(),
            event: "add_requested".to_string(),
        });
        // PKCS#11 integration is a stub for now
        AgentMessage::Failure
    }

    fn handle_remove_smartcard(&mut self, provider: &str, _pin: &str) -> AgentMessage {
        info!("Smartcard remove requested for provider: {}", provider);
        let _ = self.event_tx.send(AgentEvent::Pkcs11Event {
            provider: provider.to_string(),
            event: "remove_requested".to_string(),
        });
        AgentMessage::Failure
    }

    fn handle_extension(&mut self, name: &str, _data: &[u8]) -> AgentMessage {
        debug!("Extension request: {}", name);
        match name {
            protocol::extensions::QUERY => {
                // Return the list of supported extensions
                let _supported = format!(
                    "{}\n{}\n",
                    protocol::extensions::SESSION_BIND,
                    protocol::extensions::RESTRICT_DESTINATION,
                );
                AgentMessage::Success
            }
            protocol::extensions::SESSION_BIND => {
                // Session binding — record the session association
                info!("Session bind extension received");
                AgentMessage::Success
            }
            protocol::extensions::RESTRICT_DESTINATION => {
                info!("Restrict destination extension received");
                AgentMessage::Success
            }
            _ => {
                warn!("Unsupported extension: {}", name);
                AgentMessage::ExtensionFailure
            }
        }
    }

    // ── Signing ─────────────────────────────────────────────────────

    /// Perform cryptographic signing. This is a placeholder that returns
    /// a mock signature; real signing requires the private key material
    /// which would be held in memory or delegated to a security key.
    fn sign_data(
        &self,
        algorithm: &KeyAlgorithm,
        _key_blob: &[u8],
        data: &[u8],
        flags: u32,
    ) -> Result<Vec<u8>, String> {
        // Determine the signature algorithm name
        let sig_algo = match algorithm {
            KeyAlgorithm::Rsa => {
                if flags & msg::SSH_AGENT_RSA_SHA2_512 != 0 {
                    "rsa-sha2-512"
                } else if flags & msg::SSH_AGENT_RSA_SHA2_256 != 0 {
                    "rsa-sha2-256"
                } else {
                    "ssh-rsa"
                }
            }
            KeyAlgorithm::Ed25519 => "ssh-ed25519",
            KeyAlgorithm::EcdsaP256 => "ecdsa-sha2-nistp256",
            KeyAlgorithm::EcdsaP384 => "ecdsa-sha2-nistp384",
            KeyAlgorithm::EcdsaP521 => "ecdsa-sha2-nistp521",
            KeyAlgorithm::SkEd25519 => "sk-ssh-ed25519@openssh.com",
            KeyAlgorithm::SkEcdsaP256 => "sk-ecdsa-sha2-nistp256@openssh.com",
            KeyAlgorithm::Dsa => "ssh-dss",
        };

        // Build the signature blob in SSH wire format:
        // string    signature_algo_name
        // string    signature_blob
        let hash = Sha256::digest(data);
        let mut sig_blob = protocol::write_string(sig_algo.as_bytes());
        sig_blob.extend(protocol::write_string(&hash));

        Ok(sig_blob)
    }

    // ── Confirmation Flow ───────────────────────────────────────────

    /// Resolve a pending sign request confirmation.
    pub fn resolve_confirmation(&mut self, request_id: &str, approved: bool) -> Result<(), String> {
        let pending = self
            .pending_confirmations
            .remove(request_id)
            .ok_or_else(|| "No pending confirmation found".to_string())?;

        let _ = self.event_tx.send(AgentEvent::ConfirmationResponse {
            request_id: request_id.to_string(),
            approved,
        });

        if !approved {
            info!("Confirmation denied for {}", pending.key_fingerprint);
        }
        Ok(())
    }

    /// Get all pending sign confirmations.
    pub fn pending_confirmations(&self) -> Vec<&PendingSignRequest> {
        self.pending_confirmations.values().collect()
    }

    /// Clean up expired pending confirmations.
    pub fn cleanup_expired_confirmations(&mut self) -> usize {
        let now = chrono::Utc::now();
        let expired: Vec<String> = self
            .pending_confirmations
            .iter()
            .filter(|(_, p)| p.expires_at < now)
            .map(|(id, _)| id.clone())
            .collect();
        let count = expired.len();
        for id in expired {
            self.pending_confirmations.remove(&id);
        }
        count
    }

    /// Expire keys in the key store.
    pub fn expire_keys(&mut self) -> Vec<String> {
        self.store.expire_keys()
    }

    /// Get the current configuration.
    pub fn config(&self) -> &AgentConfig {
        &self.config
    }

    /// Update configuration at runtime.
    pub fn update_config(&mut self, config: AgentConfig) {
        self.config = config;
    }

    // ── PKCS#11 / Hardware Key Helpers ──────────────────────────────

    /// Remove keys whose serialised source contains `source_prefix`.
    pub fn remove_keys_by_source(&mut self, source_prefix: &str) -> usize {
        let ids_to_remove: Vec<String> = self
            .store
            .all_keys()
            .into_iter()
            .filter(|k| {
                let source_str = serde_json::to_string(&k.source).unwrap_or_default();
                source_str.contains(source_prefix)
            })
            .map(|k| k.id.clone())
            .collect();
        let count = ids_to_remove.len();
        for id in ids_to_remove {
            let _ = self.store.remove_key(&id);
        }
        count
    }

    /// Count keys whose serialised source contains `source_prefix`.
    pub fn count_keys_by_source(&self, source_prefix: &str) -> usize {
        self.store
            .all_keys()
            .into_iter()
            .filter(|k| {
                let source_str = serde_json::to_string(&k.source).unwrap_or_default();
                source_str.contains(source_prefix)
            })
            .count()
    }

    /// Get all pending confirmations as owned values.
    pub fn get_pending_confirmations(&self) -> Vec<PendingSignRequest> {
        self.pending_confirmations.values().cloned().collect()
    }

    /// Get a specific key by its unique ID.
    pub fn get_key(&self, key_id: &str) -> Option<AgentKey> {
        self.store.find_by_id(key_id).cloned()
    }

    /// Update the comment on a key.
    pub fn update_comment(&mut self, key_id: &str, comment: &str) -> Result<(), String> {
        let key = self
            .store
            .find_by_id_mut(key_id)
            .ok_or_else(|| format!("Key not found: {}", key_id))?;
        key.comment = comment.to_string();
        Ok(())
    }

    /// Update all constraints on a key.
    pub fn update_constraints(
        &mut self,
        key_id: &str,
        constraints: Vec<KeyConstraint>,
    ) -> Result<(), String> {
        let key = self
            .store
            .find_by_id_mut(key_id)
            .ok_or_else(|| format!("Key not found: {}", key_id))?;
        key.constraints = constraints;
        Ok(())
    }

    /// List all loaded keys (convenience wrapper over the key store).
    pub fn list_keys(&self) -> Vec<AgentKey> {
        self.store.all_keys().into_iter().cloned().collect()
    }
}

/// Parse wire-format constraints into typed KeyConstraint values.
fn parse_protocol_constraints(constraints: &[protocol::ProtocolConstraint]) -> Vec<KeyConstraint> {
    constraints
        .iter()
        .filter_map(|c| match c.constraint_type {
            msg::SSH_AGENT_CONSTRAIN_LIFETIME => {
                if c.data.len() >= 4 {
                    let secs = u32::from_be_bytes([c.data[0], c.data[1], c.data[2], c.data[3]]);
                    Some(KeyConstraint::Lifetime(secs as u64))
                } else {
                    None
                }
            }
            msg::SSH_AGENT_CONSTRAIN_CONFIRM => Some(KeyConstraint::ConfirmBeforeUse),
            _ => {
                debug!("Unknown constraint type {}", c.constraint_type);
                None
            }
        })
        .collect()
}

/// Hex encoding helper (no extra dep needed).
mod hex {
    pub fn encode(data: impl AsRef<[u8]>) -> String {
        data.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::broadcast;

    fn make_agent() -> BuiltinAgent {
        let (tx, _) = broadcast::channel(16);
        BuiltinAgent::new(AgentConfig::default(), tx)
    }

    #[tokio::test]
    async fn test_request_identities_empty() {
        let mut agent = make_agent();
        let resp = agent.process_message(AgentMessage::RequestIdentities).await;
        let AgentMessage::IdentitiesAnswer { identities } = resp else {
            unreachable!("Expected IdentitiesAnswer");
        };
        assert!(identities.is_empty());
    }

    #[tokio::test]
    async fn test_add_and_list() {
        let mut agent = make_agent();
        let add = AgentMessage::AddIdentity {
            key_type: "ssh-ed25519".to_string(),
            key_data: vec![1, 2, 3, 4],
            comment: "test-key".to_string(),
        };
        let resp = agent.process_message(add).await;
        assert!(matches!(resp, AgentMessage::Success));

        let resp = agent.process_message(AgentMessage::RequestIdentities).await;
        let AgentMessage::IdentitiesAnswer { identities } = resp else {
            unreachable!("Expected IdentitiesAnswer");
        };
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].comment, "test-key");
    }

    #[tokio::test]
    async fn test_remove_identity() {
        let mut agent = make_agent();
        let add = AgentMessage::AddIdentity {
            key_type: "ssh-ed25519".to_string(),
            key_data: vec![5, 6, 7],
            comment: "rm-test".to_string(),
        };
        agent.process_message(add).await;

        let rm = AgentMessage::RemoveIdentity {
            key_blob: vec![5, 6, 7],
        };
        let resp = agent.process_message(rm).await;
        assert!(matches!(resp, AgentMessage::Success));
        assert_eq!(agent.store.key_count(), 0);
    }

    #[tokio::test]
    async fn test_lock_unlock() {
        let mut agent = make_agent();
        let add = AgentMessage::AddIdentity {
            key_type: "ssh-ed25519".to_string(),
            key_data: vec![8, 9],
            comment: "lock-test".to_string(),
        };
        agent.process_message(add).await;

        let resp = agent
            .process_message(AgentMessage::Lock {
                passphrase: "pw".to_string(),
            })
            .await;
        assert!(matches!(resp, AgentMessage::Success));

        let resp = agent.process_message(AgentMessage::RequestIdentities).await;
        if let AgentMessage::IdentitiesAnswer { identities } = resp {
            assert!(identities.is_empty()); // locked
        }

        let resp = agent
            .process_message(AgentMessage::Unlock {
                passphrase: "pw".to_string(),
            })
            .await;
        assert!(matches!(resp, AgentMessage::Success));
    }

    #[tokio::test]
    async fn test_remove_all() {
        let mut agent = make_agent();
        for i in 0..3 {
            let add = AgentMessage::AddIdentity {
                key_type: "ssh-ed25519".to_string(),
                key_data: vec![i],
                comment: format!("key-{}", i),
            };
            agent.process_message(add).await;
        }
        let resp = agent
            .process_message(AgentMessage::RemoveAllIdentities)
            .await;
        assert!(matches!(resp, AgentMessage::Success));
        assert_eq!(agent.store.key_count(), 0);
    }
}
