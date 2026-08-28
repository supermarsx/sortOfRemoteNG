//! Full-artifact master-key rotation orchestrator.
//!
//! The retired `encryption_rotate_master_key` command in
//! `sorng-encryption` rotated only the settings envelope + key-storage
//! receipts (`dek.enc` + vault). That left every other artifact — connections (`data.enc`),
//! recording metadata, recording media sidecars, macros, and every
//! v2 backup file across every destination — encrypted under the old
//! sub-keys after rotation, which made them all unreadable on next
//! boot.
//!
//! This command takes a stage-then-commit approach:
//!
//! 1. Build a frozen `EncryptionState` snapshot holding the *old*
//!    DEK. The live state remains on that key until commit succeeds.
//! 2. Generate a fresh DEK in an isolated state.
//! 3. Copy every required artifact to a transaction sidecar and
//!    re-encrypt only the sidecar. Any rewrite failure discards all
//!    sidecars, leaving canonical bytes and persisted key receipts
//!    unchanged.
//! 4. Back up every canonical artifact, replace it with its fully
//!    staged counterpart, and roll the set back if a replacement or
//!    key-receipt update fails.
//! 5. Re-wrap the new DEK into the OS vault + (if password mode)
//!    `dek.enc`, then install it into the live state. Reset the lockout
//!    counter; emit the unlocked event; audit the rotation.
//!
//! This removes the previous normal-error split-key state: a failed
//! required rewrite can no longer persist the new DEK or alter a
//! canonical artifact. Transaction sidecars use unique names so a
//! failed attempt cannot collide with a later retry.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

use sorng_encryption::artifacts::{
    connections as artifact_connections, settings as artifact_settings,
};
use sorng_encryption::audit::{self, AuditEvent};
use sorng_encryption::dek::MasterDek;
use sorng_encryption::envelope::{
    self as enc_envelope, EnvelopeHeader, MasterKeyStorage, MAGIC as SORNG_ENVELOPE_MAGIC,
    NONCE_LEN, SALT_LEN,
};
use sorng_encryption::key_ring::{self, RetiredKeyRing};
use sorng_encryption::password_wrap::{self, Argon2Params};
use sorng_encryption::{ArtifactKind, EncryptionState};
use sorng_recording::service::RecordingServiceState;
use sorng_recording::storage as rec_storage;
use sorng_storage::backup::BackupServiceState;
use sorng_storage::storage::SecureStorageState;

const DEK_ENC_FILENAME: &str = "dek.enc";
const SETTINGS_ENC_FILENAME: &str = "settings.enc";
/// `<app_data>/databases/` — the per-user connection databases, their
/// index, and their per-database trust stores. Every file under here is
/// wrapped in a master-DEK envelope, so every file under here has to be
/// re-keyed by a rotation. Omitting this directory is exactly the bug
/// t74 exists to fix.
const DATABASES_DIRNAME: &str = "databases";
/// Tauri event name. Must mirror the constant in `sorng-encryption`.
const EVENT_UNLOCKED: &str = "encryption:unlocked";

/// Injected fault point used by the abort/rollback tests. Called with
/// the artifact tag and canonical path just before that artifact is
/// staged; returning `Some(reason)` fails the stage as if the
/// filesystem had refused it.
pub type RotationFailureInjector<'a> = dyn Fn(&str, &Path) -> Option<String> + Sync + 'a;
type VaultReceiptWriter<'a> = dyn Fn(&[u8; 32]) -> Result<(), String> + Sync + 'a;
type BeforeSettingsLockHook<'a> = dyn Fn() + Sync + 'a;

#[derive(Debug)]
struct StagedArtifact {
    artifact: &'static str,
    canonical: PathBuf,
    staged: PathBuf,
    backup: PathBuf,
}

fn durable_rotation_mode(
    vault_receipt_will_exist: bool,
    password_receipt_will_exist: bool,
) -> Result<MasterKeyStorage, String> {
    match (vault_receipt_will_exist, password_receipt_will_exist) {
        (true, true) => Ok(MasterKeyStorage::VaultAndPassword),
        (true, false) => Ok(MasterKeyStorage::Vault),
        (false, true) => Ok(MasterKeyStorage::Password),
        (false, false) => Err(
            "rotation requires at least one durable key receipt (OS vault or password-wrapped dek.enc)"
                .to_string(),
        ),
    }
}

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
    /// Was `databases/index.json` (the current generation) re-encrypted?
    pub database_index_rewritten: bool,
    /// Count of current-generation per-database payloads
    /// (`databases/<id>.json`) re-encrypted.
    pub databases_rewritten: u32,
    /// Count of current-generation per-database trust stores
    /// (`databases/<id>.trust.json`) re-encrypted.
    pub trust_stores_rewritten: u32,
    /// Count of recovery generations (`.bak` / `.v0.bak`) of any
    /// `databases/**` file re-encrypted. These are not optional: the
    /// SDBF read ladder will happily serve a `.bak`, so a rotation that
    /// skipped them would turn permanent data loss into intermittent
    /// data loss.
    pub database_generations_rewritten: u32,
    /// Was the retained key ring (`dek-ring.enc`) re-wrapped under the
    /// new DEK with the outgoing DEK pushed onto it?
    pub key_ring_updated: bool,
    /// How many superseded DEKs the ring holds after this rotation.
    /// Bounded by `key_ring::KEY_RING_CAPACITY`.
    pub key_ring_retained: u32,
    /// Total v2-envelope bytes written across all artifacts.
    pub bytes_rewritten: u64,
    /// Was the OS vault entry updated with the new DEK?
    pub vault_updated: bool,
    /// Was `dek.enc` re-wrapped under the new DEK?
    pub dek_enc_updated: bool,
    /// Per-file failure reasons. Empty on a clean run. A non-empty
    /// list means the transaction was not committed: canonical
    /// artifacts, the live DEK, and persisted key receipts remain on
    /// the old key so the user can correct the failure and retry.
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
/// `encryption_rotate_master_key` from the Settings UI. The legacy
/// settings-only entry point now fails closed; this is the sole
/// supported master-key rotation implementation.
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
    // perform — it has no `AppHandle`. A failed staged transaction
    // leaves the old key live, so only announce a committed rotation.
    if report.failures.is_empty() {
        let _ = app.emit(EVENT_UNLOCKED, ());
    }

    Ok(report)
}

/// Tauri-agnostic body of the master-key rotation orchestrator.
///
/// Takes plain references instead of `tauri::State` so integration
/// tests can drive it without the Tauri runtime. Behavioural surface:
///
/// - Step 1 snapshots the current DEK (DEK A).
/// - Step 2 generates DEK B in an isolated state; the live state stays
///   on DEK A while work is fallible.
/// - Step 3 walks every artifact (settings, connections, backups,
///   recording metadata, media sidecars, macros), decrypting with DEK
///   A and re-encrypting a sidecar with DEK B.
/// - Step 4 commits the complete staged set with rollback copies. If
///   any required rewrite failed, this step is never entered.
/// - Step 5 updates key-storage receipts and only then installs DEK B
///   in the live state, resets lockout, and appends to the audit log.
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
    rotate_master_key_full_inner_impl(
        app_data_dir,
        enc_state,
        storage_state,
        backup_state,
        recording_state,
        password,
        vault_present,
        None,
        None,
        None,
    )
    .await
}

