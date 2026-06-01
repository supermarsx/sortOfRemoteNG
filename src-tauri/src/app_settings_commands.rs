//! Frontend application settings persistence.
//!
//! The frontend `GlobalSettings` blob is stored at the root of
//! `<app_data_dir>` as one of:
//!
//! - `settings.json` — v0, plaintext JSON, the legacy format.
//! - `settings.enc` — v2, the [`sorng_encryption`] envelope codec under
//!   [`ArtifactKind::Settings`]. Produced once the user runs
//!   `encryption_migrate_settings`; written transparently by every
//!   subsequent `write_app_settings` while the [`EncryptionState`] is
//!   unlocked.
//!
//! Read dispatch: `.enc` first, fall back to `.json`. Write dispatch:
//! `.enc` when the encryption state is unlocked, plaintext `.json`
//! otherwise — there's no "stay on plaintext after migration" branch
//! because that would be a silent regression. After
//! `encryption_disable_settings` runs, the encrypted file is gone and
//! `.json` is back, so the next write naturally goes to `.json`.
//!
//! The reader still merges arbitrary root-level keys (e.g. the
//! updater object) regardless of which format produced the blob,
//! preserving the old contract.

use serde_json::Value;
use sorng_encryption::artifacts::settings as artifact_settings;
use sorng_encryption::envelope::{MasterKeyStorage, SALT_LEN};
use sorng_encryption::password_wrap::Argon2Params;
use sorng_encryption::EncryptionState;
use tauri::{Manager, State};

const SETTINGS_FILENAME: &str = "settings.json";
const SETTINGS_ENC_FILENAME: &str = "settings.enc";
const DEK_ENC_FILENAME: &str = "dek.enc";

/// Probe the live mode from disk + vault. Mirrors the logic in
/// `encryption_status` so the writer below stamps the preamble with
/// the same mode that the unlock screen will see at next boot.
async fn current_master_key_storage(
    dir: &std::path::Path,
) -> MasterKeyStorage {
    let vault_present = sorng_vault::keychain::read_dek().await.is_ok();
    let dek_enc_present = dir.join(DEK_ENC_FILENAME).exists();
    match (vault_present, dek_enc_present) {
        (true, true) => MasterKeyStorage::VaultAndPassword,
        (true, false) => MasterKeyStorage::Vault,
        (false, true) => MasterKeyStorage::Password,
        (false, false) => MasterKeyStorage::Vault, // sensible default
    }
}

