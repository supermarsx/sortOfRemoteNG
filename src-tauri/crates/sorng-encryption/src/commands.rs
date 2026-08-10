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
//!   re-encrypt as v2, then remove the plaintext `settings.json`.
//!
//! The file-IO portions of the unlock / setup flows accept a
//! `tauri::AppHandle` so they can resolve `app_data_dir`; pure tests
//! live in `password_wrap.rs` / `artifacts/settings.rs`.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

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
    pub backup_path: Option<String>,
    pub bytes_in: usize,
    pub bytes_out: usize,
    pub master_key_storage: MasterKeyStorage,
}

// ─── Path helpers ──────────────────────────────────────────────────

const SETTINGS_JSON_FILENAME: &str = "settings.json";
const DEK_ENC_FILENAME: &str = "dek.enc";
const MAX_SETTINGS_BYTES: u64 = 64 * 1024 * 1024;

fn app_data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

fn ensure_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_bounded_regular_file(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|e| format!("inspect {}: {e}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "{} must be a regular, non-symlink file",
            path.display()
        ));
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "{} exceeds the {max_bytes}-byte safety limit",
            path.display()
        ));
    }

    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "{} changed while reading and exceeded the safety limit",
            path.display()
        ));
    }
    Ok(bytes)
}

fn require_renderer_scoped_path(app: &AppHandle, path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("selected file path must be absolute".to_string());
    }
    let scope = app
        .try_fs_scope()
        .ok_or_else(|| "filesystem scope is unavailable; refusing path access".to_string())?;
    if !scope.is_allowed(path) {
        return Err("file path was not granted by the native file picker".to_string());
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "destination has no parent directory".to_string())?;
    let parent_metadata = std::fs::symlink_metadata(parent)
        .map_err(|e| format!("inspect destination directory: {e}"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err("destination parent must be a regular directory".to_string());
    }
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("destination must be a regular, non-symlink file".to_string());
        }
    }

    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("create temporary file: {e}"))?;
    tmp.write_all(bytes)
        .map_err(|e| format!("write temporary file: {e}"))?;
    tmp.as_file_mut()
        .sync_all()
        .map_err(|e| format!("sync temporary file: {e}"))?;
    tmp.persist(path)
        .map_err(|e| format!("replace destination: {}", e.error))?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|e| format!("sync destination directory: {e}"))?;
    Ok(())
}

trait SettingsTransitionIo: Sync {
    fn read(&self, path: &Path) -> Result<Vec<u8>, String>;
    fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), String>;
    fn remove(&self, path: &Path) -> Result<(), String>;
}

struct FilesystemSettingsTransitionIo;

impl SettingsTransitionIo for FilesystemSettingsTransitionIo {
    fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
        read_bounded_regular_file(path, MAX_SETTINGS_BYTES)
    }

    fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        atomic_write(path, bytes)
    }

    fn remove(&self, path: &Path) -> Result<(), String> {
        std::fs::remove_file(path).map_err(|error| format!("remove {}: {error}", path.display()))
    }
}

fn rollback_settings_destination(
    io: &dyn SettingsTransitionIo,
    destination: &Path,
    previous: Option<&[u8]>,
    transition_error: String,
) -> String {
    let rollback = match previous {
        Some(bytes) => io.write(destination, bytes),
        None => io.remove(destination),
    };
    match rollback {
        Ok(()) => transition_error,
        Err(rollback_error) => format!(
            "{transition_error}; additionally failed to roll back {}: {rollback_error}",
            destination.display()
        ),
    }
}

const LOCKOUT_PERSISTENCE_ERROR: &str =
    "password lockout state could not be persisted; retries remain throttled in memory";
const AUDIT_PERSISTENCE_ERROR: &str = "security audit event could not be persisted";

/// The on-disk lockout receipt survives restarts, while this process-local
/// copy remains authoritative for the current process. In particular, a
/// failed save must not let the next attempt reload an older, less restrictive
/// receipt from disk.
static LOCKOUT_MEMORY: OnceLock<Mutex<Option<(PathBuf, LockoutState)>>> = OnceLock::new();

