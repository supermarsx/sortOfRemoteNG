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
    async fn survives_process_restart_via_master_bytes() {
        // Same persistence invariant as `settings`: a rebuilt state
        // initialised from only the raw master bytes must decode
        // blobs the original state wrote. This is what guarantees
        // `data.enc` survives an app restart.
        let state_a = EncryptionState::new();
        state_a.install(MasterDek::generate()).await;

        let payload = json!({
            "connections": [{ "id": "c1", "host": "example.com" }],
            "settings": { "theme": "dark" },
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
        // Short buffer must be a typed error, not a panic.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let buf = [0u8; 32];
        assert!(read(&state, &buf).await.is_err());
    }

    #[tokio::test]
    async fn valid_magic_garbage_body_fails_gcm_auth() {
        // Preamble decodes, but the body is random — GCM auth must
        // reject it. Confirms the AAD-binds-preamble-to-body contract.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let header = EnvelopeHeader::new_vault([0u8; NONCE_LEN]);
        let mut blob = header.encode().to_vec();
        blob.extend((0..256).map(|i| (i as u8).wrapping_mul(17)));
        assert!(matches!(
            read(&state, &blob).await,
            Err(ConnectionsError::Envelope(EnvelopeError::AuthenticationFailed))
        ));
    }

    #[tokio::test]
    async fn cross_codec_rejection_matrix() {
        // Every pair (producer, consumer) where producer != consumer
        // must fail at read time. The HKDF labels in `dek.rs` exist
        // to enforce exactly this property: a file written under one
        // sub-key cannot be decrypted under any other, even when both
        // sub-keys derive from the same master DEK. This test is the
        // exhaustive cartesian-product proof.
        //
        // Two failure shapes appear in the matrix:
        //  - whole-file-codec ↔ whole-file-codec: preamble parses
        //    successfully (same envelope format), then GCM auth fails
        //    on the body because the sub-key differs.
        //  - whole-file-codec ↔ media: the preambles have different
        //    `kind` discriminants (envelope = 0, chunked-stream = 2)
        //    *and* different lengths (64 vs 32). Decoding may bail on
        //    header parse OR on body auth depending on direction. We
        //    don't pin the variant — only that the read returns Err.
        use crate::artifacts::{
            backups as b, connections as c, logs as l, macros as m,
            recording_media as rmedia, recording_meta as rm, settings as s,
        };

        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;

        let obj = json!({ "k": "v" });
        let bytes: &[u8] = b"opaque-bytes-payload";

        // Produce one blob per codec with the same logical payload
        // shape (JSON object for object codecs, raw bytes for byte
        // codecs). All under Vault mode for simplicity.
        let blob_s = s::write(&state, &obj, MasterKeyStorage::Vault, Argon2Params::OWASP, [0; SALT_LEN]).await.unwrap();
        let blob_c = c::write(&state, &obj, MasterKeyStorage::Vault, Argon2Params::OWASP, [0; SALT_LEN]).await.unwrap();
        let blob_b = b::write(&state, bytes, MasterKeyStorage::Vault, Argon2Params::OWASP, [0; SALT_LEN]).await.unwrap();
        let blob_m = m::write(&state, &obj, MasterKeyStorage::Vault, Argon2Params::OWASP, [0; SALT_LEN]).await.unwrap();
        let blob_rm = rm::write(&state, &obj, MasterKeyStorage::Vault, Argon2Params::OWASP, [0; SALT_LEN]).await.unwrap();
        let blob_l = l::write(&state, bytes, MasterKeyStorage::Vault, Argon2Params::OWASP, [0; SALT_LEN]).await.unwrap();
        let blob_media = rmedia::write_one_shot(&state, bytes, MasterKeyStorage::Vault, Some(64)).await.unwrap();

        // Whole-file ↔ whole-file off-diagonal: every consumer rejects
        // every producer that isn't itself.
        assert!(s::read(&state, &blob_c).await.is_err());
        assert!(s::read(&state, &blob_b).await.is_err());
        assert!(s::read(&state, &blob_m).await.is_err());
        assert!(s::read(&state, &blob_rm).await.is_err());
        assert!(s::read(&state, &blob_l).await.is_err());

        assert!(c::read(&state, &blob_s).await.is_err());
        assert!(c::read(&state, &blob_b).await.is_err());
        assert!(c::read(&state, &blob_m).await.is_err());
        assert!(c::read(&state, &blob_rm).await.is_err());
        assert!(c::read(&state, &blob_l).await.is_err());

        assert!(b::read(&state, &blob_s).await.is_err());
        assert!(b::read(&state, &blob_c).await.is_err());
        assert!(b::read(&state, &blob_m).await.is_err());
        assert!(b::read(&state, &blob_rm).await.is_err());
        assert!(b::read(&state, &blob_l).await.is_err());

        assert!(m::read(&state, &blob_s).await.is_err());
        assert!(m::read(&state, &blob_c).await.is_err());
        assert!(m::read(&state, &blob_b).await.is_err());
        assert!(m::read(&state, &blob_rm).await.is_err());
        assert!(m::read(&state, &blob_l).await.is_err());

        assert!(rm::read(&state, &blob_s).await.is_err());
        assert!(rm::read(&state, &blob_c).await.is_err());
        assert!(rm::read(&state, &blob_b).await.is_err());
        assert!(rm::read(&state, &blob_m).await.is_err());
        assert!(rm::read(&state, &blob_l).await.is_err());

        assert!(l::read(&state, &blob_s).await.is_err());
        assert!(l::read(&state, &blob_c).await.is_err());
        assert!(l::read(&state, &blob_b).await.is_err());
        assert!(l::read(&state, &blob_m).await.is_err());
        assert!(l::read(&state, &blob_rm).await.is_err());

        // Whole-file → media: a 64-byte envelope preamble fed to the
        // media decoder reads `kind` byte 7 = envelope-kind (not
        // chunked-stream); media must reject it.
        assert!(rmedia::read_all(&state, &blob_s).await.is_err());
        assert!(rmedia::read_all(&state, &blob_c).await.is_err());
        assert!(rmedia::read_all(&state, &blob_b).await.is_err());
        assert!(rmedia::read_all(&state, &blob_m).await.is_err());
        assert!(rmedia::read_all(&state, &blob_rm).await.is_err());
        assert!(rmedia::read_all(&state, &blob_l).await.is_err());

        // Media → whole-file: media's 32-byte header has `kind = 2`
        // at byte 7 which envelope reads as `MasterKeyStorage =
        // VaultAndPassword`. Preamble parse may succeed, then GCM
        // auth fails on the body — either way the read returns Err.
        assert!(s::read(&state, &blob_media).await.is_err());
        assert!(c::read(&state, &blob_media).await.is_err());
        assert!(b::read(&state, &blob_media).await.is_err());
        assert!(m::read(&state, &blob_media).await.is_err());
        assert!(rm::read(&state, &blob_media).await.is_err());
        assert!(l::read(&state, &blob_media).await.is_err());
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