/// Test-only rotation entry point that exposes the fault injector.
///
/// The abort/rollback ladder is the part of this module that protects
/// user data, so it has to be provable from an integration test rather
/// than by reading the code. `#[doc(hidden)]` — not a supported API.
#[doc(hidden)]
#[allow(dead_code, clippy::too_many_arguments)]
pub async fn rotate_master_key_full_inner_with_injector(
    app_data_dir: &Path,
    enc_state: &EncryptionState,
    storage_state: &SecureStorageState,
    backup_state: &BackupServiceState,
    recording_state: &RecordingServiceState,
    password: Option<String>,
    vault_present: bool,
    failure_injector: &RotationFailureInjector<'_>,
) -> Result<FullRotateReport, String> {
    rotate_master_key_full_inner_impl(
        app_data_dir,
        enc_state,
        storage_state,
        backup_state,
        recording_state,
        password,
        vault_present,
        Some(failure_injector),
        None,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn rotate_master_key_full_inner_impl(
    app_data_dir: &Path,
    enc_state: &EncryptionState,
    storage_state: &SecureStorageState,
    backup_state: &BackupServiceState,
    recording_state: &RecordingServiceState,
    password: Option<String>,
    vault_present: bool,
    failure_injector: Option<&RotationFailureInjector<'_>>,
    vault_receipt_writer: Option<&VaultReceiptWriter<'_>>,
    before_settings_lock: Option<&BeforeSettingsLockHook<'_>>,
) -> Result<FullRotateReport, String> {
    if !enc_state.is_unlocked().await {
        return Err("state is locked; unlock before rotating".into());
    }

    let dek_enc_path = app_data_dir.join(DEK_ENC_FILENAME);
    let settings_enc_path = app_data_dir.join(SETTINGS_ENC_FILENAME);

    let new_mode = durable_rotation_mode(vault_present, password.is_some())?;

    // ── Step 2: prepare the new DEK in isolation ───────────────────
    // The live state deliberately stays on the old key until every
    // staged artifact and persisted key receipt has committed.
    let new_state = EncryptionState::new();
    new_state.install(MasterDek::generate()).await;
    let new_bytes_raw = new_state
        .master_bytes_raw()
        .await
        .ok_or_else(|| "internal: new master DEK vanished mid-rotation".to_string())?;

    let salt = [0u8; SALT_LEN];

    // Password wrapping is intentionally preflighted before taking the
    // process-wide settings coordinator. Argon2 is the slowest part of a
    // password rotation and no settings snapshot exists yet, so ordinary
    // settings writes remain unblocked while it runs.
    let new_dek_enc_blob = match password.as_deref() {
        Some(pw) => {
            let Some(dek_owned) = MasterDek::from_bytes(&new_bytes_raw) else {
                return Err("internal: master DEK wrong length".to_string());
            };
            Some(
                password_wrap::wrap(pw, &dek_owned, Argon2Params::OWASP)
                    .map_err(|error| format!("wrap: {error}"))?,
            )
        }
        None => None,
    };

    if let Some(hook) = before_settings_lock {
        hook();
    }

    // From the live-key/settings snapshot through canonical replacement,
    // receipt persistence, and live-key installation, rotation is one FIFO
    // transaction with ordinary settings writes and representation changes.
    let settings_guard = sorng_encryption::settings_coordinator::lock().await;

    // The state or on-disk receipt could have changed while password preflight
    // ran and this rotation waited its turn, so all canonical preconditions are
    // re-read only after entering the shared coordinator.
    if !enc_state.is_unlocked().await {
        return Err("state is locked; unlock before rotating".into());
    }
    let dek_enc_present = dek_enc_path.exists();
    let settings_enc_present = settings_enc_path.exists();
    if dek_enc_present && password.is_none() {
        return Err("password mode is in effect; supply the password to re-wrap dek.enc".into());
    }

    // ── Step 1: freeze the old DEK ─────────────────────────────────
    let old_state = enc_state
        .snapshot()
        .await
        .ok_or_else(|| "internal: state vanished mid-rotation".to_string())?;

    let old_bytes_raw = old_state
        .master_bytes_raw()
        .await
        .ok_or_else(|| "internal: old master DEK vanished mid-rotation".to_string())?;

    // Capture the old receipt before any canonical artifact can be
    // committed so a later receipt failure has a recovery source.
    let old_dek_enc_blob = if dek_enc_present {
        Some(std::fs::read(&dek_enc_path).map_err(|e| format!("read dek.enc: {e}"))?)
    } else {
        None
    };

    let mut report = FullRotateReport::default();
    let transaction_id = format!("{:032x}", rand::random::<u128>());
    let mut staged = Vec::new();

    // ── Step 3a: settings.enc ──────────────────────────────────────
    if settings_enc_present {
        match prepare_stage(
            &transaction_id,
            "settings",
            &settings_enc_path,
            failure_injector,
        ) {
            Ok(item) => {
                let result =
                    rewrite_settings(&item.staged, &old_state, &new_state, new_mode, salt).await;
                keep_or_record_stage(&mut report, &mut staged, item, result, |report, n| {
                    report.settings_rewritten = true;
                    report.bytes_rewritten += n;
                });
            }
            Err(reason) => push_failure(&mut report, "settings", &settings_enc_path, reason),
        }
    }

    // ── Step 3b: connections (`data.enc` aka `storage.json`) ──────
    let store_path = PathBuf::from({
        let svc = storage_state.lock().await;
        svc.store_path().to_string()
    });
    if store_path.exists() {
        // Magic-byte sniff: only re-encrypt v2 envelopes; plaintext
        // files stay plaintext.
        match std::fs::read(&store_path) {
            Ok(head) if head.len() >= 6 && &head[..6] == sorng_encryption::envelope::MAGIC => {
                match prepare_stage(
                    &transaction_id,
                    "connections",
                    &store_path,
                    failure_injector,
                ) {
                    Ok(item) => {
                        let result =
                            rewrite_connections(&item.staged, &old_state, &new_state).await;
                        keep_or_record_stage(
                            &mut report,
                            &mut staged,
                            item,
                            result,
                            |report, n| {
                                report.connections_rewritten = true;
                                report.bytes_rewritten += n;
                            },
                        );
                    }
                    Err(reason) => push_failure(&mut report, "connections", &store_path, reason),
                }
            }
            Ok(_) => {}
            Err(error) => push_failure(
                &mut report,
                "connections",
                &store_path,
                format!("read: {error}"),
            ),
        }
    }

    // ── Step 3c: backups across every enabled destination ─────────
    let backup_pairs = {
        let svc = backup_state.lock().await;
        svc.list_v2_backup_pairs().await
    };
    for pair in backup_pairs {
        let archive_item = match prepare_stage(
            &transaction_id,
            "backup",
            &pair.archive_path,
            failure_injector,
        ) {
            Ok(item) => item,
            Err(reason) => {
                push_failure(&mut report, "backup", &pair.archive_path, reason);
                continue;
            }
        };
        let metadata_item = match prepare_stage(
            &transaction_id,
            "backup",
            &pair.metadata_path,
            failure_injector,
        ) {
            Ok(item) => item,
            Err(reason) => {
                push_failure(&mut report, "backup", &pair.metadata_path, reason);
                discard_artifact_sidecars(&archive_item);
                continue;
            }
        };

        let result = sorng_storage::backup::BackupService::rewrite_backup_pair_with(
            &archive_item.staged,
            &metadata_item.staged,
            &old_state,
            &new_state,
        )
        .await
        .and_then(|bytes| {
            sync_regular_file(&archive_item.staged)?;
            sync_regular_file(&metadata_item.staged)?;
            Ok(bytes)
        });
        match result {
            Ok(bytes) => {
                report.backups_rewritten += 1;
                report.bytes_rewritten += bytes;
                staged.push(archive_item);
                staged.push(metadata_item);
            }
            Err(reason) => {
                push_failure(&mut report, "backup", &pair.archive_path, reason);
                discard_artifact_sidecars(&archive_item);
                discard_artifact_sidecars(&metadata_item);
            }
        }
    }

    // ── Step 3d: recording metadata + media + macros ──────────────
    let rec_root = {
        let svc = recording_state.lock().await;
        svc.storage_root_snapshot().await
    };
    for path in rec_storage::list_encrypted_envelope_paths(&rec_root) {
        match prepare_stage(&transaction_id, "recording-meta", &path, failure_injector) {
            Ok(item) => {
                let result =
                    rec_storage::rewrite_envelope_with(&item.staged, &old_state, &new_state)
                        .await
                        .map_err(|e| e.to_string());
                keep_or_record_stage(&mut report, &mut staged, item, result, |report, n| {
                    report.recording_envelopes_rewritten += 1;
                    report.bytes_rewritten += n;
                });
            }
            Err(reason) => push_failure(&mut report, "recording-meta", &path, reason),
        }
    }
    for path in rec_storage::list_encrypted_media_paths(&rec_root) {
        match prepare_stage(&transaction_id, "recording-media", &path, failure_injector) {
            Ok(item) => {
                let result = rec_storage::rewrite_media_with(&item.staged, &old_state, &new_state)
                    .await
                    .map_err(|e| e.to_string());
                keep_or_record_stage(&mut report, &mut staged, item, result, |report, n| {
                    report.media_sidecars_rewritten += 1;
                    report.bytes_rewritten += n;
                });
            }
            Err(reason) => push_failure(&mut report, "recording-media", &path, reason),
        }
    }
    for path in rec_storage::list_encrypted_macro_paths(&rec_root) {
        match prepare_stage(&transaction_id, "macro", &path, failure_injector) {
            Ok(item) => {
                let result = rec_storage::rewrite_macro_with(&item.staged, &old_state, &new_state)
                    .await
                    .map_err(|e| e.to_string());
                keep_or_record_stage(&mut report, &mut staged, item, result, |report, n| {
                    report.macros_rewritten += 1;
                    report.bytes_rewritten += n;
                });
            }
            Err(reason) => push_failure(&mut report, "macro", &path, reason),
        }
    }

    // ── Step 3e: databases/** (index, payloads, trust stores) ─────
    //
    // Historically absent, which is the whole reason t74 exists: a
    // rotation re-keyed settings + storage.json, reported success, and
    // left every connection database wrapped under a DEK that no longer
    // existed anywhere. Every generation is covered, not just the
    // current one — `safe_read_raw` falls back to `.bak` and
    // `.v0.bak`, so a skipped generation is a live landmine.
    let databases_dir = app_data_dir.join(DATABASES_DIRNAME);
    let mut database_tmp_files: Vec<PathBuf> = Vec::new();
    match collect_database_files(&databases_dir) {
        Ok(walk) => {
            database_tmp_files = walk.transient;
            for file in walk.files {
                match prepare_stage(
                    &transaction_id,
                    file.kind.artifact_tag(),
                    &file.path,
                    failure_injector,
                ) {
                    Ok(item) => {
                        let result = rewrite_database_file(
                            &item.staged,
                            file.kind.artifact_kind(),
                            &old_state,
                            &new_state,
                        )
                        .await;
                        keep_or_record_stage(
                            &mut report,
                            &mut staged,
                            item,
                            result,
                            |report, n| {
                                match (file.kind, file.is_generation) {
                                    (_, true) => report.database_generations_rewritten += 1,
                                    (DatabaseFileKind::Index, false) => {
                                        report.database_index_rewritten = true
                                    }
                                    (DatabaseFileKind::Payload, false) => {
                                        report.databases_rewritten += 1
                                    }
                                    (DatabaseFileKind::Trust, false) => {
                                        report.trust_stores_rewritten += 1
                                    }
                                }
                                report.bytes_rewritten += n;
                            },
                        );
                    }
                    Err(reason) => {
                        push_failure(&mut report, file.kind.artifact_tag(), &file.path, reason)
                    }
                }
            }
        }
        Err(reason) => push_failure(&mut report, "databases", &databases_dir, reason),
    }

    // ── Step 3f: the retained key ring ────────────────────────────
    //
    // Push the outgoing DEK onto the ring and re-wrap the whole ring
    // under the incoming DEK. Defence in depth for step 3e, never a
    // substitute for it: if some future artifact family is added
    // without being added to this walk, the ring keeps its files
    // openable instead of turning them into unreadable ciphertext.
    // See `sorng_encryption::key_ring` for the forward-secrecy
    // trade-off (bounded, user-directed).
    let ring_path = key_ring::ring_path(app_data_dir);
    if report.failures.is_empty() && !ring_path.exists() {
        // The staging ladder copies a canonical file, so one has to
        // exist. Seeding an *empty* ring under the still-live old key
        // is safe in both outcomes: if this rotation commits, step 3f
        // replaces it; if it aborts, a valid empty ring under the
        // unchanged live key is a no-op.
        match key_ring::encode(&old_state, &RetiredKeyRing::empty()).await {
            Ok(blob) => {
                if let Err(reason) = atomic_write(&ring_path, &blob) {
                    push_failure(&mut report, "key-ring", &ring_path, reason);
                }
            }
            Err(error) => push_failure(&mut report, "key-ring", &ring_path, error.to_string()),
        }
    }
    if report.failures.is_empty() {
        match prepare_stage(&transaction_id, "key-ring", &ring_path, failure_injector) {
            Ok(item) => {
                let outcome =
                    rewrite_key_ring(&item.staged, &old_state, &new_state, &old_bytes_raw).await;
                let retained = outcome.as_ref().map(|(_, r)| *r).unwrap_or(0);
                let result = outcome.map(|(bytes, _)| bytes);
                keep_or_record_stage(&mut report, &mut staged, item, result, move |report, n| {
                    report.key_ring_updated = true;
                    report.key_ring_retained = retained;
                    report.bytes_rewritten += n;
                });
            }
            Err(reason) => push_failure(&mut report, "key-ring", &ring_path, reason),
        }
    }

    // A required rewrite failure aborts before any canonical path,
    // live key, vault entry, or password receipt can change.
    if !report.failures.is_empty() {
        discard_rotation_files(&staged);
        reset_rewrite_tallies(&mut report);
        return Ok(report);
    }

    // ── Step 4: commit staged artifacts with rollback copies ───────
    if let Err((artifact, path, reason)) = prepare_backups(&staged) {
        push_failure(&mut report, artifact, &path, reason);
        discard_rotation_files(&staged);
        reset_rewrite_tallies(&mut report);
        return Ok(report);
    }
    if let Err((artifact, path, reason)) = commit_staged_artifacts(&staged) {
        push_failure(&mut report, artifact, &path, reason);
        let recovery_errors = rollback_artifacts(&staged);
        reset_rewrite_tallies(&mut report);
        if !recovery_errors.is_empty() {
            discard_staged_files(&staged);
            return Err(format!(
                "rotation commit failed and rollback was incomplete: {}",
                recovery_errors.join("; ")
            ));
        }
        discard_rotation_files(&staged);
        return Ok(report);
    }

    // ── Step 5: persist receipts, then swap the live state ─────────
    let mut vault_updated = false;
    let receipt_result = async {
        if vault_present {
            if let Some(writer) = vault_receipt_writer {
                writer(&new_bytes_raw).map_err(|e| format!("vault update: {e}"))?;
            } else {
                sorng_vault::keychain::store_bytes(
                    sorng_vault::types::SERVICE_NAME,
                    sorng_vault::types::MASTER_DEK_ACCOUNT,
                    &new_bytes_raw,
                )
                .await
                .map_err(|e| format!("vault update: {e}"))?;
            }
            vault_updated = true;
        }
        if let Some(blob) = new_dek_enc_blob.as_deref() {
            atomic_write(&dek_enc_path, blob)?;
        }
        Ok::<(), String>(())
    }
    .await;

    if let Err(reason) = receipt_result {
        let mut recovery_errors = rollback_artifacts(&staged);
        if vault_updated {
            let restore_result = if let Some(writer) = vault_receipt_writer {
                writer(&old_bytes_raw)
            } else {
                sorng_vault::keychain::store_bytes(
                    sorng_vault::types::SERVICE_NAME,
                    sorng_vault::types::MASTER_DEK_ACCOUNT,
                    &old_bytes_raw,
                )
                .await
                .map_err(|e| e.to_string())
            };
            if let Err(error) = restore_result {
                recovery_errors.push(format!("restore vault: {error}"));
            }
        }
        if let Some(blob) = old_dek_enc_blob.as_deref() {
            if let Err(error) = atomic_write(&dek_enc_path, blob) {
                recovery_errors.push(format!("restore dek.enc: {error}"));
            }
        }
        if recovery_errors.is_empty() {
            discard_rotation_files(&staged);
            return Err(format!(
                "{reason}; rotation rolled back to the previous key"
            ));
        }
        discard_staged_files(&staged);
        return Err(format!(
            "{reason}; rotation recovery was incomplete: {}",
            recovery_errors.join("; ")
        ));
    }

    enc_state
        .install(
            MasterDek::from_bytes(&new_bytes_raw)
                .ok_or_else(|| "internal: master DEK wrong length".to_string())?,
        )
        .await;
    report.vault_updated = vault_updated;
    report.dek_enc_updated = new_dek_enc_blob.is_some();
    discard_rotation_files(&staged);

    // Abandoned `databases/**` write-in-progress files are still on the
    // old key and no reader ever consults them (`safe_read_raw` only
    // walks canonical/.bak/.v0.bak). Removing them is deferred until
    // after the commit so an aborted rotation mutates nothing at all.
    for path in &database_tmp_files {
        let _ = std::fs::remove_file(path);
    }

    // Lockout bookkeeping and audit persistence do not participate in the
    // canonical settings/key transaction and must not delay queued writers.
    drop(settings_guard);

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
            "databaseIndexRewritten": report.database_index_rewritten,
            "databasesRewritten": report.databases_rewritten,
            "trustStoresRewritten": report.trust_stores_rewritten,
            "databaseGenerationsRewritten": report.database_generations_rewritten,
            "keyRingUpdated": report.key_ring_updated,
            "keyRingRetained": report.key_ring_retained,
            "bytesRewritten": report.bytes_rewritten,
            "vaultUpdated": report.vault_updated,
            "dekEncUpdated": report.dek_enc_updated,
            "failures": report.failures.len(),
        }),
    );

    Ok(report)
}