fn lockout_memory() -> MutexGuard<'static, Option<(PathBuf, LockoutState)>> {
    LOCKOUT_MEMORY
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn current_lockout_state(dir: &Path) -> LockoutState {
    let mut memory = lockout_memory();
    if let Some((cached_dir, state)) = memory.as_ref() {
        if cached_dir == dir {
            return state.clone();
        }
    }
    let state = LockoutState::load(dir);
    *memory = Some((dir.to_path_buf(), state.clone()));
    state
}

fn update_lockout_state(dir: &Path, update: impl FnOnce(&mut LockoutState)) -> LockoutState {
    let mut memory = lockout_memory();
    let mut state = match memory.as_ref() {
        Some((cached_dir, state)) if cached_dir == dir => state.clone(),
        _ => LockoutState::load(dir),
    };
    update(&mut state);
    *memory = Some((dir.to_path_buf(), state.clone()));
    state
}

fn persist_lockout_state_with(
    dir: &Path,
    state: &LockoutState,
    persist: impl FnOnce(&LockoutState, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    persist(state, dir).map_err(|_| LOCKOUT_PERSISTENCE_ERROR.to_string())
}

fn persist_lockout_state(dir: &Path, state: &LockoutState) -> Result<(), String> {
    persist_lockout_state_with(dir, state, |state, dir| state.save(dir))
}

fn record_security_audit(
    dir: &Path,
    event: AuditEvent,
    metadata: serde_json::Value,
) -> Result<(), String> {
    surface_audit_result(audit::record(dir, event, metadata))
}

fn surface_audit_result(result: Result<(), audit::AuditError>) -> Result<(), String> {
    result.map_err(|_| AUDIT_PERSISTENCE_ERROR.to_string())
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

async fn install_setup_dek(state: &EncryptionState, dek: MasterDek) {
    // Key preparation, vault access, password KDF, and receipt persistence are
    // completed by the caller before this point. Only the live enable edge
    // needs to share an order with settings writers.
    let _settings_guard = crate::settings_coordinator::lock().await;
    state.install(dek).await;
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
    let dir = ensure_app_data_dir(&app)?;
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
            record_security_audit(
                &dir,
                AuditEvent::SetupCompleted,
                serde_json::json!({ "method": "vault", "vaultAvailable": true }),
            )?;
            install_setup_dek(&state, dek).await;
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
            record_security_audit(
                &dir,
                AuditEvent::SetupCompleted,
                serde_json::json!({ "method": "password", "vaultAvailable": false }),
            )?;
            install_setup_dek(&state, dek).await;
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
            record_security_audit(
                &dir,
                AuditEvent::SetupCompleted,
                serde_json::json!({
                    "method": "vault-and-password",
                    "vaultAvailable": true,
                }),
            )?;
            install_setup_dek(&state, dek).await;
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
            record_security_audit(
                &dir,
                AuditEvent::UnlockSuccess,
                serde_json::json!({ "method": "vault" }),
            )?;
            state.install(dek).await;
            let _ = app.emit(EVENT_UNLOCKED, ());
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
            let lockout = current_lockout_state(&dir);
            if lockout.remaining_cooldown_ms() > 0 {
                return Ok(UnlockResult::WrongPassword);
            }
            let blob = read_bounded_regular_file(&dek_path, password_wrap::FILE_LEN as u64)?;
            match password_wrap::unwrap(pw, &blob) {
                Ok(dek) => {
                    let lockout = update_lockout_state(&dir, LockoutState::record_success);
                    let lockout_result = persist_lockout_state(&dir, &lockout);
                    let audit_result = record_security_audit(
                        &dir,
                        AuditEvent::UnlockSuccess,
                        serde_json::json!({ "method": "password" }),
                    );
                    lockout_result?;
                    audit_result?;
                    state.install(dek).await;
                    let _ = app.emit(EVENT_UNLOCKED, ());
                    Ok(UnlockResult::UnlockedFromPassword)
                }
                Err(password_wrap::WrapError::AuthenticationFailed) => {
                    let lockout = update_lockout_state(&dir, LockoutState::record_failure);
                    let lockout_result = persist_lockout_state(&dir, &lockout);
                    let audit_result = record_security_audit(
                        &dir,
                        AuditEvent::UnlockFailure,
                        serde_json::json!({
                            "reason": "wrong-password",
                            "failedAttempts": lockout.failed_attempts,
                            "remainingCooldownMs": lockout.remaining_cooldown_ms(),
                        }),
                    );
                    lockout_result?;
                    audit_result?;
                    Ok(UnlockResult::WrongPassword)
                }
                Err(e) => Err(e.to_string()),
            }
        }
        (SetupOutcome::VaultUnavailable, _) => Ok(UnlockResult::VaultUnavailable),
    }
}

