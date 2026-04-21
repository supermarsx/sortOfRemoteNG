//! OpenPGP cryptographic operations for Passbolt.
//!
//! Passbolt relies entirely on OpenPGP for encrypting secrets, metadata,
//! challenge-response authentication, and sharing workflows.
//!
//! This module provides a software-only PGP abstraction layer that wraps
//! armored key handling, encryption, decryption, signing, and verification.
//! It uses base64-encoded stubs so the crate compiles without requiring
//! a native GPG library; a real deployment should swap in `sequoia-openpgp`
//! or a comparable pure-Rust PGP implementation.

use crate::passbolt::types::PassboltError;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use log::{debug, warn};
use sha2::{Digest, Sha256};

/// A parsed PGP key (public or private).
#[derive(Debug, Clone)]
pub struct PgpKey {
    /// Armored key text.
    pub armored: String,
    /// Key fingerprint (uppercase hex, 40 chars).
    pub fingerprint: String,
    /// Key ID (last 16 hex chars of the fingerprint).
    pub key_id: String,
    /// User-ID string.
    pub uid: String,
    /// Whether this key has secret material.
    pub is_secret: bool,
}

/// PGP operation context holding the current user's key pair
/// and cached recipient keys.
#[derive(Debug, Clone)]
pub struct PgpContext {
    /// User's private key.
    user_key: Option<PgpKey>,
    /// Passphrase for the private key.
    passphrase: Option<String>,
    /// Server public key.
    server_key: Option<PgpKey>,
    /// Cached recipient public keys (user_id -> PgpKey).
    recipient_keys: std::collections::HashMap<String, PgpKey>,
}

impl Default for PgpContext {
    fn default() -> Self {
        Self::new()
    }
}

impl PgpContext {
    /// Create an empty PGP context.
    pub fn new() -> Self {
        Self {
            user_key: None,
            passphrase: None,
            server_key: None,
            recipient_keys: std::collections::HashMap::new(),
        }
    }

    /// Import the user's private key.
    pub fn set_user_key(&mut self, armored: &str, passphrase: &str) {
        if let Ok(key) = parse_armored_key(armored, true) {
            self.user_key = Some(key);
        } else {
            warn!("Failed to parse user private key");
        }
        self.passphrase = Some(passphrase.to_string());
    }

    /// Get the user key fingerprint.
    pub fn user_fingerprint(&self) -> Option<&str> {
        self.user_key.as_ref().map(|k| k.fingerprint.as_str())
    }

    /// Import the server's public key.
    pub fn set_server_key(&mut self, armored: &str, _fingerprint: &str) {
        if let Ok(key) = parse_armored_key(armored, false) {
            self.server_key = Some(key);
        } else {
            warn!("Failed to parse server public key");
        }
    }

    /// Get the server key fingerprint.
    pub fn server_fingerprint(&self) -> Option<&str> {
        self.server_key.as_ref().map(|k| k.fingerprint.as_str())
    }

    /// Cache a recipient's public key for sharing operations.
    pub fn add_recipient_key(&mut self, user_id: &str, armored: &str, _fingerprint: &str) {
        if let Ok(key) = parse_armored_key(armored, false) {
            self.recipient_keys.insert(user_id.to_string(), key);
        } else {
            warn!("Failed to parse recipient key for user {}", user_id);
        }
    }

    /// Get a cached recipient key.
    pub fn get_recipient_key(&self, user_id: &str) -> Option<&PgpKey> {
        self.recipient_keys.get(user_id)
    }

    /// Encrypt a plaintext message for the server using its public key.
    pub fn encrypt_for_server(&self, plaintext: &str) -> Result<String, PassboltError> {
        let _server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set"))?;
        // In a real implementation, this would use sequoia-openpgp or similar
        // to PGP-encrypt the plaintext to the server's public key.
        let encoded = B64.encode(plaintext.as_bytes());
        let armored = format!(
            "-----BEGIN PGP MESSAGE-----\n\n{}\n-----END PGP MESSAGE-----",
            encoded
        );
        debug!(
            "Encrypted message for server ({} bytes plaintext)",
            plaintext.len()
        );
        Ok(armored)
    }

