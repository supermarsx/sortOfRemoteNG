//! Encryption at rest for the proxy cache (D3).
//!
//! - A per-connection random DEK is wrapped (AES-256-GCM) under the cache
//!   master key and stored with the binding digest in `keys.v1`.
//! - Every entry file is sealed with AES-256-GCM in the STREAM construction
//!   (`aead::stream`, big-endian 32-bit counter) over 64 KiB segments, under a
//!   per-file key derived (HKDF-SHA256) from the DEK and a random file salt.
//!   The entry file name is bound as associated data, so files cannot be
//!   swapped between names.
//! - File names are keyed hashes of the cache key, so they reveal no URL.

use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::stream::{DecryptorBE32, EncryptorBE32};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::Aes256Gcm;
use hkdf::Hkdf;
use rand::RngCore;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

/// Plaintext bytes per STREAM segment.
pub(crate) const SEGMENT: usize = 64 * 1024;
const TAG: usize = 16;
const KEYS_MAGIC: &[u8; 8] = b"SRNGPCK1";
const ENTRY_MAGIC: &[u8; 8] = b"SRNGPCE1";
const SALT: usize = 32;
const WRAP_NONCE: usize = 12;
/// `magic | binding | nonce | AES-GCM(DEK)`.
pub(crate) const KEYS_FILE_LEN: usize = KEYS_MAGIC.len() + 32 + WRAP_NONCE + 32 + TAG;
/// STREAM nonce prefix for `StreamBE32` with a 96-bit AEAD nonce. Every file
/// has its own key (random salt), so a fixed prefix never repeats a nonce.
const STREAM_NONCE: [u8; 7] = [0; 7];

fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    rand::rngs::OsRng.fill_bytes(&mut out);
    out
}

fn derive(ikm: &[u8], salt: Option<&[u8]>, info: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut out = Zeroizing::new([0u8; 32]);
    // 32 bytes is always a valid HKDF-SHA256 output length.
    let _ = Hkdf::<Sha256>::new(salt, ikm).expand(info, out.as_mut_slice());
    out
}

/// Result of reading `keys.v1`.
pub(crate) enum KeysFile {
    Valid(CacheKeys),
    /// Written for another binding digest: the store must be wiped.
    BindingMismatch,
    /// Unreadable, truncated, or the master key cannot unwrap it.
    Invalid,
}

/// The unwrapped per-connection keys.
pub(crate) struct CacheKeys {
    entry_root: Zeroizing<[u8; 32]>,
    name_key: Zeroizing<[u8; 32]>,
}

impl CacheKeys {
    fn from_dek(dek: &[u8; 32]) -> Self {
        Self {
            entry_root: derive(dek, None, b"sorng-proxy-cache-v1 entry"),
            name_key: derive(dek, None, b"sorng-proxy-cache-v1 name"),
        }
    }

    /// Creates a fresh DEK and returns the keys plus the `keys.v1` bytes.
    pub(crate) fn generate(master: &[u8; 32], binding: &[u8; 32]) -> (Self, Vec<u8>) {
        let dek = Zeroizing::new(random::<32>());
        let nonce = random::<WRAP_NONCE>();
        let aad = keys_aad(binding);
        let cipher = Aes256Gcm::new(GenericArray::from_slice(master));
        let mut file = Vec::with_capacity(KEYS_FILE_LEN);
        file.extend_from_slice(KEYS_MAGIC);
        file.extend_from_slice(binding);
        file.extend_from_slice(&nonce);
        // Encrypting 32 bytes with a fresh nonce cannot fail.
        let wrapped = cipher
            .encrypt(
                GenericArray::from_slice(&nonce),
                Payload {
                    msg: dek.as_slice(),
                    aad: &aad,
                },
            )
            .unwrap_or_default();
        file.extend_from_slice(&wrapped);
        (Self::from_dek(&dek), file)
    }

    /// Parses `keys.v1` for `binding` under `master`.
    pub(crate) fn unwrap(master: &[u8; 32], binding: &[u8; 32], file: &[u8]) -> KeysFile {
        if file.len() != KEYS_FILE_LEN || !file.starts_with(KEYS_MAGIC) {
            return KeysFile::Invalid;
        }
        let (stored_binding, rest) = file[KEYS_MAGIC.len()..].split_at(32);
        if stored_binding != binding {
            return KeysFile::BindingMismatch;
        }
        let (nonce, wrapped) = rest.split_at(WRAP_NONCE);
        let aad = keys_aad(binding);
        let cipher = Aes256Gcm::new(GenericArray::from_slice(master));
        let Ok(dek) = cipher.decrypt(
            GenericArray::from_slice(nonce),
            Payload {
                msg: wrapped,
                aad: &aad,
            },
        ) else {
            return KeysFile::Invalid;
        };
        let dek = Zeroizing::new(dek);
        let Ok(dek) = <[u8; 32]>::try_from(dek.as_slice()) else {
            return KeysFile::Invalid;
        };
        let dek = Zeroizing::new(dek);
        KeysFile::Valid(Self::from_dek(&dek))
    }