/// `reason` is a free-form tag the caller supplies so the audit log
/// can distinguish *why* a lock fired. The frontend uses:
///   - `"manual"`    — Settings → Security "Lock now" button
///   - `"shortcut"`  — Ctrl/⌘-L global keyboard binding
///   - `"idle"`      — auto-lock idle-timeout
///   - `"blur"`      — auto-lock window blur (debounced)
///   - `"minimize"`  — auto-lock window minimised
///   - `"visibility-hidden"` — DOM `visibilitychange → hidden`
/// `None` records as `"unspecified"` so older callers still produce
/// a clean audit entry.
#[tauri::command]
pub async fn encryption_lock(
    app: AppHandle,
    state: State<'_, EncryptionState>,
    reason: Option<String>,
) -> Result<(), String> {
    state.lock().await;
    let _ = app.emit(EVENT_LOCKED, ());
    let dir = ensure_app_data_dir(&app)?;
    record_security_audit(
        &dir,
        AuditEvent::Locked,
        serde_json::json!({
            "reason": reason.unwrap_or_else(|| "unspecified".to_string()),
        }),
    )?;
    Ok(())
}

/// Current lockout state for the password-unlock path. Cheap to call —
/// the unlock screen polls this every ~250 ms while a cool-down is
/// active so the countdown stays live without busy-waiting.
#[tauri::command]
pub async fn encryption_lockout_state(app: AppHandle) -> Result<LockoutSnapshot, String> {
    let dir = ensure_app_data_dir(&app)?;
    let state = current_lockout_state(&dir);
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
    let blob = read_bounded_regular_file(&dek_path, password_wrap::FILE_LEN as u64)?;

    // Validate the old password by unwrapping first; do not touch
    // anything until we have the plaintext DEK in hand.
    let dek = password_wrap::unwrap(&old_password, &blob).map_err(|e| format!("unwrap: {e}"))?;

    let argon = argon2.unwrap_or(Argon2Params::OWASP);
    argon.validate().map_err(|e| e.to_string())?;
    let new_blob =
        password_wrap::wrap(&new_password, &dek, argon).map_err(|e| format!("wrap: {e}"))?;
    atomic_write(&dek_path, &new_blob)?;
    let dir = ensure_app_data_dir(&app)?;
    record_security_audit(&dir, AuditEvent::PasswordChanged, serde_json::json!({}))?;
    // If the live state was previously locked, leave it locked — the
    // caller decides whether to unlock automatically. If already
    // unlocked, the in-memory DEK is unchanged so nothing else needs
    // doing.
    let _ = state;
    Ok(())
}

/// Migrate `settings.json` (v0 plaintext) → `settings.enc` (v2
/// envelope). Requires the state to be unlocked. On success removes
/// the original plaintext `settings.json` so secrets do not remain
/// available outside the encrypted envelope.
fn durable_settings_mode(
    vault_present: bool,
    password_receipt_present: bool,
) -> Result<MasterKeyStorage, String> {
    match (vault_present, password_receipt_present) {
        (true, true) => Ok(MasterKeyStorage::VaultAndPassword),
        (true, false) => Ok(MasterKeyStorage::Vault),
        (false, true) => Ok(MasterKeyStorage::Password),
        (false, false) => Err(
            "unlocked master key has no durable vault or dek.enc receipt; refusing settings encryption"
                .into(),
        ),
    }
}

