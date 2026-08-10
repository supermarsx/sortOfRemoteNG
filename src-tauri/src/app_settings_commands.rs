//! Frontend application settings persistence.
//!
//! The frontend `GlobalSettings` blob is stored at the root of
//! `<app_data_dir>` as one of:
//!
//! - `settings.json` — v0, plaintext JSON, the legacy format.
//! - `settings.enc` — v2, the [`sorng_encryption`] envelope codec under
//!   [`ArtifactKind::Settings`]. Produced once the user runs
//!   `encryption_migrate_settings`; written transparently by subsequent
//!   `write_app_settings` calls while that encrypted representation remains
//!   canonical.
//!
//! Read dispatch: `.enc` first, fall back to `.json`. Write dispatch:
//! preserve the canonical representation already on disk, using `.enc` for a
//! first-ever write only when the encryption state is unlocked. After
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
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Manager, State};

const SETTINGS_FILENAME: &str = "settings.json";
const SETTINGS_ENC_FILENAME: &str = "settings.enc";
const DEK_ENC_FILENAME: &str = "dek.enc";
pub(crate) const REST_API_VAULT_SERVICE: &str = "sortofremoteng.internal.rest-api";
const REST_API_KEY_ACCOUNT: &str = "api-key-v1";
const REST_API_JWT_ACCOUNT: &str = "jwt-signing-secret-v1";
const REST_API_SECRET_BYTES: usize = 32;

/// Makes each atomic-write temp name unique within a process. The process id in
/// `temp_path_for` keeps simultaneously-running app processes separate too.
static SETTINGS_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
/// Assigns a process-wide total order to successfully committed settings
/// transactions. A generation is reserved under the shared settings
/// coordinator before fallible I/O, and is returned only after durable
/// write/read-back verification succeeds; failed writes leave harmless gaps.
static SETTINGS_COMMIT_GENERATION: AtomicU64 = AtomicU64::new(1);

fn reserve_settings_commit_generation() -> Result<u64, String> {
    SETTINGS_COMMIT_GENERATION
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |generation| {
            generation.checked_add(1)
        })
        .map_err(|_| "settings commit generation exhausted".to_string())
}

#[derive(Clone)]
#[doc(hidden)]
pub struct RestApiRuntimeSecrets {
    pub api_key: String,
    pub jwt_secret: String,
}

