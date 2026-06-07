//! Phase 3b — encrypted macros library (`macros/*.enc`).
//!
//! Macro definitions are small JSON payloads carrying user-authored
//! command sequences that may embed credentials (the user records a
//! login flow). Same shape as `artifacts::settings`, different
//! sub-key ([`ArtifactKind::Macros`]).

use rand::rngs::OsRng;
use rand::RngCore;
use serde_json::Value;

use crate::dek::ArtifactKind;
use crate::envelope::{
    self, EnvelopeError, EnvelopeHeader, MasterKeyStorage, NONCE_LEN, SALT_LEN,
};
use crate::password_wrap::Argon2Params;
use crate::state::EncryptionState;

#[derive(Debug, thiserror::Error)]
pub enum MacroError {
    #[error("encryption state is locked; unlock before reading or writing macros")]
    Locked,
    #[error("envelope codec failed: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("macro payload is not valid UTF-8 JSON: {0}")]
    Json(String),
    #[error("macro payload must be a JSON object at the root")]
    NonObjectPayload,
}

pub async fn read(
    state: &EncryptionState,
    file_bytes: &[u8],
) -> Result<Option<Value>, MacroError> {
    let sub_key = state
        .sub_key(ArtifactKind::Macros)
        .await
        .ok_or(MacroError::Locked)?;
    let (_header, plaintext) = envelope::read_envelope(&sub_key, file_bytes)?;
    if plaintext.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        serde_json::from_slice(&plaintext).map_err(|e| MacroError::Json(e.to_string()))?,
    ))
}

pub async fn write(
    state: &EncryptionState,
    value: &Value,
    mode: MasterKeyStorage,
    argon2: Argon2Params,
    argon2_salt: [u8; SALT_LEN],
) -> Result<Vec<u8>, MacroError> {
    if !value.is_object() {
        return Err(MacroError::NonObjectPayload);
    }
    let sub_key = state
        .sub_key(ArtifactKind::Macros)
        .await
        .ok_or(MacroError::Locked)?;
    let plaintext = serde_json::to_vec(value).map_err(|e| MacroError::Json(e.to_string()))?;
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
    async fn round_trip() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let payload = json!({
            "macros": [
                { "id": "login-prod", "steps": [{ "kind": "input", "value": "admin" }] }
            ]
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
    async fn sub_key_isolation_from_settings() {
        // A macro blob must not decrypt under the Settings sub-key
        // even when both come from the same master DEK.
        use crate::artifacts::settings as settings_artifact;
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let blob = write(
            &state,
            &json!({ "macros": [] }),
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
    async fn non_object_payload_rejected() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        assert!(matches!(
            write(
                &state,
                &json!("string-payload"),
                MasterKeyStorage::Vault,
                Argon2Params::OWASP,
                [0u8; SALT_LEN],
            )
            .await
            .unwrap_err(),
            MacroError::NonObjectPayload
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
        assert!(matches!(err, MacroError::Locked));
    }

    #[tokio::test]
    async fn survives_process_restart_via_master_bytes() {
        // A user's recorded macro library must survive an app reboot.
        // Verify by carrying only the raw master bytes across a
        // simulated "restart" boundary.
        let state_a = EncryptionState::new();
        state_a.install(MasterDek::generate()).await;
        let payload = json!({
            "macros": [
                { "id": "login-prod", "steps": [{ "kind": "input", "value": "admin" }] }
            ]
        });
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

        let decoded = read(&state_b, &blob).await.unwrap().unwrap();
        assert_eq!(decoded, payload);
    }

    #[tokio::test]
    async fn truncated_input_is_clean_error() {
        // Short buffer must surface as a typed error.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let buf = [0u8; 32];
        assert!(read(&state, &buf).await.is_err());
    }

    #[tokio::test]
    async fn valid_magic_garbage_body_fails_gcm_auth() {
        // Valid preamble + random body → AAD binding forces GCM auth
        // failure.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let header = EnvelopeHeader::new_vault([0u8; NONCE_LEN]);
        let mut blob = header.encode().to_vec();
        blob.extend((0..256).map(|i| (i as u8).wrapping_mul(29)));
        assert!(matches!(
            read(&state, &blob).await,
            Err(MacroError::Envelope(EnvelopeError::AuthenticationFailed))
        ));
    }
}
