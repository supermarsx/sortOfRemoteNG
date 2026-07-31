//! OpenPGP cryptographic operations for Passbolt.
//!
//! Passbolt relies on OpenPGP for encrypted secrets, metadata, GPGAuth/JWT
//! challenge-response messages, and sharing workflows.

use crate::passbolt::types::PassboltError;
use pgp::composed::cleartext::CleartextSignedMessage;
use pgp::composed::{Deserializable, Message, SignedPublicKey, SignedSecretKey};
use pgp::crypto::hash::HashAlgorithm;
use pgp::crypto::sym::SymmetricKeyAlgorithm;
use pgp::types::PublicKeyTrait;
use pgp::ArmorOptions;
use zeroize::Zeroize;

const MAX_KEY_BYTES: usize = 512 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 1024 * 1024;
const MAX_ARMORED_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_RECIPIENT_KEYS: usize = 1024;

/// A parsed PGP key (public or private).
pub struct PgpKey {
    /// Armored key text.
    pub armored: String,
    /// Key fingerprint (uppercase hex, 40 chars for v4 keys).
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
    pub fn set_user_key(&mut self, armored: &str, passphrase: &str) -> Result<(), PassboltError> {
        if armored.len() > MAX_KEY_BYTES || passphrase.len() > 16 * 1024 {
            return Err(PassboltError::invalid_config(
                "Passbolt user key material exceeds safe limits",
            ));
        }
        let key = parse_armored_key(armored, true)?;
        self.user_key = Some(key);
        if let Some(existing) = self.passphrase.as_mut() {
            existing.zeroize();
        }
        self.passphrase = Some(passphrase.to_string());
        Ok(())
    }

    /// Get the user key fingerprint.
    pub fn user_fingerprint(&self) -> Option<&str> {
        self.user_key.as_ref().map(|k| k.fingerprint.as_str())
    }

    /// Import the server's public key.
    pub fn set_server_key(
        &mut self,
        armored: &str,
        expected_fingerprint: &str,
    ) -> Result<(), PassboltError> {
        if armored.len() > MAX_KEY_BYTES {
            return Err(PassboltError::auth_failed(
                "Passbolt server key exceeds safe limits",
            ));
        }
        let key = parse_armored_key(armored, false)?;
        if !fingerprint_matches(&key.fingerprint, expected_fingerprint) {
            return Err(PassboltError::auth_failed(
                "Passbolt server key fingerprint mismatch",
            ));
        }
        self.server_key = Some(key);
        Ok(())
    }

    /// Get the server key fingerprint.
    pub fn server_fingerprint(&self) -> Option<&str> {
        self.server_key.as_ref().map(|k| k.fingerprint.as_str())
    }

    /// Cache a recipient's public key for sharing operations.
    pub fn add_recipient_key(
        &mut self,
        user_id: &str,
        armored: &str,
        expected_fingerprint: &str,
    ) -> Result<(), PassboltError> {
        if self.recipient_keys.len() >= MAX_RECIPIENT_KEYS
            && !self.recipient_keys.contains_key(user_id)
        {
            return Err(PassboltError::bad_request(
                "Passbolt recipient-key cache is full",
            ));
        }
        if user_id.is_empty() || user_id.len() > 128 || armored.len() > MAX_KEY_BYTES {
            return Err(PassboltError::bad_request(
                "Passbolt recipient key is invalid",
            ));
        }
        let key = parse_armored_key(armored, false)?;
        if !fingerprint_matches(&key.fingerprint, expected_fingerprint) {
            return Err(PassboltError::crypto(
                "Passbolt recipient key fingerprint mismatch",
            ));
        }
        self.recipient_keys.insert(user_id.to_string(), key);
        Ok(())
    }

    /// Get a cached recipient key.
    pub fn get_recipient_key(&self, user_id: &str) -> Option<&PgpKey> {
        self.recipient_keys.get(user_id)
    }

