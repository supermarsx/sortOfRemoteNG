use chacha20poly1305::aead::generic_array::GenericArray;
use chacha20poly1305::aead::Aead;
use chacha20poly1305::{ChaCha20Poly1305, KeyInit};
use chrono::Utc;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::PortKnockError;
use crate::types::*;

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Cryptographic operations for port knocking.
///
/// Provides encryption, signing, key derivation, and replay protection.
/// Uses portable fallback implementations (XOR cipher, FNV-based HMAC) —
/// production deployments should use `ring` or execute the generated
/// OpenSSL command strings on the remote host.
pub struct KnockCrypto;

impl Default for KnockCrypto {
    fn default() -> Self {
        Self::new()
    }
}

impl KnockCrypto {
    pub fn new() -> Self {
        Self
    }

    // ── Encryption / Decryption ────────────────────────────────────

    /// Encrypt knock payload data.
    ///
    /// Generates a nonce, XOR-stretches the key to data length, and
    /// stores algorithm + nonce + ciphertext + timestamp.
    pub fn encrypt_payload(
        data: &[u8],
        key: &[u8],
        algorithm: KnockEncryption,
    ) -> Result<EncryptedKnockPayload, PortKnockError> {
        if key.is_empty() {
            return Err(PortKnockError::EncryptionError(
                "key must not be empty".into(),
            ));
        }

        if algorithm == KnockEncryption::None {
            return Ok(EncryptedKnockPayload {
                algorithm,
                ciphertext: data.to_vec(),
                nonce: Vec::new(),
                hmac: None,
                hmac_algorithm: None,
                key_derivation: KeyDerivation::Raw,
                timestamp: Utc::now(),
            });
        }

        // Derive a 256-bit key using SHA-256
        let derived_key = Sha256::digest(key);
        let cipher = ChaCha20Poly1305::new(GenericArray::from_slice(&derived_key));

        // Generate random 96-bit nonce
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = GenericArray::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data).map_err(|e| {
            PortKnockError::EncryptionError(format!("ChaCha20Poly1305 encryption failed: {}", e))
        })?;