// ══════════════════════════════════════════════════════════════════
// databases/** walk
// ══════════════════════════════════════════════════════════════════

/// Which master sub-key protects a file under `<app_data>/databases/`.
/// The three kinds use *different* HKDF labels by design, so a payload
/// re-encrypted under the wrong kind would fail authentication on the
/// next read — getting this classification right is load-bearing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DatabaseFileKind {
    /// `index.json` — the database metadata list.
    Index,
    /// `<id>.json` — one database's connections payload.
    Payload,
    /// `<id>.trust.json` — one database's trust store.
    Trust,
}

impl DatabaseFileKind {
    fn artifact_kind(self) -> ArtifactKind {
        match self {
            DatabaseFileKind::Index => ArtifactKind::DatabasesIndex,
            DatabaseFileKind::Payload => ArtifactKind::Connections,
            DatabaseFileKind::Trust => ArtifactKind::TrustStore,
        }
    }

    /// Tag used in `FullRotateReport::failures` and the staging ladder.
    fn artifact_tag(self) -> &'static str {
        match self {
            DatabaseFileKind::Index => "databases-index",
            DatabaseFileKind::Payload => "database",
            DatabaseFileKind::Trust => "database-trust",
        }
    }
}

#[derive(Debug)]
struct DatabaseFile {
    path: PathBuf,
    kind: DatabaseFileKind,
    /// `true` for a `.bak` / `.v0.bak` recovery generation.
    is_generation: bool,
}

