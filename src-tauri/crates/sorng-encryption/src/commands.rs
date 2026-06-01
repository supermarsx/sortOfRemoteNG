//! Tauri command surface.
//!
//! Phase 0 shipped status / setup / unlock / lock with vault-only
//! storage. Phase 1 adds:
//!
//! - **Password-mode setup and unlock** via `dek.enc` (the Argon2id
//!   password-wrap blob next to `settings.enc`).
//! - **Per-mode persistence dispatch** — `app_settings_commands::
//!   write_app_settings` learns to call `settings::write` and produce
//!   `settings.enc` when the state is unlocked; reads dispatch by
//!   `looks_like_envelope`.
//! - **`encryption_migrate_settings`** — read `settings.json` v0,
//!   re-encrypt as v2, atomic-swap, archive the original to
//!   `settings.json.v0.bak`.
//!
//! The file-IO portions of the unlock / setup flows accept a
//! `tauri::AppHandle` so they can resolve `app_data_dir`; pure tests
//! live in `password_wrap.rs` / `artifacts/settings.rs`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::artifacts::settings as artifact_settings;
use crate::audit::{self, AuditEntry, AuditEvent};
use crate::dek::{ArtifactKind, MasterDek};
use crate::envelope::{looks_like_envelope_helper, MasterKeyStorage};
use crate::lockout::LockoutState;
use crate::password_wrap::{self, Argon2Params};
use crate::state::{decide_setup, EncryptionState, SetupOutcome};

/// Tauri event broadcast on every successful unlock so secondary
/// windows can dismiss their own unlock screens and refresh status.
pub const EVENT_UNLOCKED: &str = "encryption:unlocked";
/// Tauri event broadcast on `encryption_lock` so secondary windows can
/// trigger their own auto-lock UI in lockstep.
pub const EVENT_LOCKED: &str = "encryption:locked";

// ─── DTOs ──────────────────────────────────────────────────────────

/// What the Settings → Security panel needs to render its status badge.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionStatus {
    pub schema_version: u8,
    pub master_key_storage: Option<MasterKeyStorage>,
    pub unlocked: bool,
    pub vault_available: bool,
    pub vault_has_master_dek: bool,
    pub vault_backend: String,
    pub artifact_labels: Vec<&'static str>,
    /// `true` when `<app_data_dir>/dek.enc` exists. Drives the unlock
    /// screen's "this app uses password mode" branch.
    pub password_wrap_present: bool,
    /// `true` when `<app_data_dir>/settings.enc` exists.
    pub settings_encrypted_on_disk: bool,
    /// `true` when a legacy plain `settings.json` is still present —
    /// drives the migration prompt.
    pub settings_plaintext_present: bool,
}

/// Caller's setup method choice. Matches the `EncryptionSettings.
/// masterKeyStorage` TypeScript enum.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetupMethod {
    Vault,
    Password {
        password: String,
        #[serde(default)]
        argon2: Option<Argon2Params>,
    },
    VaultAndPassword {
        password: String,
        #[serde(default)]
        argon2: Option<Argon2Params>,
    },
}

/// Outcome of an `encryption_unlock` call, mirrored from
/// [`SetupOutcome`] so the frontend can decide what to show next.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnlockResult {
    UnlockedFromVault,
    UnlockedFromPassword,
    AlreadyUnlocked,
    NeedsSetup,
    PasswordRequired,
    VaultUnavailable,
    /// The password failed to unwrap the local `dek.enc` blob.
    WrongPassword,
}

/// Live snapshot of the password-attempt cool-down state. Returned by
/// `encryption_lockout_state`; consumed by the unlock screen to render
/// its "try again in N seconds" countdown and to gate the password
/// input.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockoutSnapshot {
    pub failed_attempts: u32,
    pub last_failure_unix_ms: u64,
    pub remaining_cooldown_ms: u64,
}