async fn migrate_settings_locked_with(
    dir: &Path,
    state: &EncryptionState,
    mode: MasterKeyStorage,
    io: &dyn SettingsTransitionIo,
) -> Result<MigrationReport, String> {
    if !state.is_unlocked().await {
        return Err("state is locked; unlock before migrating".into());
    }

    let source = dir.join(SETTINGS_JSON_FILENAME);
    let destination = dir.join(artifact_settings::SETTINGS_ENC_FILENAME);
    if destination.exists() {
        return Err("settings.enc already exists; refusing to overwrite encrypted settings".into());
    }

    let raw = io.read(&source)?;
    let bytes_in = raw.len();

    // Idempotency guard: a file that already starts with the SORNG
    // magic isn't v0 — refuse rather than wrap-twice.
    if looks_like_envelope_helper(&raw) {
        return Err("source is already an envelope file; refusing to wrap twice".into());
    }

    let value: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| format!("parse settings.json: {e}"))?;
    let salt = [0u8; crate::envelope::SALT_LEN];
    let blob = artifact_settings::write(state, &value, mode, Argon2Params::OWASP, salt)
        .await
        .map_err(|e| e.to_string())?;
    let bytes_out = blob.len();

    io.write(&destination, &blob)?;
    let verification = async {
        let readback = io
            .read(&destination)
            .map_err(|error| format!("verify settings.enc (read-back): {error}"))?;
        let decoded = artifact_settings::read(state, &readback)
            .await
            .map_err(|error| format!("verify settings.enc (decrypt): {error}"))?
            .ok_or_else(|| {
                "verify settings.enc: encrypted artifact contained no settings document".to_string()
            })?;
        if decoded != value {
            return Err(
                "verify settings.enc: read-back did not match plaintext source".to_string(),
            );
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = verification {
        return Err(rollback_settings_destination(io, &destination, None, error));
    }

    if let Err(error) = io.remove(&source) {
        return Err(rollback_settings_destination(
            io,
            &destination,
            None,
            format!("remove plaintext settings.json: {error}"),
        ));
    }

    Ok(MigrationReport {
        source_path: source.to_string_lossy().into_owned(),
        destination_path: destination.to_string_lossy().into_owned(),
        backup_path: None,
        bytes_in,
        bytes_out,
        master_key_storage: mode,
    })
}

#[doc(hidden)]
pub async fn migrate_settings_inner(
    dir: &Path,
    state: &EncryptionState,
    mode: MasterKeyStorage,
) -> Result<MigrationReport, String> {
    let _settings_guard = crate::settings_coordinator::lock().await;
    migrate_settings_locked_with(dir, state, mode, &FilesystemSettingsTransitionIo).await
}

#[tauri::command]
pub async fn encryption_migrate_settings(
    app: AppHandle,
    state: State<'_, EncryptionState>,
) -> Result<MigrationReport, String> {
    let dir = ensure_app_data_dir(&app)?;
    let _settings_guard = crate::settings_coordinator::lock().await;
    if !state.is_unlocked().await {
        return Err("state is locked; unlock before migrating".into());
    }

    // Determine the mode from on-disk signals while the canonical settings
    // generation is frozen by the coordinator.
    let vault_has_dek = sorng_vault::keychain::read_dek().await.is_ok();
    let dek_enc_present = dir.join(DEK_ENC_FILENAME).exists();
    let mode = durable_settings_mode(vault_has_dek, dek_enc_present)?;

    let report =
        migrate_settings_locked_with(&dir, &state, mode, &FilesystemSettingsTransitionIo).await?;
    drop(_settings_guard);

    if let Err(error) = record_security_audit(
        &dir,
        AuditEvent::SettingsMigrated,
        serde_json::json!({
            "bytesIn": report.bytes_in,
            "bytesOut": report.bytes_out,
            "mode": match mode {
                MasterKeyStorage::Vault => "vault",
                MasterKeyStorage::Password => "password",
                MasterKeyStorage::VaultAndPassword => "vault-and-password",
            },
        }),
    ) {
        log::warn!("{error}; settings migration already committed");
    }

    Ok(report)
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
async fn disable_settings_locked_with(
    dir: &Path,
    state: &EncryptionState,
    io: &dyn SettingsTransitionIo,
) -> Result<DisableSettingsReport, String> {
    if !state.is_unlocked().await {
        return Err("state is locked; unlock before disabling".into());
    }

    let source = dir.join(artifact_settings::SETTINGS_ENC_FILENAME);
    let destination = dir.join(SETTINGS_JSON_FILENAME);
    let previous_destination = if destination.exists() {
        Some(io.read(&destination)?)
    } else {
        None
    };

    let raw = io.read(&source)?;
    let bytes_in = raw.len();
    if !looks_like_envelope_helper(&raw) {
        return Err("source is not an envelope file; refusing to operate".into());
    }
    let value = artifact_settings::read(state, &raw)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "settings.enc did not contain a settings document; refusing to delete it".to_string()
        })?;
    let body =
        serde_json::to_string_pretty(&value).map_err(|e| format!("re-serialize settings: {e}"))?;
    let bytes_out = body.len();

    io.write(&destination, body.as_bytes())?;
    let verification = io
        .read(&destination)
        .map_err(|error| format!("verify settings.json (read-back): {error}"))
        .and_then(|readback| {
            serde_json::from_slice::<serde_json::Value>(&readback)
                .map_err(|error| format!("verify settings.json (parse): {error}"))
        })
        .and_then(|decoded| {
            if decoded == value {
                Ok(())
            } else {
                Err("verify settings.json: read-back did not match encrypted source".to_string())
            }
        });
    if let Err(error) = verification {
        return Err(rollback_settings_destination(
            io,
            &destination,
            previous_destination.as_deref(),
            error,
        ));
    }

    if let Err(error) = io.remove(&source) {
        return Err(rollback_settings_destination(
            io,
            &destination,
            previous_destination.as_deref(),
            format!("remove settings.enc: {error}"),
        ));
    }

    Ok(DisableSettingsReport {
        source_path: source.to_string_lossy().into_owned(),
        destination_path: destination.to_string_lossy().into_owned(),
        bytes_in,
        bytes_out,
    })
}

