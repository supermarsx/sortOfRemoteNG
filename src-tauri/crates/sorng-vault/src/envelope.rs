//! Envelope encryption using AES-256-GCM with Argon2id key derivation.
//!
//! This module provides high-level encrypt/decrypt functions that:
//!
//! 1. Derive a 256-bit key from a password/passphrase using Argon2id
//! 2. Encrypt/decrypt data using AES-256-GCM (authenticated encryption)
//! 3. Produce a combined output: `EnvelopeMeta` (JSON) + ciphertext (base64)
//!
//! When combined with the vault keychain, the workflow is:
//!
//! ```text
//! [user password / biometric key]
//!         │
//!    Argon2id KDF
//!         │
//!    256-bit KEK  ──► unwrap DEK stored in OS vault
//!         │
//!       DEK  ──► AES-256-GCM encrypt/decrypt application data
//! ```

use crate::types::*;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;

/// Default Argon2id parameters (OWASP recommended minimum for interactive use).
const ARGON2_MEMORY_KIB: u32 = 65_536; // 64 MiB
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encrypt `plaintext` with a password using Argon2id + AES-256-GCM.
///
/// Returns `(meta_json, ciphertext_b64)`.
pub fn encrypt(password: &str, plaintext: &[u8]) -> VaultResult<(String, String)> {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| VaultError::crypto(format!("AES-GCM encrypt: {e}")))?;

    let meta = EnvelopeMeta {
        version: 1,
        kdf: "argon2id".into(),
        kdf_memory_kib: ARGON2_MEMORY_KIB,
        kdf_time_cost: ARGON2_TIME_COST,
        kdf_parallelism: ARGON2_PARALLELISM,
        salt_b64: general_purpose::STANDARD.encode(salt),
        nonce_b64: general_purpose::STANDARD.encode(nonce_bytes),
    };

    let meta_json =
        serde_json::to_string(&meta).map_err(|e| VaultError::serde(format!("meta json: {e}")))?;
    let ct_b64 = general_purpose::STANDARD.encode(&ciphertext);

    Ok((meta_json, ct_b64))
}

/// Decrypt `ciphertext_b64` using the `meta_json` envelope and password.
pub fn decrypt(password: &str, meta_json: &str, ciphertext_b64: &str) -> VaultResult<Vec<u8>> {
    let meta: EnvelopeMeta =
        serde_json::from_str(meta_json).map_err(|e| VaultError::serde(format!("meta parse: {e}")))?;

    if meta.version != 1 {
        return Err(VaultError::crypto(format!(
            "Unsupported envelope version: {}",
            meta.version
        )));
    }

    let salt = general_purpose::STANDARD
        .decode(&meta.salt_b64)
        .map_err(|e| VaultError::crypto(format!("salt decode: {e}")))?;
    let nonce_bytes = general_purpose::STANDARD
        .decode(&meta.nonce_b64)
        .map_err(|e| VaultError::crypto(format!("nonce decode: {e}")))?;
    let ciphertext = general_purpose::STANDARD
        .decode(ciphertext_b64)
        .map_err(|e| VaultError::crypto(format!("ciphertext decode: {e}")))?;

    let key = derive_key_with_params(
        password,
        &salt,
        meta.kdf_memory_kib,
        meta.kdf_time_cost,
        meta.kdf_parallelism,
    )?;

    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| VaultError::access_denied("Decryption failed — wrong password or corrupted data"))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Encrypt/decrypt with raw key (for DEK wrapping)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encrypt data with a raw 32-byte key (no KDF).
pub fn encrypt_with_key(key: &[u8; 32], plaintext: &[u8]) -> VaultResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| VaultError::crypto(format!("AES-GCM encrypt: {e}")))?;

    // Prepend nonce to ciphertext
    let mut output = nonce_bytes.to_vec();
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

/// Decrypt data with a raw 32-byte key (no KDF).
pub fn decrypt_with_key(key: &[u8; 32], data: &[u8]) -> VaultResult<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return Err(VaultError::crypto("Data too short for nonce+ciphertext"));
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| VaultError::access_denied("Decryption failed — wrong key or corrupted data"))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  KDF
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn derive_key(password: &str, salt: &[u8]) -> VaultResult<[u8; 32]> {
    derive_key_with_params(
        password,
        salt,
        ARGON2_MEMORY_KIB,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
    )
}

fn derive_key_with_params(
    password: &str,
    salt: &[u8],
    memory_kib: u32,
    time_cost: u32,
    parallelism: u32,
) -> VaultResult<[u8; 32]> {
    let params = argon2::Params::new(memory_kib, time_cost, parallelism, Some(32))
        .map_err(|e| VaultError::kdf(format!("Argon2 params: {e}")))?;

    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| VaultError::kdf(format!("Argon2 hash: {e}")))?;

    Ok(key)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_password() {
        let plaintext = b"Hello, vault!";
        let password = "super-secret-p@ssw0rd";

        let (meta, ct) = encrypt(password, plaintext).unwrap();
        let decrypted = decrypt(password, &meta, &ct).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_password_fails() {
        let plaintext = b"secret data";
        let (meta, ct) = encrypt("correct", plaintext).unwrap();
        let result = decrypt("wrong", &meta, &ct);
        assert!(result.is_err());
    }

    #[test]
    fn round_trip_raw_key() {
        let key = [42u8; 32];
        let plaintext = b"raw key encryption test";

        let encrypted = encrypt_with_key(&key, plaintext).unwrap();
        let decrypted = decrypt_with_key(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_fails() {
        let key1 = [1u8; 32];
        let key2 = [2u8; 32];
        let encrypted = encrypt_with_key(&key1, b"data").unwrap();
        assert!(decrypt_with_key(&key2, &encrypted).is_err());
    }
}
