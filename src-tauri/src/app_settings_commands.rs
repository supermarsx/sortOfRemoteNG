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
///   removed after the encrypted write succeeds so secrets do not
///   remain available outside the envelope.
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

/// Number of attempts the atomic writer makes before giving up. Rides
/// out transient failures (AV file locks, a momentarily-vanished
/// app-data dir, a temp sweep racing the rename).
const ATOMIC_WRITE_MAX_ATTEMPTS: u32 = 3;
/// Base backoff between retry attempts. Multiplied by the attempt index
/// for a small linear back-off (10ms, 20ms).
const ATOMIC_WRITE_BACKOFF: std::time::Duration = std::time::Duration::from_millis(10);

/// Derive a per-target temp path so the `.enc` and `.json` writes never
/// share a single `settings.tmp` and clobber each other's in-flight
/// bytes. The temp lives in the same directory as the target (so the
/// final `rename` stays on one filesystem and is atomic) but carries a
/// file-name-derived, `.tmp`-suffixed name, e.g.
/// `settings.enc` → `.settings.enc.tmp`, `settings.json` →
/// `.settings.json.tmp`.
fn temp_path_for(path: &std::path::Path) -> std::path::PathBuf {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "settings".to_string());
    let tmp_name = format!(".{file_name}.tmp");
    match path.parent() {
        Some(parent) => parent.join(tmp_name),
        None => std::path::PathBuf::from(tmp_name),
    }
}