#[doc(hidden)]
pub async fn disable_settings_inner(
    dir: &Path,
    state: &EncryptionState,
) -> Result<DisableSettingsReport, String> {
    let _settings_guard = crate::settings_coordinator::lock().await;
    disable_settings_locked_with(dir, state, &FilesystemSettingsTransitionIo).await
}

#[tauri::command]
pub async fn encryption_disable_settings(
    app: AppHandle,
    state: State<'_, EncryptionState>,
) -> Result<DisableSettingsReport, String> {
    let dir = ensure_app_data_dir(&app)?;
    let report = disable_settings_inner(&dir, &state).await?;

    if let Err(error) = record_security_audit(
        &dir,
        AuditEvent::SettingsDecrypted,
        serde_json::json!({ "bytesIn": report.bytes_in, "bytesOut": report.bytes_out }),
    ) {
        log::warn!("{error}; settings disable transition already committed");
    }

    Ok(report)
}

const LEGACY_ROTATION_RETIRED_ERROR: &str = "Legacy settings-only master-key rotation is retired because it can leave connections, backups, recordings, and macros unreadable. Use encryption_rotate_master_key_full instead.";

fn reject_legacy_master_key_rotation() -> Result<(), String> {
    Err(LEGACY_ROTATION_RETIRED_ERROR.to_string())
}

