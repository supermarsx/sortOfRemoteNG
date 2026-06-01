//! Phase 1 — encrypted settings (`settings.enc`).
//!
//! Replaces the plain `settings.json` with an envelope-encrypted file.
//! The writer is symmetric with `app_settings_commands::write_app_settings`
//! — it accepts the same shallow-merge `patch: Value` semantics, applies
//! the same root-object coercion, and produces a JSON-encoded body —
//! then runs it through the v2 envelope using the Settings sub-key.
//!
//! Dispatch policy at boot is owned by `app_settings_commands.rs`
//! (which has the `tauri::AppHandle` to resolve `app_data_dir`); this
//! module is path-agnostic so it stays trivially unit-testable.
//!
//! Filenames (relative to `<app_data_dir>`):
//!
//! ```text
//!   settings.json       v0 plaintext (legacy; read for migration only)
//!   settings.enc        v2 envelope (current)
//!   settings.json.v0.bak post-migration rollback copy (kept for one
//!                       release as a safety net; manual delete after)
//! ```

use rand::rngs::OsRng;
use rand::RngCore;
use serde_json::Value;

use crate::dek::ArtifactKind;
use crate::envelope::{
    self, EnvelopeError, EnvelopeHeader, MasterKeyStorage, NONCE_LEN, SALT_LEN,
};
use crate::password_wrap::Argon2Params;
use crate::state::EncryptionState;

/// Filename for the encrypted settings blob inside the app-data dir.
pub const SETTINGS_ENC_FILENAME: &str = "settings.enc";

/// Filename for the post-migration plaintext backup.
pub const SETTINGS_BACKUP_FILENAME: &str = "settings.json.v0.bak";

/// Errors raised by the settings artifact codec.
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("encryption state is locked; unlock before reading or writing")]
    Locked,
    #[error("envelope codec failed: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("settings payload is not valid UTF-8 JSON: {0}")]
    Json(String),
    #[error("settings patch must be a JSON object at the root")]
    NonObjectPatch,
}