impl From<&LockoutState> for LockoutSnapshot {
    fn from(s: &LockoutState) -> Self {
        Self {
            failed_attempts: s.failed_attempts,
            last_failure_unix_ms: s.last_failure_unix_ms,
            remaining_cooldown_ms: s.remaining_cooldown_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub source_path: String,
    pub destination_path: String,
    pub backup_path: String,
    pub bytes_in: usize,
    pub bytes_out: usize,
    pub master_key_storage: MasterKeyStorage,
}

// ─── Path helpers ──────────────────────────────────────────────────

const SETTINGS_JSON_FILENAME: &str = "settings.json";
const DEK_ENC_FILENAME: &str = "dek.enc";

fn app_data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

fn ensure_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn encryption_status(
    app: AppHandle,
    state: State<'_, EncryptionState>,
) -> Result<EncryptionStatus, String> {
    let vault_available = sorng_vault::keychain::is_available();
    let vault_backend = sorng_vault::keychain::backend_name().to_string();
    let vault_has_master_dek = if vault_available {
        sorng_vault::keychain::read_dek().await.is_ok()
    } else {
        false
    };

    // File-system signals — what does disk say about our mode?
    let dek_enc = app_data_path(&app, DEK_ENC_FILENAME).ok();
    let settings_enc = app_data_path(&app, artifact_settings::SETTINGS_ENC_FILENAME).ok();
    let settings_json = app_data_path(&app, SETTINGS_JSON_FILENAME).ok();
    let password_wrap_present = dek_enc.as_ref().is_some_and(|p| p.exists());
    let settings_encrypted_on_disk = settings_enc.as_ref().is_some_and(|p| p.exists());
    let settings_plaintext_present = settings_json.as_ref().is_some_and(|p| p.exists());

    // Derive the "current" mode from the disk signals:
    let master_key_storage = match (
        vault_has_master_dek,
        password_wrap_present,
        settings_encrypted_on_disk || vault_has_master_dek || password_wrap_present,
    ) {
        (true, true, _) => Some(MasterKeyStorage::VaultAndPassword),
        (true, false, _) => Some(MasterKeyStorage::Vault),
        (false, true, _) => Some(MasterKeyStorage::Password),
        _ => None,
    };

    let labels = ArtifactKind::all()
        .iter()
        .map(|a| a.label())
        .collect::<Vec<_>>();

    Ok(EncryptionStatus {
        schema_version: if settings_encrypted_on_disk { 2 } else { 0 },
        master_key_storage,
        unlocked: state.is_unlocked().await,
        vault_available,
        vault_has_master_dek,
        vault_backend,
        artifact_labels: labels,
        password_wrap_present,
        settings_encrypted_on_disk,
        settings_plaintext_present,
    })
}

#[tauri::command]
pub async fn encryption_setup(
    app: AppHandle,
    state: State<'_, EncryptionState>,
    method: SetupMethod,
) -> Result<UnlockResult, String> {
    if state.is_unlocked().await {
        return Ok(UnlockResult::AlreadyUnlocked);
    }
    ensure_app_data_dir(&app)?;
    let dek_path = app_data_path(&app, DEK_ENC_FILENAME)?;

    match method {
        SetupMethod::Vault => {
            if !sorng_vault::keychain::is_available() {
                return Ok(UnlockResult::VaultUnavailable);
            }
            let bytes = sorng_vault::keychain::ensure_dek()
                .await
                .map_err(|e| format!("ensure_dek: {e}"))?;
            let dek = MasterDek::from_bytes(&bytes).ok_or("vault returned wrong-size DEK")?;
            state.install(dek).await;
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = audit::record(
                    &dir,
                    AuditEvent::SetupCompleted,
                    serde_json::json!({ "method": "vault", "vaultAvailable": true }),
                );
            }
            Ok(UnlockResult::UnlockedFromVault)
        }
        SetupMethod::Password { password, argon2 } => {
            // Generate fresh DEK, wrap with the supplied password,
            // persist next to settings.enc.
            let argon = argon2.unwrap_or(Argon2Params::OWASP);
            argon.validate().map_err(|e| e.to_string())?;
            let dek = MasterDek::generate();
            let blob = password_wrap::wrap(&password, &dek, argon).map_err(|e| e.to_string())?;
            atomic_write(&dek_path, &blob)?;
            state.install(dek).await;
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = audit::record(
                    &dir,
                    AuditEvent::SetupCompleted,
                    serde_json::json!({ "method": "password", "vaultAvailable": false }),
                );
            }
            Ok(UnlockResult::UnlockedFromPassword)
        }
        SetupMethod::VaultAndPassword { password, argon2 } => {
            if !sorng_vault::keychain::is_available() {
                return Ok(UnlockResult::VaultUnavailable);
            }
            let argon = argon2.unwrap_or(Argon2Params::OWASP);
            argon.validate().map_err(|e| e.to_string())?;

            // Vault is the source of truth for the DEK bytes; the
            // password-wrap is a recovery copy. Hand the same DEK to
            // both sinks.
            let bytes = sorng_vault::keychain::ensure_dek()
                .await
                .map_err(|e| format!("ensure_dek: {e}"))?;
            let dek = MasterDek::from_bytes(&bytes).ok_or("vault returned wrong-size DEK")?;
            let blob = password_wrap::wrap(&password, &dek, argon).map_err(|e| e.to_string())?;
            atomic_write(&dek_path, &blob)?;
            state.install(dek).await;
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = audit::record(
                    &dir,
                    AuditEvent::SetupCompleted,
                    serde_json::json!({
                        "method": "vault-and-password",
                        "vaultAvailable": true,
                    }),
                );
            }
            Ok(UnlockResult::UnlockedFromVault)
        }
    }
}