    /// Encrypt a plaintext message for the server using its public key.
    pub fn encrypt_for_server(&self, plaintext: &str) -> Result<String, PassboltError> {
        validate_plaintext_len(plaintext)?;
        let server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set"))?;
        let public_key = parse_public_key(&server_key.armored)?;
        encrypt_literal_for_public_key(plaintext, &public_key)
    }

    /// Encrypt and sign a message for the server (used in JWT challenge).
    pub fn encrypt_and_sign_for_server(&self, plaintext: &str) -> Result<String, PassboltError> {
        validate_plaintext_len(plaintext)?;
        let server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set"))?;
        let user_key = self
            .user_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("User private key not set"))?;

        let public_key = parse_public_key(&server_key.armored)?;
        let secret_key = parse_secret_key(&user_key.armored)?;
        let mut passphrase = self.passphrase.clone().unwrap_or_default();
        let result = sign_openpgp_message(
            Message::new_literal("", plaintext),
            &secret_key,
            &passphrase,
        );
        passphrase.zeroize();
        let signed = result?;
        encrypt_message_for_public_key(&signed, &public_key)
    }

    /// Encrypt a plaintext secret for a specific user by their user_id.
    pub fn encrypt_for_user(
        &self,
        plaintext: &str,
        user_id: &str,
    ) -> Result<String, PassboltError> {
        validate_plaintext_len(plaintext)?;
        let recipient_key = self.recipient_keys.get(user_id).ok_or_else(|| {
            PassboltError::crypto(format!("No public key cached for user {}", user_id))
        })?;
        let public_key = parse_public_key(&recipient_key.armored)?;
        encrypt_literal_for_public_key(plaintext, &public_key)
    }

    /// Decrypt a PGP message using the user's private key.
    pub fn decrypt(&self, armored_message: &str) -> Result<String, PassboltError> {
        validate_armored_message_len(armored_message)?;
        let decrypted = self.decrypt_message(armored_message)?;
        message_to_string(&decrypted)
    }

    /// Decrypt and verify a PGP message (verifying the server's signature).
    pub fn decrypt_and_verify(&self, armored_message: &str) -> Result<String, PassboltError> {
        validate_armored_message_len(armored_message)?;
        let server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set for verification"))?;
        let public_key = parse_public_key(&server_key.armored)?;
        let decrypted = self.decrypt_message(armored_message)?;

        verify_openpgp_message(&decrypted, &public_key)?;
        message_to_string(&decrypted)
    }

    /// Sign a message with the user's private key as an OpenPGP cleartext signature.
    pub fn sign(&self, message: &str) -> Result<String, PassboltError> {
        validate_plaintext_len(message)?;
        let user_key = self
            .user_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("User private key not set for signing"))?;
        let secret_key = parse_secret_key(&user_key.armored)?;
        let mut passphrase = self.passphrase.clone().unwrap_or_default();
        let result = sign_cleartext_message(message, &secret_key, &passphrase);
        passphrase.zeroize();
        let signed = result?;

        signed
            .to_armored_string(ArmorOptions::default())
            .map_err(map_pgp_err)
    }

    /// Verify a cleartext-signed message from the server.
    pub fn verify_signature(&self, armored_signed: &str) -> Result<String, PassboltError> {
        validate_armored_message_len(armored_signed)?;
        let server_key = self
            .server_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("Server public key not set for verification"))?;
        let public_key = parse_public_key(&server_key.armored)?;
        let (signed, _) =
            CleartextSignedMessage::from_string(armored_signed).map_err(map_pgp_err)?;

        verify_cleartext_message(&signed, &public_key)?;
        Ok(signed.signed_text())
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
        const PREFIX: &str = "gpgauthv1.3.0|36|";
        token.len() == PREFIX.len() + 72
            && token.starts_with(PREFIX)
            && token[PREFIX.len()..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
    }

    /// Encrypt metadata for a resource/folder/tag using the metadata key.
    pub fn encrypt_metadata(&self, plaintext_json: &str) -> Result<String, PassboltError> {
        let _ = plaintext_json;
        Err(PassboltError::crypto(
            "Passbolt metadata-key encryption is not implemented; refusing to substitute the server authentication key",
        ))
    }

    /// Decrypt metadata using the metadata private key.
    pub fn decrypt_metadata(&self, armored_metadata: &str) -> Result<String, PassboltError> {
        let _ = armored_metadata;
        Err(PassboltError::crypto(
            "Passbolt metadata-key decryption is not implemented; refusing to substitute the user authentication key",
        ))
    }

    fn decrypt_message(&self, armored_message: &str) -> Result<Message, PassboltError> {
        let user_key = self
            .user_key
            .as_ref()
            .ok_or_else(|| PassboltError::crypto("User private key not set for decryption"))?;
        let secret_key = parse_secret_key(&user_key.armored)?;
        let mut passphrase = self.passphrase.clone().unwrap_or_default();
        let (message, _) = Message::from_string(armored_message).map_err(map_pgp_err)?;
        let result = message
            .decrypt(|| passphrase.clone(), &[&secret_key])
            .map_err(map_pgp_err);
        passphrase.zeroize();
        let (decrypted, _) = result?;
        Ok(decrypted)
    }
}

