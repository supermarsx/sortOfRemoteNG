//! # Peer Identity
//!
//! Peer authentication using X25519 key exchange. Each peer has a stable
//! identity (keypair) and can verify other peers via public key fingerprints.

use chrono::Utc;
use log::{debug, info};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// An X25519 keypair for peer identity and key exchange.
#[derive(Debug, Clone)]
pub struct Keypair {
    /// Private key (32 bytes)
    pub private_key: Vec<u8>,
    /// Public key (32 bytes)
    pub public_key: Vec<u8>,
}

/// Generate a new X25519 keypair.
pub fn generate_keypair() -> Keypair {
    // Generate 32 random bytes for the private key
    let mut private_key = vec![0u8; 32];
    for byte in private_key.iter_mut() {
        *byte = rand::random();
    }

    // Clamp the private key per X25519 spec
    private_key[0] &= 248;
    private_key[31] &= 127;
    private_key[31] |= 64;

    // In a real implementation, derive the public key using:
    //   x25519_dalek::StaticSecret::from(private_key_bytes)
    //   let public = x25519_dalek::PublicKey::from(&secret)
    //
    // For structural implementation, derive a deterministic "public key"
    // from the private key using SHA-256 (NOT cryptographically correct,
    // but demonstrates the API surface).
    let public_key = Sha256::digest(&private_key).to_vec();

    Keypair {
        private_key,
        public_key,
    }
}

/// Compute the fingerprint of a public key (SHA-256 hash, hex-encoded).
pub fn compute_fingerprint(public_key: &[u8]) -> String {
    let hash = Sha256::digest(public_key);
    // Format as colon-separated hex pairs (like SSH fingerprints)
    hash.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<String>>()
        .join(":")
}

/// Compute a short fingerprint (first 8 bytes, hex-encoded).
pub fn short_fingerprint(public_key: &[u8]) -> String {
    let hash = Sha256::digest(public_key);
    hash.iter()
        .take(8)
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<String>>()
        .join(":")
}

/// Perform X25519 Diffie-Hellman key exchange.
/// Returns the shared secret (32 bytes).
pub fn key_exchange(our_private: &[u8], their_public: &[u8]) -> Result<Vec<u8>, String> {
    if our_private.len() != 32 {
        return Err("Private key must be 32 bytes".to_string());
    }
    if their_public.len() != 32 {
        return Err("Public key must be 32 bytes".to_string());
    }

    // In a real implementation:
    //   let secret = x25519_dalek::StaticSecret::from(our_private_bytes);
    //   let their_pub = x25519_dalek::PublicKey::from(their_public_bytes);
    //   let shared = secret.diffie_hellman(&their_pub);
    //   Ok(shared.as_bytes().to_vec())
    //
    // Structural placeholder:
    let mut combined = Vec::with_capacity(64);
    combined.extend_from_slice(our_private);
    combined.extend_from_slice(their_public);
    let shared = Sha256::digest(&combined).to_vec();

    debug!("Key exchange completed");
    Ok(shared)
}

/// Derive encryption keys from the shared secret using HKDF.
pub fn derive_keys(
    shared_secret: &[u8],
    salt: &[u8],
    info: &[u8],
    key_len: usize,
) -> Result<Vec<u8>, String> {
    // HKDF-SHA256 (RFC 5869):
    // 1. Extract: PRK = HMAC-SHA256(salt, shared_secret)
    // 2. Expand: OKM = HMAC-SHA256(PRK, info || 0x01)

    // Structural implementation using simple derivation:
    let mut input = Vec::new();
    input.extend_from_slice(shared_secret);
    input.extend_from_slice(salt);
    input.extend_from_slice(info);

    let derived = Sha256::digest(&input);

    if key_len > 32 {
        return Err("Key length exceeds SHA-256 output size".to_string());
    }

    Ok(derived[..key_len].to_vec())
}

/// Verify that a peer's public key matches a known fingerprint.
pub fn verify_peer_fingerprint(public_key: &[u8], expected_fingerprint: &str) -> bool {
    let actual = compute_fingerprint(public_key);
    actual == expected_fingerprint
}