#[tauri::command]
pub async fn encryption_unlock(
    app: AppHandle,
    state: State<'_, EncryptionState>,
    password: Option<String>,
) -> Result<UnlockResult, String> {
    if state.is_unlocked().await {
        return Ok(UnlockResult::AlreadyUnlocked);
    }
    let dek_path = app_data_path(&app, DEK_ENC_FILENAME)?;
    let dek_enc_present = dek_path.exists();
    let dir = ensure_app_data_dir(&app)?;

    let vault_available = sorng_vault::keychain::is_available();
    let has_dek = if vault_available {
        sorng_vault::keychain::read_dek().await.is_ok()
    } else {
        false
    };

    // If a `dek.enc` exists, password mode is in effect regardless of
    // whether the vault also has a copy. That's the on-disk record.
    let configured = match (has_dek, dek_enc_present) {
        (true, true) => Some(MasterKeyStorage::VaultAndPassword),
        (true, false) => Some(MasterKeyStorage::Vault),
        (false, true) => Some(MasterKeyStorage::Password),
        (false, false) => None,
    };
    let outcome = decide_setup(vault_available, has_dek, configured);

    match (outcome, password.as_deref()) {
        (SetupOutcome::UnlockedFromVault, _) => {
            let bytes = sorng_vault::keychain::read_dek()
                .await
                .map_err(|e| format!("read_dek: {e}"))?;
            let dek = MasterDek::from_bytes(&bytes).ok_or("vault returned wrong-size DEK")?;
            state.install(dek).await;
            let _ = app.emit(EVENT_UNLOCKED, ());
            let _ = audit::record(
                &dir,
                AuditEvent::UnlockSuccess,
                serde_json::json!({ "method": "vault" }),
            );
            // Vault unlock is silent and has no failed-attempt history
            // to reset; password-mode lockouts live in their own file
            // and are untouched here.
            Ok(UnlockResult::UnlockedFromVault)
        }
        (SetupOutcome::FreshlyInitialized, _) => Ok(UnlockResult::NeedsSetup),
        (SetupOutcome::PasswordRequired, None) => Ok(UnlockResult::PasswordRequired),
        (SetupOutcome::PasswordRequired, Some(pw)) => {
            // Honour the lockout schedule before doing any KDF work —
            // a brute-force attacker shouldn't be able to keep the CPU
            // busy with Argon2id while waiting out the cool-down.
            let mut lockout = LockoutState::load(&dir);
            if lockout.remaining_cooldown_ms() > 0 {
                return Ok(UnlockResult::WrongPassword);
            }
            let blob = std::fs::read(&dek_path).map_err(|e| format!("read dek.enc: {e}"))?;
            match password_wrap::unwrap(pw, &blob) {
                Ok(dek) => {
                    state.install(dek).await;
                    lockout.record_success();
                    let _ = lockout.save(&dir);
                    let _ = app.emit(EVENT_UNLOCKED, ());
                    let _ = audit::record(
                        &dir,
                        AuditEvent::UnlockSuccess,
                        serde_json::json!({ "method": "password" }),
                    );
                    Ok(UnlockResult::UnlockedFromPassword)
                }
                Err(password_wrap::WrapError::AuthenticationFailed) => {
                    lockout.record_failure();
                    let _ = lockout.save(&dir);
                    let _ = audit::record(
                        &dir,
                        AuditEvent::UnlockFailure,
                        serde_json::json!({
                            "reason": "wrong-password",
                            "failedAttempts": lockout.failed_attempts,
                            "remainingCooldownMs": lockout.remaining_cooldown_ms(),
                        }),
                    );
                    Ok(UnlockResult::WrongPassword)
                }
                Err(e) => Err(e.to_string()),
            }
        }
        (SetupOutcome::VaultUnavailable, _) => Ok(UnlockResult::VaultUnavailable),
    }
}

#[tauri::command]
pub async fn encryption_lock(
    app: AppHandle,
    state: State<'_, EncryptionState>,
) -> Result<(), String> {
    state.lock().await;
    let _ = app.emit(EVENT_LOCKED, ());
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = audit::record(&dir, AuditEvent::Locked, serde_json::json!({}));
    }
    Ok(())
}