        Ok(EncryptedKnockPayload {
            algorithm,
            ciphertext,
            nonce: nonce_bytes.to_vec(),
            hmac: None,
            hmac_algorithm: None,
            key_derivation: KeyDerivation::Raw,
            timestamp: Utc::now(),
        })
    }

    /// Reverse encryption produced by [`encrypt_payload`].
    pub fn decrypt_payload(
        payload: &EncryptedKnockPayload,
        key: &[u8],
    ) -> Result<Vec<u8>, PortKnockError> {
        if key.is_empty() {
            return Err(PortKnockError::DecryptionError(
                "key must not be empty".into(),
            ));
        }

        if payload.algorithm == KnockEncryption::None {
            return Ok(payload.ciphertext.clone());
        }

        if payload.nonce.len() != 12 {
            return Err(PortKnockError::DecryptionError(
                "Invalid nonce length for ChaCha20Poly1305 (expected 12 bytes)".into(),
            ));
        }

        let derived_key = Sha256::digest(key);
        let cipher = ChaCha20Poly1305::new(GenericArray::from_slice(&derived_key));
        let nonce = GenericArray::from_slice(&payload.nonce);

        cipher
            .decrypt(nonce, payload.ciphertext.as_ref())
            .map_err(|e| {
                PortKnockError::DecryptionError(format!(
                    "ChaCha20Poly1305 decryption failed: {}",
                    e
                ))
            })
    }

    // ── HMAC ───────────────────────────────────────────────────────

    /// Compute an HMAC digest.
    ///
    /// Uses `H(key XOR opad || H(key XOR ipad || message))` with a
    /// FNV-1a–based hash. The output length varies by algorithm (32/48/64
    /// bytes for SHA-256/384/512 equivalents). Production code should use
    /// the `ring` or `hmac` crate.
    pub fn compute_hmac(data: &[u8], key: &[u8], algorithm: HmacAlgorithm) -> Vec<u8> {
        let block_size: usize = 64;
        let digest_len = match algorithm {
            HmacAlgorithm::Sha256 => 32,
            HmacAlgorithm::Sha384 => 48,
            HmacAlgorithm::Sha512 => 64,
        };

        // Normalise key to block_size
        let norm_key = if key.len() > block_size {
            let h = fnv_hash(key, digest_len);
            let mut k = h;
            k.resize(block_size, 0);
            k
        } else {
            let mut k = key.to_vec();
            k.resize(block_size, 0);
            k
        };

        let ipad: Vec<u8> = norm_key.iter().map(|b| b ^ 0x36).collect();
        let opad: Vec<u8> = norm_key.iter().map(|b| b ^ 0x5c).collect();

        let mut inner = ipad;
        inner.extend_from_slice(data);
        let inner_hash = fnv_hash(&inner, digest_len);

        let mut outer = opad;
        outer.extend_from_slice(&inner_hash);
        fnv_hash(&outer, digest_len)
    }

    /// Constant-time HMAC verification.
    pub fn verify_hmac(data: &[u8], key: &[u8], expected: &[u8], algorithm: HmacAlgorithm) -> bool {
        let computed = Self::compute_hmac(data, key, algorithm);
        Self::constant_time_compare(&computed, expected)
    }

    // ── Key Derivation ─────────────────────────────────────────────

    /// Derive a key from a password and salt.
    pub fn derive_key(
        password: &[u8],
        salt: &[u8],
        params: &KeyDerivation,
    ) -> Result<Vec<u8>, PortKnockError> {
        match params {
            KeyDerivation::Pbkdf2 {
                iterations,
                salt_len: _,
            } => {
                let mut dk = password.to_vec();
                dk.extend_from_slice(salt);
                for _ in 0..*iterations {
                    dk = fnv_hash(&dk, 32);
                }
                Ok(dk)
            }
            KeyDerivation::Argon2 {
                memory_kb,
                iterations,
                parallelism: _,
            } => {
                // Simplified: mix password+salt then iterate, mixing in
                // memory_kb to influence the output.
                let mut state = Vec::with_capacity(password.len() + salt.len() + 4);
                state.extend_from_slice(password);
                state.extend_from_slice(salt);
                state.extend_from_slice(&memory_kb.to_le_bytes());
                for _ in 0..*iterations {
                    state = fnv_hash(&state, 32);
                    // Fold the memory parameter back in each round
                    for (i, b) in memory_kb.to_le_bytes().iter().enumerate() {
                        if i < state.len() {
                            state[i] ^= b;
                        }
                    }
                }
                Ok(state)
            }
            KeyDerivation::Raw => Ok(password.to_vec()),
        }
    }

    // ── Random Generation ──────────────────────────────────────────

    /// Generate a nonce using timestamp + atomic counter.
    pub fn generate_nonce(size: usize) -> Vec<u8> {
        if size == 0 {
            return Vec::new();
        }
        let ts = Utc::now().timestamp_nanos_opt().unwrap_or(0) as u64;
        let counter = NONCE_COUNTER.fetch_add(1, Ordering::Relaxed);

        let mut seed = Vec::with_capacity(16);
        seed.extend_from_slice(&ts.to_le_bytes());
        seed.extend_from_slice(&counter.to_le_bytes());

        let mut out = Vec::with_capacity(size);
        let mut round: u64 = 0;
        while out.len() < size {
            let mut block = seed.clone();
            block.extend_from_slice(&round.to_le_bytes());
            let h = fnv_hash(&block, 16);
            for &b in &h {
                if out.len() >= size {
                    break;
                }
                out.push(b);
            }
            round += 1;
        }
        out
    }

    /// Generate random key bytes.
    pub fn generate_key(length: usize) -> Vec<u8> {
        Self::generate_nonce(length)
    }

    /// Generate random salt bytes.
    pub fn generate_salt(length: usize) -> Vec<u8> {
        // Include an extra counter bump so salt differs from a key
        // generated immediately before.
        NONCE_COUNTER.fetch_add(1, Ordering::Relaxed);
        Self::generate_nonce(length)
    }

    // ── Replay Protection ──────────────────────────────────────────

    /// Check whether a nonce has been seen within the replay window.
    /// Returns `true` if the nonce is **fresh** (NOT a replay).
    pub fn check_replay(nonce: &str, window: &mut ReplayWindow) -> bool {
        if window.seen_nonces.contains(&nonce.to_string()) {
            return false;
        }

        window.seen_nonces.push(nonce.to_string());

        // Trim the window to window_size
        let max = window.window_size as usize;
        if window.seen_nonces.len() > max {
            let excess = window.seen_nonces.len() - max;
            window.seen_nonces.drain(..excess);
        }

        window.last_timestamp = Utc::now();
        true
    }

    // ── OpenSSL Command Builders ───────────────────────────────────

    /// Build an `openssl enc` command for remote encryption.
    pub fn build_openssl_encrypt_command(
        data_hex: &str,
        key_hex: &str,
        algorithm: KnockEncryption,
    ) -> String {
        let cipher = openssl_cipher_name(algorithm);
        let iv_hex = hex_encode(&Self::generate_nonce(16));
        format!(
            "echo -n '{data_hex}' | xxd -r -p | openssl enc -{cipher} -K {key_hex} -iv {iv_hex} -nopad | xxd -p"
        )
    }

    /// Build an `openssl enc -d` command for remote decryption.
    pub fn build_openssl_decrypt_command(
        ciphertext_hex: &str,
        key_hex: &str,
        algorithm: KnockEncryption,
    ) -> String {
        let cipher = openssl_cipher_name(algorithm);
        format!(
            "echo -n '{ciphertext_hex}' | xxd -r -p | openssl enc -d -{cipher} -K {key_hex} -nopad | xxd -p"
        )
    }

    /// Build an `openssl dgst` command for remote HMAC computation.
    pub fn build_hmac_command(data_hex: &str, key_hex: &str, algorithm: HmacAlgorithm) -> String {
        let dgst = openssl_digest_name(algorithm);
        format!(
            "echo -n '{data_hex}' | xxd -r -p | openssl dgst -{dgst} -mac HMAC -macopt hexkey:{key_hex} | awk '{{print $2}}'"
        )
    }

    // ── Key Fingerprinting ─────────────────────────────────────────

    /// SHA-256-style fingerprint of a key as colon-separated hex.
    pub fn fingerprint_key(key: &[u8]) -> String {
        let hash = fnv_hash(key, 32);
        hash.iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join(":")
    }

    // ── Constant-Time Comparison ───────────────────────────────────

    /// Timing-safe byte comparison.
    pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let mut diff: u8 = 0;
        for (x, y) in a.iter().zip(b.iter()) {
            diff |= x ^ y;
        }
        diff == 0
    }
}

