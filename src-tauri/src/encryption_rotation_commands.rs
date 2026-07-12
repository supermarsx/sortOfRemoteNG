//! Full-artifact master-key rotation orchestrator.
//!
//! `encryption_rotate_master_key` in `sorng-encryption` rotates only
//! the settings envelope + key-storage receipts (`dek.enc` +
//! vault). That left every other artifact — connections (`data.enc`),
//! recording metadata, recording media sidecars, macros, and every
//! v2 backup file across every destination — encrypted under the old
//! sub-keys after rotation, which made them all unreadable on next
//! boot.
//!
//! This command takes the snapshot-then-swap-then-rewrite approach:
//!
//! 1. Build a frozen `EncryptionState` snapshot holding the *old*
//!    DEK. The live state can be swapped underneath us during step 3.
//! 2. Generate a fresh DEK and install it into the live state.
//! 3. For each artifact: read with the snapshot (old key), re-encrypt
//!    with the live state (new key), atomic-rename into place. The
//!    `.rotating` temp file leaves no half-written canonical paths if
//!    a single file's rewrite fails.
//! 4. Re-wrap the new DEK into the OS vault + (if password mode)
//!    `dek.enc`. Reset the lockout counter; emit the unlocked event;
//!    audit the rotation.
//!
//! Crash safety: the canonical path of every artifact is touched
//! exactly once via `rename(tmp, canonical)`, so a crash inside an
//! individual file's rewrite leaves the canonical at its previous
//! (old-key) bytes. A crash after step 4 — vault + `dek.enc` updated
//! but some artifacts still old-key — is the lossy case. Mitigation:
//! the user is told before clicking "Rotate" to export a portable
//! `.dek` first (see the existing portable-export command). With that
//! escape hatch, the worst recoverable state is "import old portable
//! `.dek`, run the rotation again".

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use sorng_encryption::artifacts::{
    connections as artifact_connections, settings as artifact_settings,
};
use sorng_encryption::audit::{self, AuditEvent};
use sorng_encryption::dek::MasterDek;
use sorng_encryption::envelope::{MasterKeyStorage, SALT_LEN};
use sorng_encryption::password_wrap::{self, Argon2Params};
use sorng_encryption::EncryptionState;
use sorng_recording::service::RecordingServiceState;
use sorng_recording::storage as rec_storage;
use sorng_storage::backup::BackupServiceState;
use sorng_storage::storage::SecureStorageState;

const DEK_ENC_FILENAME: &str = "dek.enc";
const SETTINGS_ENC_FILENAME: &str = "settings.enc";
/// Tauri event name. Must mirror the constant in `sorng-encryption`.
const EVENT_UNLOCKED: &str = "encryption:unlocked";

/// Per-artifact rewrite tally returned by the rotation command.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullRotateReport {
    /// Did `settings.enc` exist + get re-encrypted?
    pub settings_rewritten: bool,
    /// Did the connections file (`data.enc` v2 envelope) exist + get
    /// re-encrypted? `false` when the file is still plaintext.
    pub connections_rewritten: bool,
    /// Count of v2 backup files re-encrypted across every enabled
    /// destination.
    pub backups_rewritten: u32,
    /// Count of recording-metadata envelopes re-encrypted.
    pub recording_envelopes_rewritten: u32,
    /// Count of media sidecars (`*.media.enc`) re-encrypted under the
    /// chunked-stream codec.
    pub media_sidecars_rewritten: u32,
    /// Count of macro envelopes re-encrypted.
    pub macros_rewritten: u32,
    /// Total v2-envelope bytes written across all artifacts.
    pub bytes_rewritten: u64,
    /// Was the OS vault entry updated with the new DEK?
    pub vault_updated: bool,
    /// Was `dek.enc` re-wrapped under the new DEK?
    pub dek_enc_updated: bool,
    /// Per-file failure reasons. Empty on a clean run. A non-empty
    /// list means the rotation completed for everything that
    /// succeeded but the listed files still hold their old
    /// ciphertext — the user can re-run rotation to retry them.
    pub failures: Vec<FullRotateFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullRotateFailure {
    pub artifact: String,
    pub path: String,
    pub reason: String,
}