    /// Encrypt and sign a message for the server (used in JWT challenge).
    pub fn encrypt_and_sign_for_server(&self, plaintext: &str) -> Result<String, PassboltError> {
        let _server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set"))?;
        let _user_key = self
            .user_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("User private key not set"))?;
        // gpg_encrypt(gpg_sign(challenge, user_key), server_key)
        let encoded = B64.encode(plaintext.as_bytes());
        let armored = format!(
            "-----BEGIN PGP MESSAGE-----\n\n{}\n-----END PGP MESSAGE-----",
            encoded
        );
        debug!(
            "Encrypted+signed message for server ({} bytes)",
            plaintext.len()
        );
        Ok(armored)
    }

    /// Encrypt a plaintext secret for a specific user by their user_id.
    pub fn encrypt_for_user(
        &self,
        plaintext: &str,
        user_id: &str,
    ) -> Result<String, PassboltError> {
        let _recipient_key = self.recipient_keys.get(user_id).ok_or_else(|| {
            PassboltError::crypto(format!("No public key cached for user {}", user_id))
        })?;
        let encoded = B64.encode(plaintext.as_bytes());
        let armored = format!(
            "-----BEGIN PGP MESSAGE-----\n\n{}\n-----END PGP MESSAGE-----",
            encoded
        );
        debug!(
            "Encrypted secret for user {} ({} bytes)",
            user_id,
            plaintext.len()
        );
        Ok(armored)
    }

    /// Decrypt a PGP message using the user's private key.
    pub fn decrypt(&self, armored_message: &str) -> Result<String, PassboltError> {
        let _user_key = self
            .user_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("User private key not set for decryption"))?;
        // Extract base64 payload from the armored message.
        let payload = extract_pgp_payload(armored_message)?;
        let decoded = B64
            .decode(&payload)
            .map_err(|e| PassboltError::crypto(format!("Base64 decode failed: {}", e)))?;
        let plaintext = String::from_utf8(decoded)
            .map_err(|e| PassboltError::crypto(format!("UTF-8 decode failed: {}", e)))?;
        debug!("Decrypted message ({} bytes plaintext)", plaintext.len());
        Ok(plaintext)
    }

    /// Decrypt and verify a PGP message (verifying the server's signature).
    pub fn decrypt_and_verify(&self, armored_message: &str) -> Result<String, PassboltError> {
        let _server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set for verification"))?;
        // In production this would verify the signature before returning.
        self.decrypt(armored_message)
    }

    /// Sign a message with the user's private key.
    pub fn sign(&self, message: &str) -> Result<String, PassboltError> {
        let _user_key = self
            .user_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("User private key not set for signing"))?;
        let encoded = B64.encode(message.as_bytes());
        let armored = format!(
            "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n{}\n-----BEGIN PGP SIGNATURE-----\n\n{}\n-----END PGP SIGNATURE-----",
            message, encoded
        );
        debug!("Signed message ({} bytes)", message.len());
        Ok(armored)
    }

    /// Verify a cleartext-signed message from the server.
    pub fn verify_signature(&self, _armored_signed: &str) -> Result<String, PassboltError> {
        let _server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set for verification"))?;
        // In production, extract the cleartext and verify the signature.
        warn!("Signature verification is a stub — accepting without cryptographic check");
        Ok("verified".to_string())
    }

    /// Generate a random challenge token for GPGAuth.
    pub fn generate_challenge(&self) -> String {
        use rand::RngCore;
        let mut rng = rand::thread_rng();
        let mut token = [0u8; 36];
        rng.fill_bytes(&mut token);
        format!("gpgauthv1.3.0|36|{}", hex_encode(&token))
    }

    /// Verify a GPGAuth challenge token format.
    pub fn verify_challenge_format(token: &str) -> bool {
        token.starts_with("gpgauthv1.3.0|36|") && token.len() > 17
    }

    /// Encrypt metadata for a resource/folder/tag using the metadata key.
    pub fn encrypt_metadata(&self, plaintext_json: &str) -> Result<String, PassboltError> {
        let encoded = B64.encode(plaintext_json.as_bytes());
        let armored = format!(
            "-----BEGIN PGP MESSAGE-----\n\n{}\n-----END PGP MESSAGE-----",
            encoded
        );
        debug!("Encrypted metadata ({} bytes)", plaintext_json.len());
        Ok(armored)
    }

    /// Decrypt metadata using the metadata private key.
    pub fn decrypt_metadata(&self, armored_metadata: &str) -> Result<String, PassboltError> {
        self.decrypt(armored_metadata)
    }
}