#[derive(Debug, Default)]
struct DatabaseWalk {
    files: Vec<DatabaseFile>,
    /// Abandoned `.tmp` write-in-progress files. Never re-encrypted (no
    /// reader consults them); removed only after a successful commit.
    transient: Vec<PathBuf>,
}

/// Classify one file name inside `databases/`.
///
/// Returns `None` for anything that is not a database artifact — `.tmp`
/// files, and any stray file the app did not write (rotation sidecars
/// from an earlier crashed attempt included, since those carry a
/// `.sorng-rotation-<id>.staged` / `.backup` extension).
fn classify_database_file(file_name: &str) -> Option<(DatabaseFileKind, bool)> {
    if file_name.ends_with(".tmp") {
        return None;
    }
    let (base, is_generation) = if let Some(base) = file_name.strip_suffix(".v0.bak") {
        (base, true)
    } else if let Some(base) = file_name.strip_suffix(".bak") {
        (base, true)
    } else {
        (file_name, false)
    };
    if !base.ends_with(".json") {
        return None;
    }
    let kind = if base == "index.json" {
        DatabaseFileKind::Index
    } else if base.ends_with(".trust.json") {
        DatabaseFileKind::Trust
    } else {
        DatabaseFileKind::Payload
    };
    Some((kind, is_generation))
}

/// Enumerate every re-keyable file under `databases/`. A missing
/// directory is not an error — a profile that has never created a
/// database simply has nothing here.
///
/// Ordering is deterministic (sorted by path) so a rotation stages, and
/// therefore rolls back, in a reproducible order.
fn collect_database_files(dir: &Path) -> Result<DatabaseWalk, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DatabaseWalk::default())
        }
        Err(error) => return Err(format!("read {}: {error}", dir.display())),
    };

    let mut walk = DatabaseWalk::default();
    for entry in entries {
        let entry = entry.map_err(|error| format!("read {}: {error}", dir.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("stat {}: {error}", entry.path().display()))?;
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".tmp") {
            walk.transient.push(entry.path());
            continue;
        }
        if let Some((kind, is_generation)) = classify_database_file(&name) {
            walk.files.push(DatabaseFile {
                path: entry.path(),
                kind,
                is_generation,
            });
        }
    }
    walk.files.sort_by(|a, b| a.path.cmp(&b.path));
    walk.transient.sort();
    Ok(walk)
}

/// Re-key one `databases/**` file in place (the caller points this at a
/// *staged sidecar*, never a canonical path).
///
/// The on-disk shape is `SDBF preamble (32 B) || SORNG v2 envelope`, so
/// this unwraps the outer codec by hand rather than going through
/// `safe_write`: `safe_write` rotates the `.bak` generation, which would
/// clobber the very generations this walk is trying to preserve.
///
/// A payload without the envelope magic is legacy plaintext from before
/// P4. It is **promoted** to an envelope under the new key rather than
/// skipped, matching the "tolerant read, encrypt on write" policy the
/// normal save path already follows.
async fn rewrite_database_file(
    path: &Path,
    artifact: ArtifactKind,
    from: &EncryptionState,
    to: &EncryptionState,
) -> Result<u64, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read: {e}"))?;
    let payload = sorng_storage::sdbf::parse_and_verify(&bytes)
        .map_err(|e| format!("verify database file: {e}"))?;

    let is_envelope = payload.len() >= SORNG_ENVELOPE_MAGIC.len()
        && &payload[..SORNG_ENVELOPE_MAGIC.len()] == SORNG_ENVELOPE_MAGIC;

    let plain = if is_envelope {
        let sub_key = from
            .sub_key(artifact)
            .await
            .ok_or_else(|| "decrypt: previous key unavailable".to_string())?;
        let (_header, plain) =
            enc_envelope::read_envelope(&sub_key, payload).map_err(|e| format!("decrypt: {e}"))?;
        plain
    } else {
        // Legacy plaintext. Verify it really is JSON before promoting —
        // encrypting unverified bytes would bake corruption in behind a
        // key, where it can never be diagnosed again.
        serde_json::from_slice::<serde_json::Value>(payload)
            .map_err(|e| format!("legacy plaintext JSON: {e}"))?;
        payload.to_vec()
    };

    let sub_key = to
        .sub_key(artifact)
        .await
        .ok_or_else(|| "encrypt: new key unavailable".to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    {
        use rand::rngs::OsRng;
        use rand::RngCore;
        OsRng.fill_bytes(&mut nonce);
    }
    let envelope =
        enc_envelope::write_envelope(&sub_key, &EnvelopeHeader::new_vault(nonce), &plain)
            .map_err(|e| format!("encrypt: {e}"))?;

    // Verify the freshly written envelope opens under the new key before
    // it is allowed anywhere near a commit. Staging is worthless if the
    // staged bytes are not provably readable.
    enc_envelope::read_envelope(&sub_key, &envelope)
        .map_err(|e| format!("verify re-encrypted database file: {e}"))?;

    let mut out = Vec::with_capacity(sorng_storage::sdbf::PREAMBLE_LEN + envelope.len());
    out.extend_from_slice(&sorng_storage::sdbf::encode_preamble(&envelope));
    out.extend_from_slice(&envelope);
    sorng_storage::sdbf::parse_and_verify(&out)
        .map_err(|e| format!("verify re-encrypted database container: {e}"))?;

    let n = out.len() as u64;
    atomic_write(path, &out)?;
    Ok(n)
}