impl Drop for PgpKey {
    fn drop(&mut self) {
        self.armored.zeroize();
    }
}

impl Drop for PgpContext {
    fn drop(&mut self) {
        if let Some(passphrase) = self.passphrase.as_mut() {
            passphrase.zeroize();
        }
        self.passphrase = None;
        self.user_key = None;
        self.server_key = None;
        self.recipient_keys.clear();
    }
}

// -- Helper functions -------------------------------------------------------

/// Parse an armored PGP key and extract OpenPGP metadata.
pub fn parse_armored_key(armored: &str, expect_secret: bool) -> Result<PgpKey, PassboltError> {
    if armored.is_empty() || armored.len() > MAX_KEY_BYTES {
        return Err(PassboltError::crypto("OpenPGP key size is invalid"));
    }
    let trimmed = armored.trim();

    if !expect_secret && trimmed.contains("PRIVATE KEY") {
        return Err(PassboltError::crypto(
            "A private OpenPGP key was supplied where a public key is required",
        ));
    }

    if expect_secret {
        let key = parse_secret_key(trimmed)?;
        Ok(secret_key_metadata(trimmed, &key))
    } else {
        let key = parse_public_key(trimmed)?;
        Ok(public_key_metadata(trimmed, &key))
    }
}

fn parse_public_key(armored: &str) -> Result<SignedPublicKey, PassboltError> {
    let (key, _) = SignedPublicKey::from_string(armored.trim()).map_err(map_pgp_err)?;
    key.verify().map_err(map_pgp_err)?;
    Ok(key)
}

fn parse_secret_key(armored: &str) -> Result<SignedSecretKey, PassboltError> {
    let (key, _) = SignedSecretKey::from_string(armored.trim()).map_err(map_pgp_err)?;
    key.verify().map_err(map_pgp_err)?;
    Ok(key)
}

fn public_key_metadata(armored: &str, key: &SignedPublicKey) -> PgpKey {
    let fingerprint = hex_encode_upper(key.fingerprint().as_bytes());
    let key_id = hex_encode_upper(key.key_id().as_ref());
    let uid = key
        .details
        .users
        .first()
        .map(|user| user.id.id().to_string())
        .unwrap_or_default();

    PgpKey {
        armored: armored.to_string(),
        fingerprint,
        key_id,
        uid,
        is_secret: false,
    }
}

fn secret_key_metadata(armored: &str, key: &SignedSecretKey) -> PgpKey {
    let fingerprint = hex_encode_upper(key.fingerprint().as_bytes());
    let key_id = hex_encode_upper(key.key_id().as_ref());
    let uid = key
        .details
        .users
        .first()
        .map(|user| user.id.id().to_string())
        .unwrap_or_default();

    PgpKey {
        armored: armored.to_string(),
        fingerprint,
        key_id,
        uid,
        is_secret: true,
    }
}

fn encrypt_literal_for_public_key(
    plaintext: &str,
    public_key: &SignedPublicKey,
) -> Result<String, PassboltError> {
    let message = Message::new_literal("", plaintext);
    encrypt_message_for_public_key(&message, public_key)
}

