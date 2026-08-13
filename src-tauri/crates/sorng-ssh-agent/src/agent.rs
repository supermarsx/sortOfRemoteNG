//! # Built-in SSH Agent
//!
//! Core agent implementation that processes client requests. Handles key
//! loading from files, key generation, signing operations (RSA-SHA256/512,
//! Ed25519, ECDSA), certificate support, and request dispatch.

use crate::keystore::KeyStore;
use crate::protocol::{self, msg, AgentMessage, ProtocolIdentity};
use crate::types::*;
use crate::{constraints, keystore};
use log::{debug, error, info, warn};
use rsa::pkcs1v15;
use rsa::BigUint;
use sha2::{Digest, Sha256};
use signature::{SignatureEncoding, Signer};
use ssh_key::private::{Ed25519Keypair, KeypairData, RsaKeypair, RsaPrivateKey};
use ssh_key::public::{Ed25519PublicKey, RsaPublicKey};
use ssh_key::{Mpint, PrivateKey};
use std::collections::HashMap;
use tokio::sync::broadcast;

const MAX_PENDING_CONFIRMATIONS: usize = 128;

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
            } => match parse_protocol_constraints(&constraints) {
                Ok(parsed) => self.handle_add_identity(&key_type, &key_data, &comment, parsed),
                Err(e) => {
                    warn!("Rejected invalid key constraints: {}", e);
                    AgentMessage::Failure
                }
            },
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
            } => match parse_protocol_constraints(&constraints) {
                Ok(parsed) => self.handle_add_smartcard(&provider, &pin, parsed),
                Err(_) => AgentMessage::Failure,
            },
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
        let stored_identities = self.store.list_identities();
        if protocol::validate_identities_answer(
            stored_identities
                .iter()
                .map(|(key_blob, comment)| (key_blob.as_slice(), comment.as_str())),
        )
        .is_err()
        {
            warn!("Refusing oversized SSH-agent identity response");
            return AgentMessage::Failure;
        }

        let identities: Vec<ProtocolIdentity> = stored_identities
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
        if key_blob.is_empty()
            || key_blob.len() > protocol::MAX_KEY_DATA_LEN
            || data.len() > protocol::MAX_SIGN_DATA_LEN
        {
            warn!("Rejected oversized SSH-agent signing request");
            return AgentMessage::Failure;
        }
        let supported_flags = msg::SSH_AGENT_RSA_SHA2_256 | msg::SSH_AGENT_RSA_SHA2_512;
        if flags & !supported_flags != 0 || flags == supported_flags {
            warn!("Rejected unsupported or ambiguous SSH-agent signing flags");
            return AgentMessage::Failure;
        }

        // Check if key exists
        let (fingerprint, algorithm, constraint_result) = match self.store.find_by_blob(key_blob) {
            Some(key) => (
                key.fingerprint_sha256.clone(),
                key.algorithm,
                constraints::can_sign(key, None, None, 0),
            ),
            None => {
                warn!("Sign request for unknown key");
                return AgentMessage::Failure;
            }
        };

        if (!self.config.allowed_algorithms.is_empty()
            && !self.config.allowed_algorithms.contains(&algorithm))
            || (algorithm == KeyAlgorithm::Dsa && !self.config.allow_dsa)
        {
            warn!("Signing denied by the configured algorithm policy");
            return AgentMessage::Failure;
        }
        if algorithm == KeyAlgorithm::Rsa && flags == 0 {
            warn!("Legacy RSA-SHA1 agent signatures are disabled");
            return AgentMessage::Failure;
        }
        if algorithm != KeyAlgorithm::Rsa && flags != 0 {
            warn!("RSA signature flags supplied for a non-RSA key");
            return AgentMessage::Failure;
        }
        if !constraint_result.allowed {
            warn!("Signing denied by key constraints");
            return AgentMessage::Failure;
        }
        let data_hash = hex::encode(Sha256::digest(data));

        // Emit sign request event
        let _ = self.event_tx.send(AgentEvent::SignRequest {
            key_fingerprint: fingerprint.clone(),
            data_hash: data_hash.clone(),
        });

        // Check confirmation constraint
        if constraint_result.needs_confirmation {
            self.cleanup_expired_confirmations();
            if self.pending_confirmations.len() >= MAX_PENDING_CONFIRMATIONS {
                warn!("Pending signing confirmation limit reached");
                return AgentMessage::Failure;
            }
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
        if key_type.is_empty()
            || key_type.len() > 128
            || key_data.len() > protocol::MAX_KEY_DATA_LEN
            || comment.len() > protocol::MAX_TEXT_LEN
        {
            warn!("Rejected invalid add-identity field size");
            return AgentMessage::Failure;
        }
        let parsed = match parse_add_identity_key(key_type, key_data, comment) {
            Ok(parsed) => parsed,
            Err(e) => {
                debug!("Rejected invalid add-identity payload: {}", e);
                return AgentMessage::Failure;
            }
        };
        let Some(algorithm) = KeyAlgorithm::try_from_ssh_name(key_type) else {
            return AgentMessage::Failure;
        };
        if (!self.config.allowed_algorithms.is_empty()
            && !self.config.allowed_algorithms.contains(&algorithm))
            || (algorithm == KeyAlgorithm::Dsa && !self.config.allow_dsa)
        {
            return AgentMessage::Failure;
        }
        if keystore::validate_text_field("Key comment", &parsed.comment, protocol::MAX_TEXT_LEN)
            .is_err()
        {
            return AgentMessage::Failure;
        }
        let bits = match parsed.private_key.as_ref().map(PrivateKey::key_data) {
            Some(KeypairData::Rsa(keypair)) => {
                u32::try_from(keypair.public.n.as_bytes().len().saturating_mul(8))
                    .unwrap_or(u32::MAX)
            }
            Some(KeypairData::Ed25519(_)) => 256,
            _ => return AgentMessage::Failure,
        };
        if algorithm == KeyAlgorithm::Rsa && bits < self.config.min_rsa_bits {
            warn!("Rejected RSA key below the configured size");
            return AgentMessage::Failure;
        }
        let mut constraints = constraints;
        if self.config.default_lifetime_secs > 0
            && !constraints
                .iter()
                .any(|item| matches!(item, KeyConstraint::Lifetime(_)))
        {
            constraints.push(KeyConstraint::Lifetime(
                self.config.default_lifetime_secs as u64,
            ));
        }
        if self.config.default_confirm
            && !constraints
                .iter()
                .any(|item| matches!(item, KeyConstraint::ConfirmBeforeUse))
        {
            constraints.push(KeyConstraint::ConfirmBeforeUse);
        }
        if constraints::validate_key_constraints(&constraints).is_err() {
            return AgentMessage::Failure;
        }
        let fingerprint = format!(
            "SHA256:{}",
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD_NO_PAD,
                Sha256::digest(&parsed.public_key_blob),
            )
        );

        let key = AgentKey {
            id: uuid::Uuid::new_v4().to_string(),
            comment: parsed.comment,
            algorithm,
            bits,
            fingerprint_sha256: fingerprint.clone(),
            fingerprint_md5: String::new(),
            public_key_blob: parsed.public_key_blob,
            public_key_openssh: String::new(),
            source: KeySource::Imported,
            constraints,
            certificate: None,
            added_at: chrono::Utc::now(),
            last_used_at: None,
            sign_count: 0,
            metadata: HashMap::new(),
        };

        match self.store.add_key_with_private(key, parsed.private_key) {
            Ok(id) => {
                info!("Added key {}", id);
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
        if self.store.is_locked() {
            return AgentMessage::Failure;
        }
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
            protocol::extensions::QUERY
            | protocol::extensions::SESSION_BIND
            | protocol::extensions::RESTRICT_DESTINATION => AgentMessage::Failure,
            _ => {
                warn!("Unsupported extension: {}", name);
                AgentMessage::ExtensionFailure
            }
        }
    }

    // ── Signing ─────────────────────────────────────────────────────

    /// Perform cryptographic signing.
    fn sign_data(
        &self,
        algorithm: &KeyAlgorithm,
        key_blob: &[u8],
        data: &[u8],
        flags: u32,
    ) -> Result<Vec<u8>, String> {
        let private_key = self
            .store
            .find_private_by_blob(key_blob)
            .ok_or_else(|| "Key has no private signing material".to_string())?;

        match private_key.key_data() {
            KeypairData::Ed25519(_) => {
                if *algorithm != KeyAlgorithm::Ed25519 {
                    return Err("Stored key algorithm does not match Ed25519 signer".to_string());
                }
                let signature = private_key
                    .try_sign(data)
                    .map_err(|_| "Ed25519 signing failed".to_string())?;
                Ok(make_signature_blob("ssh-ed25519", signature.as_bytes()))
            }
            KeypairData::Rsa(rsa_keypair) => {
                let (signature_algorithm, signature_bytes) =
                    sign_rsa_agent_data(rsa_keypair, data, flags)?;
                Ok(make_signature_blob(signature_algorithm, &signature_bytes))
            }
            other => Err(format!(
                "Unsupported private key algorithm for agent signing: {:?}",
                other.algorithm()
            )),
        }
    }

    // ── Confirmation Flow ───────────────────────────────────────────

    /// Resolve a pending sign request confirmation.
    pub fn resolve_confirmation(&mut self, request_id: &str, approved: bool) -> Result<(), String> {
        let pending = self
            .pending_confirmations
            .remove(request_id)
            .ok_or_else(|| "No pending confirmation found".to_string())?;
        if pending.expires_at <= chrono::Utc::now() {
            return Err("Signing confirmation has expired".to_string());
        }

        let _ = self.event_tx.send(AgentEvent::ConfirmationResponse {
            request_id: request_id.to_string(),
            approved: false,
        });

        if approved {
            return Err(
                "Approved confirmations cannot resume an already-refused agent protocol request"
                    .to_string(),
            );
        }
        info!("Confirmation denied for {}", pending.key_fingerprint);
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
            .filter(|(_, p)| p.expires_at <= now)
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
    pub fn update_config(&mut self, config: AgentConfig) -> Result<(), String> {
        self.store.set_max_keys(config.max_loaded_keys)?;
        self.config = config;
        Ok(())
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
        keystore::validate_text_field("Key comment", comment, protocol::MAX_TEXT_LEN)?;
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
        constraints::validate_key_constraints(&constraints)?;
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

struct ParsedIdentity {
    public_key_blob: Vec<u8>,
    private_key: Option<PrivateKey>,
    comment: String,
}

fn parse_add_identity_key(
    key_type: &str,
    key_data: &[u8],
    fallback_comment: &str,
) -> Result<ParsedIdentity, String> {
    match key_type {
        "ssh-ed25519" => parse_ed25519_identity(key_data, fallback_comment),
        "ssh-rsa" | "rsa-sha2-256" | "rsa-sha2-512" => {
            parse_rsa_identity(key_data, fallback_comment)
        }
        other => Err(format!("Unsupported add-identity key type: {}", other)),
    }
}

fn parse_ed25519_identity(
    key_data: &[u8],
    fallback_comment: &str,
) -> Result<ParsedIdentity, String> {
    let (public, offset) = protocol::read_string(key_data, 0)?;
    let (private, offset) = protocol::read_string(key_data, offset)?;
    let (comment, offset) = read_optional_trailing_comment(key_data, offset, fallback_comment)?;
    if offset != key_data.len() {
        return Err("Unexpected trailing bytes in Ed25519 identity".to_string());
    }

    let public: [u8; 32] = public
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid Ed25519 public key length".to_string())?;
    let private: [u8; 64] = private
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid Ed25519 private key length".to_string())?;
    let keypair = Ed25519Keypair::from_bytes(&private)
        .map_err(|e| format!("Invalid Ed25519 private key: {}", e))?;
    if keypair.public != Ed25519PublicKey(public) {
        return Err("Ed25519 public key does not match private key".to_string());
    }

    let mut private_key = PrivateKey::from(keypair);
    private_key.set_comment(comment.clone());

    Ok(ParsedIdentity {
        public_key_blob: make_public_key_blob("ssh-ed25519", &[protocol::write_string(&public)]),
        private_key: Some(private_key),
        comment,
    })
}

fn parse_rsa_identity(key_data: &[u8], fallback_comment: &str) -> Result<ParsedIdentity, String> {
    let (n, offset) = read_mpint_field(key_data, 0)?;
    let (e, offset) = read_mpint_field(key_data, offset)?;
    let (d, offset) = read_mpint_field(key_data, offset)?;
    let (iqmp, offset) = read_mpint_field(key_data, offset)?;
    let (p, offset) = read_mpint_field(key_data, offset)?;
    let (q, offset) = read_mpint_field(key_data, offset)?;
    let (comment, offset) = read_optional_trailing_comment(key_data, offset, fallback_comment)?;
    if offset != key_data.len() {
        return Err("Unexpected trailing bytes in RSA identity".to_string());
    }

    let public = RsaPublicKey {
        e: Mpint::from_bytes(&e).map_err(|err| format!("Invalid RSA exponent: {}", err))?,
        n: Mpint::from_bytes(&n).map_err(|err| format!("Invalid RSA modulus: {}", err))?,
    };
    let private = RsaPrivateKey {
        d: Mpint::from_bytes(&d).map_err(|err| format!("Invalid RSA private exponent: {}", err))?,
        iqmp: Mpint::from_bytes(&iqmp).map_err(|err| format!("Invalid RSA iqmp: {}", err))?,
        p: Mpint::from_bytes(&p).map_err(|err| format!("Invalid RSA p: {}", err))?,
        q: Mpint::from_bytes(&q).map_err(|err| format!("Invalid RSA q: {}", err))?,
    };
    let keypair = RsaKeypair { public, private };
    validate_rsa_keypair(&keypair)?;

    let mut private_key = PrivateKey::from(keypair);
    private_key.set_comment(comment.clone());

    Ok(ParsedIdentity {
        public_key_blob: make_public_key_blob(
            "ssh-rsa",
            &[protocol::write_string(&e), protocol::write_string(&n)],
        ),
        private_key: Some(private_key),
        comment,
    })
}

fn read_mpint_field(data: &[u8], offset: usize) -> Result<(Vec<u8>, usize), String> {
    protocol::read_string(data, offset)
}

fn read_optional_trailing_comment(
    data: &[u8],
    offset: usize,
    fallback_comment: &str,
) -> Result<(String, usize), String> {
    if offset == data.len() {
        return Ok((fallback_comment.to_string(), offset));
    }
    protocol::read_utf8_string(data, offset)
}

fn make_public_key_blob(algorithm: &str, fields: &[Vec<u8>]) -> Vec<u8> {
    let mut blob = protocol::write_string(algorithm.as_bytes());
    for field in fields {
        blob.extend_from_slice(field);
    }
    blob
}

fn make_signature_blob(algorithm: &str, signature: &[u8]) -> Vec<u8> {
    let mut blob = protocol::write_string(algorithm.as_bytes());
    blob.extend(protocol::write_string(signature));
    blob
}

fn sign_rsa_agent_data(
    keypair: &RsaKeypair,
    data: &[u8],
    flags: u32,
) -> Result<(&'static str, Vec<u8>), String> {
    let private_key = rsa_private_key_from_ssh_keypair(keypair)?;
    if flags & msg::SSH_AGENT_RSA_SHA2_512 != 0 {
        let signing_key = pkcs1v15::SigningKey::<sha2::Sha512>::new(private_key);
        let signature = signing_key
            .try_sign(data)
            .map_err(|_| "RSA-SHA512 signing failed".to_string())?;
        Ok(("rsa-sha2-512", signature.to_vec()))
    } else if flags & msg::SSH_AGENT_RSA_SHA2_256 != 0 {
        let signing_key = pkcs1v15::SigningKey::<sha2::Sha256>::new(private_key);
        let signature = signing_key
            .try_sign(data)
            .map_err(|_| "RSA-SHA256 signing failed".to_string())?;
        Ok(("rsa-sha2-256", signature.to_vec()))
    } else {
        let signing_key = pkcs1v15::SigningKey::<sha1::Sha1>::new(private_key);
        let signature = signing_key
            .try_sign(data)
            .map_err(|_| "RSA-SHA1 signing failed".to_string())?;
        Ok(("ssh-rsa", signature.to_vec()))
    }
}

fn validate_rsa_keypair(keypair: &RsaKeypair) -> Result<(), String> {
    rsa_private_key_from_ssh_keypair(keypair).map(|_| ())
}

fn rsa_private_key_from_ssh_keypair(keypair: &RsaKeypair) -> Result<rsa::RsaPrivateKey, String> {
    let n =
        BigUint::try_from(&keypair.public.n).map_err(|e| format!("Invalid RSA modulus: {}", e))?;
    let e =
        BigUint::try_from(&keypair.public.e).map_err(|e| format!("Invalid RSA exponent: {}", e))?;
    let d = BigUint::try_from(&keypair.private.d)
        .map_err(|e| format!("Invalid RSA private exponent: {}", e))?;
    let p =
        BigUint::try_from(&keypair.private.p).map_err(|e| format!("Invalid RSA prime p: {}", e))?;
    let q =
        BigUint::try_from(&keypair.private.q).map_err(|e| format!("Invalid RSA prime q: {}", e))?;
    rsa::RsaPrivateKey::from_components(n, e, d, vec![p, q])
        .map_err(|e| format!("Invalid RSA private key: {}", e))
}

/// Parse wire-format constraints into typed KeyConstraint values.
fn parse_protocol_constraints(
    constraints: &[protocol::ProtocolConstraint],
) -> Result<Vec<KeyConstraint>, String> {
    let parsed: Result<Vec<KeyConstraint>, String> = constraints
        .iter()
        .map(|c| match c.constraint_type {
            msg::SSH_AGENT_CONSTRAIN_LIFETIME => {
                if c.data.len() == 4 {
                    let secs = u32::from_be_bytes([c.data[0], c.data[1], c.data[2], c.data[3]]);
                    Ok(KeyConstraint::Lifetime(secs as u64))
                } else {
                    Err("Invalid lifetime constraint encoding".to_string())
                }
            }
            msg::SSH_AGENT_CONSTRAIN_CONFIRM if c.data.is_empty() => {
                Ok(KeyConstraint::ConfirmBeforeUse)
            }
            msg::SSH_AGENT_CONSTRAIN_CONFIRM => {
                Err("Invalid confirmation constraint encoding".to_string())
            }
            _ => Err(format!(
                "Unsupported agent constraint type {}",
                c.constraint_type
            )),
        })
        .collect();
    let parsed = parsed?;
    constraints::validate_key_constraints(&parsed)?;
    Ok(parsed)
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
    use signature::Verifier;
    use ssh_key::rand_core::OsRng;
    use ssh_key::Algorithm;
    use tokio::sync::broadcast;

    fn make_agent() -> BuiltinAgent {
        let (tx, _) = broadcast::channel(16);
        BuiltinAgent::new(AgentConfig::default(), tx)
    }

    fn ed25519_agent_key_data(private_key: &PrivateKey, comment: &str) -> (Vec<u8>, Vec<u8>) {
        let KeypairData::Ed25519(keypair) = private_key.key_data() else {
            unreachable!("expected Ed25519 test key");
        };
        let public = keypair.public.as_ref();
        let private = keypair.to_bytes();
        let mut key_data = protocol::write_string(public);
        key_data.extend(protocol::write_string(&private));
        key_data.extend(protocol::write_string(comment.as_bytes()));

        (
            key_data,
            make_public_key_blob("ssh-ed25519", &[protocol::write_string(public)]),
        )
    }

    fn valid_ed25519_add(comment: &str) -> (AgentMessage, Vec<u8>) {
        let private_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let (key_data, public_blob) = ed25519_agent_key_data(&private_key, comment);
        (
            AgentMessage::AddIdentity {
                key_type: "ssh-ed25519".to_string(),
                key_data,
                comment: comment.to_string(),
            },
            public_blob,
        )
    }

    fn public_only_test_key(id: &str, public_key_blob: Vec<u8>) -> AgentKey {
        AgentKey {
            id: id.to_string(),
            comment: id.to_string(),
            algorithm: KeyAlgorithm::Ed25519,
            bits: 256,
            fingerprint_sha256: format!("SHA256:{id}"),
            fingerprint_md5: String::new(),
            public_key_blob,
            public_key_openssh: String::new(),
            source: KeySource::Imported,
            constraints: Vec::new(),
            certificate: None,
            added_at: chrono::Utc::now(),
            last_used_at: None,
            sign_count: 0,
            metadata: HashMap::new(),
        }
    }

    fn rsa_agent_key_data(private_key: &PrivateKey, comment: &str) -> (Vec<u8>, Vec<u8>) {
        let KeypairData::Rsa(keypair) = private_key.key_data() else {
            unreachable!("expected RSA test key");
        };
        let n = keypair.public.n.as_bytes();
        let e = keypair.public.e.as_bytes();
        let d = keypair.private.d.as_bytes();
        let iqmp = keypair.private.iqmp.as_bytes();
        let p = keypair.private.p.as_bytes();
        let q = keypair.private.q.as_bytes();

        let mut key_data = protocol::write_string(n);
        key_data.extend(protocol::write_string(e));
        key_data.extend(protocol::write_string(d));
        key_data.extend(protocol::write_string(iqmp));
        key_data.extend(protocol::write_string(p));
        key_data.extend(protocol::write_string(q));
        key_data.extend(protocol::write_string(comment.as_bytes()));

        (
            key_data,
            make_public_key_blob(
                "ssh-rsa",
                &[protocol::write_string(e), protocol::write_string(n)],
            ),
        )
    }

    fn signature_algorithm(signature_blob: &[u8]) -> String {
        let (algorithm, offset) = protocol::read_utf8_string(signature_blob, 0).unwrap();
        let (_signature, offset) = protocol::read_string(signature_blob, offset).unwrap();
        assert_eq!(offset, signature_blob.len());
        algorithm
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
        let (add, public_blob) = valid_ed25519_add("test-key");
        let resp = agent.process_message(add).await;
        assert!(matches!(resp, AgentMessage::Success));

        let resp = agent.process_message(AgentMessage::RequestIdentities).await;
        let AgentMessage::IdentitiesAnswer { identities } = resp else {
            unreachable!("Expected IdentitiesAnswer");
        };
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].comment, "test-key");
        assert_eq!(identities[0].key_blob, public_blob);
    }

    #[tokio::test]
    async fn test_malformed_add_identity_is_rejected_without_mutating_store() {
        let mut agent = make_agent();
        let response = agent
            .process_message(AgentMessage::AddIdentity {
                key_type: "ssh-ed25519".to_string(),
                key_data: vec![1, 2, 3, 4],
                comment: "malformed-key".to_string(),
            })
            .await;

        assert!(matches!(response, AgentMessage::Failure));
        assert_eq!(agent.store.key_count(), 0);
    }

    #[tokio::test]
    async fn test_remove_identity() {
        let mut agent = make_agent();
        let (add, public_blob) = valid_ed25519_add("rm-test");
        assert!(matches!(
            agent.process_message(add).await,
            AgentMessage::Success
        ));

        let rm = AgentMessage::RemoveIdentity {
            key_blob: public_blob,
        };
        let resp = agent.process_message(rm).await;
        assert!(matches!(resp, AgentMessage::Success));
        assert_eq!(agent.store.key_count(), 0);
    }

    #[tokio::test]
    async fn test_lock_unlock() {
        let mut agent = make_agent();
        let (add, _) = valid_ed25519_add("lock-test");
        assert!(matches!(
            agent.process_message(add).await,
            AgentMessage::Success
        ));

        let resp = agent
            .process_message(AgentMessage::Lock {
                passphrase: "pw".to_string(),
            })
            .await;
        assert!(matches!(resp, AgentMessage::Success));

        let resp = agent.process_message(AgentMessage::RequestIdentities).await;
        let AgentMessage::IdentitiesAnswer { identities } = resp else {
            unreachable!("Expected IdentitiesAnswer while locked");
        };
        assert!(identities.is_empty());

        let resp = agent
            .process_message(AgentMessage::Unlock {
                passphrase: "pw".to_string(),
            })
            .await;
        assert!(matches!(resp, AgentMessage::Success));

        let resp = agent.process_message(AgentMessage::RequestIdentities).await;
        let AgentMessage::IdentitiesAnswer { identities } = resp else {
            unreachable!("Expected IdentitiesAnswer");
        };
        assert_eq!(identities.len(), 1);
    }

    #[tokio::test]
    async fn test_remove_all() {
        let mut agent = make_agent();
        for i in 0..3 {
            let (add, _) = valid_ed25519_add(&format!("key-{i}"));
            assert!(matches!(
                agent.process_message(add).await,
                AgentMessage::Success
            ));
        }
        assert_eq!(agent.store.key_count(), 3);
        let resp = agent
            .process_message(AgentMessage::RemoveAllIdentities)
            .await;
        assert!(matches!(resp, AgentMessage::Success));
        assert_eq!(agent.store.key_count(), 0);
    }

    #[tokio::test]
    async fn test_sign_request_fails_without_private_key_signer() {
        let mut agent = make_agent();
        let key_blob = vec![1, 2, 3, 4];
        agent
            .store
            .add_key(public_only_test_key("sign-test", key_blob.clone()))
            .unwrap();

        let resp = agent
            .process_message(AgentMessage::SignRequest {
                key_blob,
                data: b"session data".to_vec(),
                flags: 0,
            })
            .await;

        assert!(matches!(resp, AgentMessage::Failure));
    }

    #[tokio::test]
    async fn test_add_identity_ed25519_signs_agent_blob() {
        let mut agent = make_agent();
        let private_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let (key_data, public_blob) = ed25519_agent_key_data(&private_key, "ed-sign-test");

        let resp = agent
            .process_message(AgentMessage::AddIdentity {
                key_type: "ssh-ed25519".to_string(),
                key_data,
                comment: "ignored-fallback".to_string(),
            })
            .await;
        assert!(matches!(resp, AgentMessage::Success));

        let data = b"session data".to_vec();
        let resp = agent
            .process_message(AgentMessage::SignRequest {
                key_blob: public_blob,
                data: data.clone(),
                flags: 0,
            })
            .await;

        let AgentMessage::SignResponse { signature } = resp else {
            unreachable!("Expected SignResponse");
        };
        assert_eq!(signature_algorithm(&signature), "ssh-ed25519");
        let signature = ssh_key::Signature::try_from(signature.as_slice()).unwrap();
        Verifier::verify(private_key.public_key(), &data, &signature).unwrap();
    }

    #[tokio::test]
    async fn test_sign_request_unknown_key_fails() {
        let mut agent = make_agent();
        let resp = agent
            .process_message(AgentMessage::SignRequest {
                key_blob: vec![9, 9, 9],
                data: b"session data".to_vec(),
                flags: 0,
            })
            .await;

        assert!(matches!(resp, AgentMessage::Failure));
    }

    #[tokio::test]
    async fn test_add_identity_rsa_signs_requested_hash_algorithms() {
        let mut agent = make_agent();
        let private_key = PrivateKey::random(&mut OsRng, Algorithm::Rsa { hash: None }).unwrap();
        let (key_data, public_blob) = rsa_agent_key_data(&private_key, "rsa-sign-test");

        let resp = agent
            .process_message(AgentMessage::AddIdentity {
                key_type: "ssh-rsa".to_string(),
                key_data,
                comment: "ignored-fallback".to_string(),
            })
            .await;
        assert!(matches!(resp, AgentMessage::Success));

        for (flags, expected_algorithm) in [
            (msg::SSH_AGENT_RSA_SHA2_256, "rsa-sha2-256"),
            (msg::SSH_AGENT_RSA_SHA2_512, "rsa-sha2-512"),
        ] {
            let resp = agent
                .process_message(AgentMessage::SignRequest {
                    key_blob: public_blob.clone(),
                    data: b"rsa session data".to_vec(),
                    flags,
                })
                .await;

            let AgentMessage::SignResponse { signature } = resp else {
                unreachable!("Expected SignResponse for {}", expected_algorithm);
            };
            assert_eq!(signature_algorithm(&signature), expected_algorithm);
        }

        let legacy_sha1 = agent
            .process_message(AgentMessage::SignRequest {
                key_blob: public_blob,
                data: b"rsa session data".to_vec(),
                flags: 0,
            })
            .await;
        assert!(matches!(legacy_sha1, AgentMessage::Failure));
    }
}