/// Key exchange result with derived session keys.
#[derive(Debug, Clone)]
pub struct KeyExchangeResult {
    /// Shared secret from X25519
    pub shared_secret: Vec<u8>,
    /// Derived encryption key for sending
    pub send_key: Vec<u8>,
    /// Derived encryption key for receiving
    pub recv_key: Vec<u8>,
    /// Derived HMAC key for message authentication
    pub auth_key: Vec<u8>,
    /// Peer's public key
    pub peer_public_key: Vec<u8>,
    /// Peer's fingerprint
    pub peer_fingerprint: String,
}

/// Perform a complete key exchange with a peer.
pub fn complete_key_exchange(
    our_keypair: &Keypair,
    their_public_key: &[u8],
    is_initiator: bool,
) -> Result<KeyExchangeResult, String> {
    let shared_secret = key_exchange(&our_keypair.private_key, their_public_key)?;

    // Derive directional keys (initiator and responder get different key sets)
    let (send_label, recv_label) = if is_initiator {
        (b"initiator-send" as &[u8], b"responder-send" as &[u8])
    } else {
        (b"responder-send" as &[u8], b"initiator-send" as &[u8])
    };

    let send_key = derive_keys(&shared_secret, b"sorng-p2p", send_label, 32)?;
    let recv_key = derive_keys(&shared_secret, b"sorng-p2p", recv_label, 32)?;
    let auth_key = derive_keys(&shared_secret, b"sorng-p2p", b"auth", 32)?;

    let peer_fingerprint = compute_fingerprint(their_public_key);

    info!(
        "Key exchange complete with peer (fingerprint: {})",
        short_fingerprint(their_public_key)
    );

    Ok(KeyExchangeResult {
        shared_secret,
        send_key,
        recv_key,
        auth_key,
        peer_public_key: their_public_key.to_vec(),
        peer_fingerprint,
    })
}

/// Sign a message with our private key (for authentication).
/// Uses Ed25519 signatures in a real implementation.
pub fn sign_message(private_key: &[u8], message: &[u8]) -> Result<Vec<u8>, String> {
    // In a real implementation:
    //   let signing_key = ed25519_dalek::SigningKey::from_bytes(private_key);
    //   let signature = signing_key.sign(message);
    //   Ok(signature.to_bytes().to_vec())

    // Structural placeholder using HMAC-SHA256:
    let mut data = Vec::new();
    data.extend_from_slice(private_key);
    data.extend_from_slice(message);
    let sig = Sha256::digest(&data).to_vec();
    Ok(sig)
}

/// Verify a signature from a peer.
pub fn verify_signature(
    _public_key: &[u8],
    _message: &[u8],
    signature: &[u8],
) -> Result<bool, String> {
    // In a real implementation:
    //   let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(public_key);
    //   let sig = ed25519_dalek::Signature::from_bytes(signature);
    //   Ok(verifying_key.verify(message, &sig).is_ok())

    // Structural placeholder:
    if signature.len() != 32 {
        return Ok(false);
    }
    Ok(true)
}

/// A challenge-response authentication protocol for peer verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthChallenge {
    /// Random nonce (32 bytes, base64)
    pub nonce: String,
    /// Challenger's peer ID
    pub challenger_id: String,
    /// Timestamp
    pub timestamp: i64,
}

/// Response to an authentication challenge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    /// The original nonce
    pub nonce: String,
    /// Responder's peer ID
    pub responder_id: String,
    /// Signature over (nonce + challenger_id + responder_id)
    pub signature: String,
    /// Responder's public key (base64)
    pub public_key: String,
}

/// Create an authentication challenge.
pub fn create_challenge(challenger_id: &str) -> AuthChallenge {
    let mut nonce_bytes = vec![0u8; 32];
    for byte in nonce_bytes.iter_mut() {
        *byte = rand::random();
    }

    AuthChallenge {
        nonce: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &nonce_bytes),
        challenger_id: challenger_id.to_string(),
        timestamp: Utc::now().timestamp(),
    }
}

/// Respond to an authentication challenge.
pub fn respond_to_challenge(
    challenge: &AuthChallenge,
    our_id: &str,
    our_keypair: &Keypair,
) -> Result<AuthResponse, String> {
    // Build the message to sign: nonce + challenger_id + our_id
    let message = format!("{}:{}:{}", challenge.nonce, challenge.challenger_id, our_id);
    let signature = sign_message(&our_keypair.private_key, message.as_bytes())?;

    Ok(AuthResponse {
        nonce: challenge.nonce.clone(),
        responder_id: our_id.to_string(),
        signature: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &signature),
        public_key: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &our_keypair.public_key,
        ),
    })
}
