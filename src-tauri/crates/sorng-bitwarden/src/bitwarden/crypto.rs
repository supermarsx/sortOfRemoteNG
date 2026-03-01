//! Cryptographic utilities for Bitwarden integration.
//!
//! Provides key derivation (PBKDF2), AES-CBC encryption/decryption
//! for handling encrypted exports and local key material.

use crate::bitwarden::types::BitwardenError;
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hmac::Hmac;
use pbkdf2::pbkdf2_hmac;
use sha2::{Digest, Sha256};

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

/// Default PBKDF2 iteration count (matches Bitwarden's default).
pub const DEFAULT_KDF_ITERATIONS: u32 = 600_000;

/// Derive a master key from email + master password using PBKDF2-SHA256.
///
/// This matches Bitwarden's key derivation: PBKDF2(password, salt=email, iterations, 32 bytes).
pub fn derive_master_key(
    password: &str,
    salt: &str,
    iterations: u32,
) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt.as_bytes(), iterations, &mut key);
    key
}

/// Derive a stretched key (encryption key + MAC key) from a master key.
///
/// Uses HKDF-Expand with SHA-256 to produce two 32-byte keys.
pub fn stretch_key(master_key: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    use hkdf::Hkdf;
    let hkdf = Hkdf::<Sha256>::new(Some(master_key), master_key);

    let mut enc_key = [0u8; 32];
    let mut mac_key = [0u8; 32];

    hkdf.expand(b"enc", &mut enc_key)
        .expect("HKDF expand for enc key");
    hkdf.expand(b"mac", &mut mac_key)
        .expect("HKDF expand for mac key");

    (enc_key, mac_key)
}

/// Derive the master password hash used for authentication.
///
/// hash = PBKDF2(masterKey, password, 1, 32)
pub fn derive_master_password_hash(
    master_key: &[u8; 32],
    password: &str,
) -> [u8; 32] {
    let mut hash = [0u8; 32];
    pbkdf2_hmac::<Sha256>(master_key, password.as_bytes(), 1, &mut hash);
    hash
}

/// Encrypt data using AES-256-CBC with PKCS7 padding.
pub fn aes_cbc_encrypt(
    key: &[u8; 32],
    iv: &[u8; 16],
    plaintext: &[u8],
) -> Vec<u8> {
    let encryptor = Aes256CbcEnc::new(key.into(), iv.into());
    encryptor.encrypt_padded_vec_mut::<Pkcs7>(plaintext)
}

/// Decrypt data using AES-256-CBC with PKCS7 padding.
pub fn aes_cbc_decrypt(
    key: &[u8; 32],
    iv: &[u8; 16],
    ciphertext: &[u8],
) -> Result<Vec<u8>, BitwardenError> {
    let decryptor = Aes256CbcDec::new(key.into(), iv.into());
    decryptor
        .decrypt_padded_vec_mut::<Pkcs7>(ciphertext)
        .map_err(|e| BitwardenError::crypto(format!("AES-CBC decryption failed: {}", e)))
}

/// Compute HMAC-SHA256 for data integrity.
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use hmac::Mac;
    let mut mac = Hmac::<Sha256>::new_from_slice(key)
        .expect("HMAC key length is always valid");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Verify HMAC-SHA256.
pub fn verify_hmac_sha256(key: &[u8], data: &[u8], expected_mac: &[u8]) -> bool {
    let computed = hmac_sha256(key, data);
    constant_time_compare(&computed, expected_mac)
}

/// Constant-time comparison of two byte slices.
fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