fn encrypt_message_for_public_key(
    message: &Message,
    public_key: &SignedPublicKey,
) -> Result<String, PassboltError> {
    let mut rng = rand::thread_rng();
    let encrypted = if let Some(subkey) = public_key.public_subkeys.first() {
        message
            .encrypt_to_keys_seipdv1(&mut rng, SymmetricKeyAlgorithm::AES256, &[subkey])
            .map_err(map_pgp_err)?
    } else {
        message
            .encrypt_to_keys_seipdv1(&mut rng, SymmetricKeyAlgorithm::AES256, &[public_key])
            .map_err(map_pgp_err)?
    };

    encrypted
        .to_armored_string(ArmorOptions::default())
        .map_err(map_pgp_err)
}

fn sign_openpgp_message(
    message: Message,
    secret_key: &SignedSecretKey,
    passphrase: &str,
) -> Result<Message, PassboltError> {
    let mut rng = rand::thread_rng();
    let primary_passphrase = passphrase.to_string();

    match message.clone().sign(
        &mut rng,
        secret_key,
        || primary_passphrase.clone(),
        HashAlgorithm::SHA2_256,
    ) {
        Ok(signed) => Ok(signed),
        Err(primary_error) => {
            for subkey in &secret_key.secret_subkeys {
                let subkey_passphrase = passphrase.to_string();
                if let Ok(signed) = message.clone().sign(
                    &mut rng,
                    subkey,
                    || subkey_passphrase.clone(),
                    HashAlgorithm::SHA2_256,
                ) {
                    return Ok(signed);
                }
            }
            Err(map_pgp_err(primary_error))
        }
    }
}

fn sign_cleartext_message(
    message: &str,
    secret_key: &SignedSecretKey,
    passphrase: &str,
) -> Result<CleartextSignedMessage, PassboltError> {
    let mut rng = rand::thread_rng();
    let primary_passphrase = passphrase.to_string();

    match CleartextSignedMessage::sign(&mut rng, message, secret_key, || primary_passphrase.clone())
    {
        Ok(signed) => Ok(signed),
        Err(primary_error) => {
            for subkey in &secret_key.secret_subkeys {
                let subkey_passphrase = passphrase.to_string();
                if let Ok(signed) = CleartextSignedMessage::sign(&mut rng, message, subkey, || {
                    subkey_passphrase.clone()
                }) {
                    return Ok(signed);
                }
            }
            Err(map_pgp_err(primary_error))
        }
    }
}

fn verify_openpgp_message(
    message: &Message,
    public_key: &SignedPublicKey,
) -> Result<(), PassboltError> {
    if message.verify(public_key).is_ok() {
        return Ok(());
    }

    for subkey in &public_key.public_subkeys {
        if message.verify(subkey).is_ok() {
            return Ok(());
        }
    }

    message.verify(public_key).map_err(map_pgp_err)
}

fn verify_cleartext_message(
    message: &CleartextSignedMessage,
    public_key: &SignedPublicKey,
) -> Result<(), PassboltError> {
    if message.verify(public_key).is_ok() {
        return Ok(());
    }

    for subkey in &public_key.public_subkeys {
        if message.verify(subkey).is_ok() {
            return Ok(());
        }
    }

    message.verify(public_key).map(|_| ()).map_err(map_pgp_err)
}

fn message_to_string(message: &Message) -> Result<String, PassboltError> {
    let content = message
        .get_content()
        .map_err(map_pgp_err)?
        .ok_or_else(|| PassboltError::crypto("OpenPGP message did not contain plaintext"))?;

    String::from_utf8(content)
        .map_err(|e| PassboltError::crypto(format!("OpenPGP plaintext was not valid UTF-8: {}", e)))
}

fn fingerprint_matches(actual: &str, expected: &str) -> bool {
    let expected = expected.trim();
    !expected.is_empty()
        && matches!(expected.len(), 40 | 64)
        && expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        && actual.eq_ignore_ascii_case(expected)
}