// ── Private Helpers ────────────────────────────────────────────────

/// FNV-1a–based hash producing `out_len` bytes.
///
/// Iterates with different seeds to fill the requested length.
fn fnv_hash(data: &[u8], out_len: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(out_len);
    let mut seed: u64 = 0;
    while result.len() < out_len {
        let mut h: u64 = 0xcbf29ce484222325u64.wrapping_add(seed);
        for &b in data {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        let bytes = h.to_le_bytes();
        for &b in &bytes {
            if result.len() >= out_len {
                break;
            }
            result.push(b);
        }
        seed += 1;
    }
    result
}

/// Map `KnockEncryption` to an OpenSSL cipher name.
fn openssl_cipher_name(alg: KnockEncryption) -> &'static str {
    match alg {
        KnockEncryption::Aes256Gcm => "aes-256-gcm",
        KnockEncryption::Aes256Cbc => "aes-256-cbc",
        KnockEncryption::RijndaelCbc => "aes-256-cbc",
        KnockEncryption::ChaCha20Poly1305 => "chacha20-poly1305",
        KnockEncryption::None => "aes-256-cbc",
    }
}

/// Map `HmacAlgorithm` to an OpenSSL digest name.
fn openssl_digest_name(alg: HmacAlgorithm) -> &'static str {
    match alg {
        HmacAlgorithm::Sha256 => "sha256",
        HmacAlgorithm::Sha384 => "sha384",
        HmacAlgorithm::Sha512 => "sha512",
    }
}