/// Current lockout state for the password-unlock path. Cheap to call —
/// the unlock screen polls this every ~250 ms while a cool-down is
/// active so the countdown stays live without busy-waiting.
#[tauri::command]
pub async fn encryption_lockout_state(app: AppHandle) -> Result<LockoutSnapshot, String> {
    let dir = ensure_app_data_dir(&app)?;
    let state = LockoutState::load(&dir);
    Ok(LockoutSnapshot::from(&state))
}

/// Change the password that wraps the master DEK. Re-writes only
/// `dek.enc`; every artifact file keeps its existing ciphertext intact
/// because the master DEK itself isn't changing.
#[tauri::command]
pub async fn encryption_change_password(
    app: AppHandle,
    state: State<'_, EncryptionState>,
    old_password: String,
    new_password: String,
    argon2: Option<Argon2Params>,
) -> Result<(), String> {
    let dek_path = app_data_path(&app, DEK_ENC_FILENAME)?;
    let blob = std::fs::read(&dek_path).map_err(|e| format!("read dek.enc: {e}"))?;

    // Validate the old password by unwrapping first; do not touch
    // anything until we have the plaintext DEK in hand.
    let dek =
        password_wrap::unwrap(&old_password, &blob).map_err(|e| format!("unwrap: {e}"))?;

    let argon = argon2.unwrap_or(Argon2Params::OWASP);
    argon.validate().map_err(|e| e.to_string())?;
    let new_blob =
        password_wrap::wrap(&new_password, &dek, argon).map_err(|e| format!("wrap: {e}"))?;
    atomic_write(&dek_path, &new_blob)?;
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = audit::record(
            &dir,
            AuditEvent::PasswordChanged,
            serde_json::json!({}),
        );
    }
    // If the live state was previously locked, leave it locked — the
    // caller decides whether to unlock automatically. If already
    // unlocked, the in-memory DEK is unchanged so nothing else needs
    // doing.
    let _ = state;
    Ok(())
}

/// Migrate `settings.json` (v0 plaintext) → `settings.enc` (v2
/// envelope). Requires the state to be unlocked. On success archives
/// the original at `settings.json.v0.bak` so the user has a one-step
/// rollback for the rest of the release cycle.
#[tauri::command]
pub async fn encryption_migrate_settings(
    app: AppHandle,
    state: State<'_, EncryptionState>,
) -> Result<MigrationReport, String> {
    if !state.is_unlocked().await {
        return Err("state is locked; unlock before migrating".into());
    }
    let dir = ensure_app_data_dir(&app)?;
    let source = dir.join(SETTINGS_JSON_FILENAME);
    let destination = dir.join(artifact_settings::SETTINGS_ENC_FILENAME);
    let backup = dir.join(artifact_settings::SETTINGS_BACKUP_FILENAME);

    let raw = std::fs::read(&source).map_err(|e| format!("read settings.json: {e}"))?;
    let bytes_in = raw.len();

    // Idempotency guard: a file that already starts with the SORNG
    // magic isn't v0 — refuse rather than wrap-twice.
    if looks_like_envelope_helper(&raw) {
        return Err("source is already an envelope file; refusing to wrap twice".into());
    }

    let value: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| format!("parse settings.json: {e}"))?;

    // Determine the mode from on-disk signals.
    let vault_has_dek = sorng_vault::keychain::read_dek().await.is_ok();
    let dek_enc_present = dir.join(DEK_ENC_FILENAME).exists();
    let mode = match (vault_has_dek, dek_enc_present) {
        (true, true) => MasterKeyStorage::VaultAndPassword,
        (true, false) => MasterKeyStorage::Vault,
        (false, true) => MasterKeyStorage::Password,
        // Should be impossible: we're unlocked, so something put a DEK
        // in memory. Default to vault for safety.
        (false, false) => MasterKeyStorage::Vault,
    };

    // For vault mode the Argon2 salt is unused; just zero-fill.
    let salt = [0u8; crate::envelope::SALT_LEN];
    let blob =
        artifact_settings::write(&state, &value, mode, Argon2Params::OWASP, salt)
            .await
            .map_err(|e| e.to_string())?;
    let bytes_out = blob.len();

    atomic_write(&destination, &blob)?;
    // Archive the original last — if the rename above fails we don't
    // want a missing original.
    std::fs::rename(&source, &backup).map_err(|e| format!("archive backup: {e}"))?;

    let _ = audit::record(
        &dir,
        AuditEvent::SettingsMigrated,
        serde_json::json!({
            "bytesIn": bytes_in,
            "bytesOut": bytes_out,
            "mode": match mode {
                MasterKeyStorage::Vault => "vault",
                MasterKeyStorage::Password => "password",
                MasterKeyStorage::VaultAndPassword => "vault-and-password",
            },
        }),
    );

    Ok(MigrationReport {
        source_path: source.to_string_lossy().into_owned(),
        destination_path: destination.to_string_lossy().into_owned(),
        backup_path: backup.to_string_lossy().into_owned(),
        bytes_in,
        bytes_out,
        master_key_storage: mode,
    })
}