fn map_pgp_err(_error: pgp::errors::Error) -> PassboltError {
    PassboltError::crypto("OpenPGP operation failed")
}

fn validate_plaintext_len(plaintext: &str) -> Result<(), PassboltError> {
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        Err(PassboltError::crypto(
            "OpenPGP plaintext exceeds the configured size limit",
        ))
    } else {
        Ok(())
    }
}

fn validate_armored_message_len(message: &str) -> Result<(), PassboltError> {
    if message.is_empty() || message.len() > MAX_ARMORED_MESSAGE_BYTES {
        Err(PassboltError::crypto("OpenPGP message size is invalid"))
    } else {
        Ok(())
    }
}

/// Hex-encode a byte slice.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_encode_upper(bytes: &[u8]) -> String {
    hex_encode(bytes).to_uppercase()
}

// -- Tests -----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PUBLIC_KEY: &str = "-----BEGIN PGP PUBLIC KEY BLOCK-----

xioGY4d/4xsAAAAg+U2nu0jWCmHlZ3BqZYfQMxmZu52JGggkLq2EVD34laPCsQYf
GwoAAABCBYJjh3/jAwsJBwUVCg4IDAIWAAKbAwIeCSIhBssYbE8GCaaX5NUt+mxy
KwwfHifBilZwj2Ul7Ce62azJBScJAgcCAAAAAK0oIBA+LX0ifsDm185Ecds2v8lw
gyU2kCcUmKfvBXbAf6rhRYWzuQOwEn7E/aLwIwRaLsdry0+VcallHhSu4RN6HWaE
QsiPlR4zxP/TP7mhfVEe7XWPxtnMUMtf15OyA51YBM4qBmOHf+MZAAAAIIaTJINn
+eUBXbki+PSAld2nhJh/LVmFsS+60WyvXkQ1wpsGGBsKAAAALAWCY4d/4wKbDCIh
BssYbE8GCaaX5NUt+mxyKwwfHifBilZwj2Ul7Ce62azJAAAAAAQBIKbpGG2dWTX8
j+VjFM21J0hqWlEg+bdiojWnKfA5AQpWUWtnNwDEM0g12vYxoWM8Y81W+bHBw805
I8kWVkXU6vFOi+HWvv/ira7ofJu16NnoUkhclkUrk0mXubZvyl4GBg==
-----END PGP PUBLIC KEY BLOCK-----";

    const TEST_PRIVATE_KEY: &str = "-----BEGIN PGP PRIVATE KEY BLOCK-----