/// Rotate the master DEK and re-encrypt every persisted artifact
/// under the new sub-keys. Replaces the call to
/// `encryption_rotate_master_key` from the Settings UI — the old
/// command stays registered for callers that genuinely only want the
/// settings half rotated, but the production "Rotate master key"
/// button uses this one.
///
/// Implementation note: this Tauri command is intentionally a thin
/// shell around [`rotate_master_key_full_inner`]. The shell owns the
/// pieces only the Tauri runtime can supply — the `AppHandle` (for
/// `app_data_dir` resolution + the cross-window `EVENT_UNLOCKED`
/// broadcast) and the OS-vault probe — so the inner helper stays
/// callable from integration tests that don't stand up a Tauri runtime
/// (see `src-tauri/tests/encryption_rotation_e2e.rs`).
#[tauri::command]
pub async fn encryption_rotate_master_key_full(
    app: AppHandle,
    enc_state: State<'_, EncryptionState>,
    storage_state: State<'_, SecureStorageState>,
    backup_state: State<'_, BackupServiceState>,
    recording_state: State<'_, RecordingServiceState>,
    password: Option<String>,
) -> Result<FullRotateReport, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    // Probing the OS vault is a Tauri-runtime concern (it touches the
    // real keychain via `sorng_vault::keychain::read_dek`), so the
    // shell answers this for the helper. The integration test passes
    // `vault_present: false` directly so the rewrite path never tries
    // to write to the host keychain.
    let vault_present = sorng_vault::keychain::read_dek().await.is_ok();

    let report = rotate_master_key_full_inner(
        &dir,
        enc_state.inner(),
        storage_state.inner(),
        backup_state.inner(),
        recording_state.inner(),
        password,
        vault_present,
    )
    .await?;

    // The cross-window broadcast is the one piece the helper can't
    // perform — it has no `AppHandle`. Emit it here so every Tauri
    // window's encryption-status sidebar refreshes after rotation.
    let _ = app.emit(EVENT_UNLOCKED, ());

    Ok(report)
}

