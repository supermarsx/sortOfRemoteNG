//! Cryptographic utilities for vault encryption.
//!
//! - **Key derivation**: PBKDF2-HMAC-SHA256 (600 000 iterations)
//! - **Encryption**: AES-256-GCM with random 96-bit nonce
//! - **Vault format**: JSON envelope with salt, nonce, ciphertext (all hex)

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::totp::types::*;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// PBKDF2 iteration count (OWASP 2023 recommendation for SHA-256).
const PBKDF2_ITERATIONS: u32 = 600_000;
/// Salt length in bytes.
const SALT_LEN: usize = 32;
/// AES-256-GCM nonce length in bytes.
const NONCE_LEN: usize = 12;
/// Derived key length in bytes (256-bit for AES-256).
const KEY_LEN: usize = 32;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Vault envelope
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encrypted vault envelope stored as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEnvelope {
    /// Format version (for future migration).
    pub version: u32,
    /// PBKDF2 iteration count used.
    pub iterations: u32,
    /// Hex-encoded salt.
    pub salt: String,
    /// Hex-encoded AES-GCM nonce.
    pub nonce: String,
    /// Hex-encoded ciphertext (AES-256-GCM).
    pub ciphertext: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Key derivation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Derive an AES-256 key from a password using PBKDF2-HMAC-SHA256.
pub fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// Generate a cryptographically random salt.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// Generate a cryptographically random nonce for AES-GCM.
pub fn generate_nonce() -> [u8; NONCE_LEN] {
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AES-256-GCM encrypt / decrypt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encrypt plaintext bytes with AES-256-GCM.
pub fn aes_encrypt(key: &[u8; KEY_LEN], nonce_bytes: &[u8; NONCE_LEN], plaintext: &[u8]) -> Result<Vec<u8>, TotpError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| {
        TotpError::new(TotpErrorKind::EncryptionFailed, format!("AES init: {}", e))
    })?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.encrypt(nonce, plaintext).map_err(|e| {
        TotpError::new(TotpErrorKind::EncryptionFailed, format!("AES encrypt: {}", e))
    })
}