/// Re-wrap the retained key ring: decrypt under the outgoing DEK, push
/// the outgoing DEK onto the front, re-encrypt the whole ring under the
/// incoming DEK. Returns `(bytes_written, retained_count)`.
///
/// The ring is *always* encrypted — there is no code path that writes
/// retired DEKs in the clear. It is keyed by `ArtifactKind::KeyRing`, a
/// sub-key of the current master, so possessing the ring file without
/// the current master reveals nothing.
async fn rewrite_key_ring(
    path: &Path,
    from: &EncryptionState,
    to: &EncryptionState,
    outgoing_dek: &[u8; 32],
) -> Result<(u64, u32), String> {
    let mut ring = key_ring::load(path, from)
        .await
        .map_err(|e| format!("read key ring: {e}"))?;
    ring.retire(outgoing_dek, key_ring::now_unix());
    let retained = ring.len() as u32;

    let blob = key_ring::encode(to, &ring)
        .await
        .map_err(|e| format!("encrypt key ring: {e}"))?;
    // Prove the staged ring opens under the new key before commit.
    key_ring::decode(to, &blob)
        .await
        .map_err(|e| format!("verify key ring: {e}"))?;

    let n = blob.len() as u64;
    atomic_write(path, &blob)?;
    Ok((n, retained))
}

fn rotation_sidecar_path(path: &Path, transaction_id: &str, suffix: &str) -> PathBuf {
    let mut file_name = path
        .file_name()
        .unwrap_or_else(|| std::ffi::OsStr::new("artifact"))
        .to_os_string();
    file_name.push(format!(".sorng-rotation-{transaction_id}.{suffix}"));
    path.with_file_name(file_name)
}

fn rotating_tmp_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}.rotating",
        path.extension().and_then(|s| s.to_str()).unwrap_or("bin")
    ))
}

fn rollback_tmp_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}.rollback",
        path.extension().and_then(|s| s.to_str()).unwrap_or("bin")
    ))
}

fn sync_regular_file(path: &Path) -> Result<(), String> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .and_then(|file| file.sync_all())
        .map_err(|e| format!("sync {}: {e}", path.display()))
}

fn sync_parent_best_effort(_path: &Path) {
    #[cfg(unix)]
    if let Some(parent) = _path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
    }
}

fn prepare_stage(
    transaction_id: &str,
    artifact: &'static str,
    canonical: &Path,
    failure_injector: Option<&RotationFailureInjector<'_>>,
) -> Result<StagedArtifact, String> {
    if let Some(reason) = failure_injector.and_then(|injector| injector(artifact, canonical)) {
        return Err(reason);
    }

    let staged = rotation_sidecar_path(canonical, transaction_id, "staged");
    let backup = rotation_sidecar_path(canonical, transaction_id, "backup");
    if let Err(error) = std::fs::copy(canonical, &staged) {
        let _ = std::fs::remove_file(&staged);
        return Err(format!("stage {}: {error}", canonical.display()));
    }
    if let Err(reason) = sync_regular_file(&staged) {
        let _ = std::fs::remove_file(&staged);
        return Err(reason);
    }
    sync_parent_best_effort(&staged);

    Ok(StagedArtifact {
        artifact,
        canonical: canonical.to_path_buf(),
        staged,
        backup,
    })
}

fn push_failure(report: &mut FullRotateReport, artifact: &str, path: &Path, reason: String) {
    report.failures.push(FullRotateFailure {
        artifact: artifact.to_string(),
        path: path.display().to_string(),
        reason,
    });
}

fn keep_or_record_stage(
    report: &mut FullRotateReport,
    staged: &mut Vec<StagedArtifact>,
    item: StagedArtifact,
    result: Result<u64, String>,
    on_success: impl FnOnce(&mut FullRotateReport, u64),
) {
    let result = result.and_then(|bytes| {
        sync_regular_file(&item.staged)?;
        Ok(bytes)
    });
    match result {
        Ok(bytes) => {
            on_success(report, bytes);
            staged.push(item);
        }
        Err(reason) => {
            push_failure(report, item.artifact, &item.canonical, reason);
            discard_artifact_sidecars(&item);
        }
    }
}

fn prepare_backups(staged: &[StagedArtifact]) -> Result<(), (&'static str, PathBuf, String)> {
    for item in staged {
        std::fs::copy(&item.canonical, &item.backup).map_err(|e| {
            (
                item.artifact,
                item.canonical.clone(),
                format!("prepare rollback copy: {e}"),
            )
        })?;
        sync_regular_file(&item.backup).map_err(|reason| {
            (
                item.artifact,
                item.canonical.clone(),
                format!("prepare rollback copy: {reason}"),
            )
        })?;
        sync_parent_best_effort(&item.backup);
    }
    Ok(())
}

fn durable_replace(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination)
        .map_err(|e| format!("replace {}: {e}", destination.display()))?;
    sync_parent_best_effort(destination);
    Ok(())
}

fn commit_staged_artifacts(
    staged: &[StagedArtifact],
) -> Result<(), (&'static str, PathBuf, String)> {
    for item in staged {
        durable_replace(&item.staged, &item.canonical)
            .map_err(|reason| (item.artifact, item.canonical.clone(), reason))?;
    }
    Ok(())
}

fn rollback_artifacts(staged: &[StagedArtifact]) -> Vec<String> {
    let mut failures = Vec::new();
    for item in staged.iter().rev() {
        if item.backup.exists() {
            if let Err(reason) = durable_replace(&item.backup, &item.canonical) {
                failures.push(format!(
                    "restore {} {}: {reason}; rollback copy retained at {}",
                    item.artifact,
                    item.canonical.display(),
                    item.backup.display()
                ));
            }
        }
    }
    failures
}