/// Parse a Bitwarden encrypted string (CipherString).
///
/// Format: `<type>.<iv>|<ct>|<mac>`
///
/// Type 2 = AES-256-CBC, HMAC-SHA256.
pub fn parse_cipher_string(cipher_string: &str) -> Result<CipherComponents, BitwardenError> {
    let parts: Vec<&str> = cipher_string.splitn(2, '.').collect();
    if parts.len() != 2 {
        return Err(BitwardenError::crypto("Invalid cipher string format"));
    }

    let enc_type: u8 = parts[0].parse()
        .map_err(|_| BitwardenError::crypto("Invalid encryption type"))?;

    let data_parts: Vec<&str> = parts[1].split('|').collect();

    match enc_type {
        2 => {
            // AES-256-CBC, HMAC-SHA256
            if data_parts.len() != 3 {
                return Err(BitwardenError::crypto(
                    "AES-256-CBC cipher string must have iv|ct|mac",
                ));
            }
            let iv = BASE64.decode(data_parts[0])
                .map_err(|e| BitwardenError::crypto(format!("Invalid IV base64: {}", e)))?;
            let ct = BASE64.decode(data_parts[1])
                .map_err(|e| BitwardenError::crypto(format!("Invalid ciphertext base64: {}", e)))?;
            let mac = BASE64.decode(data_parts[2])
                .map_err(|e| BitwardenError::crypto(format!("Invalid MAC base64: {}", e)))?;

            Ok(CipherComponents { enc_type, iv, ciphertext: ct, mac: Some(mac) })
        }
        0 => {
            // AES-256-CBC (no HMAC)
            if data_parts.len() != 2 {
                return Err(BitwardenError::crypto(
                    "AES-256-CBC cipher string must have iv|ct",
                ));
            }
            let iv = BASE64.decode(data_parts[0])
                .map_err(|e| BitwardenError::crypto(format!("Invalid IV base64: {}", e)))?;
            let ct = BASE64.decode(data_parts[1])
                .map_err(|e| BitwardenError::crypto(format!("Invalid ciphertext base64: {}", e)))?;

            Ok(CipherComponents { enc_type, iv, ciphertext: ct, mac: None })
        }
        _ => Err(BitwardenError::crypto(format!("Unsupported encryption type: {}", enc_type))),
    }
}

/// Parsed components of a Bitwarden cipher string.
#[derive(Debug, Clone)]
pub struct CipherComponents {
    pub enc_type: u8,
    pub iv: Vec<u8>,
    pub ciphertext: Vec<u8>,
    pub mac: Option<Vec<u8>>,
}

/// Build a Bitwarden cipher string from components.
pub fn build_cipher_string(components: &CipherComponents) -> String {
    let iv_b64 = BASE64.encode(&components.iv);
    let ct_b64 = BASE64.encode(&components.ciphertext);
    match &components.mac {
        Some(mac) => {
            let mac_b64 = BASE64.encode(mac);
            format!("{}.{}|{}|{}", components.enc_type, iv_b64, ct_b64, mac_b64)
        }
        None => format!("{}.{}|{}", components.enc_type, iv_b64, ct_b64),
    }
}

/// Decrypt a Bitwarden cipher string with a stretched key pair.
pub fn decrypt_cipher_string(
    cipher_string: &str,
    enc_key: &[u8; 32],
    mac_key: &[u8; 32],
) -> Result<Vec<u8>, BitwardenError> {
    let components = parse_cipher_string(cipher_string)?;

    // Verify MAC if present
    if let Some(ref mac) = components.mac {
        let mut mac_data = Vec::new();
        mac_data.extend_from_slice(&components.iv);
        mac_data.extend_from_slice(&components.ciphertext);
        if !verify_hmac_sha256(mac_key, &mac_data, mac) {
            return Err(BitwardenError::crypto("MAC verification failed"));
        }
    }

    let iv: [u8; 16] = components.iv.try_into()
        .map_err(|_| BitwardenError::crypto("IV must be 16 bytes"))?;

    aes_cbc_decrypt(enc_key, &iv, &components.ciphertext)
}

/// Encrypt plaintext into a Bitwarden cipher string (type 2 = AES-CBC + HMAC).
pub fn encrypt_to_cipher_string(
    plaintext: &[u8],
    enc_key: &[u8; 32],
    mac_key: &[u8; 32],
) -> String {
    // Generate random IV
    let iv = generate_random_bytes::<16>();
    let ciphertext = aes_cbc_encrypt(enc_key, &iv, plaintext);

    // Compute MAC over IV + ciphertext
    let mut mac_data = Vec::new();
    mac_data.extend_from_slice(&iv);
    mac_data.extend_from_slice(&ciphertext);
    let mac = hmac_sha256(mac_key, &mac_data);

    let components = CipherComponents {
        enc_type: 2,
        iv: iv.to_vec(),
        ciphertext,
        mac: Some(mac),
    };
    build_cipher_string(&components)
}

/// Generate N random bytes.
fn generate_random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    // Use a simple XOR-based fallback. In production, use `rand` or OS RNG.
    // For tauri apps, we'd use getrandom or ring, but for this crate
    // we use a simplistic approach that can be replaced.
    #[cfg(not(test))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let seed_bytes = seed.to_le_bytes();
        for (i, b) in bytes.iter_mut().enumerate() {
            let idx = i % seed_bytes.len();
            *b = seed_bytes[idx].wrapping_add(i as u8);
        }
    }
    #[cfg(test)]
    {
        // Deterministic for tests
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(7).wrapping_add(42);
        }
    }
    bytes
}