fn generate_rest_api_secret() -> String {
    use rand::rngs::OsRng;
    use rand::RngCore;

    let mut bytes = [0u8; REST_API_SECRET_BYTES];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

async fn read_optional_rest_api_secret(account: &str) -> Result<Option<String>, String> {
    use sorng_vault::types::VaultErrorKind;

    match sorng_vault::keychain::read(REST_API_VAULT_SERVICE, account).await {
        Ok(secret) if !secret.trim().is_empty() => Ok(Some(secret)),
        Ok(_) => Ok(None),
        Err(error) if matches!(error.kind, VaultErrorKind::NotFound) => Ok(None),
        Err(error) => Err(format!("read REST API secret from OS vault: {error}")),
    }
}

async fn store_verified_rest_api_secret(account: &str, secret: &str) -> Result<(), String> {
    if !sorng_vault::keychain::is_available() {
        return Err("the OS credential vault is unavailable".to_string());
    }
    sorng_vault::keychain::store(REST_API_VAULT_SERVICE, account, secret)
        .await
        .map_err(|error| format!("store REST API secret in OS vault: {error}"))?;
    let verified = sorng_vault::keychain::read(REST_API_VAULT_SERVICE, account)
        .await
        .map_err(|error| format!("verify REST API secret in OS vault: {error}"))?;
    if verified != secret {
        return Err("REST API secret failed OS-vault read-back verification".to_string());
    }
    Ok(())
}

async fn ensure_rest_api_secret(account: &str) -> Result<String, String> {
    if !sorng_vault::keychain::is_available() {
        return Err("the OS credential vault is unavailable".to_string());
    }
    if let Some(secret) = read_optional_rest_api_secret(account).await? {
        return Ok(secret);
    }
    let secret = generate_rest_api_secret();
    store_verified_rest_api_secret(account, &secret).await?;
    Ok(secret)
}

#[doc(hidden)]
pub async fn ensure_rest_api_runtime_secrets() -> Result<RestApiRuntimeSecrets, String> {
    let api_key = ensure_rest_api_secret(REST_API_KEY_ACCOUNT).await?;
    let jwt_secret = ensure_rest_api_secret(REST_API_JWT_ACCOUNT).await?;
    Ok(RestApiRuntimeSecrets {
        api_key,
        jwt_secret,
    })
}

#[doc(hidden)]
pub async fn regenerate_rest_api_key_inner() -> Result<(), String> {
    let secret = generate_rest_api_secret();
    store_verified_rest_api_secret(REST_API_KEY_ACCOUNT, &secret).await
}

#[doc(hidden)]
pub async fn reveal_rest_api_key_inner() -> Result<String, String> {
    read_optional_rest_api_secret(REST_API_KEY_ACCOUNT)
        .await?
        .ok_or_else(|| "no REST API key is stored in the OS credential vault".to_string())
}

#[doc(hidden)]
pub async fn rest_api_secret_availability_inner() -> (bool, bool, bool) {
    let vault_available = sorng_vault::keychain::is_available();
    if !vault_available {
        return (false, false, false);
    }
    let api_key_available = read_optional_rest_api_secret(REST_API_KEY_ACCOUNT)
        .await
        .ok()
        .flatten()
        .is_some();
    let jwt_secret_available = read_optional_rest_api_secret(REST_API_JWT_ACCOUNT)
        .await
        .ok()
        .flatten()
        .is_some();
    (vault_available, api_key_available, jwt_secret_available)
}

fn rest_api_legacy_secrets(settings: &Value) -> (Option<String>, Option<String>, bool) {
    let Some(rest) = settings.get("restApi").and_then(Value::as_object) else {
        return (None, None, false);
    };
    let present = rest.contains_key("apiKey") || rest.contains_key("jwtSecret");
    let read = |key: &str| {
        rest.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    (read("apiKey"), read("jwtSecret"), present)
}

fn strip_rest_api_secrets(mut settings: Value) -> Value {
    if let Some(rest) = settings.get_mut("restApi").and_then(Value::as_object_mut) {
        rest.remove("apiKey");
        rest.remove("jwtSecret");
    }
    settings
}

fn reject_rest_api_secret_patch(patch: &Value) -> Result<(), String> {
    let contains_secret = patch
        .get("restApi")
        .and_then(Value::as_object)
        .map(|rest| rest.contains_key("apiKey") || rest.contains_key("jwtSecret"))
        .unwrap_or(false);
    if contains_secret {
        return Err(
            "REST API secrets cannot be written through general settings; use the secure native API"
                .to_string(),
        );
    }
    Ok(())
}

/// Move legacy REST API secrets to the credential vault and persist the
/// sanitized `restApi` object. The caller must hold the shared settings
/// coordinator so
/// the `settings` snapshot cannot go stale before its sanitized replacement is
/// merged back into the current document.
async fn migrate_rest_api_secrets_locked(
    dir: &std::path::Path,
    enc_state: &EncryptionState,
    settings: Value,
) -> Result<Value, String> {
    let (legacy_api_key, legacy_jwt_secret, had_secret_fields) = rest_api_legacy_secrets(&settings);
    if !had_secret_fields {
        return Ok(settings);
    }

    if legacy_api_key.is_some() || legacy_jwt_secret.is_some() {
        if !sorng_vault::keychain::is_available() {
            return Err(
                "legacy REST API secrets remain in settings because the OS credential vault is unavailable"
                    .to_string(),
            );
        }
        if let Some(secret) = legacy_api_key.as_deref() {
            store_verified_rest_api_secret(REST_API_KEY_ACCOUNT, secret).await?;
        }
        if let Some(secret) = legacy_jwt_secret.as_deref() {
            store_verified_rest_api_secret(REST_API_JWT_ACCOUNT, secret).await?;
        }
    }

    let sanitized = strip_rest_api_secrets(settings);
    let rest = sanitized
        .get("restApi")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    write_app_settings_locked(dir, enc_state, serde_json::json!({ "restApi": rest })).await?;
    Ok(sanitized)
}

/// Read settings and perform any legacy-secret migration while the caller
/// holds the shared settings coordinator.
async fn read_app_settings_secure_locked(
    dir: &std::path::Path,
    enc_state: &EncryptionState,
) -> Result<Option<Value>, String> {
    let Some(settings) = read_app_settings_inner(dir, enc_state).await? else {
        return Ok(None);
    };
    migrate_rest_api_secrets_locked(dir, enc_state, settings)
        .await
        .map(Some)
}

pub(crate) async fn read_app_settings_secure_inner(
    dir: &std::path::Path,
    enc_state: &EncryptionState,
) -> Result<Option<Value>, String> {
    // A legacy-secret migration is a read-sanitize-write transaction. Taking
    // the same lock as ordinary settings writes before the read prevents a
    // stale `restApi` object from replaying over a concurrent patch.
    let _write_guard = sorng_encryption::settings_coordinator::lock().await;
    read_app_settings_secure_locked(dir, enc_state).await
}

/// Probe the live mode from disk + vault. Mirrors the logic in
/// `encryption_status` so the writer below stamps the preamble with
/// the same mode that the unlock screen will see at next boot.
async fn current_master_key_storage(dir: &std::path::Path) -> Result<MasterKeyStorage, String> {
    let vault_present = sorng_vault::keychain::read_dek().await.is_ok();
    let dek_enc_present = dir.join(DEK_ENC_FILENAME).exists();
    match (vault_present, dek_enc_present) {
        (true, true) => Ok(MasterKeyStorage::VaultAndPassword),
        (true, false) => Ok(MasterKeyStorage::Vault),
        (false, true) => Ok(MasterKeyStorage::Password),
        (false, false) => Err(
            "unlocked master key has no durable vault or dek.enc receipt; refusing settings encryption"
                .into(),
        ),
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
        let bytes = std::fs::read(&enc_path).map_err(|e| format!("read settings.enc: {e}"))?;
        if !enc_state.is_unlocked().await {
            return Err("settings are encrypted; unlock first via Settings → Security".into());
        }
        let value = artifact_settings::read(enc_state, &bytes)
            .await
            .map_err(|e| format!("decode settings.enc: {e}"))?;
        return Ok(value.or(Some(serde_json::json!({}))));
    }

    match std::fs::read_to_string(&plain_path) {
        Ok(s) => {
            let value: Value =
                serde_json::from_str(&s).map_err(|e| format!("parse settings.json: {e}"))?;
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
    read_app_settings_secure_inner(&dir, &enc_state).await
}

/// Shallow-merge `patch` into the live settings root and persist.
/// Picks the format automatically:
///
/// - When `settings.enc` is already canonical, the merged blob remains
///   encrypted. A first-ever write while unlocked also starts encrypted.
/// - When `settings.json` is canonical, the merge remains plaintext even if
///   the master key is still unlocked for other artifacts. This keeps an
///   explicit settings-disable transition stable until migration is requested
///   again.
///
/// The existing-object base is always read through `read_app_settings`,
/// so the merge composition is identical between the two paths.
/// Returns the process-wide commit generation only after the write has been
/// durably verified.
#[tauri::command]
pub async fn write_app_settings(
    app: tauri::AppHandle,
    enc_state: State<'_, EncryptionState>,
    patch: Value,
) -> Result<u64, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    reject_rest_api_secret_patch(&patch)?;
    // Keep the optional legacy-secret migration and the caller's patch in one
    // transaction. Both helpers below assume this guard is already held.
    let _write_guard = sorng_encryption::settings_coordinator::lock().await;
    let _ = read_app_settings_secure_locked(&dir, &enc_state).await?;
    write_app_settings_locked(&dir, &enc_state, patch).await
}

/// Number of attempts the atomic writer makes before giving up. Rides
/// out transient failures (AV file locks, a momentarily-vanished
/// app-data dir, a temp sweep racing the rename).
const ATOMIC_WRITE_MAX_ATTEMPTS: u32 = 3;
/// Base backoff between retry attempts. Multiplied by the attempt index
/// for a small linear back-off (10ms, 20ms).
const ATOMIC_WRITE_BACKOFF: std::time::Duration = std::time::Duration::from_millis(10);

/// Derive an invocation-unique, per-target temp path. The temp lives in the
/// same directory as the target (so the final `rename` stays on one filesystem
/// and is atomic) and includes both the process id and a monotonic counter.
/// This prevents another process or future non-serialized caller from
/// truncating a temp file that an in-flight writer is about to publish.
fn temp_path_for(path: &std::path::Path) -> std::path::PathBuf {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "settings".to_string());
    let sequence = SETTINGS_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(".{file_name}.{}.{}.tmp", std::process::id(), sequence);
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
/// Both values must be objects so a corrupt document is never silently
/// replaced. Keys in `existing`
/// but not in `patch` (e.g. the backend-managed `updater` object) are
/// preserved untouched. Pure function so it can be unit-tested without a
/// Tauri app / filesystem.
fn merge_root(mut existing: Value, patch: &Value) -> Result<Value, String> {
    if !existing.is_object() {
        return Err("existing settings root must be a JSON object".to_string());
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
/// reference. Kept symmetric with `read_app_settings_inner`; its successful
/// result is the same process-wide commit generation returned by the command.
pub async fn write_app_settings_inner(
    dir: &std::path::Path,
    enc_state: &EncryptionState,
    patch: Value,
) -> Result<u64, String> {
    // Cover the entire transaction, not only the rename: a later writer must
    // read the generation committed by the previous writer before merging its
    // own patch. This also keeps verify-readback isolated from another save.
    let _write_guard = sorng_encryption::settings_coordinator::lock().await;
    write_app_settings_locked(dir, enc_state, patch).await
}

/// Execute a complete read-merge-write-verify transaction. The caller must
/// hold the shared settings coordinator; keeping lock acquisition outside this helper
/// lets legacy-secret migration compose a sanitized write without deadlocking
/// on the non-reentrant process mutex.
async fn write_app_settings_locked(
    dir: &std::path::Path,
    enc_state: &EncryptionState,
    patch: Value,
) -> Result<u64, String> {
    reject_rest_api_secret_patch(&patch)?;
    // Reserve before any fallible filesystem work. Failed writes may leave a
    // harmless gap, but a durable commit can never be followed by a generation
    // allocation error that falsely reports the write as failed.
    let commit_generation = reserve_settings_commit_generation()?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let enc_path = dir.join(SETTINGS_ENC_FILENAME);
    let plain_path = dir.join(SETTINGS_FILENAME);
    let encrypted_on_disk = enc_path.exists();
    let plaintext_on_disk = plain_path.exists();
    let state_unlocked = enc_state.is_unlocked().await;

    let existing: Value = if encrypted_on_disk {
        if !state_unlocked {
            return Err("settings are encrypted; unlock first via Settings → Security".into());
        }
        let bytes = std::fs::read(&enc_path).map_err(|e| format!("read settings.enc: {e}"))?;
        artifact_settings::read(enc_state, &bytes)
            .await
            .map_err(|e| format!("decode settings.enc: {e}"))?
            .ok_or_else(|| "settings.enc did not contain a settings document".to_string())?
    } else {
        match std::fs::read_to_string(&plain_path) {
            Ok(s) => serde_json::from_str(&s).map_err(|e| {
                format!(
                    "refusing to overwrite malformed settings.json at {}: {e}",
                    plain_path.display()
                )
            })?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
            Err(e) => return Err(e.to_string()),
        }
    };
    let merged = merge_root(existing, &patch)?;
    let write_encrypted = encrypted_on_disk || (state_unlocked && !plaintext_on_disk);

    if write_encrypted {
        let mode = current_master_key_storage(dir).await?;
        let salt = [0u8; SALT_LEN];
        let blob = artifact_settings::write(enc_state, &merged, mode, Argon2Params::OWASP, salt)
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
            .ok_or_else(|| {
                "verify settings.enc: encrypted artifact contained no settings document".to_string()
            })?;
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
    } else {
        let body = serde_json::to_string_pretty(&merged)
            .map_err(|e| format!("serialize settings.json: {e}"))?;
        let plain_path = plain_path.clone();
        tokio::task::spawn_blocking(move || atomic_write(&plain_path, body.as_bytes()))
            .await
            .map_err(|e| format!("settings.json write task join: {e}"))??;
    }

    Ok(commit_generation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_encryption::commands::{disable_settings_inner, migrate_settings_inner};
    use sorng_encryption::MasterDek;
    use sorng_encryption::MasterKeyStorage;
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
    fn general_settings_reject_rest_api_secrets() {
        assert!(reject_rest_api_secret_patch(&serde_json::json!({
            "restApi": { "apiKey": "must-not-land" }
        }))
        .is_err());
        assert!(reject_rest_api_secret_patch(&serde_json::json!({
            "restApi": { "jwtSecret": "must-not-land" }
        }))
        .is_err());
    }

    #[test]
    fn renderer_settings_strip_both_legacy_secret_fields() {
        let sanitized = strip_rest_api_secrets(serde_json::json!({
            "theme": "dark",
            "restApi": {
                "enabled": true,
                "apiKey": "legacy-api-key",
                "jwtSecret": "legacy-jwt-secret"
            }
        }));
        assert_eq!(sanitized["restApi"]["enabled"], true);
        assert!(sanitized["restApi"].get("apiKey").is_none());
        assert!(sanitized["restApi"].get("jwtSecret").is_none());
    }

    #[test]
    fn rejects_non_object_existing_root() {
        assert!(merge_root(serde_json::json!("garbage"), &serde_json::json!({ "a": 1 })).is_err());
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

        // No invocation-unique temp file is left behind after a successful
        // write. Enumerate instead of generating another unique candidate.
        let leftovers: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with(".settings.json.") && name.ends_with(".tmp")
            })
            .collect();
        assert!(
            leftovers.is_empty(),
            "successful writes must not leave temp files: {leftovers:?}"
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

    #[test]
    fn repeated_writes_to_the_same_target_get_unique_temp_names() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join(SETTINGS_ENC_FILENAME);
        let first = temp_path_for(&target);
        let second = temp_path_for(&target);

        assert_ne!(first, second);
        assert_eq!(first.parent(), Some(tmp.path()));
        assert_eq!(second.parent(), Some(tmp.path()));
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

        write_app_settings_inner(&app_data, &locked, serde_json::json!({ "theme": "dark" }))
            .await
            .unwrap();
        assert!(app_data.join("settings.json").exists());

        // Simulate a cleanup tool / known-folder relocation wiping the
        // app-data dir out from under us mid-session.
        std::fs::remove_dir_all(&app_data).unwrap();
        assert!(!app_data.exists());

        // Next write must self-heal rather than fail with os error 2.
        write_app_settings_inner(&app_data, &locked, serde_json::json!({ "language": "fr" }))
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

    #[tokio::test]
    async fn successful_writes_return_increasing_commit_generations() {
        let tmp = tempdir().unwrap();
        let state = EncryptionState::new();

        let first =
            write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "theme": "dark" }))
                .await
                .unwrap();
        let second =
            write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "language": "fr" }))
                .await
                .unwrap();

        assert!(first > 0);
        assert!(second > first);
    }

    #[tokio::test]
    async fn failed_write_returns_no_generation_and_leaves_a_harmless_gap() {
        let tmp = tempdir().unwrap();
        let state = EncryptionState::new();
        let before =
            write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "theme": "dark" }))
                .await
                .unwrap();

        std::fs::write(tmp.path().join(SETTINGS_FILENAME), b"not valid json").unwrap();
        let failed =
            write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "language": "de" }))
                .await;
        assert!(failed.is_err());

        std::fs::write(
            tmp.path().join(SETTINGS_FILENAME),
            br#"{ "theme": "dark" }"#,
        )
        .unwrap();
        let after =
            write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "language": "fr" }))
                .await
                .unwrap();

        assert!(after >= before + 2);
    }

    /// Build an unlocked `EncryptionState` directly, bypassing the
    /// vault/password flow so we can exercise the dispatch table.
    async fn unlocked_state_with_password_receipt(dir: &std::path::Path) -> EncryptionState {
        let state = EncryptionState::new();
        let bytes = [0x42u8; 32];
        let dek = MasterDek::from_bytes(&bytes).expect("32-byte DEK");
        state.install(dek).await;
        let receipt_dek = MasterDek::from_bytes(&bytes).expect("32-byte DEK");
        let receipt = sorng_encryption::password_wrap::wrap(
            "test-password",
            &receipt_dek,
            Argon2Params {
                memory_kib: 8 * 1024,
                time_cost: 1,
                parallelism: 1,
            },
        )
        .expect("test password receipt");
        std::fs::write(dir.join(DEK_ENC_FILENAME), receipt).expect("write test password receipt");
        state
    }

    #[tokio::test]
    async fn write_while_locked_lands_in_plaintext_json() {
        let tmp = tempdir().unwrap();
        let state = EncryptionState::new(); // locked
        write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "theme": "dark" }))
            .await
            .unwrap();

        assert!(tmp.path().join("settings.json").exists());
        assert!(!tmp.path().join("settings.enc").exists());
    }

    #[tokio::test]
    async fn write_while_unlocked_lands_in_enc() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state_with_password_receipt(tmp.path()).await;
        write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "theme": "dark" }))
            .await
            .unwrap();

        assert!(tmp.path().join("settings.enc").exists());
        // No stale plaintext should have been left behind by this
        // freshly-created directory.
        assert!(!tmp.path().join("settings.json").exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn legacy_secret_migration_and_rest_patch_share_one_transaction_lock() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let state = EncryptionState::new();
        std::fs::write(
            dir.join(SETTINGS_FILENAME),
            serde_json::to_vec_pretty(&serde_json::json!({
                "restApi": {
                    "enabled": false,
                    // An empty legacy field exercises migration without
                    // touching the real OS credential vault.
                    "apiKey": ""
                }
            }))
            .unwrap(),
        )
        .unwrap();

        // Hold the transaction mutex while deterministically queuing the
        // ordinary writer first and the migration reader second. Before the
        // secure read took this mutex up front, it could capture the stale
        // `enabled: false` object here, queue its migration behind the writer,
        // and replay that stale object after the writer committed `true`.
        let guard = sorng_encryption::settings_coordinator::lock().await;

        let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
        let writer_dir = dir.clone();
        let writer_state = state.clone();
        let writer = tokio::spawn(async move {
            let _ = writer_started_tx.send(());
            write_app_settings_inner(
                &writer_dir,
                &writer_state,
                serde_json::json!({ "restApi": { "enabled": true } }),
            )
            .await
        });
        writer_started_rx.await.unwrap();
        assert!(!writer.is_finished());

        let (reader_started_tx, reader_started_rx) = tokio::sync::oneshot::channel();
        let reader_dir = dir.clone();
        let reader_state = state.clone();
        let reader = tokio::spawn(async move {
            let _ = reader_started_tx.send(());
            read_app_settings_secure_inner(&reader_dir, &reader_state).await
        });
        reader_started_rx.await.unwrap();
        assert!(!reader.is_finished());

        drop(guard);
        writer.await.unwrap().unwrap();
        let observed = reader.await.unwrap().unwrap().unwrap();

        assert_eq!(observed["restApi"]["enabled"], true);
        assert!(observed["restApi"].get("apiKey").is_none());
        let persisted = read_app_settings_inner(&dir, &state)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(persisted["restApi"]["enabled"], true);
        assert!(persisted["restApi"].get("apiKey").is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_encrypted_writes_are_serialized_and_preserve_every_patch() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let state = unlocked_state_with_password_receipt(&dir).await;
        let mut writes = Vec::new();

        for index in 0..24 {
            let dir = dir.clone();
            let state = state.clone();
            writes.push(tokio::spawn(async move {
                let mut patch = serde_json::Map::new();
                patch.insert(format!("key-{index}"), Value::from(index));
                write_app_settings_inner(&dir, &state, Value::Object(patch)).await
            }));
        }

        for write in writes {
            write.await.unwrap().unwrap();
        }

        let value = read_app_settings_inner(&dir, &state)
            .await
            .unwrap()
            .unwrap();
        for index in 0..24 {
            assert_eq!(value[format!("key-{index}")], index);
        }
        assert!(
            std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| !entry.file_name().to_string_lossy().ends_with(".tmp")),
            "concurrent encrypted writes must not leave temp files"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_plaintext_writes_are_serialized_and_preserve_every_patch() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let state = EncryptionState::new();
        let mut writes = Vec::new();

        for index in 0..24 {
            let dir = dir.clone();
            let state = state.clone();
            writes.push(tokio::spawn(async move {
                let mut patch = serde_json::Map::new();
                patch.insert(format!("key-{index}"), Value::from(index));
                write_app_settings_inner(&dir, &state, Value::Object(patch)).await
            }));
        }

        for write in writes {
            write.await.unwrap().unwrap();
        }

        let value = read_app_settings_inner(&dir, &state)
            .await
            .unwrap()
            .unwrap();
        for index in 0..24 {
            assert_eq!(value[format!("key-{index}")], index);
        }
    }

    #[tokio::test]
    async fn read_prefers_enc_over_plaintext() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state_with_password_receipt(tmp.path()).await;
        write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "theme": "fresh" }))
            .await
            .unwrap();
        // Plant a stale plaintext shadow after the encrypted representation is
        // canonical. Reads must still prefer the envelope.
        std::fs::write(tmp.path().join("settings.json"), br#"{"theme":"stale"}"#).unwrap();

        assert!(tmp.path().join("settings.enc").exists());
        let value = read_app_settings_inner(tmp.path(), &state)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(value["theme"], "fresh");

        // The next successful encrypted write also sweeps the stale shadow.
        write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "language": "fr" }))
            .await
            .unwrap();
        assert!(!tmp.path().join("settings.json").exists());
    }

    #[tokio::test]
    async fn read_locked_enc_surfaces_lock_error() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state_with_password_receipt(tmp.path()).await;
        write_app_settings_inner(tmp.path(), &state, serde_json::json!({ "theme": "dark" }))
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn migrate_then_queued_write_preserves_the_newest_update() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        std::fs::write(
            dir.join(SETTINGS_FILENAME),
            serde_json::to_vec_pretty(&serde_json::json!({
                "theme": "dark",
                "language": "en"
            }))
            .unwrap(),
        )
        .unwrap();
        let state = unlocked_state_with_password_receipt(&dir).await;

        let guard = sorng_encryption::settings_coordinator::lock().await;
        let (migration_started_tx, migration_started_rx) = tokio::sync::oneshot::channel();
        let migration_dir = dir.clone();
        let migration_state = state.clone();
        let migration = tokio::spawn(async move {
            let _ = migration_started_tx.send(());
            migrate_settings_inner(&migration_dir, &migration_state, MasterKeyStorage::Password)
                .await
        });
        migration_started_rx.await.unwrap();
        assert!(!migration.is_finished());

        let (write_started_tx, write_started_rx) = tokio::sync::oneshot::channel();
        let write_dir = dir.clone();
        let write_state = state.clone();
        let writer = tokio::spawn(async move {
            let _ = write_started_tx.send(());
            write_app_settings_inner(
                &write_dir,
                &write_state,
                serde_json::json!({ "language": "fr", "windowSize": 1080 }),
            )
            .await
        });
        write_started_rx.await.unwrap();
        assert!(!writer.is_finished());

        drop(guard);
        migration.await.unwrap().unwrap();
        writer.await.unwrap().unwrap();

        assert!(dir.join(SETTINGS_ENC_FILENAME).exists());
        assert!(!dir.join(SETTINGS_FILENAME).exists());
        let value = read_app_settings_inner(&dir, &state)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["language"], "fr");
        assert_eq!(value["windowSize"], 1080);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn disable_then_queued_write_stays_plaintext_and_preserves_the_newest_update() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let state = unlocked_state_with_password_receipt(&dir).await;
        write_app_settings_inner(
            &dir,
            &state,
            serde_json::json!({ "theme": "dark", "language": "en" }),
        )
        .await
        .unwrap();

        let guard = sorng_encryption::settings_coordinator::lock().await;
        let (disable_started_tx, disable_started_rx) = tokio::sync::oneshot::channel();
        let disable_dir = dir.clone();
        let disable_state = state.clone();
        let disable = tokio::spawn(async move {
            let _ = disable_started_tx.send(());
            disable_settings_inner(&disable_dir, &disable_state).await
        });
        disable_started_rx.await.unwrap();
        assert!(!disable.is_finished());

        let (write_started_tx, write_started_rx) = tokio::sync::oneshot::channel();
        let write_dir = dir.clone();
        let write_state = state.clone();
        let writer = tokio::spawn(async move {
            let _ = write_started_tx.send(());
            write_app_settings_inner(
                &write_dir,
                &write_state,
                serde_json::json!({ "language": "fr", "windowSize": 1080 }),
            )
            .await
        });
        write_started_rx.await.unwrap();
        assert!(!writer.is_finished());

        drop(guard);
        disable.await.unwrap().unwrap();
        writer.await.unwrap().unwrap();

        assert!(dir.join(SETTINGS_FILENAME).exists());
        assert!(!dir.join(SETTINGS_ENC_FILENAME).exists());
        let value = read_app_settings_inner(&dir, &state)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["language"], "fr");
        assert_eq!(value["windowSize"], 1080);
    }

    #[tokio::test]
    async fn explicit_v0_to_v2_transition_preserves_data() {
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

        let unlocked = unlocked_state_with_password_receipt(tmp.path()).await;
        migrate_settings_inner(tmp.path(), &unlocked, MasterKeyStorage::Password)
            .await
            .unwrap();
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