/// Write `bytes` to `path` atomically and defensively.
///
/// Each attempt: (re)create the target's parent directory so a
/// vanished/relocated app-data dir self-heals, write the bytes to a
/// per-target temp file, then atomically `rename` it into place. The
/// whole sequence is wrapped in a bounded retry so a transient failure
/// (AV lock, the dir disappearing between create and rename, a swept
/// temp) is ridden out rather than surfaced as a bare `os error 2`.
///
/// On final failure the error is **path-prefixed**
/// (`write <path>: <e>`) so a future failure is diagnosable instead of
/// a context-free OS error.
/// Write `bytes` to `tmp` and `sync_all()` the handle before returning,
/// so the data + file metadata are flushed to stable storage BEFORE the
/// caller renames the temp into place. Without this barrier a crash after
/// the rename can leave the target as a durably-committed directory entry
/// pointing at un-flushed (zero-length / garbage) data, with the previous
/// good settings already gone.
fn write_and_sync(tmp: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = std::fs::File::create(tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

/// fsync the directory holding `path` so the rename itself is durable.
/// POSIX-only — on Windows the NTFS journal covers directory metadata as
/// part of the rename and directories can't be opened for fsync, so this
/// is a graceful no-op.
#[cfg(unix)]
fn sync_parent_dir(path: &std::path::Path) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_path: &std::path::Path) {}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_path_for(path);
    let mut last_err: Option<String> = None;

    for attempt in 0..ATOMIC_WRITE_MAX_ATTEMPTS {
        // Self-heal a missing parent every attempt: the dir may have
        // been deleted between the caller's create_dir_all and now, or
        // between a previous failed attempt and this one.
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                last_err = Some(format!("{e}"));
                if attempt + 1 < ATOMIC_WRITE_MAX_ATTEMPTS {
                    std::thread::sleep(ATOMIC_WRITE_BACKOFF * (attempt + 1));
                }
                continue;
            }
        }

        if let Err(e) = write_and_sync(&tmp, bytes) {
            last_err = Some(format!("{e}"));
            let _ = std::fs::remove_file(&tmp);
            if attempt + 1 < ATOMIC_WRITE_MAX_ATTEMPTS {
                std::thread::sleep(ATOMIC_WRITE_BACKOFF * (attempt + 1));
            }
            continue;
        }

        match std::fs::rename(&tmp, path) {
            Ok(()) => {
                sync_parent_dir(path);
                return Ok(());
            }
            Err(e) => {
                last_err = Some(format!("{e}"));
                // Don't leak the temp on a failed rename; ignore the
                // cleanup result (best-effort).
                let _ = std::fs::remove_file(&tmp);
                if attempt + 1 < ATOMIC_WRITE_MAX_ATTEMPTS {
                    std::thread::sleep(ATOMIC_WRITE_BACKOFF * (attempt + 1));
                }
            }
        }
    }

    Err(format!(
        "write {}: {}",
        path.display(),
        last_err.unwrap_or_else(|| "unknown error".to_string())
    ))
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

        // Write the encrypted blob off the async worker — `atomic_write`
        // is blocking (it may `std::thread::sleep` between retries and it
        // fsyncs), so running it inline would stall a runtime thread.
        {
            let enc_path = enc_path.clone();
            let blob = blob.clone();
            tokio::task::spawn_blocking(move || atomic_write(&enc_path, &blob))
                .await
                .map_err(|e| format!("settings.enc write task join: {e}"))??;
        }

        // Verify-before-delete. Re-read `settings.enc` from disk and
        // decrypt it back, confirming the envelope is both durable and
        // decryptable, BEFORE destroying the plaintext fallback. If the
        // blob were short/corrupt, or written under a key/mode the next
        // boot can't reproduce, deleting the plaintext here would leave
        // the user with an unreadable `settings.enc` and nothing to fall
        // back to ("unlock first" forever). On any verify failure we keep
        // the plaintext and surface an error — nothing is lost.
        let readback = std::fs::read(&enc_path)
            .map_err(|e| format!("verify settings.enc (read-back): {e}"))?;
        let decoded = artifact_settings::read(enc_state, &readback)
            .await
            .map_err(|e| format!("verify settings.enc (decrypt): {e}"))?
            .unwrap_or_else(|| serde_json::json!({}));
        if decoded != merged {
            return Err(
                "settings.enc failed read-back verification; kept plaintext settings.json"
                    .to_string(),
            );
        }

        // Verified — now it is safe to remove the plaintext shadow.
        // Best-effort: a failed removal must NOT abort after the `.enc`
        // is already committed and verified (that would surface a
        // spurious error and a confusing half-migrated state). The read
        // path prefers `.enc` over `.json` regardless, so a lingering
        // plaintext can't shadow the encrypted truth — it will be swept
        // on the next successful write.
        if plain_path.exists() {
            if let Err(e) = std::fs::remove_file(&plain_path) {
                log::warn!(
                    "settings.enc written and verified but plaintext removal failed \
                     (will retry on next write): {e}"
                );
            }
        }
        Ok(())
    } else {
        let body = serde_json::to_string_pretty(&merged)
            .map_err(|e| format!("serialize settings.json: {e}"))?;
        let plain_path = plain_path.clone();
        tokio::task::spawn_blocking(move || atomic_write(&plain_path, body.as_bytes()))
            .await
            .map_err(|e| format!("settings.json write task join: {e}"))?
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

    #[test]
    fn atomic_write_creates_missing_parent() {
        let tmp = tempdir().unwrap();
        // Target sits inside a nested directory that does NOT exist yet.
        let target = tmp
            .path()
            .join("nonexistent")
            .join("deeper")
            .join("settings.json");
        assert!(!target.parent().unwrap().exists());

        atomic_write(&target, b"hello-world").unwrap();

        assert!(target.exists());
        assert_eq!(std::fs::read(&target).unwrap(), b"hello-world");
    }

    #[test]
    fn atomic_write_is_atomic_no_temp_left_behind() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("settings.json");

        // First write establishes "old" content.
        atomic_write(&target, b"old-content").unwrap();
        // Second write replaces it with "new" content.
        atomic_write(&target, b"new-content").unwrap();

        // Target is fully the new bytes (no partial/truncated write).
        assert_eq!(std::fs::read(&target).unwrap(), b"new-content");

        // No stray temp file left behind after a successful write.
        let temp = temp_path_for(&target);
        assert!(
            !temp.exists(),
            "temp file {} should have been renamed away",
            temp.display()
        );
        // Belt-and-braces: nothing matching the legacy single-temp name
        // either.
        assert!(!tmp.path().join("settings.tmp").exists());
    }

    #[test]
    fn enc_and_json_have_distinct_temp_names() {
        let tmp = tempdir().unwrap();
        let enc = tmp.path().join(SETTINGS_ENC_FILENAME);
        let json = tmp.path().join(SETTINGS_FILENAME);

        let enc_temp = temp_path_for(&enc);
        let json_temp = temp_path_for(&json);

        // The two settings targets must derive DIFFERENT temp paths so
        // an interleaved `.enc`/`.json` write can't clobber each
        // other's in-flight temp.
        assert_ne!(
            enc_temp, json_temp,
            "enc and json must use distinct temp files"
        );
        // Both temps live next to their target (same dir → atomic
        // rename stays on one filesystem).
        assert_eq!(enc_temp.parent(), Some(tmp.path()));
        assert_eq!(json_temp.parent(), Some(tmp.path()));
    }

    #[tokio::test]
    async fn write_app_settings_inner_recovers_when_dir_deleted() {
        // Write once into a nested app-data dir, delete the whole dir,
        // then write again. The resilient writer's per-attempt
        // create_dir_all (plus the top-level create_dir_all) must
        // re-create the vanished directory and succeed.
        let tmp = tempdir().unwrap();
        let app_data = tmp.path().join("app-data");
        let locked = EncryptionState::new();

        write_app_settings_inner(
            &app_data,
            &locked,
            serde_json::json!({ "theme": "dark" }),
        )
        .await
        .unwrap();
        assert!(app_data.join("settings.json").exists());

        // Simulate a cleanup tool / known-folder relocation wiping the
        // app-data dir out from under us mid-session.
        std::fs::remove_dir_all(&app_data).unwrap();
        assert!(!app_data.exists());

        // Next write must self-heal rather than fail with os error 2.
        write_app_settings_inner(
            &app_data,
            &locked,
            serde_json::json!({ "language": "fr" }),
        )
        .await
        .unwrap();
        assert!(app_data.join("settings.json").exists());

        let value = read_app_settings_inner(&app_data, &locked)
            .await
            .unwrap()
            .unwrap();
        // The pre-deletion key is gone (dir was wiped) but the new
        // write landed cleanly.
        assert_eq!(value["language"], "fr");
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