    /// The on-disk file name for a cache key: 64 hex chars of a keyed hash.
    pub(crate) fn entry_name(&self, key: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.name_key.as_slice());
        hasher.update(key.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Seals one entry (`magic | salt | STREAM ciphertext`).
    pub(crate) fn seal(&self, name: &str, plaintext: &[u8]) -> Option<Vec<u8>> {
        let salt = random::<SALT>();
        let file_key = derive(
            self.entry_root.as_slice(),
            Some(&salt),
            b"sorng-proxy-cache-v1 file",
        );
        let cipher = Aes256Gcm::new(GenericArray::from_slice(file_key.as_slice()));
        let mut stream = EncryptorBE32::from_aead(cipher, GenericArray::from_slice(&STREAM_NONCE));
        let aad = entry_aad(name);
        let segments = plaintext.len().div_ceil(SEGMENT).max(1);
        let mut out =
            Vec::with_capacity(ENTRY_MAGIC.len() + SALT + plaintext.len() + segments * TAG);
        out.extend_from_slice(ENTRY_MAGIC);
        out.extend_from_slice(&salt);
        let mut chunks = plaintext.chunks(SEGMENT).peekable();
        if chunks.peek().is_none() {
            out.extend(
                stream
                    .encrypt_last(Payload {
                        msg: &[],
                        aad: &aad,
                    })
                    .ok()?,
            );
            return Some(out);
        }
        while let Some(chunk) = chunks.next() {
            let payload = Payload {
                msg: chunk,
                aad: &aad,
            };
            if chunks.peek().is_none() {
                out.extend(stream.encrypt_last(payload).ok()?);
                break;
            }
            out.extend(stream.encrypt_next(payload).ok()?);
        }
        Some(out)
    }

    /// Opens one entry file; `None` on any authentication or framing failure.
    pub(crate) fn open(&self, name: &str, file: &[u8]) -> Option<Vec<u8>> {
        let header = ENTRY_MAGIC.len() + SALT;
        if file.len() < header + TAG || !file.starts_with(ENTRY_MAGIC) {
            return None;
        }
        let salt = &file[ENTRY_MAGIC.len()..header];
        let file_key = derive(
            self.entry_root.as_slice(),
            Some(salt),
            b"sorng-proxy-cache-v1 file",
        );
        let cipher = Aes256Gcm::new(GenericArray::from_slice(file_key.as_slice()));
        let mut stream = DecryptorBE32::from_aead(cipher, GenericArray::from_slice(&STREAM_NONCE));
        let aad = entry_aad(name);
        let mut chunks = file[header..].chunks(SEGMENT + TAG).peekable();
        let mut out = Vec::with_capacity(file.len() - header);
        while let Some(chunk) = chunks.next() {
            let payload = Payload {
                msg: chunk,
                aad: &aad,
            };
            if chunks.peek().is_none() {
                out.extend(stream.decrypt_last(payload).ok()?);
                return Some(out);
            }
            out.extend(stream.decrypt_next(payload).ok()?);
        }
        None
    }
}

fn keys_aad(binding: &[u8; 32]) -> Vec<u8> {
    let mut aad = KEYS_MAGIC.to_vec();
    aad.extend_from_slice(binding);
    aad
}

fn entry_aad(name: &str) -> Vec<u8> {
    let mut aad = ENTRY_MAGIC.to_vec();
    aad.extend_from_slice(name.as_bytes());
    aad
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> CacheKeys {
        CacheKeys::generate(&[7; 32], &[9; 32]).0
    }

    #[test]
    fn seal_open_roundtrip_across_segment_boundaries() {
        let keys = keys();
        for len in [0, 1, SEGMENT - 1, SEGMENT, SEGMENT + 1, 3 * SEGMENT] {
            let plain: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            let sealed = keys.seal("n", &plain).expect("seal");
            assert_eq!(keys.open("n", &sealed).expect("open"), plain, "len {len}");
            assert!(keys.open("other", &sealed).is_none(), "name is bound");
        }
    }

    #[test]
    fn truncation_and_tamper_fail() {
        let keys = keys();
        let plain = vec![42u8; 2 * SEGMENT];
        let sealed = keys.seal("n", &plain).expect("seal");
        // Drop the last full segment: the remaining one was not sealed as last.
        assert!(keys
            .open("n", &sealed[..sealed.len() - SEGMENT / 2])
            .is_none());
        assert!(keys.open("n", &sealed[..40 + SEGMENT + TAG]).is_none());
        let mut flipped = sealed.clone();
        flipped[50] ^= 1;
        assert!(keys.open("n", &flipped).is_none());
    }

    #[test]
    fn keys_file_checks_binding_and_master() {
        let (keys, file) = CacheKeys::generate(&[1; 32], &[2; 32]);
        let name = keys.entry_name("k");
        assert_eq!(name.len(), 64);
        match CacheKeys::unwrap(&[1; 32], &[2; 32], &file) {
            KeysFile::Valid(again) => assert_eq!(again.entry_name("k"), name),
            _ => panic!("valid keys file rejected"),
        }
        assert!(matches!(
            CacheKeys::unwrap(&[1; 32], &[3; 32], &file),
            KeysFile::BindingMismatch
        ));
        assert!(matches!(
            CacheKeys::unwrap(&[4; 32], &[2; 32], &file),
            KeysFile::Invalid
        ));
        assert!(matches!(
            CacheKeys::unwrap(&[1; 32], &[2; 32], &file[1..]),
            KeysFile::Invalid
        ));
    }
}
