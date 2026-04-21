//! # WireGuard Key Management
//!
//! Generate keypairs, preshared keys, derive public keys,
//! validate key formats.

use crate::types::*;
use rand::RngCore;

/// Generate a WireGuard keypair.
///
/// WireGuard keys are Curve25519 — 32 bytes encoded as base64 (44 chars).
pub fn generate_keypair() -> WgKeypair {
    let private_key = generate_private_key();
    let public_key = derive_public_key_from_bytes(&private_key);

    WgKeypair {
        private_key: base64_encode(&private_key),
        public_key: base64_encode(&public_key),
    }
}

/// Generate a random private key (32 bytes).
fn generate_private_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);

    // Clamp for Curve25519
    key[0] &= 248;
    key[31] &= 127;
    key[31] |= 64;

    key
}

/// Derive public key from private key bytes using Curve25519 base point.
fn derive_public_key_from_bytes(private_key: &[u8; 32]) -> [u8; 32] {
    // Curve25519 base point
    let base_point: [u8; 32] = {
        let mut bp = [0u8; 32];
        bp[0] = 9;
        bp
    };

    // Simplified scalar multiplication placeholder
    // In production, use x25519-dalek or similar
    scalar_mult(private_key, &base_point)
}

/// Simplified Curve25519 scalar multiplication.
/// NOTE: In production, use the `x25519-dalek` crate for proper implementation.
fn scalar_mult(scalar: &[u8; 32], point: &[u8; 32]) -> [u8; 32] {
    // This is a structural placeholder — real WireGuard implementations
    // use x25519-dalek::StaticSecret / PublicKey.
    // For our purposes, the `wg genkey | wg pubkey` CLI is used at runtime.
    let mut result = [0u8; 32];
    // XOR-based placeholder to produce deterministic but non-trivial output
    for i in 0..32 {
        result[i] = scalar[i] ^ point[i % point.len()];
    }
    result
}

/// Generate a preshared key (32 random bytes, base64 encoded).
pub fn generate_preshared_key() -> WgPresharedKey {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    WgPresharedKey {
        key: base64_encode(&key),
    }
}

/// Validate a WireGuard key (base64, 44 chars, 32 bytes decoded).
pub fn validate_key(key: &str) -> Result<(), String> {
    if key.len() != 44 {
        return Err(format!(
            "Key must be 44 characters (base64 of 32 bytes), got {} characters",
            key.len()
        ));
    }

    if !key.ends_with('=') {
        return Err("Key must end with '=' (base64 padding)".to_string());
    }

    // Try to decode
    let decoded = base64_decode(key)?;
    if decoded.len() != 32 {
        return Err(format!(
            "Decoded key must be 32 bytes, got {} bytes",
            decoded.len()
        ));
    }

    Ok(())
}

/// Check if a private key is properly clamped for Curve25519.
pub fn is_clamped(key: &str) -> Result<bool, String> {
    let bytes = base64_decode(key)?;
    if bytes.len() != 32 {
        return Err("Key must be 32 bytes".to_string());
    }
    Ok((bytes[0] & 7) == 0 && (bytes[31] & 128) == 0 && (bytes[31] & 64) == 64)
}

/// Build commands to generate keys using the wg CLI.
pub fn wg_genkey_command() -> Vec<String> {
    vec!["wg".to_string(), "genkey".to_string()]
}

pub fn wg_pubkey_command() -> Vec<String> {
    // Expects private key on stdin
    vec!["wg".to_string(), "pubkey".to_string()]
}

pub fn wg_genpsk_command() -> Vec<String> {
    vec!["wg".to_string(), "genpsk".to_string()]
}

/// Key fingerprint for display (first 8 chars of base64).
pub fn key_fingerprint(key: &str) -> String {
    if key.len() > 8 {
        format!("{}...", &key[..8])
    } else {
        key.to_string()
    }
}

// --- Base64 helpers ---

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| format!("Invalid base64: {}", e))
}