/// Encode bytes as lowercase hex string.
fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = b"super-secret-key";
        let plaintext = b"knock knock payload";
        for alg in [
            KnockEncryption::Aes256Gcm,
            KnockEncryption::Aes256Cbc,
            KnockEncryption::RijndaelCbc,
            KnockEncryption::ChaCha20Poly1305,
        ] {
            let enc = KnockCrypto::encrypt_payload(plaintext, key, alg).unwrap();
            assert_ne!(enc.ciphertext, plaintext);
            let dec = KnockCrypto::decrypt_payload(&enc, key).unwrap();
            assert_eq!(dec, plaintext);
        }
    }

    #[test]
    fn encrypt_none_passthrough() {
        let key = b"k";
        let data = b"hello";
        let enc = KnockCrypto::encrypt_payload(data, key, KnockEncryption::None).unwrap();
        assert_eq!(enc.ciphertext, data);
        let dec = KnockCrypto::decrypt_payload(&enc, key).unwrap();
        assert_eq!(dec, data);
    }

    #[test]
    fn hmac_verify_ok() {
        let key = b"hmac-key";
        let data = b"message";
        let mac = KnockCrypto::compute_hmac(data, key, HmacAlgorithm::Sha256);
        assert!(KnockCrypto::verify_hmac(
            data,
            key,
            &mac,
            HmacAlgorithm::Sha256
        ));
    }

    #[test]
    fn hmac_verify_bad() {
        let key = b"hmac-key";
        let data = b"message";
        let mut mac = KnockCrypto::compute_hmac(data, key, HmacAlgorithm::Sha256);
        mac[0] ^= 0xff;
        assert!(!KnockCrypto::verify_hmac(
            data,
            key,
            &mac,
            HmacAlgorithm::Sha256
        ));
    }

    #[test]
    fn derive_key_pbkdf2() {
        let dk = KnockCrypto::derive_key(
            b"password",
            b"salt",
            &KeyDerivation::Pbkdf2 {
                iterations: 10,
                salt_len: 4,
            },
        )
        .unwrap();
        assert_eq!(dk.len(), 32);
    }

    #[test]
    fn derive_key_raw() {
        let dk = KnockCrypto::derive_key(b"raw-key", b"", &KeyDerivation::Raw).unwrap();
        assert_eq!(dk, b"raw-key");
    }

    #[test]
    fn replay_window_detects_duplicate() {
        let mut window = ReplayWindow {
            window_size: 100,
            seen_nonces: Vec::new(),
            last_timestamp: Utc::now(),
        };
        assert!(KnockCrypto::check_replay("nonce-1", &mut window));
        assert!(!KnockCrypto::check_replay("nonce-1", &mut window));
        assert!(KnockCrypto::check_replay("nonce-2", &mut window));
    }

    #[test]
    fn constant_time_compare_works() {
        assert!(KnockCrypto::constant_time_compare(b"abc", b"abc"));
        assert!(!KnockCrypto::constant_time_compare(b"abc", b"abd"));
        assert!(!KnockCrypto::constant_time_compare(b"ab", b"abc"));
    }

    #[test]
    fn nonce_uniqueness() {
        let a = KnockCrypto::generate_nonce(16);
        let b = KnockCrypto::generate_nonce(16);
        assert_ne!(a, b);
    }

    #[test]
    fn key_fingerprint_format() {
        let fp = KnockCrypto::fingerprint_key(b"test-key");
        assert!(fp.contains(':'));
        // 32 hex bytes = 32*2 chars + 31 colons = 95 chars
        assert_eq!(fp.len(), 95);
    }

    #[test]
    fn openssl_encrypt_command_contains_cipher() {
        let cmd =
            KnockCrypto::build_openssl_encrypt_command("aabb", "ccdd", KnockEncryption::Aes256Gcm);
        assert!(cmd.contains("aes-256-gcm"));
        assert!(cmd.contains("openssl enc"));
    }

    #[test]
    fn hmac_command_contains_digest() {
        let cmd = KnockCrypto::build_hmac_command("aabb", "ccdd", HmacAlgorithm::Sha512);
        assert!(cmd.contains("sha512"));
        assert!(cmd.contains("openssl dgst"));
    }
}