fn discard_artifact_sidecars(item: &StagedArtifact) {
    let staged_tmp = rotating_tmp_path(&item.staged);
    let backup_tmp = rotating_tmp_path(&item.backup);
    let staged_rollback = rollback_tmp_path(&item.staged);
    let backup_rollback = rollback_tmp_path(&item.backup);
    for path in [
        item.staged.as_path(),
        item.backup.as_path(),
        staged_tmp.as_path(),
        backup_tmp.as_path(),
        staged_rollback.as_path(),
        backup_rollback.as_path(),
    ] {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn discard_rotation_files(staged: &[StagedArtifact]) {
    for item in staged {
        discard_artifact_sidecars(item);
    }
}

fn discard_staged_files(staged: &[StagedArtifact]) {
    for item in staged {
        let staged_tmp = rotating_tmp_path(&item.staged);
        let staged_rollback = rollback_tmp_path(&item.staged);
        for path in [&item.staged, &staged_tmp, &staged_rollback] {
            if path.exists() {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn reset_rewrite_tallies(report: &mut FullRotateReport) {
    report.settings_rewritten = false;
    report.connections_rewritten = false;
    report.backups_rewritten = 0;
    report.recording_envelopes_rewritten = 0;
    report.media_sidecars_rewritten = 0;
    report.macros_rewritten = 0;
    report.database_index_rewritten = false;
    report.databases_rewritten = 0;
    report.trust_stores_rewritten = 0;
    report.database_generations_rewritten = 0;
    report.key_ring_updated = false;
    report.key_ring_retained = 0;
    report.bytes_rewritten = 0;
    report.vault_updated = false;
    report.dek_enc_updated = false;
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
    path: &Path,
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
    atomic_write(path, &blob)?;
    Ok(n)
}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let tmp = rotating_tmp_path(path);

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
    sync_parent_best_effort(path);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    use sorng_encryption::envelope::EnvelopeHeader;
    use sorng_recording::service::RecordingService;
    use sorng_storage::backup::{BackupRewritePair, BackupService};
    use sorng_storage::storage::{SecureStorage, StorageData};

    struct ReceiptFixture {
        _temp: tempfile::TempDir,
        app_data: PathBuf,
        enc_state: Arc<EncryptionState>,
        storage_state: SecureStorageState,
        backup_state: BackupServiceState,
        recording_state: RecordingServiceState,
        settings_path: PathBuf,
        settings_payload: serde_json::Value,
        old_dek_bytes: [u8; 32],
    }

    async fn receipt_fixture(seed: u8) -> ReceiptFixture {
        let temp = tempdir().expect("temp app data");
        let app_data = temp.path().to_path_buf();
        let backup_dir = app_data.join("backups");
        std::fs::create_dir_all(&backup_dir).expect("backup dir");

        let old_dek_bytes = [seed; 32];
        let enc_state = Arc::new(EncryptionState::new());
        enc_state
            .install(MasterDek::from_bytes(&old_dek_bytes).expect("old DEK"))
            .await;

        let settings_path = app_data.join(SETTINGS_ENC_FILENAME);
        let settings_payload = json!({ "theme": "dark", "fixture": seed });
        let settings_blob = artifact_settings::write(
            &enc_state,
            &settings_payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .expect("encode settings");
        std::fs::write(&settings_path, settings_blob).expect("write settings");

        let storage_state =
            SecureStorage::new(app_data.join("storage.json").to_string_lossy().to_string());
        storage_state
            .lock()
            .await
            .set_encryption_state(enc_state.clone());
        let backup_state = BackupService::new(backup_dir.to_string_lossy().to_string());
        let recording_service = RecordingService::new(&app_data.to_string_lossy());
        recording_service
            .set_encryption_state(enc_state.clone())
            .await;
        let recording_state = Arc::new(tokio::sync::Mutex::new(recording_service));

        ReceiptFixture {
            _temp: temp,
            app_data,
            enc_state,
            storage_state,
            backup_state,
            recording_state,
            settings_path,
            settings_payload,
            old_dek_bytes,
        }
    }

    async fn create_encrypted_backup(
        fixture: &ReceiptFixture,
        payload: &serde_json::Value,
    ) -> (String, BackupRewritePair) {
        let mut service = fixture.backup_state.lock().await;
        let mut config = service.get_config();
        config.destination_path = fixture
            .app_data
            .join("backups")
            .to_string_lossy()
            .into_owned();
        config.compress_backups = false;
        service.update_config(config);
        service.set_encryption_state(fixture.enc_state.clone());
        let metadata = service
            .run_backup("manual", payload)
            .await
            .expect("create encrypted backup");
        let pair = service
            .list_v2_backup_pairs()
            .await
            .into_iter()
            .next()
            .expect("encrypted backup pair");
        (metadata.id, pair)
    }

    async fn password_receipt_fixture(seed: u8, password: &str) -> ReceiptFixture {
        let fixture = receipt_fixture(seed).await;
        let receipt_dek = MasterDek::from_bytes(&fixture.old_dek_bytes).expect("receipt DEK");
        let test_argon = Argon2Params {
            memory_kib: 8 * 1024,
            time_cost: 1,
            parallelism: 1,
        };
        let receipt = password_wrap::wrap(password, &receipt_dek, test_argon)
            .expect("wrap old password receipt");
        std::fs::write(fixture.app_data.join(DEK_ENC_FILENAME), receipt)
            .expect("write old password receipt");

        let settings_blob = artifact_settings::write(
            &fixture.enc_state,
            &fixture.settings_payload,
            MasterKeyStorage::Password,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .expect("encode password settings");
        std::fs::write(&fixture.settings_path, settings_blob).expect("write password settings");
        fixture
    }

    async fn restart_from_password_receipt(
        fixture: &ReceiptFixture,
        password: &str,
    ) -> serde_json::Value {
        let receipt = std::fs::read(fixture.app_data.join(DEK_ENC_FILENAME))
            .expect("rotated password receipt");
        let restarted_state = EncryptionState::new();
        restarted_state
            .install(password_wrap::unwrap(password, &receipt).expect("unwrap rotated receipt"))
            .await;
        let settings = std::fs::read(&fixture.settings_path).expect("rotated settings");
        artifact_settings::read(&restarted_state, &settings)
            .await
            .expect("decrypt settings after restart")
            .expect("settings document after restart")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn rotation_then_queued_write_preserves_the_newest_patch_under_the_new_key() {
        let password = "rotation-then-write";
        let fixture = password_receipt_fixture(71, password).await;
        let guard = sorng_encryption::settings_coordinator::lock().await;

        let (rotation_ready_tx, rotation_ready_rx) = tokio::sync::oneshot::channel();
        let rotation_dir = fixture.app_data.clone();
        let rotation_enc = fixture.enc_state.clone();
        let rotation_storage = fixture.storage_state.clone();
        let rotation_backup = fixture.backup_state.clone();
        let rotation_recording = fixture.recording_state.clone();
        let rotation_password = password.to_string();
        let rotation = tokio::spawn(async move {
            let rotation_ready_tx = Mutex::new(Some(rotation_ready_tx));
            let before_lock = || {
                let sender = rotation_ready_tx
                    .lock()
                    .expect("rotation ready lock")
                    .take()
                    .expect("rotation ready sent once");
                let _ = sender.send(());
            };
            rotate_master_key_full_inner_impl(
                &rotation_dir,
                &rotation_enc,
                &rotation_storage,
                &rotation_backup,
                &rotation_recording,
                Some(rotation_password),
                false,
                None,
                None,
                Some(&before_lock),
            )
            .await
        });
        rotation_ready_rx
            .await
            .expect("rotation reached coordinator");
        assert!(!rotation.is_finished());

        let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
        let writer_dir = fixture.app_data.clone();
        let writer_enc = fixture.enc_state.clone();
        let writer = tokio::spawn(async move {
            let _ = writer_started_tx.send(());
            crate::app_settings_commands::write_app_settings_inner(
                &writer_dir,
                &writer_enc,
                json!({ "language": "fr", "windowSize": 1080 }),
            )
            .await
        });
        writer_started_rx.await.expect("writer started");
        assert!(!writer.is_finished());

        drop(guard);
        let report = rotation.await.expect("rotation task").expect("rotation");
        assert!(report.failures.is_empty(), "{:?}", report.failures);
        writer.await.expect("writer task").expect("queued writer");

        assert!(fixture.settings_path.exists());
        assert!(!fixture.app_data.join("settings.json").exists());
        let restarted = restart_from_password_receipt(&fixture, password).await;
        assert_eq!(restarted["theme"], "dark");
        assert_eq!(restarted["fixture"], 71);
        assert_eq!(restarted["language"], "fr");
        assert_eq!(restarted["windowSize"], 1080);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn queued_write_then_rotation_includes_the_patch_in_its_snapshot() {
        let password = "write-then-rotation";
        let fixture = password_receipt_fixture(72, password).await;
        let guard = sorng_encryption::settings_coordinator::lock().await;

        let (writer_started_tx, writer_started_rx) = tokio::sync::oneshot::channel();
        let writer_dir = fixture.app_data.clone();
        let writer_enc = fixture.enc_state.clone();
        let writer = tokio::spawn(async move {
            let _ = writer_started_tx.send(());
            crate::app_settings_commands::write_app_settings_inner(
                &writer_dir,
                &writer_enc,
                json!({ "language": "pirate", "writeGeneration": 2 }),
            )
            .await
        });
        writer_started_rx.await.expect("writer started");
        assert!(!writer.is_finished());

        let (rotation_ready_tx, rotation_ready_rx) = tokio::sync::oneshot::channel();
        let rotation_dir = fixture.app_data.clone();
        let rotation_enc = fixture.enc_state.clone();
        let rotation_storage = fixture.storage_state.clone();
        let rotation_backup = fixture.backup_state.clone();
        let rotation_recording = fixture.recording_state.clone();
        let rotation_password = password.to_string();
        let rotation = tokio::spawn(async move {
            let rotation_ready_tx = Mutex::new(Some(rotation_ready_tx));
            let before_lock = || {
                let sender = rotation_ready_tx
                    .lock()
                    .expect("rotation ready lock")
                    .take()
                    .expect("rotation ready sent once");
                let _ = sender.send(());
            };
            rotate_master_key_full_inner_impl(
                &rotation_dir,
                &rotation_enc,
                &rotation_storage,
                &rotation_backup,
                &rotation_recording,
                Some(rotation_password),
                false,
                None,
                None,
                Some(&before_lock),
            )
            .await
        });
        rotation_ready_rx
            .await
            .expect("rotation reached coordinator");
        assert!(!rotation.is_finished());

        drop(guard);
        writer.await.expect("writer task").expect("queued writer");
        let report = rotation.await.expect("rotation task").expect("rotation");
        assert!(report.failures.is_empty(), "{:?}", report.failures);

        assert!(fixture.settings_path.exists());
        assert!(!fixture.app_data.join("settings.json").exists());
        let restarted = restart_from_password_receipt(&fixture, password).await;
        assert_eq!(restarted["theme"], "dark");
        assert_eq!(restarted["fixture"], 72);
        assert_eq!(restarted["language"], "pirate");
        assert_eq!(restarted["writeGeneration"], 2);
    }

    #[tokio::test]
    async fn durable_receipt_matrix_sets_truthful_metadata_and_restarts_readably() {
        let cases = [
            ("vault", true, None, MasterKeyStorage::Vault),
            (
                "password",
                false,
                Some("password-only"),
                MasterKeyStorage::Password,
            ),
            (
                "vault-and-password",
                true,
                Some("hybrid-password"),
                MasterKeyStorage::VaultAndPassword,
            ),
        ];

        for (index, (name, vault_present, password, expected_mode)) in cases.into_iter().enumerate()
        {
            let fixture = receipt_fixture(40 + index as u8).await;
            let captured_vault = std::sync::Mutex::new(None::<[u8; 32]>);
            let vault_writer = |bytes: &[u8; 32]| {
                *captured_vault.lock().expect("vault writer lock") = Some(*bytes);
                Ok(())
            };

            let report = rotate_master_key_full_inner_impl(
                &fixture.app_data,
                &fixture.enc_state,
                &fixture.storage_state,
                &fixture.backup_state,
                &fixture.recording_state,
                password.map(str::to_string),
                vault_present,
                None,
                Some(&vault_writer),
                None,
            )
            .await
            .unwrap_or_else(|error| panic!("{name} rotation failed: {error}"));

            assert!(report.failures.is_empty(), "{name}: {:?}", report.failures);
            assert!(report.settings_rewritten, "{name}");
            assert_eq!(report.vault_updated, vault_present, "{name}");
            assert_eq!(report.dek_enc_updated, password.is_some(), "{name}");

            let settings_after = std::fs::read(&fixture.settings_path).expect("rotated settings");
            let header = EnvelopeHeader::decode(&settings_after).expect("settings header");
            assert_eq!(header.master_key_storage, expected_mode, "{name}");

            let persisted_vault = *captured_vault.lock().expect("vault read lock");
            assert_eq!(persisted_vault.is_some(), vault_present, "{name}");
            let receipt_path = fixture.app_data.join(DEK_ENC_FILENAME);
            assert_eq!(receipt_path.exists(), password.is_some(), "{name}");

            let restarted_state = EncryptionState::new();
            let restart_dek = if let Some(password) = password {
                let blob = std::fs::read(&receipt_path).expect("password receipt");
                let dek = password_wrap::unwrap(password, &blob).expect("unwrap password receipt");
                if let Some(vault_bytes) = persisted_vault {
                    let password_state = EncryptionState::new();
                    password_state.install(dek).await;
                    let password_bytes = password_state
                        .master_bytes_raw()
                        .await
                        .expect("password DEK bytes");
                    assert_eq!(password_bytes, vault_bytes, "{name}");
                    MasterDek::from_bytes(&password_bytes).expect("restart DEK")
                } else {
                    dek
                }
            } else {
                MasterDek::from_bytes(&persisted_vault.expect("vault receipt"))
                    .expect("restart vault DEK")
            };
            restarted_state.install(restart_dek).await;
            let restarted_settings = artifact_settings::read(&restarted_state, &settings_after)
                .await
                .expect("settings decrypt after restart")
                .expect("settings payload");
            assert_eq!(restarted_settings, fixture.settings_payload, "{name}");
            assert_ne!(
                restarted_state.master_bytes_raw().await.expect("new DEK"),
                fixture.old_dek_bytes,
                "{name}: rotation must install a fresh key"
            );
        }
    }

    #[tokio::test]
    async fn rotation_rekeys_backup_archive_and_integrity_sidecar_together() {
        let fixture = receipt_fixture(73).await;
        let backup_payload = json!({
            "connections": [{ "id": "backup-c1", "host": "backup.example.test" }]
        });
        let (backup_id, backup_pair) = create_encrypted_backup(&fixture, &backup_payload).await;
        let metadata_before: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&backup_pair.metadata_path).expect("backup sidecar before rotation"),
        )
        .expect("parse backup sidecar before rotation");

        let captured_vault = std::sync::Mutex::new(None::<[u8; 32]>);
        let vault_writer = |bytes: &[u8; 32]| {
            *captured_vault.lock().expect("vault writer lock") = Some(*bytes);
            Ok(())
        };
        let report = rotate_master_key_full_inner_impl(
            &fixture.app_data,
            &fixture.enc_state,
            &fixture.storage_state,
            &fixture.backup_state,
            &fixture.recording_state,
            None,
            true,
            None,
            Some(&vault_writer),
            None,
        )
        .await
        .expect("rotate backup master key");

        assert!(report.failures.is_empty(), "{:?}", report.failures);
        assert_eq!(report.backups_rewritten, 1);
        let archive_after = std::fs::read(&backup_pair.archive_path).expect("rotated backup");
        let metadata_after: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&backup_pair.metadata_path).expect("rotated backup sidecar"),
        )
        .expect("parse rotated backup sidecar");
        assert_ne!(metadata_after["checksum"], metadata_before["checksum"]);
        assert_eq!(
            metadata_after["sizeBytes"].as_u64(),
            Some(archive_after.len() as u64)
        );

        let old_state = EncryptionState::new();
        old_state
            .install(MasterDek::from_bytes(&fixture.old_dek_bytes).expect("old backup DEK"))
            .await;
        assert!(
            sorng_encryption::artifacts::backups::read(&old_state, &archive_after)
                .await
                .is_err()
        );
        let restored = fixture
            .backup_state
            .lock()
            .await
            .restore_backup_from_target(&backup_id, "legacy-default")
            .await
            .expect("restore rotated backup with updated integrity sidecar");
        assert_eq!(restored, backup_payload);
        assert!(
            std::fs::read_dir(backup_pair.archive_path.parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    !name.contains(".sorng-rotation-") && !name.ends_with(".rollback")
                })
        );
    }

    #[test]
    fn discard_artifact_sidecars_removes_nested_rewrite_artifacts() {
        let temp = tempdir().expect("temporary rotation directory");
        let item = StagedArtifact {
            artifact: "backup",
            canonical: temp.path().join("backup.json"),
            staged: temp.path().join("backup.json.sorng-rotation-test.staged"),
            backup: temp.path().join("backup.json.sorng-rotation-test.backup"),
        };
        std::fs::write(&item.canonical, b"canonical").expect("write canonical fixture");
        let sidecars = [
            item.staged.clone(),
            item.backup.clone(),
            rotating_tmp_path(&item.staged),
            rotating_tmp_path(&item.backup),
            rollback_tmp_path(&item.staged),
            rollback_tmp_path(&item.backup),
        ];
        for path in &sidecars {
            std::fs::write(path, b"old-key ciphertext").expect("write sidecar fixture");
        }

        discard_artifact_sidecars(&item);

        assert!(
            item.canonical.exists(),
            "canonical artifact must be preserved"
        );
        assert!(sidecars.iter().all(|path| !path.exists()));
    }

    #[tokio::test]
    async fn missing_backup_sidecar_aborts_rotation_and_removes_paired_stage() {
        let fixture = receipt_fixture(74).await;
        let (_, backup_pair) = create_encrypted_backup(
            &fixture,
            &json!({ "connections": [{ "id": "missing-sidecar" }] }),
        )
        .await;
        let archive_before =
            std::fs::read(&backup_pair.archive_path).expect("backup before failed rotation");
        std::fs::remove_file(&backup_pair.metadata_path).expect("remove backup sidecar");
        let vault_writer = |_: &[u8; 32]| Ok(());

        let report = rotate_master_key_full_inner_impl(
            &fixture.app_data,
            &fixture.enc_state,
            &fixture.storage_state,
            &fixture.backup_state,
            &fixture.recording_state,
            None,
            true,
            None,
            Some(&vault_writer),
            None,
        )
        .await
        .expect("missing sidecar returns a retryable report");

        assert_eq!(report.backups_rewritten, 0);
        assert_eq!(report.failures.len(), 1, "{:?}", report.failures);
        assert_eq!(report.failures[0].artifact, "backup");
        assert_eq!(
            std::fs::read(&backup_pair.archive_path).unwrap(),
            archive_before
        );
        assert!(
            std::fs::read_dir(backup_pair.archive_path.parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    !name.contains(".sorng-rotation-") && !name.ends_with(".rollback")
                })
        );
    }

    #[tokio::test]
    async fn rotation_without_any_durable_receipt_fails_before_rewriting() {
        let fixture = receipt_fixture(61).await;
        let settings_before = std::fs::read(&fixture.settings_path).expect("settings before");

        let error = rotate_master_key_full_inner_impl(
            &fixture.app_data,
            &fixture.enc_state,
            &fixture.storage_state,
            &fixture.backup_state,
            &fixture.recording_state,
            None,
            false,
            None,
            None,
            None,
        )
        .await
        .expect_err("rotation without a durable receipt must fail closed");

        assert!(error.contains("at least one durable key receipt"));
        assert_eq!(
            std::fs::read(&fixture.settings_path).unwrap(),
            settings_before
        );
        assert_eq!(
            fixture
                .enc_state
                .master_bytes_raw()
                .await
                .expect("live old DEK"),
            fixture.old_dek_bytes
        );
        assert!(!fixture.app_data.join(DEK_ENC_FILENAME).exists());
        assert!(std::fs::read_dir(&fixture.app_data)
            .expect("list app data")
            .filter_map(Result::ok)
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .contains(".sorng-rotation-")));
    }

    #[tokio::test]
    async fn partial_rewrite_failure_keeps_old_key_receipt_and_artifacts_restart_readable() {
        let tmp = tempdir().expect("temp app data");
        let app_data = tmp.path();
        let backup_dir = app_data.join("backups");
        std::fs::create_dir_all(&backup_dir).expect("backup dir");

        let old_dek_bytes = [23u8; 32];
        let enc_state = Arc::new(EncryptionState::new());
        enc_state
            .install(MasterDek::from_bytes(&old_dek_bytes).expect("old DEK"))
            .await;

        let password = "rotation-recovery-test";
        let old_receipt = password_wrap::wrap(
            password,
            &MasterDek::from_bytes(&old_dek_bytes).expect("receipt DEK"),
            Argon2Params::OWASP,
        )
        .expect("wrap old receipt");
        let receipt_path = app_data.join(DEK_ENC_FILENAME);
        std::fs::write(&receipt_path, &old_receipt).expect("write old receipt");

        let settings_path = app_data.join(SETTINGS_ENC_FILENAME);
        let settings_payload = json!({ "theme": "dark", "language": "en" });
        let settings_blob = artifact_settings::write(
            &enc_state,
            &settings_payload,
            MasterKeyStorage::Password,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .expect("encode settings");
        std::fs::write(&settings_path, &settings_blob).expect("write settings");

        let connections_path = app_data.join("storage.json");
        let storage_state = SecureStorage::new(connections_path.to_string_lossy().to_string());
        storage_state
            .lock()
            .await
            .set_encryption_state(enc_state.clone());
        let storage_payload = StorageData {
            connections: vec![json!({ "id": "c1", "host": "example.test", "port": 22 })],
            settings: std::collections::HashMap::new(),
            timestamp: 1_700_000_000,
            app_data: std::collections::HashMap::new(),
        };
        storage_state
            .lock()
            .await
            .save_data(storage_payload, false)
            .await
            .expect("encode connections");

        let backup_state = BackupService::new(backup_dir.to_string_lossy().to_string());
        let recording_service = RecordingService::new(&app_data.to_string_lossy());
        recording_service
            .set_encryption_state(enc_state.clone())
            .await;
        let recording_state = Arc::new(tokio::sync::Mutex::new(recording_service));

        let settings_before = std::fs::read(&settings_path).expect("settings before");
        let connections_before = std::fs::read(&connections_path).expect("connections before");
        let receipt_before = std::fs::read(&receipt_path).expect("receipt before");

        let fail_connections = |artifact: &str, _path: &Path| {
            (artifact == "connections").then(|| "injected connections rewrite failure".to_string())
        };
        let report = rotate_master_key_full_inner_impl(
            app_data,
            &enc_state,
            &storage_state,
            &backup_state,
            &recording_state,
            Some(password.to_string()),
            false,
            Some(&fail_connections),
            None,
            None,
        )
        .await
        .expect("partial failure must return a retryable report");

        assert_eq!(
            report.failures.len(),
            1,
            "unexpected failures: {:?}",
            report.failures
        );
        assert_eq!(report.failures[0].artifact, "connections");
        assert!(report.failures[0]
            .reason
            .contains("injected connections rewrite failure"));
        assert!(!report.settings_rewritten);
        assert!(!report.connections_rewritten);
        assert_eq!(report.bytes_rewritten, 0);
        assert!(!report.vault_updated);
        assert!(!report.dek_enc_updated);

        assert_eq!(
            enc_state.master_bytes_raw().await.expect("live DEK"),
            old_dek_bytes,
            "the failed transaction must leave DEK A live"
        );
        assert_eq!(std::fs::read(&settings_path).unwrap(), settings_before);
        assert_eq!(
            std::fs::read(&connections_path).unwrap(),
            connections_before
        );
        assert_eq!(std::fs::read(&receipt_path).unwrap(), receipt_before);

        // Simulate restart: rebuild state exclusively from the on-disk
        // password receipt and verify both canonical artifacts remain
        // readable. No in-memory snapshot from the failed attempt is used.
        let restarted_state = EncryptionState::new();
        restarted_state
            .install(password_wrap::unwrap(password, &receipt_before).expect("unwrap old receipt"))
            .await;
        let restarted_settings = artifact_settings::read(&restarted_state, &settings_before)
            .await
            .expect("settings decrypt after restart")
            .expect("settings payload");
        assert_eq!(restarted_settings, settings_payload);
        let restarted_connections =
            artifact_connections::read(&restarted_state, &connections_before)
                .await
                .expect("connections decrypt after restart")
                .expect("connections payload");
        assert_eq!(restarted_connections["connections"][0]["id"], "c1");

        let leaked_sidecars: Vec<_> = std::fs::read_dir(app_data)
            .expect("list app data")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".sorng-rotation-")
            })
            .map(|entry| entry.path())
            .collect();
        assert!(
            leaked_sidecars.is_empty(),
            "failed transaction leaked sidecars: {leaked_sidecars:?}"
        );
    }
}
