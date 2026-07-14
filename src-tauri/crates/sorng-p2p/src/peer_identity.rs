//! # Peer Identity
//!
//! Peer authentication using X25519 key exchange. Each peer has a stable
//! identity (keypair) and can verify other peers via public key fingerprints.

use chrono::Utc;
use hkdf::Hkdf;
use log::{debug, info};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

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
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);

    Keypair {
        private_key: secret.to_bytes().to_vec(),
        public_key: public.as_bytes().to_vec(),
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

    let our_private: [u8; 32] = our_private
        .try_into()
        .map_err(|_| "Private key must be 32 bytes".to_string())?;
    let their_public: [u8; 32] = their_public
        .try_into()
        .map_err(|_| "Public key must be 32 bytes".to_string())?;

    let secret = StaticSecret::from(our_private);
    let peer = PublicKey::from(their_public);
    let shared = secret.diffie_hellman(&peer);

    debug!("Key exchange completed");
    Ok(shared.as_bytes().to_vec())
}

/// Derive encryption keys from the shared secret using HKDF.
pub fn derive_keys(
    shared_secret: &[u8],
    salt: &[u8],
    info: &[u8],
    key_len: usize,
) -> Result<Vec<u8>, String> {
    let hk = Hkdf::<Sha256>::new(Some(salt), shared_secret);
    let mut out = vec![0u8; key_len];
    hk.expand(info, &mut out)
        .map_err(|_| "HKDF output length exceeds RFC 5869 limit".to_string())?;
    Ok(out)
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

/// Sign a message with our private key.
pub fn sign_message(_private_key: &[u8], _message: &[u8]) -> Result<Vec<u8>, String> {
    Err(
        "Peer identity signing is unsupported: X25519 keys provide key agreement, not signatures"
            .to_string(),
    )
}

/// Verify a signature from a peer.
pub fn verify_signature(
    _public_key: &[u8],
    _message: &[u8],
    _signature: &[u8],
) -> Result<bool, String> {
    Err(
        "Peer identity signature verification is unsupported: configure an Ed25519 identity key"
            .to_string(),
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x25519_key_exchange_matches_on_both_sides() {
        let alice = generate_keypair();
        let bob = generate_keypair();

        let alice_shared = key_exchange(&alice.private_key, &bob.public_key).unwrap();
        let bob_shared = key_exchange(&bob.private_key, &alice.public_key).unwrap();

        assert_eq!(alice_shared, bob_shared);
        assert_eq!(alice_shared.len(), 32);
    }

    #[test]
    fn hkdf_derives_requested_length() {
        let key = derive_keys(b"shared", b"salt", b"info", 48).unwrap();
        assert_eq!(key.len(), 48);
    }

    #[test]
    fn x25519_identity_does_not_claim_signature_support() {
        let keypair = generate_keypair();
        let err = sign_message(&keypair.private_key, b"message").unwrap_err();
        assert!(err.contains("unsupported"));

        let err = verify_signature(&keypair.public_key, b"message", b"sig").unwrap_err();
        assert!(err.contains("unsupported"));
    }
}
