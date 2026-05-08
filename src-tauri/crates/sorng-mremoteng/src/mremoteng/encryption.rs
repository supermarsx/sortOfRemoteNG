//! AES-256-GCM encryption/decryption with PBKDF2 key derivation.
//!
//! Matches the wire format used by mRemoteNG's `AeadCryptographyProvider`:
//! - 16-byte random salt -> PBKDF2-HMAC-SHA1 -> 32-byte key
//! - 16-byte random nonce
//! - AES-256-GCM ciphertext (includes 16-byte auth tag appended)
//! - Binary layout: `[salt (16)] [nonce (16)] [ciphertext+tag]`
//! - The salt is also used as AES-GCM additional authenticated data (AAD)
//! - Final output: Base64-encoded

use aes_gcm::{
    aead::{generic_array::typenum::U16, Aead, KeyInit, Payload},
    aes::Aes256,
    AesGcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::Rng;
use sha1::Sha1;

use super::error::{MremotengError, MremotengResult};
use super::types::{BlockCipherEngine, BlockCipherMode, EncryptionInfo};

const SALT_SIZE: usize = 16;
const NONCE_SIZE: usize = 16; // mRemoteNG uses 128-bit nonce (non-standard but matches their code)
const KEY_SIZE: usize = 32; // 256-bit AES key
const MIN_PASSWORD_LEN: usize = 1;
const DEFAULT_MASTER_PASSWORD: &str = "mR3m";
const PROTECTED_PLAINTEXT_NO_PASSWORD: &str = "ThisIsNotProtected";
const PROTECTED_PLAINTEXT_PASSWORD: &str = "ThisIsProtected";

const AES_GCM_NONCE_SIZE: usize = 12;
type Aes256Gcm16 = AesGcm<Aes256, U16>;

fn effective_password(password: &str) -> &str {
    if password.is_empty() {
        DEFAULT_MASTER_PASSWORD
    } else {
        password
    }
}

fn pkcs5_password_to_bytes(password: &str) -> Vec<u8> {
    password
        .encode_utf16()
        .map(|code_unit| (code_unit & 0xff) as u8)
        .collect()
}

/// Derive a 256-bit key from a password and salt using PBKDF2-HMAC-SHA1.
fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_SIZE] {
    let mut key = [0u8; KEY_SIZE];
    pbkdf2::pbkdf2_hmac::<Sha1>(
        &pkcs5_password_to_bytes(password),
        salt,
        iterations,
        &mut key,
    );
    key
}

/// Encrypt a plaintext string using AES-256-GCM with PBKDF2 key derivation.
///
/// Output: Base64-encoded `[salt (16)] [nonce (16)] [ciphertext+tag]`
pub fn encrypt(plaintext: &str, password: &str, iterations: u32) -> MremotengResult<String> {
    let password = effective_password(password);
    if password.len() < MIN_PASSWORD_LEN {
        return Err(MremotengError::Encryption(format!(
            "Password must be at least {} character(s)",
            MIN_PASSWORD_LEN
        )));
    }

    if plaintext.is_empty() {
        return Ok(String::new());
    }

    let mut rng = rand::thread_rng();

    // Generate random salt
    let mut salt = [0u8; SALT_SIZE];
    rng.fill(&mut salt);

    // Derive key
    let key = derive_key(password, &salt, iterations);

    // Generate random nonce (128-bit, matching mRemoteNG/BouncyCastle)
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rng.fill(&mut nonce_bytes);

    // Encrypt
    let cipher =
        Aes256Gcm16::new_from_slice(&key).map_err(|e| MremotengError::Encryption(e.to_string()))?;
    let nonce = Nonce::<U16>::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: &salt,
            },
        )
        .map_err(|e| MremotengError::Encryption(e.to_string()))?;

    // Assemble: [salt][nonce][ciphertext+tag]
    let mut output = Vec::with_capacity(SALT_SIZE + NONCE_SIZE + ciphertext.len());
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(B64.encode(&output))
}

