//! On-disk file envelope: 64-byte unencrypted preamble + AES-256-GCM
//! ciphertext.
//!
//! Designed for two simultaneous goals:
//!
//! 1. **The unlock screen can render before any key is available.**
//!    The preamble carries enough metadata (which master-key-storage
//!    mode, which Argon2id parameters, which DEK-envelope nonce) for the
//!    UI to ask the user the *right* unlock question without first
//!    decrypting anything.
//! 2. **Downgrade attempts are detectable.** Every encrypted file
//!    carries the same magic + version. A reader that sees v0 (plain
//!    JSON) when its in-memory state is v2 raises `Version::Downgrade`
//!    and the caller can refuse to load.
//!
//! ## Wire format
//!
//! ```text
//!  offset  size   description
//!  ──────  ────   ──────────────────────────────────────────────────────
//!   0       6     b"SORNG\0"                ASCII magic
//!   6       1     version                   u8, currently 2
//!   7       1     master_key_storage        0 = vault, 1 = password, 2 = both
//!   8       4     argon2_memory_kib         u32 LE
//!  12       4     argon2_time_cost          u32 LE
//!  16       4     argon2_parallelism        u32 LE
//!  20      16     argon2_salt               raw bytes (zeros if storage = vault)
//!  36      12     data_nonce                AES-256-GCM nonce for the body
//!  48      16     reserved                  must be zero on write
//!  ──────  ────
//!  64      ..     ciphertext || GCM tag     AEAD body
//! ```
//!
//! AEAD additional-authenticated-data is the first 64 bytes — i.e. the
//! preamble itself — so a tampered preamble fails GCM verification at
//! decrypt-time. This binds the header to the body.

use serde::{Deserialize, Serialize};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};

#[cfg(test)]
use base64::{engine::general_purpose, Engine as _};

use crate::dek::{SubKey, KEY_LEN};

/// Magic prefix shared by every v1+ envelope file.
pub const MAGIC: &[u8; 6] = b"SORNG\0";
/// Current envelope version.
pub const CURRENT_VERSION: u8 = 2;
/// Total size of the unencrypted preamble.
pub const PREAMBLE_LEN: usize = 64;
/// AEAD nonce length (96 bits, per AES-256-GCM).
pub const NONCE_LEN: usize = 12;
/// Argon2id salt length (used only in password / hybrid modes).
pub const SALT_LEN: usize = 16;

/// How the master DEK is reconstructed at unlock time. Stored in the
/// preamble at offset 7.
///
/// Each variant is on-disk-stable; renumbering breaks every existing
/// file. Add new variants at the bottom.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[repr(u8)]
pub enum MasterKeyStorage {
    /// Master DEK lives in the OS vault under
    /// `("com.sortofremoteng.vault", "master-dek")`. The unlock screen
    /// is skipped — the DEK is read silently at app start.
    Vault = 0,
    /// No vault available (or the user opted in to extra friction).
    /// The DEK is Argon2id-wrapped with the user's password and the
    /// wrap blob lives in this file (or its sibling). Unlock asks for
    /// a password.
    Password = 1,
    /// Belt-and-suspenders. Wrap blob exists *and* the vault carries
    /// the DEK; unlock asks for the password and the vault check is
    /// an extra "is this still the same machine?" guard.
    VaultAndPassword = 2,
}

impl MasterKeyStorage {
    pub fn from_u8(b: u8) -> Option<Self> {
        match b {
            0 => Some(Self::Vault),
            1 => Some(Self::Password),
            2 => Some(Self::VaultAndPassword),
            _ => None,
        }
    }
}

/// Parsed view of the 64-byte preamble. The fields are kept aligned
/// with the wire layout for ease of cross-reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeHeader {
    pub version: u8,
    pub master_key_storage: MasterKeyStorage,
    pub argon2_memory_kib: u32,
    pub argon2_time_cost: u32,
    pub argon2_parallelism: u32,
    pub argon2_salt: [u8; SALT_LEN],
    pub data_nonce: [u8; NONCE_LEN],
}

impl EnvelopeHeader {
    /// Build a header for a fresh vault-mode write. The Argon2id fields
    /// are zeroed because no password-wrap is happening.
    pub fn new_vault(data_nonce: [u8; NONCE_LEN]) -> Self {
        Self {
            version: CURRENT_VERSION,
            master_key_storage: MasterKeyStorage::Vault,
            argon2_memory_kib: 0,
            argon2_time_cost: 0,
            argon2_parallelism: 0,
            argon2_salt: [0u8; SALT_LEN],
            data_nonce,
        }
    }