/// Pure-Rust entry point shared by the Tauri command and the boot-
/// time capability priming in `state_registry`. Takes a borrowed
/// `EncryptionState` so callers that already have a handle don't have
/// to round-trip through `app.state::<…>()`.
pub async fn read_app_settings_inner(
    dir: &std::path::Path,
    enc_state: &EncryptionState,
) -> Result<Option<Value>, String> {
    let enc_path = dir.join(SETTINGS_ENC_FILENAME);
    let plain_path = dir.join(SETTINGS_FILENAME);

    // Prefer the encrypted file if present. Even when locked we don't
    // silently fall back to plaintext — that path would let an
    // attacker delete `settings.enc` and force a downgrade. Instead we
    // surface "locked" to the caller, who can render an explainer.
    if enc_path.exists() {
        let bytes = std::fs::read(&enc_path)
            .map_err(|e| format!("read settings.enc: {e}"))?;
        if !enc_state.is_unlocked().await {
            return Err(
                "settings are encrypted; unlock first via Settings → Security"
                    .into(),
            );
        }
        let value = artifact_settings::read(enc_state, &bytes)
            .await
            .map_err(|e| format!("decode settings.enc: {e}"))?;
        return Ok(value.or(Some(serde_json::json!({}))));
    }

    match std::fs::read_to_string(&plain_path) {
        Ok(s) => {
            let value: Value = serde_json::from_str(&s)
                .map_err(|e| format!("parse settings.json: {e}"))?;
            Ok(Some(value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Read the whole settings blob. Tries `settings.enc` first, then
/// falls back to plaintext `settings.json`. Returns `None` when
/// neither exists (first-ever start).
///
/// Outcomes the caller may see:
/// - `Ok(Some(value))` — settings recovered, either from the
///   encrypted file (state was unlocked when called) or the
///   plaintext file (still v0 or not yet migrated).
/// - `Ok(None)` — neither file exists yet.
/// - `Err(...)` — the encrypted file exists but the state is locked,
///   or the file is corrupted. The caller surfaces this to the UI as
///   "encryption is locked; unlock to load preferences".
#[tauri::command]
pub async fn read_app_settings(
    app: tauri::AppHandle,
    enc_state: State<'_, EncryptionState>,
) -> Result<Option<Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    read_app_settings_inner(&dir, &enc_state).await
}

/// Shallow-merge `patch` into the live settings root and persist.
/// Picks the format automatically:
///
/// - When [`EncryptionState`] is unlocked, the merged blob lands in
///   `settings.enc` (v2 envelope). Any pre-existing plaintext file is
///   left untouched as a one-release rollback safety net; the post-
///   migration commit renames it to `.v0.bak`, so callers won't see a
///   stale file in normal operation.
/// - When locked, the merge writes plaintext `settings.json` — this
///   keeps the boot flow that loads window geometry before unlock
///   working unchanged. Sensitive keys are still in the user's hands
///   here; the encryption story applies once they migrate.
///
/// The existing-object base is always read through `read_app_settings`,
/// so the merge composition is identical between the two paths.
#[tauri::command]
pub async fn write_app_settings(
    app: tauri::AppHandle,
    enc_state: State<'_, EncryptionState>,
    patch: Value,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    write_app_settings_inner(&dir, &enc_state, patch).await
}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Shallow-merge `patch`'s top-level keys into `existing` at the root.
/// `existing` is coerced to an object if it isn't one. Keys in `existing`
/// but not in `patch` (e.g. the backend-managed `updater` object) are
/// preserved untouched. Pure function so it can be unit-tested without a
/// Tauri app / filesystem.
fn merge_root(mut existing: Value, patch: &Value) -> Result<Value, String> {
    if !existing.is_object() {
        existing = serde_json::json!({});
    }
    let patch_obj = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;
    let obj = existing.as_object_mut().expect("coerced to object above");
    for (key, value) in patch_obj {
        obj.insert(key.clone(), value.clone());
    }
    Ok(existing)
}

/// Pure-Rust write entry-point shared by the Tauri command and any
/// future caller that already holds the encryption state by
/// reference. Kept symmetric with `read_app_settings_inner`.
pub async fn write_app_settings_inner(
    dir: &std::path::Path,
    enc_state: &EncryptionState,
    patch: Value,
) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let enc_path = dir.join(SETTINGS_ENC_FILENAME);
    let plain_path = dir.join(SETTINGS_FILENAME);

    let existing: Value = if enc_path.exists() {
        if !enc_state.is_unlocked().await {
            return Err(
                "settings are encrypted; unlock first via Settings → Security"
                    .into(),
            );
        }
        let bytes = std::fs::read(&enc_path)
            .map_err(|e| format!("read settings.enc: {e}"))?;
        artifact_settings::read(enc_state, &bytes)
            .await
            .map_err(|e| format!("decode settings.enc: {e}"))?
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        match std::fs::read_to_string(&plain_path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| serde_json::json!({})),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
            Err(e) => return Err(e.to_string()),
        }
    };
    let merged = merge_root(existing, &patch)?;

    if enc_state.is_unlocked().await {
        let mode = current_master_key_storage(dir).await;
        let salt = [0u8; SALT_LEN];
        let blob = artifact_settings::write(
            enc_state,
            &merged,
            mode,
            Argon2Params::OWASP,
            salt,
        )
        .await
        .map_err(|e| format!("encode settings.enc: {e}"))?;
        atomic_write(&enc_path, &blob)?;
        if plain_path.exists() && plain_path != dir.join("settings.json.v0.bak") {
            let _ = std::fs::remove_file(&plain_path);
        }
        Ok(())
    } else {
        let body = serde_json::to_string_pretty(&merged)
            .map_err(|e| format!("serialize settings.json: {e}"))?;
        atomic_write(&plain_path, body.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_encryption::MasterDek;
    use tempfile::tempdir;

    #[test]
    fn merges_frontend_keys_and_preserves_updater() {
        let existing = serde_json::json!({
            "theme": "dark",
            "updater": { "privateEndpointUrl": "https://priv.example/x" }
        });
        let patch = serde_json::json!({ "theme": "light", "language": "fr" });
        let merged = merge_root(existing, &patch).unwrap();

        assert_eq!(merged["theme"], "light");
        assert_eq!(merged["language"], "fr");
        // Backend-managed sibling left intact.
        assert_eq!(
            merged["updater"]["privateEndpointUrl"],
            "https://priv.example/x"
        );
    }

    #[test]
    fn coerces_non_object_root() {
        let merged = merge_root(serde_json::json!("garbage"), &serde_json::json!({ "a": 1 }))
            .unwrap();
        assert_eq!(merged["a"], 1);
    }

    #[test]
    fn rejects_non_object_patch() {
        assert!(merge_root(serde_json::json!({}), &serde_json::json!([1, 2])).is_err());
    }

    /// Build an unlocked `EncryptionState` directly, bypassing the
    /// vault/password flow so we can exercise the dispatch table.
    async fn unlocked_state() -> EncryptionState {
        let state = EncryptionState::new();
        let dek = MasterDek::from_bytes(&[0x42u8; 32]).expect("32-byte DEK");
        state.install(dek).await;
        state
    }

    #[tokio::test]
    async fn write_while_locked_lands_in_plaintext_json() {
        let tmp = tempdir().unwrap();
        let state = EncryptionState::new(); // locked
        write_app_settings_inner(
            tmp.path(),
            &state,
            serde_json::json!({ "theme": "dark" }),
        )
        .await
        .unwrap();

        assert!(tmp.path().join("settings.json").exists());
        assert!(!tmp.path().join("settings.enc").exists());
    }

    #[tokio::test]
    async fn write_while_unlocked_lands_in_enc() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state().await;
        write_app_settings_inner(
            tmp.path(),
            &state,
            serde_json::json!({ "theme": "dark" }),
        )
        .await
        .unwrap();

        assert!(tmp.path().join("settings.enc").exists());
        // No stale plaintext should have been left behind by this
        // freshly-created directory.
        assert!(!tmp.path().join("settings.json").exists());
    }

    #[tokio::test]
    async fn read_prefers_enc_over_plaintext() {
        let tmp = tempdir().unwrap();
        // Plant a plaintext that we explicitly *don't* want to win.
        std::fs::write(
            tmp.path().join("settings.json"),
            br#"{"theme":"stale"}"#,
        )
        .unwrap();
        let state = unlocked_state().await;
        write_app_settings_inner(
            tmp.path(),
            &state,
            serde_json::json!({ "theme": "fresh" }),
        )
        .await
        .unwrap();

        // The `.enc` write should have removed the stale `.json` and
        // the next read should reflect the encrypted truth.
        assert!(tmp.path().join("settings.enc").exists());
        assert!(!tmp.path().join("settings.json").exists());
        let value = read_app_settings_inner(tmp.path(), &state)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(value["theme"], "fresh");
    }

    #[tokio::test]
    async fn read_locked_enc_surfaces_lock_error() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state().await;
        write_app_settings_inner(
            tmp.path(),
            &state,
            serde_json::json!({ "theme": "dark" }),
        )
        .await
        .unwrap();

        // Drop to a locked state and re-read; the dispatcher must not
        // silently fall back to plaintext (it doesn't exist anyway, but
        // the contract is independent of that).
        let locked = EncryptionState::new();
        let err = read_app_settings_inner(tmp.path(), &locked)
            .await
            .unwrap_err();
        assert!(
            err.contains("encrypted") || err.contains("unlock"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn read_missing_returns_none() {
        let tmp = tempdir().unwrap();
        let state = EncryptionState::new();
        let value = read_app_settings_inner(tmp.path(), &state).await.unwrap();
        assert!(value.is_none());
    }

    #[tokio::test]
    async fn v0_to_v2_transition_preserves_data() {
        // Mirrors the data-loss bug: app writes settings.json while
        // locked, then user enables encryption (state flips unlocked
        // mid-session) and writes again. The merged blob must contain
        // both updates.
        let tmp = tempdir().unwrap();

        let locked = EncryptionState::new();
        write_app_settings_inner(
            tmp.path(),
            &locked,
            serde_json::json!({ "theme": "dark", "language": "en" }),
        )
        .await
        .unwrap();
        assert!(tmp.path().join("settings.json").exists());

        let unlocked = unlocked_state().await;
        write_app_settings_inner(
            tmp.path(),
            &unlocked,
            serde_json::json!({ "language": "fr", "windowSize": 1080 }),
        )
        .await
        .unwrap();
        assert!(tmp.path().join("settings.enc").exists());
        assert!(!tmp.path().join("settings.json").exists());

        let value = read_app_settings_inner(tmp.path(), &unlocked)
            .await
            .unwrap()
            .unwrap();
        // The v0 key that wasn't in the second patch must survive.
        assert_eq!(value["theme"], "dark");
        // The patched key must reflect the newer write.
        assert_eq!(value["language"], "fr");
        // The brand-new key must be present.
        assert_eq!(value["windowSize"], 1080);
    }
}