/// Tauri-agnostic body of the master-key rotation orchestrator.
///
/// Takes plain references instead of `tauri::State` so integration
/// tests can drive it without the Tauri runtime. Behavioural surface:
///
/// - Step 1 snapshots the current DEK (DEK A) so the rewrite loop can
///   still decrypt under the old key after step 2 swaps the live state.
/// - Step 2 generates DEK B and installs it into `enc_state`.
/// - Step 3 walks every artifact (settings, connections, backups,
///   recording metadata, media sidecars, macros), decrypting with the
///   frozen DEK A and re-encrypting with DEK B in place.
/// - Step 4 updates the key-storage receipts: vault entry when
///   `vault_present`, and `dek.enc` when `password` is `Some`.
/// - Step 5 resets the lockout counter and appends to the audit log.
///
/// The `vault_present` flag is passed in (rather than re-probed) so
/// tests can deterministically skip the OS-keychain write. The Tauri
/// command wrapper above probes it via `sorng_vault::keychain::read_dek`
/// and forwards the result.
#[allow(clippy::too_many_arguments)]
pub async fn rotate_master_key_full_inner(
    app_data_dir: &std::path::Path,
    enc_state: &EncryptionState,
    storage_state: &SecureStorageState,
    backup_state: &BackupServiceState,
    recording_state: &RecordingServiceState,
    password: Option<String>,
    vault_present: bool,
) -> Result<FullRotateReport, String> {
    if !enc_state.is_unlocked().await {
        return Err("state is locked; unlock before rotating".into());
    }

    let dek_enc_path = app_data_dir.join(DEK_ENC_FILENAME);
    let dek_enc_present = dek_enc_path.exists();
    let settings_enc_path = app_data_dir.join(SETTINGS_ENC_FILENAME);
    let settings_enc_present = settings_enc_path.exists();

    if dek_enc_present && password.is_none() {
        return Err(
            "password mode is in effect; supply the password to re-wrap dek.enc".into(),
        );
    }

    // ── Step 1: freeze the old DEK ─────────────────────────────────
    let old_state = enc_state
        .snapshot()
        .await
        .ok_or_else(|| "internal: state vanished mid-rotation".to_string())?;

    // ── Step 2: install the new DEK into the live state ────────────
    let new_dek = MasterDek::generate();
    enc_state.install(new_dek).await;

    let new_mode = match (vault_present, dek_enc_present) {
        (true, true) => MasterKeyStorage::VaultAndPassword,
        (true, false) => MasterKeyStorage::Vault,
        (false, true) => MasterKeyStorage::Password,
        (false, false) => MasterKeyStorage::Vault,
    };
    let salt = [0u8; SALT_LEN];

    let mut report = FullRotateReport::default();

    // ── Step 3a: settings.enc ──────────────────────────────────────
    if settings_enc_present {
        match rewrite_settings(&settings_enc_path, &old_state, enc_state, new_mode, salt).await
        {
            Ok(n) => {
                report.settings_rewritten = true;
                report.bytes_rewritten += n;
            }
            Err(reason) => report.failures.push(FullRotateFailure {
                artifact: "settings".into(),
                path: settings_enc_path.display().to_string(),
                reason,
            }),
        }
    }

    // ── Step 3b: connections (`data.enc` aka `storage.json`) ──────
    let store_path = {
        let svc = storage_state.lock().await;
        svc.store_path().to_string()
    };
    if std::path::Path::new(&store_path).exists() {
        // Magic-byte sniff: only re-encrypt v2 envelopes; plaintext
        // files stay plaintext.
        let head = std::fs::read(&store_path).unwrap_or_default();
        if head.len() >= 6 && &head[..6] == sorng_encryption::envelope::MAGIC {
            match rewrite_connections(&store_path, &old_state, enc_state).await {
                Ok(n) => {
                    report.connections_rewritten = true;
                    report.bytes_rewritten += n;
                }
                Err(reason) => report.failures.push(FullRotateFailure {
                    artifact: "connections".into(),
                    path: store_path.clone(),
                    reason,
                }),
            }
        }
    }

    // ── Step 3c: backups across every enabled destination ─────────
    let backup_paths = {
        let svc = backup_state.lock().await;
        svc.list_v2_files().await
    };
    for path in backup_paths {
        match sorng_storage::backup::BackupService::rewrite_backup_with(
            &path, &old_state, enc_state,
        )
        .await
        {
            Ok(n) => {
                report.backups_rewritten += 1;
                report.bytes_rewritten += n;
            }
            Err(reason) => report.failures.push(FullRotateFailure {
                artifact: "backup".into(),
                path: path.display().to_string(),
                reason,
            }),
        }
    }

    // ── Step 3d: recording metadata + media + macros ──────────────
    let rec_root = {
        let svc = recording_state.lock().await;
        svc.storage_root_snapshot().await
    };
    for path in rec_storage::list_encrypted_envelope_paths(&rec_root) {
        match rec_storage::rewrite_envelope_with(&path, &old_state, enc_state).await {
            Ok(n) => {
                report.recording_envelopes_rewritten += 1;
                report.bytes_rewritten += n;
            }
            Err(e) => report.failures.push(FullRotateFailure {
                artifact: "recording-meta".into(),
                path: path.display().to_string(),
                reason: e.to_string(),
            }),
        }
    }
    for path in rec_storage::list_encrypted_media_paths(&rec_root) {
        match rec_storage::rewrite_media_with(&path, &old_state, enc_state).await {
            Ok(n) => {
                report.media_sidecars_rewritten += 1;
                report.bytes_rewritten += n;
            }
            Err(e) => report.failures.push(FullRotateFailure {
                artifact: "recording-media".into(),
                path: path.display().to_string(),
                reason: e.to_string(),
            }),
        }
    }
    for path in rec_storage::list_encrypted_macro_paths(&rec_root) {
        match rec_storage::rewrite_macro_with(&path, &old_state, enc_state).await {
            Ok(n) => {
                report.macros_rewritten += 1;
                report.bytes_rewritten += n;
            }
            Err(e) => report.failures.push(FullRotateFailure {
                artifact: "macro".into(),
                path: path.display().to_string(),
                reason: e.to_string(),
            }),
        }
    }

    // ── Step 4: key-storage receipts ──────────────────────────────
    let new_bytes_raw = enc_state
        .master_bytes_raw()
        .await
        .ok_or_else(|| "internal: new master DEK vanished mid-rotation".to_string())?;

    if vault_present {
        sorng_vault::keychain::store_bytes(
            sorng_vault::types::SERVICE_NAME,
            sorng_vault::types::MASTER_DEK_ACCOUNT,
            &new_bytes_raw,
        )
        .await
        .map_err(|e| format!("vault update: {e}"))?;
        report.vault_updated = true;
    }
    if let Some(pw) = password {
        let dek_owned = MasterDek::from_bytes(&new_bytes_raw)
            .ok_or_else(|| "internal: master DEK wrong length".to_string())?;
        let blob = password_wrap::wrap(&pw, &dek_owned, Argon2Params::OWASP)
            .map_err(|e| format!("wrap: {e}"))?;
        atomic_write(&dek_enc_path, &blob)?;
        report.dek_enc_updated = true;
    }

    // Lockout reset + audit. The cross-window broadcast lives in the
    // Tauri wrapper (this helper has no AppHandle).
    let mut lockout = sorng_encryption::lockout::LockoutState::load(app_data_dir);
    lockout.record_success();
    let _ = lockout.save(app_data_dir);
    let _ = audit::record(
        app_data_dir,
        AuditEvent::KeyRotated,
        serde_json::json!({
            "settingsRewritten": report.settings_rewritten,
            "connectionsRewritten": report.connections_rewritten,
            "backupsRewritten": report.backups_rewritten,
            "recordingEnvelopesRewritten": report.recording_envelopes_rewritten,
            "mediaSidecarsRewritten": report.media_sidecars_rewritten,
            "macrosRewritten": report.macros_rewritten,
            "bytesRewritten": report.bytes_rewritten,
            "vaultUpdated": report.vault_updated,
            "dekEncUpdated": report.dek_enc_updated,
            "failures": report.failures.len(),
        }),
    );

    Ok(report)
}