/// Decrypt a Base64-encoded ciphertext string using AES-256-GCM with PBKDF2.
///
/// Supports real mRemoteNG 128-bit nonces and legacy sortOfRemoteNG 96-bit
/// empty-AAD exports written before the compatibility fix.
pub fn decrypt(ciphertext_b64: &str, password: &str, iterations: u32) -> MremotengResult<String> {
    let password = effective_password(password);
    if password.len() < MIN_PASSWORD_LEN {
        return Err(MremotengError::Decryption(format!(
            "Password must be at least {} character(s)",
            MIN_PASSWORD_LEN
        )));
    }

    if ciphertext_b64.is_empty() {
        return Ok(String::new());
    }

    let data = B64
        .decode(ciphertext_b64)
        .map_err(|e| MremotengError::Decryption(format!("Invalid Base64: {}", e)))?;

    decrypt_with_nonce_size(&data, password, iterations, NONCE_SIZE, true)
        .or_else(|_| decrypt_with_nonce_size(&data, password, iterations, NONCE_SIZE, false))
        .or_else(|_| {
            decrypt_with_nonce_size(&data, password, iterations, AES_GCM_NONCE_SIZE, false)
        })
}

fn decrypt_with_nonce_size(
    data: &[u8],
    password: &str,
    iterations: u32,
    nonce_size: usize,
    salt_as_aad: bool,
) -> MremotengResult<String> {
    let min_len = SALT_SIZE + nonce_size + 16; // 16 = GCM tag
    if data.len() < min_len {
        return Err(MremotengError::Decryption(
            "Encrypted data too short".into(),
        ));
    }

    let salt = &data[..SALT_SIZE];
    let nonce_bytes = &data[SALT_SIZE..SALT_SIZE + nonce_size];
    let ciphertext = &data[SALT_SIZE + nonce_size..];

    let key = derive_key(password, salt, iterations);

    let plaintext_bytes = if nonce_size == NONCE_SIZE {
        let cipher = Aes256Gcm16::new_from_slice(&key)
            .map_err(|e| MremotengError::Decryption(e.to_string()))?;
        let nonce = Nonce::<U16>::from_slice(nonce_bytes);
        cipher.decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: if salt_as_aad { salt } else { b"" },
            },
        )
    } else {
        let cipher = aes_gcm::Aes256Gcm::new_from_slice(&key)
            .map_err(|e| MremotengError::Decryption(e.to_string()))?;
        let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);
        cipher.decrypt(nonce, ciphertext)
    }
    .map_err(|_| {
        MremotengError::Decryption("Decryption failed - wrong password or corrupted data".into())
    })?;

    String::from_utf8(plaintext_bytes)
        .map_err(|e| MremotengError::Decryption(format!("Invalid UTF-8: {}", e)))
}

/// Decrypt a password field. If the password is empty or decryption fails
/// with an empty password, returns the value as-is (may be unencrypted).
pub fn decrypt_password(
    encrypted_password: &str,
    master_password: &str,
    iterations: u32,
) -> String {
    if encrypted_password.is_empty() {
        return String::new();
    }

    match decrypt(encrypted_password, master_password, iterations) {
        Ok(p) => p,
        Err(_) => encrypted_password.to_string(),
    }
}

/// Encrypt a password field for storage.
pub fn encrypt_password(
    plaintext_password: &str,
    master_password: &str,
    iterations: u32,
) -> MremotengResult<String> {
    if plaintext_password.is_empty() {
        return Ok(String::new());
    }

    encrypt(plaintext_password, master_password, iterations)
}

pub fn encrypt_protected_sentinel(
    master_password: &str,
    iterations: u32,
) -> MremotengResult<String> {
    let plaintext = if effective_password(master_password) == DEFAULT_MASTER_PASSWORD {
        PROTECTED_PLAINTEXT_NO_PASSWORD
    } else {
        PROTECTED_PLAINTEXT_PASSWORD
    };
    encrypt(plaintext, master_password, iterations)
}

