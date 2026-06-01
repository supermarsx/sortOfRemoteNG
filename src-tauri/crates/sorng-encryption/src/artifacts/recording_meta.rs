//! Phase 2a — encrypted recording metadata (`recording/*.json` →
//! `recording/*.json.enc`).
//!
//! Recording metadata is small JSON describing the session (host, user,
//! start/end timestamps, list of media chunk filenames, etc.). It's
//! treated exactly like settings — the same v2 envelope, the same
//! mode-aware preamble — only the HKDF sub-key differs
//! ([`ArtifactKind::RecordingsMeta`]).
//!
//! Media bytes themselves live in a separate format ([`super::
//! recording_media`]) because they're orders of magnitude larger and
//! need random-access seek; this module is JSON-only.

use rand::rngs::OsRng;
use rand::RngCore;
use serde_json::Value;

use crate::dek::ArtifactKind;
use crate::envelope::{
    self, EnvelopeError, EnvelopeHeader, MasterKeyStorage, NONCE_LEN, SALT_LEN,
};
use crate::password_wrap::Argon2Params;
use crate::state::EncryptionState;

/// Suffix applied when migrating a `.json` metadata file to v2. The
/// original file is archived to `<name>.v0.bak` before deletion.
pub const ENCRYPTED_SUFFIX: &str = ".enc";

#[derive(Debug, thiserror::Error)]
pub enum RecordingMetaError {
    #[error("encryption state is locked; unlock before reading or writing recording metadata")]
    Locked,
    #[error("envelope codec failed: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("recording metadata payload is not valid UTF-8 JSON: {0}")]
    Json(String),
    #[error("recording metadata must be a JSON object at the root")]
    NonObjectPayload,
}

pub async fn read(
    state: &EncryptionState,
    file_bytes: &[u8],
) -> Result<Option<Value>, RecordingMetaError> {
    let sub_key = state
        .sub_key(ArtifactKind::RecordingsMeta)
        .await
        .ok_or(RecordingMetaError::Locked)?;
    let (_header, plaintext) = envelope::read_envelope(&sub_key, file_bytes)?;
    if plaintext.is_empty() {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(&plaintext)
        .map_err(|e| RecordingMetaError::Json(e.to_string()))?;
    Ok(Some(value))
}

pub async fn write(
    state: &EncryptionState,
    value: &Value,
    mode: MasterKeyStorage,
    argon2: Argon2Params,
    argon2_salt: [u8; SALT_LEN],
) -> Result<Vec<u8>, RecordingMetaError> {
    if !value.is_object() {
        return Err(RecordingMetaError::NonObjectPayload);
    }
    let sub_key = state
        .sub_key(ArtifactKind::RecordingsMeta)
        .await
        .ok_or(RecordingMetaError::Locked)?;
    let plaintext =
        serde_json::to_vec(value).map_err(|e| RecordingMetaError::Json(e.to_string()))?;

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
    Ok(envelope::write_envelope(&sub_key, &header, &plaintext)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::MasterDek;
    use serde_json::json;

    #[tokio::test]
    async fn round_trip_vault_mode() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let payload = json!({
            "host": "example.com",
            "user": "alice",
            "startedAt": "2026-06-01T10:00:00Z",
            "chunks": ["00000.dat", "00001.dat"],
        });
        let blob = write(
            &state,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        let decoded = read(&state, &blob).await.unwrap().unwrap();
        assert_eq!(decoded, payload);
    }

    #[tokio::test]
    async fn settings_subkey_cannot_decrypt_recording_metadata() {
        // Sub-key domain separation: a file written with the
        // RecordingsMeta sub-key must not decrypt under any other
        // artifact's sub-key, even if both are derived from the same
        // master. This is the contract the HKDF labels exist to
        // enforce.
        use crate::artifacts::settings as settings_artifact;
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let payload = json!({ "kind": "recording" });
        let blob = write(
            &state,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        // settings::read uses Settings sub-key; should fail GCM auth.
        let err = settings_artifact::read(&state, &blob).await.unwrap_err();
        assert!(matches!(
            err,
            settings_artifact::SettingsError::Envelope(
                EnvelopeError::AuthenticationFailed
            ),
        ));
    }

    #[tokio::test]
    async fn locked_state_blocks_io() {
        let state = EncryptionState::new();
        let err = write(
            &state,
            &json!({}),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, RecordingMetaError::Locked));
    }

    #[tokio::test]
    async fn non_object_payload_rejected() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let err = write(
            &state,
            &json!(["a", "b"]),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, RecordingMetaError::NonObjectPayload));
    }
}