    /// Build a header for a password (or hybrid) mode write. Caller
    /// supplies the Argon2id parameters and salt — typically pulled
    /// from `EncryptionSettings.argon2id`.
    pub fn new_password(
        mode: MasterKeyStorage,
        argon2_memory_kib: u32,
        argon2_time_cost: u32,
        argon2_parallelism: u32,
        argon2_salt: [u8; SALT_LEN],
        data_nonce: [u8; NONCE_LEN],
    ) -> Self {
        Self {
            version: CURRENT_VERSION,
            master_key_storage: mode,
            argon2_memory_kib,
            argon2_time_cost,
            argon2_parallelism,
            argon2_salt,
            data_nonce,
        }
    }

    /// Serialize the header to its on-disk 64-byte form.
    pub fn encode(&self) -> [u8; PREAMBLE_LEN] {
        let mut out = [0u8; PREAMBLE_LEN];
        out[0..6].copy_from_slice(MAGIC);
        out[6] = self.version;
        out[7] = self.master_key_storage as u8;
        out[8..12].copy_from_slice(&self.argon2_memory_kib.to_le_bytes());
        out[12..16].copy_from_slice(&self.argon2_time_cost.to_le_bytes());
        out[16..20].copy_from_slice(&self.argon2_parallelism.to_le_bytes());
        out[20..36].copy_from_slice(&self.argon2_salt);
        out[36..48].copy_from_slice(&self.data_nonce);
        // 48..64 reserved (zeros).
        out
    }

    /// Parse the 64-byte preamble. Returns `Version::Downgrade` if the
    /// magic is missing — that's the v0 plaintext case the caller must
    /// handle separately.
    pub fn decode(buf: &[u8]) -> Result<Self, EnvelopeError> {
        if buf.len() < PREAMBLE_LEN {
            return Err(EnvelopeError::Truncated);
        }
        if &buf[0..6] != MAGIC {
            return Err(EnvelopeError::MissingMagic);
        }
        let version = buf[6];
        if version != CURRENT_VERSION {
            return Err(EnvelopeError::UnsupportedVersion(version));
        }
        let storage = MasterKeyStorage::from_u8(buf[7])
            .ok_or(EnvelopeError::UnknownMasterKeyStorage(buf[7]))?;
        let argon2_memory_kib = u32::from_le_bytes(buf[8..12].try_into().unwrap());
        let argon2_time_cost = u32::from_le_bytes(buf[12..16].try_into().unwrap());
        let argon2_parallelism = u32::from_le_bytes(buf[16..20].try_into().unwrap());
        let mut argon2_salt = [0u8; SALT_LEN];
        argon2_salt.copy_from_slice(&buf[20..36]);
        let mut data_nonce = [0u8; NONCE_LEN];
        data_nonce.copy_from_slice(&buf[36..48]);
        // Reserved bytes are ignored on read; future versions may use them.

        Ok(Self {
            version,
            master_key_storage: storage,
            argon2_memory_kib,
            argon2_time_cost,
            argon2_parallelism,
            argon2_salt,
            data_nonce,
        })
    }

    /// Cheap "is this file an envelope file?" check that doesn't
    /// allocate or decode further. Used by readers that want to dispatch
    /// between v0 (plaintext) and v2.
    pub fn looks_like_envelope(buf: &[u8]) -> bool {
        buf.len() >= 7 && &buf[0..6] == MAGIC
    }
}

/// Failures during envelope codec operations. Distinct from KDF /
/// vault errors so callers can react differently (e.g. "downgrade" is
/// recoverable, "auth tag" is not).
#[derive(Debug, thiserror::Error)]
pub enum EnvelopeError {
    #[error("file is shorter than the 64-byte preamble")]
    Truncated,
    #[error("missing SORNG magic prefix (v0 plaintext or unrelated file)")]
    MissingMagic,
    #[error("unsupported envelope version: {0}")]
    UnsupportedVersion(u8),
    #[error("unknown master-key-storage discriminant: {0}")]
    UnknownMasterKeyStorage(u8),
    #[error("AES-256-GCM authentication failed (tamper or wrong key)")]
    AuthenticationFailed,
    #[error("invalid key length: expected 32, got {0}")]
    InvalidKey(usize),
    #[error("base64 decode error: {0}")]
    Base64(String),
}

