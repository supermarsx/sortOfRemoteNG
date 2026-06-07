//! Phase 3a — encrypted backups (`backup/*.enc`).
//!
//! The existing backup pipeline already supports an opt-in password
//! envelope; this module replaces it with the unified v2 envelope so
//! backups participate in the same master-key rotation, mode
//! detection, and downgrade defence as every other artifact.
//!
//! Backup payloads are typically a few-to-tens of MiB JSON blobs
//! (full database snapshot + settings + macros). The whole-file
//! envelope is the right fit — backups aren't seeked; they're
//! restored end-to-end. Streaming AEAD would be over-engineering.

use rand::rngs::OsRng;
use rand::RngCore;

use crate::dek::ArtifactKind;
use crate::envelope::{
    self, EnvelopeError, EnvelopeHeader, MasterKeyStorage, NONCE_LEN, SALT_LEN,
};
use crate::password_wrap::Argon2Params;
use crate::state::EncryptionState;

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("encryption state is locked; unlock before reading or writing backups")]
    Locked,
    #[error("envelope codec failed: {0}")]
    Envelope(#[from] EnvelopeError),
}

/// Encrypt arbitrary `plaintext` bytes for a backup file. Unlike the
/// JSON-only `settings::write`, this accepts raw bytes — the backup
/// pipeline already serializes its payload (JSON, XML, binary
/// depending on `BackupConfig.format`) before encryption.
pub async fn write(
    state: &EncryptionState,
    plaintext: &[u8],
    mode: MasterKeyStorage,
    argon2: Argon2Params,
    argon2_salt: [u8; SALT_LEN],
) -> Result<Vec<u8>, BackupError> {
    let sub_key = state
        .sub_key(ArtifactKind::Backups)
        .await
        .ok_or(BackupError::Locked)?;
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let header = match mode {
        MasterKeyStorage::Vault => EnvelopeHeader::new_vault(nonce),
        MasterKeyStorage::Password | MasterKeyStorage::VaultAndPassword => {
            EnvelopeHeader::new_password(
                mode,
                argon2.memory_kib,
                argon2.time_cost,
                argon2.parallelism,
                argon2_salt,
                nonce,
            )
        }
    };
    Ok(envelope::write_envelope(&sub_key, &header, plaintext)?)
}

/// Inverse of [`write`]. Returns the raw plaintext bytes; the backup
/// restore pipeline knows how to parse them.
pub async fn read(state: &EncryptionState, file_bytes: &[u8]) -> Result<Vec<u8>, BackupError> {
    let sub_key = state
        .sub_key(ArtifactKind::Backups)
        .await
        .ok_or(BackupError::Locked)?;
    let (_header, plaintext) = envelope::read_envelope(&sub_key, file_bytes)?;
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::MasterDek;

    #[tokio::test]
    async fn round_trip_binary_blob() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        // Realistic-ish 1 MiB payload of mixed bytes.
        let data: Vec<u8> = (0..1024 * 1024).map(|i| (i % 251) as u8).collect();
        let blob = write(
            &state,
            &data,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        assert!(blob.len() > data.len()); // envelope adds ~80 bytes
        let recovered = read(&state, &blob).await.unwrap();
        assert_eq!(recovered, data);
    }

    #[tokio::test]
    async fn empty_payload_round_trips() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let blob = write(
            &state,
            &[],
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        let recovered = read(&state, &blob).await.unwrap();
        assert!(recovered.is_empty());
    }

    #[tokio::test]
    async fn locked_state_blocks_io() {
        let state = EncryptionState::new();
        let err = write(
            &state,
            b"x",
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, BackupError::Locked));
    }

    #[tokio::test]
    async fn survives_process_restart_via_master_bytes() {
        // A backup written before a "restart" must restore after one,
        // using only the persisted master bytes. This is what makes
        // backups a useful disaster-recovery artifact across reboots.
        let state_a = EncryptionState::new();
        state_a.install(MasterDek::generate()).await;
        let payload: Vec<u8> = (0..4096).map(|i| (i * 7 % 251) as u8).collect();
        let blob = write(
            &state_a,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();

        let saved_bytes = state_a.master_bytes_raw().await.unwrap();
        std::mem::drop(state_a);

        let state_b = EncryptionState::new();
        state_b
            .install(MasterDek::from_bytes(&saved_bytes).unwrap())
            .await;

        let recovered = read(&state_b, &blob).await.unwrap();
        assert_eq!(recovered, payload);
    }

    #[tokio::test]
    async fn truncated_input_is_clean_error() {
        // Short buffer must be a typed error, never a panic.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let buf = [0u8; 32];
        assert!(read(&state, &buf).await.is_err());
    }

    #[tokio::test]
    async fn valid_magic_garbage_body_fails_gcm_auth() {
        // Valid preamble + random body: must land in the GCM auth-fail
        // path because the AAD covers the preamble.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let header = EnvelopeHeader::new_vault([0u8; NONCE_LEN]);
        let mut blob = header.encode().to_vec();
        blob.extend((0..256).map(|i| (i as u8).wrapping_mul(13)));
        assert!(matches!(
            read(&state, &blob).await,
            Err(BackupError::Envelope(EnvelopeError::AuthenticationFailed))
        ));
    }

    #[tokio::test]
    async fn cross_state_decryption_fails() {
        let s1 = EncryptionState::new();
        let s2 = EncryptionState::new();
        s1.install(MasterDek::generate()).await;
        s2.install(MasterDek::generate()).await;
        let blob = write(
            &s1,
            b"backup body",
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        assert!(matches!(
            read(&s2, &blob).await,
            Err(BackupError::Envelope(EnvelopeError::AuthenticationFailed))
        ));
    }
}
