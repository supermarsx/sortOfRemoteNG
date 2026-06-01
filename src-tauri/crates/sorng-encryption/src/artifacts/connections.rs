//! Phase 8 — encrypted connections database (`data.json` →
//! `data.enc`).
//!
//! Replaces the legacy `SORNG_ENC:` text-prefixed file (PBKDF2/600k,
//! database-password-derived) with the unified v2 envelope under
//! [`ArtifactKind::Connections`]. Same on-disk shape as `settings.enc`
//! — JSON object payload, sub-key domain-separated from every other
//! artifact via the `sorng-v1::connections` HKDF label.
//!
//! Migration semantics live in `sorng-storage::storage`: when the file
//! still begins with the legacy `SORNG_ENC:` ASCII prefix, the storage
//! layer asks for the database password, decrypts with PBKDF2, then
//! re-encrypts with this codec under the master DEK and renames the
//! original to `data.json.v0.bak`. After migration the database
//! password is no longer needed — the master key unlocks both the
//! settings and the connections store.

use rand::rngs::OsRng;
use rand::RngCore;
use serde_json::Value;

use crate::dek::ArtifactKind;
use crate::envelope::{
    self, EnvelopeError, EnvelopeHeader, MasterKeyStorage, NONCE_LEN, SALT_LEN,
};
use crate::password_wrap::Argon2Params;
use crate::state::EncryptionState;

/// Errors raised by the connections artifact codec.
#[derive(Debug, thiserror::Error)]
pub enum ConnectionsError {
    #[error("encryption state is locked; unlock before reading or writing connections")]
    Locked,
    #[error("envelope codec failed: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("connections payload is not valid UTF-8 JSON: {0}")]
    Json(String),
    #[error("connections payload must be a JSON object at the root")]
    NonObjectPayload,
}

/// Decrypt a connections envelope. Empty plaintext decodes to `None`
/// so a caller seeing "envelope round-tripped, body empty" can choose
/// whether to treat it as missing or as an empty database.
pub async fn read(
    state: &EncryptionState,
    file_bytes: &[u8],
) -> Result<Option<Value>, ConnectionsError> {
    let sub_key = state
        .sub_key(ArtifactKind::Connections)
        .await
        .ok_or(ConnectionsError::Locked)?;
    let (_header, plaintext) = envelope::read_envelope(&sub_key, file_bytes)?;
    if plaintext.is_empty() {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(&plaintext)
        .map_err(|e| ConnectionsError::Json(e.to_string()))?;
    Ok(Some(value))
}

/// Encode a connections JSON object as a v2 envelope. Caller supplies
/// the mode so the preamble matches what the unlock screen needs to
/// see at next boot — the same contract as `artifacts::settings`.
pub async fn write(
    state: &EncryptionState,
    value: &Value,
    mode: MasterKeyStorage,
    argon2: Argon2Params,
    argon2_salt: [u8; SALT_LEN],
) -> Result<Vec<u8>, ConnectionsError> {
    if !value.is_object() {
        return Err(ConnectionsError::NonObjectPayload);
    }
    let sub_key = state
        .sub_key(ArtifactKind::Connections)
        .await
        .ok_or(ConnectionsError::Locked)?;
    let plaintext =
        serde_json::to_vec(value).map_err(|e| ConnectionsError::Json(e.to_string()))?;

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
            "connections": [
                { "id": "c1", "host": "example.com", "user": "alice" },
                { "id": "c2", "host": "bastion.local", "user": "bob" }
            ],
            "settings": { "theme": "dark" },
            "timestamp": 1_700_000_000_u64,
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
    async fn settings_subkey_cannot_decrypt_connections() {
        // Sub-key domain separation contract: a file written with the
        // Connections sub-key must not decrypt under any other
        // artifact's key. This is the property HKDF labels enforce
        // and the reason `sorng-v1::*` lives in `dek::ArtifactKind`.
        use crate::artifacts::settings as settings_artifact;
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let payload = json!({ "kind": "connections" });
        let blob = write(
            &state,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
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
        assert!(matches!(err, ConnectionsError::Locked));
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
        assert!(matches!(err, ConnectionsError::NonObjectPayload));
    }

    #[tokio::test]
    async fn empty_envelope_round_trips_to_none() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let sub_key = state.sub_key(ArtifactKind::Connections).await.unwrap();
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);
        let header = EnvelopeHeader::new_vault(nonce);
        // Hand-craft an envelope with an empty body to confirm the
        // `None` branch — the storage layer relies on this to
        // distinguish "empty database" from "file missing".
        let blob = envelope::write_envelope(&sub_key, &header, &[]).unwrap();
        let result = read(&state, &blob).await.unwrap();
        assert!(result.is_none());
    }
}