/// Encrypt `plaintext` with the given sub-key under a header. Returns
/// the full file bytes (preamble || ciphertext || tag). The preamble is
/// used as AEAD additional-authenticated-data so any tamper of the
/// header is detected on read.
pub fn write_envelope(
    sub_key: &SubKey,
    header: &EnvelopeHeader,
    plaintext: &[u8],
) -> Result<Vec<u8>, EnvelopeError> {
    let key_bytes = sub_key.bytes();
    if key_bytes.len() != KEY_LEN {
        return Err(EnvelopeError::InvalidKey(key_bytes.len()));
    }
    let cipher = Aes256Gcm::new(key_bytes.into());
    let nonce = Nonce::from_slice(&header.data_nonce);
    let preamble = header.encode();

    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: &preamble,
            },
        )
        // AEAD encrypt only fails on absurd input lengths (> 64 GiB).
        .map_err(|_| EnvelopeError::AuthenticationFailed)?;

    let mut out = Vec::with_capacity(PREAMBLE_LEN + ciphertext.len());
    out.extend_from_slice(&preamble);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Inverse of [`write_envelope`]. Returns `(header, plaintext)` on
/// success. The header is needed by callers that want to inspect the
/// storage mode used at write-time (e.g. to detect a configuration
/// drift between disk and current settings).
pub fn read_envelope(
    sub_key: &SubKey,
    file_bytes: &[u8],
) -> Result<(EnvelopeHeader, Vec<u8>), EnvelopeError> {
    if file_bytes.len() < PREAMBLE_LEN {
        return Err(EnvelopeError::Truncated);
    }
    let header = EnvelopeHeader::decode(&file_bytes[..PREAMBLE_LEN])?;

    let key_bytes = sub_key.bytes();
    if key_bytes.len() != KEY_LEN {
        return Err(EnvelopeError::InvalidKey(key_bytes.len()));
    }
    let cipher = Aes256Gcm::new(key_bytes.into());
    let nonce = Nonce::from_slice(&header.data_nonce);

    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &file_bytes[PREAMBLE_LEN..],
                aad: &file_bytes[..PREAMBLE_LEN],
            },
        )
        .map_err(|_| EnvelopeError::AuthenticationFailed)?;
    Ok((header, plaintext))
}

// ─── Test helpers (test-only base64 round-trip for debug dumps) ──