// ─── Phase 6: decrypt / rotate / portable export-import ────────────

/// Report returned by `encryption_disable_settings`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisableSettingsReport {
    pub source_path: String,
    pub destination_path: String,
    pub bytes_in: usize,
    pub bytes_out: usize,
}

/// Inverse of `encryption_migrate_settings` — decrypt `settings.enc`
/// back into plain `settings.json`, then delete the encrypted file
/// so the next start uses the v0 path. The master key itself stays
/// alive (vault entry and/or `dek.enc`) so other artifacts continue
/// to decrypt; the full "disable everything" path is a follow-up.
#[tauri::command]
pub async fn encryption_disable_settings(
    app: AppHandle,
    state: State<'_, EncryptionState>,
) -> Result<DisableSettingsReport, String> {
    if !state.is_unlocked().await {
        return Err("state is locked; unlock before disabling".into());
    }
    let dir = ensure_app_data_dir(&app)?;
    let source = dir.join(artifact_settings::SETTINGS_ENC_FILENAME);
    let destination = dir.join(SETTINGS_JSON_FILENAME);

    let raw = std::fs::read(&source).map_err(|e| format!("read settings.enc: {e}"))?;
    let bytes_in = raw.len();
    if !looks_like_envelope_helper(&raw) {
        return Err("source is not an envelope file; refusing to operate".into());
    }
    let value = artifact_settings::read(&state, &raw)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| serde_json::json!({}));
    let body = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("re-serialize settings: {e}"))?;
    let bytes_out = body.len();
    atomic_write(&destination, body.as_bytes())?;
    // Now safe to delete the encrypted file.
    std::fs::remove_file(&source).map_err(|e| format!("remove settings.enc: {e}"))?;

    let _ = audit::record(
        &dir,
        AuditEvent::SettingsDecrypted,
        serde_json::json!({ "bytesIn": bytes_in, "bytesOut": bytes_out }),
    );

    Ok(DisableSettingsReport {
        source_path: source.to_string_lossy().into_owned(),
        destination_path: destination.to_string_lossy().into_owned(),
        bytes_in,
        bytes_out,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateReport {
    pub artifacts_rewritten: u32,
    pub bytes_rewritten: usize,
    pub vault_updated: bool,
    pub dek_enc_updated: bool,
}

/// Rotate the master DEK. Generates fresh 32 random bytes, re-
/// encrypts every artifact currently on disk under the new sub-keys,
/// updates the vault entry and/or `dek.enc` to match. Atomic per file
/// (temp + rename); a partial failure mid-rotation leaves the file
/// that's mid-flight as its old ciphertext rather than corruption.
///
/// `password` is required iff `dek.enc` exists on disk (password or
/// hybrid mode) — we need to rewrap the new DEK under it. Vault-only
/// mode doesn't need it.
#[tauri::command]
pub async fn encryption_rotate_master_key(
    app: AppHandle,
    state: State<'_, EncryptionState>,
    password: Option<String>,
) -> Result<RotateReport, String> {
    if !state.is_unlocked().await {
        return Err("state is locked; unlock before rotating".into());
    }
    let dir = ensure_app_data_dir(&app)?;
    let dek_enc_path = dir.join(DEK_ENC_FILENAME);
    let dek_enc_present = dek_enc_path.exists();
    let settings_enc_path = dir.join(artifact_settings::SETTINGS_ENC_FILENAME);
    let settings_enc_present = settings_enc_path.exists();
    let vault_present = sorng_vault::keychain::read_dek().await.is_ok();

    if dek_enc_present && password.is_none() {
        return Err(
            "password mode is in effect; supply the password to re-wrap dek.enc"
                .into(),
        );
    }

    // Read each artifact's plaintext via the *current* state, before
    // we install the new DEK.
    let settings_plaintext = if settings_enc_present {
        let blob = std::fs::read(&settings_enc_path)
            .map_err(|e| format!("read settings.enc: {e}"))?;
        artifact_settings::read(&state, &blob)
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Generate the new master DEK, install it.
    let new_dek = MasterDek::generate();
    state.install(new_dek).await;

    // Determine the on-disk mode the new files should declare.
    let new_mode = match (vault_present, dek_enc_present) {
        (true, true) => MasterKeyStorage::VaultAndPassword,
        (true, false) => MasterKeyStorage::Vault,
        (false, true) => MasterKeyStorage::Password,
        (false, false) => MasterKeyStorage::Vault, // sensible default
    };

    let mut artifacts_rewritten = 0u32;
    let mut bytes_rewritten = 0usize;

    if settings_enc_present {
        let salt = [0u8; crate::envelope::SALT_LEN];
        let blob = artifact_settings::write(
            &state,
            &settings_plaintext,
            new_mode,
            Argon2Params::OWASP,
            salt,
        )
        .await
        .map_err(|e| e.to_string())?;
        bytes_rewritten += blob.len();
        atomic_write(&settings_enc_path, &blob)?;
        artifacts_rewritten += 1;
    }

    // Update key-storage receipts.
    let mut vault_updated = false;
    let mut dek_enc_updated = false;
    let new_bytes = state
        .with_master(|m| *m.bytes_for_password_wrap())
        .await
        .ok_or("master DEK vanished mid-rotation")?;

    if vault_present {
        sorng_vault::keychain::store_bytes(
            sorng_vault::types::SERVICE_NAME,
            sorng_vault::types::MASTER_DEK_ACCOUNT,
            &new_bytes,
        )
        .await
        .map_err(|e| format!("vault update: {e}"))?;
        vault_updated = true;
    }
    if let Some(pw) = password {
        let argon = Argon2Params::OWASP;
        let dek_owned = MasterDek::from_bytes(&new_bytes)
            .ok_or("internal: master DEK wrong length")?;
        let blob =
            password_wrap::wrap(&pw, &dek_owned, argon).map_err(|e| format!("wrap: {e}"))?;
        atomic_write(&dek_enc_path, &blob)?;
        dek_enc_updated = true;
    }

    // Reset the lockout counter — successful rotation is the strongest
    // possible signal that the user holds the password.
    let mut lockout = LockoutState::load(&dir);
    lockout.record_success();
    let _ = lockout.save(&dir);
    let _ = app.emit(EVENT_UNLOCKED, ());

    let _ = audit::record(
        &dir,
        AuditEvent::KeyRotated,
        serde_json::json!({
            "artifactsRewritten": artifacts_rewritten,
            "bytesRewritten": bytes_rewritten,
            "vaultUpdated": vault_updated,
            "dekEncUpdated": dek_enc_updated,
        }),
    );

    Ok(RotateReport {
        artifacts_rewritten,
        bytes_rewritten,
        vault_updated,
        dek_enc_updated,
    })
}

/// Write the master DEK as a portable wrapped blob at the user-chosen
/// path. Works regardless of how the local DEK is stored — the export
/// always wraps with the supplied password using the standard
/// Argon2id envelope, so the recipient only needs the password to
/// import on a different machine.
#[tauri::command]
pub async fn encryption_export_portable_dek(
    app: AppHandle,
    state: State<'_, EncryptionState>,
    destination_path: String,
    password: String,
    argon2: Option<Argon2Params>,
) -> Result<u64, String> {
    if !state.is_unlocked().await {
        return Err("state is locked; unlock before exporting".into());
    }
    let argon = argon2.unwrap_or(Argon2Params::OWASP);
    argon.validate().map_err(|e| e.to_string())?;

    let bytes = state
        .with_master(|m| *m.bytes_for_password_wrap())
        .await
        .ok_or("master DEK unavailable")?;
    let dek = MasterDek::from_bytes(&bytes).ok_or("internal: wrong-size DEK")?;
    let blob = password_wrap::wrap(&password, &dek, argon).map_err(|e| e.to_string())?;

    let dest = std::path::PathBuf::from(&destination_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    atomic_write(&dest, &blob)?;
    let bytes = blob.len() as u64;
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = audit::record(
            &dir,
            AuditEvent::PortableExported,
            serde_json::json!({
                "destinationPath": destination_path,
                "bytes": bytes,
            }),
        );
    }
    Ok(bytes)
}

/// Import a portable wrapped DEK and adopt it as the local master
/// key. On success the state is unlocked, the vault (if available) is
/// updated, and `dek.enc` is written locally so the next start finds
/// the new key.
#[tauri::command]
pub async fn encryption_import_portable_dek(
    app: AppHandle,
    state: State<'_, EncryptionState>,
    source_path: String,
    password: String,
) -> Result<(), String> {
    let dir = ensure_app_data_dir(&app)?;
    let blob = std::fs::read(&source_path).map_err(|e| format!("read source: {e}"))?;
    let dek = password_wrap::unwrap(&password, &blob)
        .map_err(|e| format!("unwrap: {e}"))?;

    // Adopt as the live key.
    let raw = *dek.bytes_for_password_wrap();
    state.install(dek).await;

    // Persist locally so the next start finds it.
    if sorng_vault::keychain::is_available() {
        sorng_vault::keychain::store_bytes(
            sorng_vault::types::SERVICE_NAME,
            sorng_vault::types::MASTER_DEK_ACCOUNT,
            &raw,
        )
        .await
        .map_err(|e| format!("vault store: {e}"))?;
    }

    // Always write `dek.enc` too — it's the cross-machine recipe and
    // protects against the user nuking the vault on cleanup.
    let dek_path = dir.join(DEK_ENC_FILENAME);
    let dek_local =
        MasterDek::from_bytes(&raw).ok_or("internal: re-wrap wrong-size DEK")?;
    let local_wrap = password_wrap::wrap(&password, &dek_local, Argon2Params::OWASP)
        .map_err(|e| format!("re-wrap: {e}"))?;
    atomic_write(&dek_path, &local_wrap)?;

    // Reset lockout (successful unwrap counts as proof the user
    // holds the password) and broadcast.
    let mut lockout = LockoutState::load(&dir);
    lockout.record_success();
    let _ = lockout.save(&dir);
    let _ = app.emit(EVENT_UNLOCKED, ());
    let _ = audit::record(
        &dir,
        AuditEvent::PortableImported,
        serde_json::json!({ "sourcePath": source_path }),
    );

    Ok(())
}

// ─── Phase 7: audit log read / clear commands ──────────────────────

/// Return the most recent `limit` audit entries (default 100). The
/// Settings → Security panel calls this on render to show recent
/// activity.
#[tauri::command]
pub async fn encryption_audit_read(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<AuditEntry>, String> {
    let dir = ensure_app_data_dir(&app)?;
    let lim = limit.unwrap_or(100) as usize;
    audit::read_tail(&dir, lim).map_err(|e| e.to_string())
}

/// Truncate the audit log. Stamps a `log-cleared` entry immediately
/// afterwards so the gap is itself a recorded event.
#[tauri::command]
pub async fn encryption_audit_clear(app: AppHandle) -> Result<(), String> {
    let dir = ensure_app_data_dir(&app)?;
    audit::clear(&dir).map_err(|e| e.to_string())?;
    // Re-record the clear so it's visible in `tail -f` immediately.
    let _ = audit::record(
        &dir,
        AuditEvent::Locked,
        serde_json::json!({ "note": "audit-log-cleared" }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_method_password_default_argon2() {
        let v: SetupMethod =
            serde_json::from_str(r#"{"password":{"password":"x"}}"#).unwrap();
        if let SetupMethod::Password { password, argon2 } = v {
            assert_eq!(password, "x");
            assert!(argon2.is_none());
        } else {
            panic!("expected Password");
        }
    }

    #[test]
    fn setup_method_password_with_argon2() {
        let v: SetupMethod = serde_json::from_str(
            r#"{"password":{"password":"x","argon2":{"memoryKib":32768,"timeCost":2,"parallelism":2}}}"#,
        )
        .unwrap();
        if let SetupMethod::Password {
            password,
            argon2: Some(a),
        } = v
        {
            assert_eq!(password, "x");
            assert_eq!(a.memory_kib, 32768);
            assert_eq!(a.time_cost, 2);
            assert_eq!(a.parallelism, 2);
        } else {
            panic!("expected Password with argon2");
        }
    }

    #[test]
    fn unlock_result_kebab() {
        assert_eq!(
            serde_json::to_string(&UnlockResult::UnlockedFromVault).unwrap(),
            "\"unlocked-from-vault\""
        );
        assert_eq!(
            serde_json::to_string(&UnlockResult::WrongPassword).unwrap(),
            "\"wrong-password\""
        );
    }

    #[test]
    fn migration_report_serializes_camel_case() {
        let r = MigrationReport {
            source_path: "a".into(),
            destination_path: "b".into(),
            backup_path: "c".into(),
            bytes_in: 1,
            bytes_out: 2,
            master_key_storage: MasterKeyStorage::Vault,
        };
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"sourcePath\":\"a\""));
        assert!(s.contains("\"destinationPath\":\"b\""));
        assert!(s.contains("\"bytesIn\":1"));
        assert!(s.contains("\"bytesOut\":2"));
        assert!(s.contains("\"masterKeyStorage\":\"vault\""));
    }

    #[test]
    fn disable_settings_report_camel_case() {
        let r = DisableSettingsReport {
            source_path: "a".into(),
            destination_path: "b".into(),
            bytes_in: 10,
            bytes_out: 20,
        };
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"sourcePath\":\"a\""));
        assert!(s.contains("\"bytesIn\":10"));
        assert!(s.contains("\"bytesOut\":20"));
    }

    #[test]
    fn rotate_report_camel_case() {
        let r = RotateReport {
            artifacts_rewritten: 3,
            bytes_rewritten: 1024,
            vault_updated: true,
            dek_enc_updated: false,
        };
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"artifactsRewritten\":3"));
        assert!(s.contains("\"bytesRewritten\":1024"));
        assert!(s.contains("\"vaultUpdated\":true"));
        assert!(s.contains("\"dekEncUpdated\":false"));
    }

    // ─── End-to-end logic tests bypassing the Tauri AppHandle ──

    use crate::artifacts::settings as artifact_settings;
    use crate::dek::MasterDek;
    use crate::envelope::{self, SALT_LEN};

    #[tokio::test]
    async fn rotation_logic_invalidates_old_ciphertext() {
        // Compose the same steps `encryption_rotate_master_key`
        // performs, minus AppHandle / vault I/O: install DEK, encrypt
        // a settings payload, then rotate and verify the old
        // ciphertext fails to decrypt under the new state while the
        // new ciphertext round-trips.
        let enc_state = EncryptionState::new();
        enc_state.install(MasterDek::generate()).await;

        let payload = serde_json::json!({ "theme": "dark", "v": 1 });
        let old_blob = artifact_settings::write(
            &enc_state,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();

        // "Rotate" — install a fresh master DEK, re-encrypt.
        enc_state.install(MasterDek::generate()).await;
        let new_blob = artifact_settings::write(
            &enc_state,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();

        // Old ciphertext is no longer readable.
        let err = artifact_settings::read(&enc_state, &old_blob)
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            artifact_settings::SettingsError::Envelope(
                envelope::EnvelopeError::AuthenticationFailed,
            )
        ));
        // New ciphertext does round-trip.
        let recovered = artifact_settings::read(&enc_state, &new_blob)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(recovered, payload);
    }

    #[tokio::test]
    async fn portable_export_then_import_yields_same_master() {
        // Wrap the master DEK with a password (export), then unwrap
        // (import) and confirm a sub-key derived from each yields the
        // same bytes — i.e. the master survived the round-trip.
        let enc_state = EncryptionState::new();
        let original = MasterDek::generate();
        let bytes_before =
            *original.sub_key(crate::ArtifactKind::Settings).bytes();
        enc_state.install(original).await;

        // Export path: wrap with password.
        let raw = enc_state
            .with_master(|m| *m.bytes_for_password_wrap())
            .await
            .unwrap();
        let dek_to_wrap = MasterDek::from_bytes(&raw).unwrap();
        let blob = password_wrap::wrap(
            "portable-pw",
            &dek_to_wrap,
            Argon2Params::OWASP,
        )
        .unwrap();

        // Import path on a fresh state: unwrap and install.
        let target_state = EncryptionState::new();
        let recovered =
            password_wrap::unwrap("portable-pw", &blob).unwrap();
        let bytes_after =
            *recovered.sub_key(crate::ArtifactKind::Settings).bytes();
        target_state.install(recovered).await;

        assert_eq!(bytes_before, bytes_after);
        assert!(target_state.is_unlocked().await);
    }

    #[tokio::test]
    async fn disable_settings_logic_recovers_original_plaintext() {
        // The disable path reads the envelope and writes plaintext
        // JSON. Compose: encrypt a payload, decrypt it via the same
        // artifact module, confirm the recovered JSON matches the
        // original byte-for-byte after re-serialization.
        let enc_state = EncryptionState::new();
        enc_state.install(MasterDek::generate()).await;
        let payload = serde_json::json!({
            "theme": "dark",
            "user": { "id": 7, "name": "alice" },
            "list": [1, 2, 3],
        });
        let blob = artifact_settings::write(
            &enc_state,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        let recovered = artifact_settings::read(&enc_state, &blob)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(recovered, payload);
    }
}