xUsGY4d/4xsAAAAg+U2nu0jWCmHlZ3BqZYfQMxmZu52JGggkLq2EVD34laMAGXKB
exK+cH6NX1hs5hNhIB00TrJmosgv3mg1ditlsLfCsQYfGwoAAABCBYJjh3/jAwsJ
BwUVCg4IDAIWAAKbAwIeCSIhBssYbE8GCaaX5NUt+mxyKwwfHifBilZwj2Ul7Ce6
2azJBScJAgcCAAAAAK0oIBA+LX0ifsDm185Ecds2v8lwgyU2kCcUmKfvBXbAf6rh
RYWzuQOwEn7E/aLwIwRaLsdry0+VcallHhSu4RN6HWaEQsiPlR4zxP/TP7mhfVEe
7XWPxtnMUMtf15OyA51YBMdLBmOHf+MZAAAAIIaTJINn+eUBXbki+PSAld2nhJh/
LVmFsS+60WyvXkQ1AE1gCk95TUR3XFeibg/u/tVY6a//1q0NWC1X+yui3O24wpsG
GBsKAAAALAWCY4d/4wKbDCIhBssYbE8GCaaX5NUt+mxyKwwfHifBilZwj2Ul7Ce6
2azJAAAAAAQBIKbpGG2dWTX8j+VjFM21J0hqWlEg+bdiojWnKfA5AQpWUWtnNwDE
M0g12vYxoWM8Y81W+bHBw805I8kWVkXU6vFOi+HWvv/ira7ofJu16NnoUkhclkUr
k0mXubZvyl4GBg==
-----END PGP PRIVATE KEY BLOCK-----";

    fn roundtrip_context() -> PgpContext {
        let mut ctx = PgpContext::new();
        let fingerprint = parse_armored_key(TEST_PUBLIC_KEY, false)
            .unwrap()
            .fingerprint
            .clone();
        ctx.set_user_key(TEST_PRIVATE_KEY, "").unwrap();
        ctx.set_server_key(TEST_PUBLIC_KEY, &fingerprint).unwrap();
        ctx.add_recipient_key("user1", TEST_PUBLIC_KEY, &fingerprint)
            .unwrap();
        ctx
    }

    #[test]
    fn test_parse_public_key() {
        let key = parse_armored_key(TEST_PUBLIC_KEY, false).unwrap();
        assert!(!key.is_secret);
        assert!(!key.fingerprint.is_empty());
        assert!(!key.key_id.is_empty());
    }

    #[test]
    fn test_parse_private_key() {
        let key = parse_armored_key(TEST_PRIVATE_KEY, true).unwrap();
        assert!(key.is_secret);
        assert!(!key.fingerprint.is_empty());
    }

    #[test]
    fn test_parse_wrong_expectation() {
        let err = parse_armored_key(TEST_PUBLIC_KEY, true);
        assert!(err.is_err());
        let err = parse_armored_key(TEST_PRIVATE_KEY, false);
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
        ctx.set_user_key(TEST_PRIVATE_KEY, "").unwrap();
        assert!(ctx.user_fingerprint().is_some());
    }

    #[test]
    fn test_set_server_key() {
        let mut ctx = PgpContext::new();
        let fingerprint = parse_armored_key(TEST_PUBLIC_KEY, false)
            .unwrap()
            .fingerprint
            .clone();
        ctx.set_server_key(TEST_PUBLIC_KEY, &fingerprint).unwrap();
        assert!(ctx.server_fingerprint().is_some());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let ctx = roundtrip_context();
        let encrypted = ctx.encrypt_for_server("hello world").unwrap();
        assert!(encrypted.contains("BEGIN PGP MESSAGE"));
        assert_eq!(ctx.decrypt(&encrypted).unwrap(), "hello world");
    }

    #[test]
    fn test_encrypt_for_user_roundtrip() {
        let ctx = roundtrip_context();
        let encrypted = ctx.encrypt_for_user("secret", "user1").unwrap();
        assert_eq!(ctx.decrypt(&encrypted).unwrap(), "secret");
    }

    #[test]
    fn test_encrypt_for_user_missing_key() {
        let ctx = PgpContext::new();
        let err = ctx.encrypt_for_user("secret", "unknown");
        assert!(err.is_err());
    }

    #[test]
    fn test_sign_and_verify_cleartext() {
        let ctx = roundtrip_context();
        let signed = ctx.sign("test message").unwrap();
        assert!(signed.contains("BEGIN PGP SIGNED MESSAGE"));
        assert_eq!(ctx.verify_signature(&signed).unwrap(), "test message");
    }

    #[test]
    fn test_encrypt_and_sign_decrypt_and_verify_roundtrip() {
        let ctx = roundtrip_context();
        let encrypted = ctx.encrypt_and_sign_for_server("challenge").unwrap();
        assert_eq!(ctx.decrypt_and_verify(&encrypted).unwrap(), "challenge");
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
    fn test_metadata_crypto_fails_closed_without_metadata_keys() {
        let ctx = roundtrip_context();
        assert!(ctx.encrypt_metadata(r#"{"name":"test"}"#).is_err());
        assert!(ctx.decrypt_metadata("encrypted-metadata").is_err());
    }

    #[test]
    fn test_hex_encode() {
        assert_eq!(hex_encode(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
    }

    #[test]
    fn test_decrypt_without_key() {
        let ctx = PgpContext::new();
        let err = ctx.decrypt("-----BEGIN PGP MESSAGE-----\n\nabc\n-----END PGP MESSAGE-----");
        assert!(err.is_err());
    }
}