#[cfg(test)]
pub(crate) fn b64(bytes: &[u8]) -> String {
    general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::{ArtifactKind, MasterDek};
    use rand::rngs::OsRng;
    use rand::RngCore;

    fn rand_nonce() -> [u8; NONCE_LEN] {
        let mut n = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut n);
        n
    }

    #[test]
    fn header_round_trip_vault_mode() {
        let nonce = rand_nonce();
        let h = EnvelopeHeader::new_vault(nonce);
        let bytes = h.encode();
        assert_eq!(bytes.len(), PREAMBLE_LEN);
        assert_eq!(&bytes[0..6], MAGIC);
        assert_eq!(bytes[6], CURRENT_VERSION);
        assert_eq!(bytes[7], MasterKeyStorage::Vault as u8);

        let parsed = EnvelopeHeader::decode(&bytes).unwrap();
        assert_eq!(parsed, h);
    }

    #[test]
    fn header_round_trip_password_mode() {
        let mut salt = [0u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        let nonce = rand_nonce();
        let h = EnvelopeHeader::new_password(
            MasterKeyStorage::Password,
            65536,
            3,
            4,
            salt,
            nonce,
        );
        let bytes = h.encode();
        let parsed = EnvelopeHeader::decode(&bytes).unwrap();
        assert_eq!(parsed, h);
    }

    #[test]
    fn missing_magic_is_detected_separately_from_truncation() {
        let mut buf = [0u8; PREAMBLE_LEN];
        // looks_like_envelope must refuse the zero buffer.
        assert!(!EnvelopeHeader::looks_like_envelope(&buf));
        // Putting only part of the magic in still fails.
        buf[..3].copy_from_slice(b"SOR");
        assert!(!EnvelopeHeader::looks_like_envelope(&buf));
        assert!(matches!(
            EnvelopeHeader::decode(&buf),
            Err(EnvelopeError::MissingMagic),
        ));

        // 0-byte and 5-byte inputs are truncated.
        assert!(matches!(
            EnvelopeHeader::decode(&[]),
            Err(EnvelopeError::Truncated),
        ));
    }

    #[test]
    fn unsupported_version_is_rejected() {
        let nonce = rand_nonce();
        let mut bytes = EnvelopeHeader::new_vault(nonce).encode();
        bytes[6] = 99;
        assert!(matches!(
            EnvelopeHeader::decode(&bytes),
            Err(EnvelopeError::UnsupportedVersion(99)),
        ));
    }

    #[test]
    fn unknown_storage_mode_is_rejected() {
        let nonce = rand_nonce();
        let mut bytes = EnvelopeHeader::new_vault(nonce).encode();
        bytes[7] = 7; // outside the closed set
        assert!(matches!(
            EnvelopeHeader::decode(&bytes),
            Err(EnvelopeError::UnknownMasterKeyStorage(7)),
        ));
    }

    #[test]
    fn write_read_round_trip_with_vault_header() {
        let master = MasterDek::generate();
        let sk = master.sub_key(ArtifactKind::Settings);
        let header = EnvelopeHeader::new_vault(rand_nonce());
        let plaintext = b"{\"theme\":\"dark\",\"language\":\"en\"}";

        let file = write_envelope(&sk, &header, plaintext).unwrap();
        assert!(file.len() > PREAMBLE_LEN);
        assert!(EnvelopeHeader::looks_like_envelope(&file));

        let (parsed, decrypted) = read_envelope(&sk, &file).unwrap();
        assert_eq!(parsed, header);
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn empty_plaintext_round_trips() {
        // An "empty settings file" should still produce a valid envelope.
        let master = MasterDek::generate();
        let sk = master.sub_key(ArtifactKind::Settings);
        let header = EnvelopeHeader::new_vault(rand_nonce());
        let file = write_envelope(&sk, &header, &[]).unwrap();
        let (_, decrypted) = read_envelope(&sk, &file).unwrap();
        assert!(decrypted.is_empty());
    }

    #[test]
    fn wrong_sub_key_fails_authentication() {
        let master = MasterDek::generate();
        let sk = master.sub_key(ArtifactKind::Settings);
        let other = master.sub_key(ArtifactKind::Backups);
        let header = EnvelopeHeader::new_vault(rand_nonce());
        let file = write_envelope(&sk, &header, b"settings body").unwrap();
        assert!(matches!(
            read_envelope(&other, &file),
            Err(EnvelopeError::AuthenticationFailed),
        ));
    }

    #[test]
    fn header_tamper_is_detected_via_aad() {
        let master = MasterDek::generate();
        let sk = master.sub_key(ArtifactKind::Settings);
        let header = EnvelopeHeader::new_vault(rand_nonce());
        let mut file = write_envelope(&sk, &header, b"body").unwrap();
        // Flip a byte in the reserved region of the preamble — readable
        // by `decode` but the AAD changes so GCM tag fails.
        file[50] ^= 0x01;
        let (parsed, _) = (EnvelopeHeader::decode(&file[..PREAMBLE_LEN]).unwrap(), ());
        assert_eq!(parsed.version, CURRENT_VERSION);
        assert!(matches!(
            read_envelope(&sk, &file),
            Err(EnvelopeError::AuthenticationFailed),
        ));
    }

    #[test]
    fn body_tamper_is_detected() {
        let master = MasterDek::generate();
        let sk = master.sub_key(ArtifactKind::Settings);
        let header = EnvelopeHeader::new_vault(rand_nonce());
        let mut file = write_envelope(&sk, &header, b"body").unwrap();
        let body_idx = PREAMBLE_LEN + 2;
        file[body_idx] ^= 0xFF;
        assert!(matches!(
            read_envelope(&sk, &file),
            Err(EnvelopeError::AuthenticationFailed),
        ));
    }

    #[test]
    fn b64_helper_round_trip() {
        let raw = b"hello";
        let s = b64(raw);
        let back = general_purpose::STANDARD.decode(&s).unwrap();
        assert_eq!(back, raw);
    }
}