// ── Helper functions ────────────────────────────────────────────────

/// Parse an armored PGP key and extract basic info.
pub fn parse_armored_key(armored: &str, expect_secret: bool) -> Result<PgpKey, PassboltError> {
    let trimmed = armored.trim();
    let is_secret = trimmed.contains("PRIVATE KEY");
    let is_public = trimmed.contains("PUBLIC KEY");

    if expect_secret && !is_secret {
        return Err(PassboltError::crypto(
            "Expected a private key but got a public key",
        ));
    }
    if !expect_secret && !is_public && !is_secret {
        return Err(PassboltError::crypto("Not a valid PGP key block"));
    }

    // Derive a fingerprint from a hash of the key data (stub).
    let fingerprint = compute_fingerprint(trimmed);
    let key_id = fingerprint[fingerprint.len().saturating_sub(16)..].to_string();

    Ok(PgpKey {
        armored: trimmed.to_string(),
        fingerprint,
        key_id,
        uid: String::new(),
        is_secret,
    })
}

/// Compute a stub fingerprint from key material (SHA-256 truncated to 40 hex).
fn compute_fingerprint(key_data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key_data.as_bytes());
    let result = hasher.finalize();
    let hex = hex_encode(&result);
    hex[..40].to_uppercase()
}

/// Extract the base64 payload from an armored PGP message.
fn extract_pgp_payload(armored: &str) -> Result<String, PassboltError> {
    let lines: Vec<&str> = armored.lines().collect();
    let mut in_body = false;
    let mut payload = String::new();

    for line in &lines {
        let trimmed = line.trim();
        if trimmed.is_empty() && !in_body {
            in_body = true;
            continue;
        }
        if trimmed.starts_with("-----END") {
            break;
        }
        if in_body && !trimmed.is_empty() {
            // Skip checksum line (starts with =)
            if !trimmed.starts_with('=') {
                payload.push_str(trimmed);
            }
        }
    }

    if payload.is_empty() {
        return Err(PassboltError::crypto(
            "No payload found in armored PGP message",
        ));
    }
    Ok(payload)
}