/// Read an encrypted settings file. Returns `Ok(None)` if the file is
/// empty (a zero-byte envelope round-trip is legal and represents
/// "decrypted to empty body"); the caller decides what default object
/// to use.
pub async fn read(
    state: &EncryptionState,
    file_bytes: &[u8],
) -> Result<Option<Value>, SettingsError> {
    let sub_key = state
        .sub_key(ArtifactKind::Settings)
        .await
        .ok_or(SettingsError::Locked)?;
    let (_header, plaintext) = envelope::read_envelope(&sub_key, file_bytes)?;
    if plaintext.is_empty() {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(&plaintext)
        .map_err(|e| SettingsError::Json(e.to_string()))?;
    Ok(Some(value))
}

/// Encode the given JSON value as a v2 envelope. Caller supplies the
/// header mode (vault / password / hybrid) so the on-disk preamble
/// faithfully records what was in effect at write-time — this is what
/// the unlock screen uses to choose the right prompt at next boot.
pub async fn write(
    state: &EncryptionState,
    value: &Value,
    mode: MasterKeyStorage,
    argon2: Argon2Params,
    argon2_salt: [u8; SALT_LEN],
) -> Result<Vec<u8>, SettingsError> {
    if !value.is_object() {
        return Err(SettingsError::NonObjectPatch);
    }
    let sub_key = state
        .sub_key(ArtifactKind::Settings)
        .await
        .ok_or(SettingsError::Locked)?;

    let plaintext = serde_json::to_vec(value).map_err(|e| SettingsError::Json(e.to_string()))?;

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

/// Shallow-merge a patch object into an existing settings object at
/// the root. Mirrors the semantics of `app_settings_commands::
/// merge_root` so v0 and v2 behave identically from the caller's
/// perspective.
pub fn merge_root(mut existing: Value, patch: &Value) -> Result<Value, SettingsError> {
    if !existing.is_object() {
        existing = serde_json::json!({});
    }
    let patch_obj = patch.as_object().ok_or(SettingsError::NonObjectPatch)?;
    let obj = existing.as_object_mut().expect("coerced above");
    for (k, v) in patch_obj {
        obj.insert(k.clone(), v.clone());
    }
    Ok(existing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::MasterDek;
    use serde_json::json;

    fn install_dek(state: &EncryptionState) -> tokio::task::JoinHandle<()> {
        let state = state.clone();
        tokio::task::spawn(async move {
            state.install(MasterDek::generate()).await;
        })
    }

    #[tokio::test]
    async fn vault_mode_round_trip() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;

        let payload = json!({ "theme": "dark", "language": "en" });
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
    async fn password_mode_writes_argon2_params_into_header() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;

        let payload = json!({ "key": "value" });
        let argon = Argon2Params {
            memory_kib: 32_768,
            time_cost: 2,
            parallelism: 2,
        };
        let salt = [7u8; SALT_LEN];
        let blob = write(
            &state,
            &payload,
            MasterKeyStorage::Password,
            argon,
            salt,
        )
        .await
        .unwrap();

        // Inspect the preamble directly: the unlock screen reads exactly
        // these bytes to decide what to prompt the user for.
        let header = EnvelopeHeader::decode(&blob[..envelope::PREAMBLE_LEN]).unwrap();
        assert_eq!(header.master_key_storage, MasterKeyStorage::Password);
        assert_eq!(header.argon2_memory_kib, 32_768);
        assert_eq!(header.argon2_time_cost, 2);
        assert_eq!(header.argon2_parallelism, 2);
        assert_eq!(header.argon2_salt, salt);
    }

    #[tokio::test]
    async fn read_locked_returns_locked_error() {
        let state = EncryptionState::new();
        // Build a valid blob with a temporarily-installed key, then
        // lock the state before reading.
        state.install(MasterDek::generate()).await;
        let blob = write(
            &state,
            &json!({}),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        state.lock().await;
        assert!(matches!(
            read(&state, &blob).await,
            Err(SettingsError::Locked)
        ));
    }

    #[tokio::test]
    async fn write_locked_returns_locked_error() {
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
        assert!(matches!(err, SettingsError::Locked));
    }

    #[tokio::test]
    async fn non_object_payload_rejected() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let err = write(
            &state,
            &json!([1, 2, 3]),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, SettingsError::NonObjectPatch));
    }

    #[tokio::test]
    async fn empty_object_round_trips() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let blob = write(
            &state,
            &json!({}),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        let decoded = read(&state, &blob).await.unwrap().unwrap();
        assert_eq!(decoded, json!({}));
    }

    #[tokio::test]
    async fn cross_state_decryption_fails() {
        // Sanity: a blob written by one master cannot be read by
        // another, even with the same artifact kind.
        let s1 = EncryptionState::new();
        let s2 = EncryptionState::new();
        s1.install(MasterDek::generate()).await;
        s2.install(MasterDek::generate()).await;
        let blob = write(
            &s1,
            &json!({"a": 1}),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        assert!(matches!(
            read(&s2, &blob).await,
            Err(SettingsError::Envelope(EnvelopeError::AuthenticationFailed))
        ));
    }

    #[test]
    fn merge_root_overlays_patch() {
        let existing = json!({"theme": "dark", "updater": {"private": "x"}});
        let patch = json!({"theme": "light", "language": "fr"});
        let merged = merge_root(existing, &patch).unwrap();
        assert_eq!(merged["theme"], "light");
        assert_eq!(merged["language"], "fr");
        // Untouched keys preserved.
        assert_eq!(merged["updater"]["private"], "x");
    }

    #[test]
    fn merge_root_rejects_non_object_patch() {
        assert!(matches!(
            merge_root(json!({}), &json!([1])),
            Err(SettingsError::NonObjectPatch)
        ));
    }

    #[test]
    fn merge_root_coerces_non_object_existing() {
        let merged = merge_root(json!("garbage"), &json!({"a": 1})).unwrap();
        assert_eq!(merged["a"], 1);
    }

    #[tokio::test]
    async fn install_dek_in_a_task_does_not_deadlock() {
        // Smoke test that the shared state works across task
        // boundaries — used by the eventual frontend command paths.
        let state = EncryptionState::new();
        install_dek(&state).await.unwrap();
        assert!(state.is_unlocked().await);
    }
}