/// Decrypt ciphertext bytes with AES-256-GCM.
pub fn aes_decrypt(key: &[u8; KEY_LEN], nonce_bytes: &[u8; NONCE_LEN], ciphertext: &[u8]) -> Result<Vec<u8>, TotpError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| {
        TotpError::new(TotpErrorKind::DecryptionFailed, format!("AES init: {}", e))
    })?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.decrypt(nonce, ciphertext).map_err(|_e| {
        TotpError::new(TotpErrorKind::DecryptionFailed, "Decryption failed – wrong password or corrupted data")
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Vault-level encrypt / decrypt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encrypt a plaintext string (typically JSON) into a `VaultEnvelope` JSON string.
pub fn encrypt_vault(plaintext: &str, password: &str) -> Result<String, TotpError> {
    let salt = generate_salt();
    let nonce = generate_nonce();
    let key = derive_key(password, &salt, PBKDF2_ITERATIONS);
    let ciphertext = aes_encrypt(&key, &nonce, plaintext.as_bytes())?;

    let envelope = VaultEnvelope {
        version: 1,
        iterations: PBKDF2_ITERATIONS,
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ciphertext: hex::encode(ciphertext),
    };

    serde_json::to_string_pretty(&envelope).map_err(|e| {
        TotpError::new(TotpErrorKind::EncryptionFailed, format!("JSON serialize: {}", e))
    })
}

/// Decrypt a `VaultEnvelope` JSON string back to plaintext.
pub fn decrypt_vault(envelope_json: &str, password: &str) -> Result<String, TotpError> {
    let envelope: VaultEnvelope = serde_json::from_str(envelope_json).map_err(|e| {
        TotpError::new(
            TotpErrorKind::DecryptionFailed,
            format!("Invalid vault envelope: {}", e),
        )
    })?;

    let salt = hex::decode(&envelope.salt).map_err(|e| {
        TotpError::new(TotpErrorKind::DecryptionFailed, format!("Bad salt hex: {}", e))
    })?;
    let nonce_bytes = hex::decode(&envelope.nonce).map_err(|e| {
        TotpError::new(TotpErrorKind::DecryptionFailed, format!("Bad nonce hex: {}", e))
    })?;
    let ciphertext = hex::decode(&envelope.ciphertext).map_err(|e| {
        TotpError::new(TotpErrorKind::DecryptionFailed, format!("Bad ciphertext hex: {}", e))
    })?;

    if nonce_bytes.len() != NONCE_LEN {
        return Err(TotpError::new(
            TotpErrorKind::DecryptionFailed,
            format!("Nonce length {} != expected {}", nonce_bytes.len(), NONCE_LEN),
        ));
    }

    let key = derive_key(password, &salt, envelope.iterations);
    let mut nonce_arr = [0u8; NONCE_LEN];
    nonce_arr.copy_from_slice(&nonce_bytes);

    let plaintext_bytes = aes_decrypt(&key, &nonce_arr, &ciphertext)?;
    String::from_utf8(plaintext_bytes).map_err(|e| {
        TotpError::new(
            TotpErrorKind::DecryptionFailed,
            format!("UTF-8 decode: {}", e),
        )
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Password strength
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Simple password-strength score (0–4).
///   0 = very weak, 1 = weak, 2 = fair, 3 = good, 4 = strong
pub fn password_strength(password: &str) -> u8 {
    let len = password.len();
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    let variety = [has_lower, has_upper, has_digit, has_special]
        .iter()
        .filter(|&&v| v)
        .count();

    let mut score: u8 = 0;

    if len >= 8 {
        score += 1;
    }
    if len >= 12 {
        score += 1;
    }
    if variety >= 3 {
        score += 1;
    }
    if variety >= 4 && len >= 16 {
        score += 1;
    }

    score.min(4)
}

/// Human-readable label for a strength score.
pub fn strength_label(score: u8) -> &'static str {
    match score {
        0 => "Very Weak",
        1 => "Weak",
        2 => "Fair",
        3 => "Good",
        _ => "Strong",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── PBKDF2 key derivation ────────────────────────────────────

    #[test]
    fn derive_key_deterministic() {
        let salt = [0u8; SALT_LEN];
        let k1 = derive_key("password", &salt, 1000);
        let k2 = derive_key("password", &salt, 1000);
        assert_eq!(k1, k2);
    }

    #[test]
    fn derive_key_different_passwords() {
        let salt = [0u8; SALT_LEN];
        let k1 = derive_key("password1", &salt, 1000);
        let k2 = derive_key("password2", &salt, 1000);
        assert_ne!(k1, k2);
    }

    #[test]
    fn derive_key_different_salts() {
        let s1 = [0u8; SALT_LEN];
        let s2 = [1u8; SALT_LEN];
        let k1 = derive_key("password", &s1, 1000);
        let k2 = derive_key("password", &s2, 1000);
        assert_ne!(k1, k2);
    }

    // ── AES-256-GCM ─────────────────────────────────────────────

    #[test]
    fn aes_encrypt_decrypt_roundtrip() {
        let key = derive_key("test", &[42u8; SALT_LEN], 1000);
        let nonce = [0u8; NONCE_LEN];
        let plaintext = b"Hello, vault!";
        let ct = aes_encrypt(&key, &nonce, plaintext).unwrap();
        let pt = aes_decrypt(&key, &nonce, &ct).unwrap();
        assert_eq!(pt, plaintext);
    }

    #[test]
    fn aes_wrong_key_fails() {
        let key1 = derive_key("correct", &[0u8; SALT_LEN], 1000);
        let key2 = derive_key("wrong", &[0u8; SALT_LEN], 1000);
        let nonce = [0u8; NONCE_LEN];
        let ct = aes_encrypt(&key1, &nonce, b"secret data").unwrap();
        let result = aes_decrypt(&key2, &nonce, &ct);
        assert!(result.is_err());
    }

    #[test]
    fn aes_wrong_nonce_fails() {
        let key = derive_key("test", &[0u8; SALT_LEN], 1000);
        let n1 = [0u8; NONCE_LEN];
        let n2 = [1u8; NONCE_LEN];
        let ct = aes_encrypt(&key, &n1, b"data").unwrap();
        let result = aes_decrypt(&key, &n2, &ct);
        assert!(result.is_err());
    }

    #[test]
    fn aes_empty_plaintext() {
        let key = derive_key("test", &[0u8; SALT_LEN], 1000);
        let nonce = [0u8; NONCE_LEN];
        let ct = aes_encrypt(&key, &nonce, b"").unwrap();
        let pt = aes_decrypt(&key, &nonce, &ct).unwrap();
        assert!(pt.is_empty());
    }

    // ── Vault encrypt / decrypt ──────────────────────────────────

    #[test]
    fn vault_encrypt_decrypt_roundtrip() {
        let plaintext = r#"[{"label":"test","secret":"ABCDEF"}]"#;
        let password = "my-strong-password-123!";
        let envelope = encrypt_vault(plaintext, password).unwrap();
        let decrypted = decrypt_vault(&envelope, password).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn vault_wrong_password_fails() {
        let envelope = encrypt_vault("secret", "correct-password").unwrap();
        let result = decrypt_vault(&envelope, "wrong-password");
        assert!(result.is_err());
    }

    #[test]
    fn vault_envelope_is_valid_json() {
        let envelope = encrypt_vault("test", "pass").unwrap();
        let parsed: VaultEnvelope = serde_json::from_str(&envelope).unwrap();
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.iterations, PBKDF2_ITERATIONS);
        assert_eq!(hex::decode(&parsed.salt).unwrap().len(), SALT_LEN);
        assert_eq!(hex::decode(&parsed.nonce).unwrap().len(), NONCE_LEN);
    }

    #[test]
    fn vault_each_encryption_is_unique() {
        let e1 = encrypt_vault("same", "pass").unwrap();
        let e2 = encrypt_vault("same", "pass").unwrap();
        // Different salt + nonce each time
        assert_ne!(e1, e2);
    }

    // ── Random generation ────────────────────────────────────────

    #[test]
    fn random_salt_unique() {
        let s1 = generate_salt();
        let s2 = generate_salt();
        assert_ne!(s1, s2);
    }

    #[test]
    fn random_nonce_unique() {
        let n1 = generate_nonce();
        let n2 = generate_nonce();
        assert_ne!(n1, n2);
    }

    // ── Password strength ────────────────────────────────────────

    #[test]
    fn strength_empty() {
        assert_eq!(password_strength(""), 0);
    }

    #[test]
    fn strength_short() {
        assert_eq!(password_strength("abc"), 0);
    }

    #[test]
    fn strength_medium() {
        // 8+ chars with mixed case
        let score = password_strength("Abcdefgh1");
        assert!(score >= 1);
    }

    #[test]
    fn strength_strong() {
        let score = password_strength("MyStr0ng!P@ssw0rd123");
        assert!(score >= 3);
    }

    #[test]
    fn strength_label_mapping() {
        assert_eq!(strength_label(0), "Very Weak");
        assert_eq!(strength_label(1), "Weak");
        assert_eq!(strength_label(2), "Fair");
        assert_eq!(strength_label(3), "Good");
        assert_eq!(strength_label(4), "Strong");
    }
}