/// Hex-encode a byte slice.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PUBKEY: &str =
        "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQENBGTJv\n-----END PGP PUBLIC KEY BLOCK-----";
    const TEST_PRIVKEY: &str =
        "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\npriv123\n-----END PGP PRIVATE KEY BLOCK-----";

    #[test]
    fn test_parse_public_key() {
        let key = parse_armored_key(TEST_PUBKEY, false).unwrap();
        assert!(!key.is_secret);
        assert_eq!(key.fingerprint.len(), 40);
    }

    #[test]
    fn test_parse_private_key() {
        let key = parse_armored_key(TEST_PRIVKEY, true).unwrap();
        assert!(key.is_secret);
    }

    #[test]
    fn test_parse_wrong_expectation() {
        let err = parse_armored_key(TEST_PUBKEY, true);
        assert!(err.is_err());
    }

    #[test]
    fn test_pgp_context_new() {
        let ctx = PgpContext::new();
        assert!(ctx.user_fingerprint().is_none());
        assert!(ctx.server_fingerprint().is_none());
    }

    #[test]
    fn test_set_user_key() {
        let mut ctx = PgpContext::new();
        ctx.set_user_key(TEST_PRIVKEY, "pass");
        assert!(ctx.user_fingerprint().is_some());
    }

    #[test]
    fn test_set_server_key() {
        let mut ctx = PgpContext::new();
        ctx.set_server_key(TEST_PUBKEY, "fingerprint");
        assert!(ctx.server_fingerprint().is_some());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let mut ctx = PgpContext::new();
        ctx.set_user_key(TEST_PRIVKEY, "pass");
        ctx.set_server_key(TEST_PUBKEY, "fingerprint");

        let encrypted = ctx.encrypt_for_server("hello world").unwrap();
        assert!(encrypted.contains("BEGIN PGP MESSAGE"));

        let decrypted = ctx.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, "hello world");
    }

    #[test]
    fn test_encrypt_for_user() {
        let mut ctx = PgpContext::new();
        ctx.add_recipient_key("user1", TEST_PUBKEY, "fingerprint");
        let encrypted = ctx.encrypt_for_user("secret", "user1").unwrap();
        assert!(encrypted.contains("BEGIN PGP MESSAGE"));
    }

    #[test]
    fn test_encrypt_for_user_missing_key() {
        let ctx = PgpContext::new();
        let err = ctx.encrypt_for_user("secret", "unknown");
        assert!(err.is_err());
    }

    #[test]
    fn test_sign_message() {
        let mut ctx = PgpContext::new();
        ctx.set_user_key(TEST_PRIVKEY, "pass");
        let signed = ctx.sign("test message").unwrap();
        assert!(signed.contains("PGP SIGNED MESSAGE"));
        assert!(signed.contains("test message"));
    }

    #[test]
    fn test_generate_challenge() {
        let ctx = PgpContext::new();
        let challenge = ctx.generate_challenge();
        assert!(PgpContext::verify_challenge_format(&challenge));
    }

    #[test]
    fn test_challenge_format_invalid() {
        assert!(!PgpContext::verify_challenge_format("not-a-challenge"));
    }

    #[test]
    fn test_encrypt_metadata() {
        let mut ctx = PgpContext::new();
        ctx.set_user_key(TEST_PRIVKEY, "pass");
        let encrypted = ctx.encrypt_metadata(r#"{"name":"test"}"#).unwrap();
        assert!(encrypted.contains("BEGIN PGP MESSAGE"));
    }

    #[test]
    fn test_decrypt_metadata() {
        let mut ctx = PgpContext::new();
        ctx.set_user_key(TEST_PRIVKEY, "pass");
        let encrypted = ctx.encrypt_metadata(r#"{"name":"test"}"#).unwrap();
        let decrypted = ctx.decrypt_metadata(&encrypted).unwrap();
        assert_eq!(decrypted, r#"{"name":"test"}"#);
    }

    #[test]
    fn test_extract_pgp_payload() {
        let armored = "-----BEGIN PGP MESSAGE-----\n\naGVsbG8=\n-----END PGP MESSAGE-----";
        let payload = extract_pgp_payload(armored).unwrap();
        assert_eq!(payload, "aGVsbG8=");
    }

    #[test]
    fn test_extract_pgp_payload_empty() {
        let err = extract_pgp_payload("-----BEGIN PGP MESSAGE-----\n-----END PGP MESSAGE-----");
        assert!(err.is_err());
    }

    #[test]
    fn test_hex_encode() {
        assert_eq!(hex_encode(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
    }

    #[test]
    fn test_encrypt_and_sign() {
        let mut ctx = PgpContext::new();
        ctx.set_user_key(TEST_PRIVKEY, "pass");
        ctx.set_server_key(TEST_PUBKEY, "fingerprint");
        let encrypted = ctx.encrypt_and_sign_for_server("challenge").unwrap();
        assert!(encrypted.contains("BEGIN PGP MESSAGE"));
    }

    #[test]
    fn test_decrypt_without_key() {
        let ctx = PgpContext::new();
        let err = ctx.decrypt("-----BEGIN PGP MESSAGE-----\n\naGVsbG8=\n-----END PGP MESSAGE-----");
        assert!(err.is_err());
    }
}