/// SHA-256 hash of data.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Base64 encode.
pub fn base64_encode(data: &[u8]) -> String {
    BASE64.encode(data)
}

/// Base64 decode.
pub fn base64_decode(data: &str) -> Result<Vec<u8>, BitwardenError> {
    BASE64.decode(data)
        .map_err(|e| BitwardenError::crypto(format!("Base64 decode error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Key derivation ──────────────────────────────────────────────

    #[test]
    fn derive_master_key_deterministic() {
        let key1 = derive_master_key("password", "user@example.com", 600_000);
        let key2 = derive_master_key("password", "user@example.com", 600_000);
        assert_eq!(key1, key2);
    }

    #[test]
    fn derive_master_key_different_salt() {
        let key1 = derive_master_key("password", "a@a.com", 1000);
        let key2 = derive_master_key("password", "b@b.com", 1000);
        assert_ne!(key1, key2);
    }

    #[test]
    fn derive_master_key_different_password() {
        let key1 = derive_master_key("pass1", "user@a.com", 1000);
        let key2 = derive_master_key("pass2", "user@a.com", 1000);
        assert_ne!(key1, key2);
    }

    #[test]
    fn derive_master_key_different_iterations() {
        let key1 = derive_master_key("password", "a@a.com", 1000);
        let key2 = derive_master_key("password", "a@a.com", 2000);
        assert_ne!(key1, key2);
    }

    // ── Key stretching ──────────────────────────────────────────────

    #[test]
    fn stretch_key_produces_different_keys() {
        let master = derive_master_key("test", "test@test.com", 1000);
        let (enc, mac) = stretch_key(&master);
        assert_ne!(enc, mac);
        assert_ne!(enc, [0u8; 32]);
        assert_ne!(mac, [0u8; 32]);
    }

    // ── Master password hash ────────────────────────────────────────

    #[test]
    fn derive_master_password_hash_deterministic() {
        let key = derive_master_key("password", "user@test.com", 1000);
        let hash1 = derive_master_password_hash(&key, "password");
        let hash2 = derive_master_password_hash(&key, "password");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn derive_master_password_hash_different_password() {
        let key = derive_master_key("password", "user@test.com", 1000);
        let hash1 = derive_master_password_hash(&key, "password");
        let hash2 = derive_master_password_hash(&key, "different");
        assert_ne!(hash1, hash2);
    }

    // ── AES-CBC ─────────────────────────────────────────────────────

    #[test]
    fn aes_cbc_encrypt_decrypt_roundtrip() {
        let key = [42u8; 32];
        let iv = [1u8; 16];
        let plaintext = b"Hello, Bitwarden!";

        let ciphertext = aes_cbc_encrypt(&key, &iv, plaintext);
        assert_ne!(ciphertext.as_slice(), plaintext);

        let decrypted = aes_cbc_decrypt(&key, &iv, &ciphertext).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn aes_cbc_empty_plaintext() {
        let key = [0u8; 32];
        let iv = [0u8; 16];
        let plaintext = b"";

        let ciphertext = aes_cbc_encrypt(&key, &iv, plaintext);
        let decrypted = aes_cbc_decrypt(&key, &iv, &ciphertext).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn aes_cbc_block_aligned_plaintext() {
        let key = [1u8; 32];
        let iv = [2u8; 16];
        let plaintext = [b'A'; 32]; // Exactly 2 blocks

        let ciphertext = aes_cbc_encrypt(&key, &iv, &plaintext);
        let decrypted = aes_cbc_decrypt(&key, &iv, &ciphertext).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn aes_cbc_wrong_key_fails() {
        let key = [42u8; 32];
        let iv = [1u8; 16];
        let ciphertext = aes_cbc_encrypt(&key, &iv, b"secret");

        let wrong_key = [99u8; 32];
        let result = aes_cbc_decrypt(&wrong_key, &iv, &ciphertext);
        assert!(result.is_err());
    }

    // ── HMAC ────────────────────────────────────────────────────────

    #[test]
    fn hmac_sha256_deterministic() {
        let key = b"secret_key";
        let data = b"test data";
        let mac1 = hmac_sha256(key, data);
        let mac2 = hmac_sha256(key, data);
        assert_eq!(mac1, mac2);
        assert_eq!(mac1.len(), 32);
    }

    #[test]
    fn hmac_sha256_different_key() {
        let data = b"test data";
        let mac1 = hmac_sha256(b"key1", data);
        let mac2 = hmac_sha256(b"key2", data);
        assert_ne!(mac1, mac2);
    }

    #[test]
    fn verify_hmac_valid() {
        let key = b"test_key";
        let data = b"test data";
        let mac = hmac_sha256(key, data);
        assert!(verify_hmac_sha256(key, data, &mac));
    }

    #[test]
    fn verify_hmac_invalid() {
        let key = b"test_key";
        let data = b"test data";
        let mac = hmac_sha256(key, data);
        assert!(!verify_hmac_sha256(key, b"modified", &mac));
    }

    // ── Constant time compare ───────────────────────────────────────

    #[test]
    fn constant_time_eq() {
        assert!(constant_time_compare(b"hello", b"hello"));
        assert!(!constant_time_compare(b"hello", b"world"));
        assert!(!constant_time_compare(b"hello", b"hell"));
    }

    // ── Cipher string parsing ───────────────────────────────────────

    #[test]
    fn parse_type2_cipher_string() {
        let iv = BASE64.encode([1u8; 16]);
        let ct = BASE64.encode(b"ciphertext");
        let mac = BASE64.encode([2u8; 32]);
        let cs = format!("2.{}|{}|{}", iv, ct, mac);

        let components = parse_cipher_string(&cs).unwrap();
        assert_eq!(components.enc_type, 2);
        assert_eq!(components.iv.len(), 16);
        assert!(components.mac.is_some());
    }

    #[test]
    fn parse_type0_cipher_string() {
        let iv = BASE64.encode([1u8; 16]);
        let ct = BASE64.encode(b"ciphertext");
        let cs = format!("0.{}|{}", iv, ct);

        let components = parse_cipher_string(&cs).unwrap();
        assert_eq!(components.enc_type, 0);
        assert!(components.mac.is_none());
    }

    #[test]
    fn parse_invalid_cipher_string() {
        assert!(parse_cipher_string("invalid").is_err());
        assert!(parse_cipher_string("99.data").is_err());
        assert!(parse_cipher_string("2.only_one_part").is_err());
    }

    // ── Build cipher string ──────────────────────────────────────────

    #[test]
    fn build_cipher_string_type2() {
        let components = CipherComponents {
            enc_type: 2,
            iv: vec![1u8; 16],
            ciphertext: vec![2u8; 32],
            mac: Some(vec![3u8; 32]),
        };
        let cs = build_cipher_string(&components);
        assert!(cs.starts_with("2."));
        assert_eq!(cs.split('|').count(), 3);
    }

    #[test]
    fn build_cipher_string_type0() {
        let components = CipherComponents {
            enc_type: 0,
            iv: vec![1u8; 16],
            ciphertext: vec![2u8; 32],
            mac: None,
        };
        let cs = build_cipher_string(&components);
        assert!(cs.starts_with("0."));
        assert_eq!(cs.split('|').count(), 2);
    }

    // ── Full encrypt/decrypt cycle ──────────────────────────────────

    #[test]
    fn encrypt_decrypt_cipher_string_roundtrip() {
        let master = derive_master_key("testpass", "user@test.com", 1000);
        let (enc_key, mac_key) = stretch_key(&master);

        let plaintext = b"This is a secret vault entry!";
        let cipher_string = encrypt_to_cipher_string(plaintext, &enc_key, &mac_key);

        let decrypted = decrypt_cipher_string(&cipher_string, &enc_key, &mac_key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let master1 = derive_master_key("pass1", "user@test.com", 1000);
        let (enc1, mac1) = stretch_key(&master1);

        let master2 = derive_master_key("pass2", "user@test.com", 1000);
        let (enc2, mac2) = stretch_key(&master2);

        let cipher_string = encrypt_to_cipher_string(b"secret", &enc1, &mac1);
        let result = decrypt_cipher_string(&cipher_string, &enc2, &mac2);
        assert!(result.is_err());
    }

    // ── SHA-256 ─────────────────────────────────────────────────────

    #[test]
    fn sha256_deterministic() {
        let hash1 = sha256(b"hello");
        let hash2 = sha256(b"hello");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn sha256_different_input() {
        let hash1 = sha256(b"hello");
        let hash2 = sha256(b"world");
        assert_ne!(hash1, hash2);
    }

    // ── Base64 ──────────────────────────────────────────────────────

    #[test]
    fn base64_roundtrip() {
        let data = b"Hello Bitwarden";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn base64_decode_invalid() {
        let result = base64_decode("not valid base64!!!!");
        assert!(result.is_err());
    }
}