pub fn verify_protected_sentinel(
    protected: &str,
    master_password: &str,
    iterations: u32,
) -> MremotengResult<bool> {
    if protected.is_empty() {
        return Ok(true);
    }
    let plaintext = decrypt(protected, master_password, iterations)?;
    Ok(matches!(
        plaintext.as_str(),
        PROTECTED_PLAINTEXT_NO_PASSWORD | PROTECTED_PLAINTEXT_PASSWORD
    ))
}

/// Build encryption info from file metadata.
pub fn build_encryption_info(
    protected: &str,
    engine: BlockCipherEngine,
    mode: BlockCipherMode,
    kdf_iterations: u32,
    full_file_encryption: bool,
) -> EncryptionInfo {
    let is_encrypted = !protected.is_empty();
    EncryptionInfo {
        is_encrypted,
        full_file_encryption,
        encryption_engine: engine,
        encryption_mode: mode,
        kdf_iterations,
        requires_password: is_encrypted && full_file_encryption,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let password = "TestPassword123!";
        let plaintext = "Hello, mRemoteNG!";
        let iterations = 1000;

        let encrypted = encrypt(plaintext, password, iterations).unwrap();
        assert!(!encrypted.is_empty());
        assert_ne!(encrypted, plaintext);

        let decrypted = decrypt(&encrypted, password, iterations).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_empty_plaintext() {
        let result = encrypt("", "password", 1000).unwrap();
        assert_eq!(result, "");

        let result = decrypt("", "password", 1000).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_wrong_password() {
        let encrypted = encrypt("secret", "correct", 1000).unwrap();
        let result = decrypt(&encrypted, "wrong", 1000);
        assert!(result.is_err());
    }

    #[test]
    fn test_password_field_helpers() {
        let encrypted = encrypt_password("mypass", "master", 1000).unwrap();
        let decrypted = decrypt_password(&encrypted, "master", 1000);
        assert_eq!(decrypted, "mypass");
    }

    #[test]
    fn test_default_password() {
        let encrypted = encrypt_password("secret", "", 1000).unwrap();
        let decrypted = decrypt_password(&encrypted, "", 1000);
        assert_eq!(decrypted, "secret");
    }

    #[test]
    fn decrypts_real_mremoteng_default_master_protected_sample() {
        let protected = "0RlaSZ8kZayRzE3yO2agQWIXUV5EW3ZWDJ3Pm2SV4yKJaZyYWSxrFgjtbM8RcO1ebkkTuRerKXmfdUmM7oVFZ1M/";

        let decrypted = decrypt(protected, "mR3m", 1000).unwrap();

        assert_eq!(decrypted, PROTECTED_PLAINTEXT_NO_PASSWORD);
    }

    #[test]
    fn decrypts_fixed_salt_aad_vector_with_16_byte_nonce() {
        let protected = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh+uz8d4sTNaXr0HOVjlPwIR242YEwJN5jdxDvqLIqzPGtjj";

        let decrypted = decrypt(protected, "", 1000).unwrap();

        assert_eq!(decrypted, PROTECTED_PLAINTEXT_NO_PASSWORD);
    }

    #[test]
    fn decrypts_legacy_empty_aad_vector() {
        let protected = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9gjEssCXScU591iI4+iNzk/8FY/ftUkt6DfQzNT9a56IWX";

        let decrypted = decrypt(protected, "", 1000).unwrap();

        assert_eq!(decrypted, PROTECTED_PLAINTEXT_NO_PASSWORD);
    }

    #[test]
    fn uses_pkcs5_low_byte_password_conversion() {
        let protected =
            "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr+ILHCWiT4evIaHlzgqtsozBl0fg48rsmYQL7oc";

        let decrypted = decrypt(protected, "passwört", 1000).unwrap();

        assert_eq!(decrypted, "latin-secret");
    }
}