async fn rewrite_settings(
    path: &std::path::Path,
    from: &EncryptionState,
    to: &EncryptionState,
    mode: MasterKeyStorage,
    salt: [u8; SALT_LEN],
) -> Result<u64, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read: {e}"))?;
    let value = artifact_settings::read(from, &bytes)
        .await
        .map_err(|e| format!("decrypt: {e}"))?
        .unwrap_or_else(|| serde_json::json!({}));
    let blob = artifact_settings::write(to, &value, mode, Argon2Params::OWASP, salt)
        .await
        .map_err(|e| format!("encrypt: {e}"))?;
    let n = blob.len() as u64;
    atomic_write(path, &blob)?;
    Ok(n)
}

async fn rewrite_connections(
    path: &str,
    from: &EncryptionState,
    to: &EncryptionState,
) -> Result<u64, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read: {e}"))?;
    let value = artifact_connections::read(from, &bytes)
        .await
        .map_err(|e| format!("decrypt: {e}"))?
        .unwrap_or_else(|| serde_json::json!({}));
    let blob = artifact_connections::write(
        to,
        &value,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .map_err(|e| format!("encrypt: {e}"))?;
    let n = blob.len() as u64;
    atomic_write(std::path::Path::new(path), &blob)?;
    Ok(n)
}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let tmp = path.with_extension(format!(
        "{}.rotating",
        path.extension().and_then(|s| s.to_str()).unwrap_or("bin")
    ));

    // Write the temp file and flush it to stable storage BEFORE the rename.
    // Without this barrier a crash after the rename can leave the target as a
    // durably-committed directory entry pointing at unflushed (empty/partial)
    // data — the rotated key material would be lost. Mirrors the durability
    // barrier the other encrypted writers use.
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("write tmp: {e}"))?;
        f.write_all(bytes).map_err(|e| format!("write tmp: {e}"))?;
        f.sync_all().map_err(|e| format!("sync tmp: {e}"))?;
    }

    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;

    // fsync the directory holding `path` so the rename itself is durable.
    // POSIX-only — on Windows the NTFS journal covers directory metadata as
    // part of the rename and directories can't be opened for fsync.
    #[cfg(unix)]
    {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                if let Ok(dir) = std::fs::File::open(parent) {
                    let _ = dir.sync_all();
                }
            }
        }
    }

    Ok(())
}