/// Retired compatibility entry point.
///
/// The legacy command changed the master key and settings envelope without
/// rewriting the other encrypted artifact families. Returning a hard error is
/// safer than preserving an operation that can strand durable user data. The
/// app-level `encryption_rotate_master_key_full` command is the only supported
/// master-key rotation path.
#[tauri::command]
pub async fn encryption_rotate_master_key(
    _app: AppHandle,
    _state: State<'_, EncryptionState>,
    _password: Option<String>,
) -> Result<(), String> {
    reject_legacy_master_key_rotation()
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
    require_renderer_scoped_path(&app, &dest)?;
    atomic_write(&dest, &blob)?;
    let bytes = blob.len() as u64;
    let dir = ensure_app_data_dir(&app)?;
    record_security_audit(
        &dir,
        AuditEvent::PortableExported,
        serde_json::json!({
            "destinationFile": dest.file_name().and_then(|v| v.to_str()),
            "bytes": bytes,
        }),
    )?;
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
    let source = PathBuf::from(&source_path);
    require_renderer_scoped_path(&app, &source)?;
    let blob = read_bounded_regular_file(&source, password_wrap::FILE_LEN as u64)?;
    let dek = password_wrap::unwrap(&password, &blob).map_err(|e| format!("unwrap: {e}"))?;

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
    let dek_local = MasterDek::from_bytes(&raw).ok_or("internal: re-wrap wrong-size DEK")?;
    let local_wrap = password_wrap::wrap(&password, &dek_local, Argon2Params::OWASP)
        .map_err(|e| format!("re-wrap: {e}"))?;
    atomic_write(&dek_path, &local_wrap)?;

    // Reset lockout (successful unwrap counts as proof the user
    // holds the password) and broadcast.
    let lockout = update_lockout_state(&dir, LockoutState::record_success);
    let lockout_result = persist_lockout_state(&dir, &lockout);
    let audit_result = record_security_audit(
        &dir,
        AuditEvent::PortableImported,
        serde_json::json!({
            "sourceFile": source.file_name().and_then(|value| value.to_str())
        }),
    );
    lockout_result?;
    audit_result?;
    let _ = app.emit(EVENT_UNLOCKED, ());

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
    record_security_audit(
        &dir,
        AuditEvent::Locked,
        serde_json::json!({ "note": "audit-log-cleared" }),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn setup_method_password_default_argon2() {
        let v: SetupMethod = serde_json::from_str(r#"{"password":{"password":"x"}}"#).unwrap();
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
            backup_path: None,
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
    fn settings_encryption_requires_a_durable_key_receipt() {
        assert_eq!(
            durable_settings_mode(true, false).unwrap(),
            MasterKeyStorage::Vault
        );
        assert_eq!(
            durable_settings_mode(false, true).unwrap(),
            MasterKeyStorage::Password
        );
        assert_eq!(
            durable_settings_mode(true, true).unwrap(),
            MasterKeyStorage::VaultAndPassword
        );
        assert!(durable_settings_mode(false, false).is_err());
    }

    #[test]
    fn legacy_settings_only_rotation_is_retired_with_full_rotation_guidance() {
        let error = reject_legacy_master_key_rotation()
            .expect_err("the settings-only rotation path must fail closed");

        assert!(error.contains("settings-only master-key rotation is retired"));
        assert!(error.contains("connections"));
        assert!(error.contains("backups"));
        assert!(error.contains("recordings"));
        assert!(error.contains("macros"));
        assert!(error.contains("encryption_rotate_master_key_full"));
    }

    #[test]
    fn failed_lockout_save_keeps_throttling_in_memory() {
        let dir = tempdir().unwrap();
        LockoutState::default().save(dir.path()).unwrap();

        let failed = update_lockout_state(dir.path(), LockoutState::record_failure);
        let err = persist_lockout_state_with(dir.path(), &failed, |_, _| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "sensitive filesystem detail",
            ))
        })
        .unwrap_err();

        assert_eq!(err, LOCKOUT_PERSISTENCE_ERROR);
        assert_eq!(LockoutState::load(dir.path()), LockoutState::default());
        let cached = current_lockout_state(dir.path());
        assert_eq!(cached.failed_attempts, 1);
        assert!(cached.remaining_cooldown_ms() > 0);
    }

    #[test]
    fn audit_write_failure_is_opaque() {
        let err = surface_audit_result(Err(audit::AuditError::Write(
            "sensitive filesystem detail".to_string(),
        )))
        .unwrap_err();
        assert_eq!(err, AUDIT_PERSISTENCE_ERROR);
        assert!(!err.contains("sensitive"));
    }

    #[derive(Default)]
    struct InjectedSettingsTransitionIo {
        fail_write: Option<PathBuf>,
        corrupt_readback: Option<PathBuf>,
        fail_remove: Option<PathBuf>,
    }

    impl SettingsTransitionIo for InjectedSettingsTransitionIo {
        fn read(&self, path: &Path) -> Result<Vec<u8>, String> {
            if self.corrupt_readback.as_deref() == Some(path) {
                return Ok(b"corrupt transition readback".to_vec());
            }
            read_bounded_regular_file(path, MAX_SETTINGS_BYTES)
        }

        fn write(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
            if self.fail_write.as_deref() == Some(path) {
                return Err("injected settings transition write failure".to_string());
            }
            atomic_write(path, bytes)
        }

        fn remove(&self, path: &Path) -> Result<(), String> {
            if self.fail_remove.as_deref() == Some(path) {
                return Err("injected settings transition delete failure".to_string());
            }
            std::fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    async fn transition_test_state() -> EncryptionState {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        state
    }

    #[tokio::test]
    async fn migration_failures_roll_back_to_the_plaintext_source() {
        for failure in ["write", "verify", "delete"] {
            let dir = tempdir().unwrap();
            let source = dir.path().join(SETTINGS_JSON_FILENAME);
            let destination = dir.path().join(artifact_settings::SETTINGS_ENC_FILENAME);
            let expected = serde_json::json!({ "theme": "dark", "failure": failure });
            std::fs::write(&source, serde_json::to_vec_pretty(&expected).unwrap()).unwrap();
            let state = transition_test_state().await;
            let io = InjectedSettingsTransitionIo {
                fail_write: (failure == "write").then(|| destination.clone()),
                corrupt_readback: (failure == "verify").then(|| destination.clone()),
                fail_remove: (failure == "delete").then(|| source.clone()),
            };

            let _settings_guard = crate::settings_coordinator::lock().await;
            let error =
                migrate_settings_locked_with(dir.path(), &state, MasterKeyStorage::Vault, &io)
                    .await
                    .expect_err("injected migration failure");
            assert!(error.contains("injected") || error.contains("verify"));
            assert!(source.exists(), "plaintext source must survive {failure}");
            assert!(
                !destination.exists(),
                "encrypted destination must roll back after {failure}"
            );
            let recovered: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&source).unwrap()).unwrap();
            assert_eq!(recovered, expected);
        }
    }

    #[tokio::test]
    async fn disable_failures_roll_back_to_the_encrypted_source() {
        for failure in ["write", "verify", "delete"] {
            let dir = tempdir().unwrap();
            let source = dir.path().join(artifact_settings::SETTINGS_ENC_FILENAME);
            let destination = dir.path().join(SETTINGS_JSON_FILENAME);
            let expected = serde_json::json!({ "theme": "dark", "failure": failure });
            let state = transition_test_state().await;
            let blob = artifact_settings::write(
                &state,
                &expected,
                MasterKeyStorage::Vault,
                Argon2Params::OWASP,
                [0u8; SALT_LEN],
            )
            .await
            .unwrap();
            atomic_write(&source, &blob).unwrap();
            let io = InjectedSettingsTransitionIo {
                fail_write: (failure == "write").then(|| destination.clone()),
                corrupt_readback: (failure == "verify").then(|| destination.clone()),
                fail_remove: (failure == "delete").then(|| source.clone()),
            };

            let _settings_guard = crate::settings_coordinator::lock().await;
            let error = disable_settings_locked_with(dir.path(), &state, &io)
                .await
                .expect_err("injected disable failure");
            assert!(error.contains("injected") || error.contains("verify"));
            assert!(source.exists(), "encrypted source must survive {failure}");
            assert!(
                !destination.exists(),
                "plaintext destination must roll back after {failure}"
            );
            let recovered = artifact_settings::read(&state, &std::fs::read(&source).unwrap())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(recovered, expected);
        }
    }

    #[tokio::test]
    async fn disable_delete_failure_restores_preexisting_plaintext_bytes() {
        let dir = tempdir().unwrap();
        let source = dir.path().join(artifact_settings::SETTINGS_ENC_FILENAME);
        let destination = dir.path().join(SETTINGS_JSON_FILENAME);
        let expected = serde_json::json!({ "theme": "encrypted-current" });
        let original_plaintext = b"{\r\n  \"theme\": \"stale-fallback\"\r\n}\r\n";
        let state = transition_test_state().await;
        let blob = artifact_settings::write(
            &state,
            &expected,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        atomic_write(&source, &blob).unwrap();
        std::fs::write(&destination, original_plaintext).unwrap();
        let io = InjectedSettingsTransitionIo {
            fail_remove: Some(source.clone()),
            ..Default::default()
        };

        let _settings_guard = crate::settings_coordinator::lock().await;
        disable_settings_locked_with(dir.path(), &state, &io)
            .await
            .expect_err("source delete failure must roll back plaintext replacement");

        assert_eq!(std::fs::read(&destination).unwrap(), original_plaintext);
        let recovered = artifact_settings::read(&state, &std::fs::read(source).unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(recovered, expected);
    }

    #[tokio::test]
    async fn disable_rejects_empty_envelope_without_committing_plaintext() {
        let dir = tempdir().unwrap();
        let source = dir.path().join(artifact_settings::SETTINGS_ENC_FILENAME);
        let destination = dir.path().join(SETTINGS_JSON_FILENAME);
        let state = transition_test_state().await;
        let sub_key = state.sub_key(crate::ArtifactKind::Settings).await.unwrap();
        let header = crate::envelope::EnvelopeHeader::new_vault([0u8; crate::envelope::NONCE_LEN]);
        let blob = crate::envelope::write_envelope(&sub_key, &header, b"").unwrap();
        atomic_write(&source, &blob).unwrap();

        let _settings_guard = crate::settings_coordinator::lock().await;
        let error =
            disable_settings_locked_with(dir.path(), &state, &FilesystemSettingsTransitionIo)
                .await
                .expect_err("empty settings envelope must fail closed");

        assert!(error.contains("did not contain a settings document"));
        assert!(source.exists());
        assert!(!destination.exists());
        assert!(
            artifact_settings::read(&state, &std::fs::read(source).unwrap())
                .await
                .unwrap()
                .is_none()
        );
    }

    // ─── End-to-end logic tests bypassing the Tauri AppHandle ──

    use crate::artifacts::settings as artifact_settings;
    use crate::dek::MasterDek;
    use crate::envelope::{self, SALT_LEN};

    #[tokio::test]
    async fn fresh_master_key_invalidates_old_ciphertext() {
        // Install a fresh DEK and verify old ciphertext fails to decrypt
        // under the new state while new ciphertext still round-trips.
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
        let bytes_before = *original.sub_key(crate::ArtifactKind::Settings).bytes();
        enc_state.install(original).await;

        // Export path: wrap with password.
        let raw = enc_state
            .with_master(|m| *m.bytes_for_password_wrap())
            .await
            .unwrap();
        let dek_to_wrap = MasterDek::from_bytes(&raw).unwrap();
        let blob = password_wrap::wrap("portable-pw", &dek_to_wrap, Argon2Params::OWASP).unwrap();

        // Import path on a fresh state: unwrap and install.
        let target_state = EncryptionState::new();
        let recovered = password_wrap::unwrap("portable-pw", &blob).unwrap();
        let bytes_after = *recovered.sub_key(crate::ArtifactKind::Settings).bytes();
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
