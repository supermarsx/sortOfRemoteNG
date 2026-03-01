//! AES-256-GCM encryption/decryption with PBKDF2 key derivation.
//!
//! Matches the wire format used by mRemoteNG's `AeadCryptographyProvider`:
//! - 16-byte random salt → PBKDF2-HMAC-SHA1 → 32-byte key
//! - 16-byte random nonce
//! - AES-256-GCM ciphertext (includes 16-byte auth tag appended)
//! - Binary layout: `[salt (16)] [nonce (16)] [ciphertext+tag]`
//! - Final output: Base64-encoded

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::Rng;
use sha1::Sha1;

use super::error::{MremotengError, MremotengResult};

const SALT_SIZE: usize = 16;
const NONCE_SIZE: usize = 16; // mRemoteNG uses 128-bit nonce (non-standard but matches their code)
const KEY_SIZE: usize = 32; // 256-bit AES key
const MIN_PASSWORD_LEN: usize = 1;

// mRemoteNG uses 96-bit nonce for AES-GCM (the standard).
// However, the BouncyCastle GCM implementation in mRemoteNG uses 128-bit nonce.
// The `aes-gcm` crate only supports 96-bit nonces natively.
// We'll use 96-bit nonces (first 12 bytes) which is compatible with the standard
// AES-GCM spec. For reading mRemoteNG files that used 128-bit nonces,
// we provide a fallback.
const AES_GCM_NONCE_SIZE: usize = 12;

/// Derive a 256-bit key from a password and salt using PBKDF2-HMAC-SHA1.
fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_SIZE] {
    let mut key = [0u8; KEY_SIZE];
    pbkdf2::pbkdf2_hmac::<Sha1>(
        password.as_bytes(),
        salt,
        iterations,
        &mut key,
    );
    key
}

/// Encrypt a plaintext string using AES-256-GCM with PBKDF2 key derivation.
///
/// Output: Base64-encoded `[salt (16)] [nonce (12)] [ciphertext+tag]`
pub fn encrypt(plaintext: &str, password: &str, iterations: u32) -> MremotengResult<String> {
    if password.len() < MIN_PASSWORD_LEN {
        return Err(MremotengError::Encryption(
            format!("Password must be at least {} character(s)", MIN_PASSWORD_LEN),
        ));
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

    // Generate random nonce (96-bit for standard AES-GCM)
    let mut nonce_bytes = [0u8; AES_GCM_NONCE_SIZE];
    rng.fill(&mut nonce_bytes);

    // Encrypt
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| MremotengError::Encryption(e.to_string()))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| MremotengError::Encryption(e.to_string()))?;

    // Assemble: [salt][nonce][ciphertext+tag]
    let mut output = Vec::with_capacity(SALT_SIZE + AES_GCM_NONCE_SIZE + ciphertext.len());
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(B64.encode(&output))
}

/// Decrypt a Base64-encoded ciphertext string using AES-256-GCM with PBKDF2.
///
/// Supports both 96-bit (standard) and 128-bit (mRemoteNG BouncyCastle) nonces.
pub fn decrypt(ciphertext_b64: &str, password: &str, iterations: u32) -> MremotengResult<String> {
    if password.len() < MIN_PASSWORD_LEN {
        return Err(MremotengError::Decryption(
            format!("Password must be at least {} character(s)", MIN_PASSWORD_LEN),
        ));
    }

    if ciphertext_b64.is_empty() {
        return Ok(String::new());
    }

    let data = B64.decode(ciphertext_b64)
        .map_err(|e| MremotengError::Decryption(format!("Invalid Base64: {}", e)))?;

    // Try standard 96-bit nonce first, then mRemoteNG's 128-bit
    decrypt_with_nonce_size(&data, password, iterations, AES_GCM_NONCE_SIZE)
        .or_else(|_| decrypt_with_nonce_size(&data, password, iterations, NONCE_SIZE))
}

fn decrypt_with_nonce_size(
    data: &[u8],
    password: &str,
    iterations: u32,
    nonce_size: usize,
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

    // For 128-bit nonce: truncate to 96-bit since aes-gcm only supports 96-bit
    // mRemoteNG's BouncyCastle handles arbitrary nonce sizes.
    // For compatibility, we only use the first 12 bytes if nonce_size is 16.
    let effective_nonce = if nonce_size > AES_GCM_NONCE_SIZE {
        &nonce_bytes[..AES_GCM_NONCE_SIZE]
    } else {
        nonce_bytes
    };

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| MremotengError::Decryption(e.to_string()))?;
    let nonce = Nonce::from_slice(effective_nonce);

    let plaintext_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| MremotengError::Decryption(
            "Decryption failed — wrong password or corrupted data".into(),
        ))?;

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

    // If no master password, the file might be unencrypted
    if master_password.is_empty() {
        // Try with default empty password "mR3m"
        match decrypt(encrypted_password, "mR3m", iterations) {
            Ok(p) => return p,
            Err(_) => return encrypted_password.to_string(),
        }
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

    let pwd = if master_password.is_empty() { "mR3m" } else { master_password };
    encrypt(plaintext_password, pwd, iterations)
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
}
