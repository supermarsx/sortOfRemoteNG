//! Preview-bound native artifact management. No renderer-supplied file paths.
//! Bulk transitions commit one family at a time and report every outcome.

use crate::artifact_storage_adapters::{self as adapters, ArtifactRoots, ArtifactScan};
use rand::RngCore;
use serde::Serialize;
use sorng_encryption::{
    artifact_policy::{self, ArtifactStatus, DiskState, ProtectionMode, DATA_ARTIFACTS},
    artifact_transaction::{self, ArtifactTransaction},
    ArtifactKind, EncryptionState,
};
use sorng_recording::service::RecordingServiceState;
use sorng_storage::{backup::BackupServiceState, storage::SecureStorageState};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

const CANCELLED: &str = "artifact transition cancelled before commit";
const PREVIEW_TTL: Duration = Duration::from_secs(300);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManagementStatus {
    artifacts: Vec<ArtifactStatus>,
    unlocked: bool,
    recovery_required: bool,
    busy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    policy_error: Option<String>,
    warnings: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPreview {
    token: String,
    target: ProtectionMode,
    artifacts: Vec<ArtifactStatus>,
    total_files: u64,
    total_bytes: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactResult {
    id: ArtifactKind,
    outcome: String,
    files: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactApplyReport {
    request_id: String,
    outcome: String,
    results: Vec<ArtifactResult>,
    recovery_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactProgress {
    request_id: String,
    phase: String,
    completed: usize,
    total: usize,
}

struct PreparedPreview {
    public: ArtifactPreview,
    selected: Vec<ArtifactKind>,
    fingerprint: String,
    policy: Vec<u8>,
    generation: u64,
    created: Instant,
}
struct Active {
    request_id: String,
    cancel: Arc<AtomicBool>,
}
#[derive(Default)]
struct Controller {
    preview: Option<PreparedPreview>,
    active: Option<Active>,
}
static CONTROLLER: OnceLock<Mutex<Controller>> = OnceLock::new();
fn controller() -> &'static Mutex<Controller> {
    CONTROLLER.get_or_init(Mutex::default)
}
struct ActiveGuard {
    preview_token: String,
}
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        sorng_encryption::log_adapter::release_artifact_preview(&self.preview_token);
        if let Ok(mut state) = controller().lock() {
            state.active = None;
        }
    }
}
struct PreviewPause {
    token: String,
    retained: bool,
}
impl Drop for PreviewPause {
    fn drop(&mut self) {
        if !self.retained {
            sorng_encryption::log_adapter::release_artifact_preview(&self.token);
        }
    }
}

fn validate_identifier(value: &str) -> Result<(), String> {
    if !(1..=80).contains(&value.len())
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err("invalid artifact operation identifier".into());
    }
    Ok(())
}
fn validate_selection(ids: &[ArtifactKind]) -> Result<(), String> {
    if ids.is_empty() || ids.len() > DATA_ARTIFACTS.len() {
        return Err("select at least one supported data artifact".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    if ids
        .iter()
        .any(|id| !DATA_ARTIFACTS.contains(id) || !seen.insert(*id))
    {
        return Err("unknown, duplicate, or protected artifact selection".into());
    }
    Ok(())
}
fn require_available(state: &EncryptionState) -> Result<(), String> {
    if state.artifact_recovery_required() {
        return Err("recover the interrupted artifact transition before making changes".into());
    }
    state.artifact_policy_document().map(|_| ())
}

async fn roots<R: Runtime>(
    app: &AppHandle<R>,
    state: &EncryptionState,
    storage: &SecureStorageState,
    backup: &BackupServiceState,
    recording: &RecordingServiceState,
) -> Result<ArtifactRoots, String> {
    let app_data = match state.artifact_policy_root() {
        Some(root) => root,
        None => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    let legacy_storage = PathBuf::from(storage.lock().await.store_path());
    let recordings = recording.lock().await.storage_root_snapshot().await;
    let (backups, backup_restrictions) = backup.lock().await.artifact_backup_roots();
    Ok(ArtifactRoots {
        logs: app_data.join("logs"),
        app_data,
        legacy_storage,
        recordings,
        backups,
        backup_restrictions,
    })
}

async fn scan_background(
    context: &ArtifactRoots,
    state: &EncryptionState,
    selected: Option<&[ArtifactKind]>,
) -> Result<ArtifactScan, String> {
    let context = context.clone();
    let state = state.clone();
    let selected = selected.map(<[ArtifactKind]>::to_vec);
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        runtime.block_on(async {
            match selected {
                Some(selected) => adapters::scan_selected(&context, &state, &selected).await,
                None => adapters::scan(&context, &state).await,
            }
        })
    })
    .await
    .map_err(|e| format!("artifact scan task failed: {e}"))?
}

#[tauri::command]
pub async fn encryption_get_artifact_status<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, EncryptionState>,
    storage_state: State<'_, SecureStorageState>,
    backup_state: State<'_, BackupServiceState>,
    recording_state: State<'_, RecordingServiceState>,
) -> Result<ArtifactManagementStatus, String> {
    let (context, snapshot, generation, policy) = {
        let _guard = sorng_encryption::settings_coordinator::lock().await;
        let context = roots(
            &app,
            &state,
            &storage_state,
            &backup_state,
            &recording_state,
        )
        .await?;
        artifact_policy::refresh(&state).await;
        let snapshot = state
            .snapshot()
            .await
            .unwrap_or_else(|| state.inner().clone());
        (
            context,
            snapshot,
            state.key_generation(),
            state.artifact_policy_document().ok(),
        )
    };
    let mut scan = scan_background(&context, &snapshot, None).await?;
    let mut warnings = context.backup_restrictions.clone();
    if state.key_generation() != generation || state.artifact_policy_document().ok() != policy {
        warnings.push(
            "Master key or artifact policy changed during inspection; refresh the artifact status"
                .into(),
        );
        for row in &mut scan.rows {
            row.disk_state = DiskState::Unverified;
            row.mutable = false;
            row.reason = Some("Master key or artifact policy changed during inspection".into());
        }
    }
    let busy = controller()
        .lock()
        .map_err(|_| "artifact controller unavailable")?
        .active
        .is_some();
    Ok(ArtifactManagementStatus {
        artifacts: scan.rows,
        unlocked: state.is_unlocked().await,
        recovery_required: state.artifact_recovery_required(),
        busy,
        policy_error: state.artifact_policy_error(),
        warnings,
    })
}

#[tauri::command]
pub async fn encryption_preview_artifact_policy<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, EncryptionState>,
    storage_state: State<'_, SecureStorageState>,
    backup_state: State<'_, BackupServiceState>,
    recording_state: State<'_, RecordingServiceState>,
    artifacts: Vec<ArtifactKind>,
    target: ProtectionMode,
) -> Result<ArtifactPreview, String> {
    validate_selection(&artifacts)?;
    if controller()
        .lock()
        .map_err(|_| "artifact controller unavailable")?
        .active
        .is_some()
    {
        return Err("an artifact operation is already running".into());
    }
    let mut random = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let mut pause = PreviewPause {
        token: token.clone(),
        retained: false,
    };
    if artifacts.contains(&ArtifactKind::Logs) {
        sorng_encryption::log_adapter::pause_for_artifact_preview(&token, PREVIEW_TTL);
    }
    let (context, snapshot, policy, generation) = {
        let _guard = sorng_encryption::settings_coordinator::lock().await;
        if !state.is_unlocked().await {
            return Err("unlock the master key before artifact management".into());
        }
        let context = roots(
            &app,
            &state,
            &storage_state,
            &backup_state,
            &recording_state,
        )
        .await?;
        artifact_policy::refresh(&state).await;
        require_available(&state)?;
        let policy =
            serde_json::to_vec(&state.artifact_policy_document()?).map_err(|e| e.to_string())?;
        (
            context,
            state.snapshot().await.ok_or("master key became locked")?,
            policy,
            state.key_generation(),
        )
    };
    let scan = scan_background(&context, &snapshot, Some(&artifacts)).await?;
    let rows = selected_rows(&scan, &artifacts)?;
    let total_files = rows
        .iter()
        .map(|r| r.encrypted_files + r.plaintext_files)
        .sum();
    let total_bytes = rows.iter().map(|r| r.bytes).sum();
    let public = ArtifactPreview {
        token,
        target,
        artifacts: rows,
        total_files,
        total_bytes,
    };
    let fingerprint = scan.fingerprint_for(&artifacts);
    let mut control = controller()
        .lock()
        .map_err(|_| "artifact controller unavailable")?;
    if let Some(previous) = control.preview.take() {
        sorng_encryption::log_adapter::release_artifact_preview(&previous.public.token);
    }
    control.preview = Some(PreparedPreview {
        public: public.clone(),
        selected: artifacts,
        fingerprint,
        policy,
        generation,
        created: Instant::now(),
    });
    pause.retained = true;
    Ok(public)
}

fn selected_rows(scan: &ArtifactScan, ids: &[ArtifactKind]) -> Result<Vec<ArtifactStatus>, String> {
    ids.iter()
        .map(|id| {
            let row = scan
                .rows
                .iter()
                .find(|r| r.id == *id)
                .ok_or("artifact scan omitted selected family")?;
            if !row.mutable || row.disk_state == DiskState::Unverified || row.unverified_files != 0
            {
                return Err(format!(
                    "{:?}: {}",
                    id,
                    row.reason
                        .as_deref()
                        .unwrap_or("selected files could not be verified")
                ));
            }
            Ok(row.clone())
        })
        .collect()
}

fn progress<R: Runtime>(app: &AppHandle<R>, id: &str, phase: &str, completed: usize, total: usize) {
    let _ = app.emit(
        "encryption:artifact-progress",
        ArtifactProgress {
            request_id: id.into(),
            phase: phase.into(),
            completed,
            total,
        },
    );
}

#[tauri::command]
// Tauri extracts the five native states separately from the three IPC fields.
#[allow(clippy::too_many_arguments)]
pub async fn encryption_apply_artifact_policy<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, EncryptionState>,
    storage_state: State<'_, SecureStorageState>,
    backup_state: State<'_, BackupServiceState>,
    recording_state: State<'_, RecordingServiceState>,
    token: String,
    confirm_plaintext: bool,
    request_id: String,
) -> Result<ArtifactApplyReport, String> {
    validate_identifier(&token)?;
    validate_identifier(&request_id)?;
    let (preview, cancel) = {
        let mut control = controller()
            .lock()
            .map_err(|_| "artifact controller unavailable")?;
        if control.active.is_some() {
            return Err("an artifact operation is already running".into());
        }
        let candidate = control
            .preview
            .as_ref()
            .ok_or("preview expired; inspect the selection again")?;
        if candidate.public.token != token || candidate.created.elapsed() > PREVIEW_TTL {
            return Err("preview expired or invalid; inspect the selection again".into());
        }
        if candidate.public.target == ProtectionMode::Plaintext && !confirm_plaintext {
            return Err("explicit plaintext confirmation is required".into());
        }
        let preview = control.preview.take().ok_or("preview unavailable")?;
        let cancel = Arc::new(AtomicBool::new(false));
        control.active = Some(Active {
            request_id: request_id.clone(),
            cancel: cancel.clone(),
        });
        (preview, cancel)
    };
    let _active = ActiveGuard {
        preview_token: preview.public.token.clone(),
    };
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    if !state.is_unlocked().await {
        return Err("unlock before applying artifact protection".into());
    }
    let context = roots(
        &app,
        &state,
        &storage_state,
        &backup_state,
        &recording_state,
    )
    .await?;
    if preview.selected.iter().any(|id| {
        matches!(
            id,
            ArtifactKind::RecordingsMeta | ArtifactKind::RecordingsMedia | ArtifactKind::Macros
        )
    }) && recording_state.lock().await.active_count().await > 0
    {
        return Err("stop active recordings before changing recording or macro protection".into());
    }
    artifact_policy::refresh(&state).await;
    require_available(&state)?;
    progress(&app, &request_id, "scan", 0, preview.selected.len());
    let scan = scan_background(&context, &state, Some(&preview.selected)).await?;
    selected_rows(&scan, &preview.selected)?;
    let policy =
        serde_json::to_vec(&state.artifact_policy_document()?).map_err(|e| e.to_string())?;
    if scan.fingerprint_for(&preview.selected) != preview.fingerprint
        || policy != preview.policy
        || state.key_generation() != preview.generation
    {
        return Err(
            "artifacts or protection policy changed since preview; inspect and confirm again"
                .into(),
        );
    }
    let mut report = ArtifactApplyReport {
        request_id: request_id.clone(),
        outcome: "completed".into(),
        results: Vec::new(),
        recovery_required: false,
        error: None,
    };
    for id in &preview.selected {
        if cancel.load(Ordering::Acquire) {
            report.outcome = "cancelled".into();
            break;
        }
        let result = {
            let app = app.clone();
            let request_id = request_id.clone();
            let context = context.clone();
            let scan = scan.clone();
            let state = state.inner().clone();
            let cancel = cancel.clone();
            let id = *id;
            let mode = preview.public.target;
            let runtime = tokio::runtime::Handle::current();
            tokio::task::spawn_blocking(move || {
                runtime.block_on(apply_family(
                    &app,
                    &request_id,
                    &context,
                    &scan,
                    id,
                    mode,
                    &state,
                    &cancel,
                ))
            })
            .await
            .map_err(|e| (format!("artifact task failed: {e}"), false, 0))
            .and_then(|r| r)
        };
        match result {
            Ok(files) => report.results.push(ArtifactResult {
                id: *id,
                outcome: "committed".into(),
                files,
                error: None,
            }),
            Err((error, committed, files)) => {
                report.results.push(ArtifactResult {
                    id: *id,
                    outcome: if committed { "committed" } else { "failed" }.into(),
                    files,
                    error: Some(error.clone()),
                });
                report.outcome = if error == CANCELLED {
                    "cancelled"
                } else {
                    "failed"
                }
                .into();
                report.error = Some(error);
                break;
            }
        }
    }
    for id in &preview.selected {
        if !report.results.iter().any(|row| row.id == *id) {
            report.results.push(ArtifactResult {
                id: *id,
                outcome: "not-attempted".into(),
                files: 0,
                error: None,
            });
        }
    }
    // Also covers a worker panic or a failed very first journal installation.
    artifact_policy::refresh(&state).await;
    report.recovery_required = state.artifact_recovery_required();
    progress(
        &app,
        &request_id,
        "complete",
        report
            .results
            .iter()
            .filter(|r| r.outcome == "committed")
            .count(),
        preview.selected.len(),
    );
    Ok(report)
}

#[allow(clippy::too_many_arguments)]
async fn apply_family<R: Runtime>(
    app: &AppHandle<R>,
    request_id: &str,
    context: &ArtifactRoots,
    scan: &ArtifactScan,
    id: ArtifactKind,
    target: ProtectionMode,
    state: &EncryptionState,
    cancel: &AtomicBool,
) -> Result<usize, (String, bool, usize)> {
    state.set_artifact_recovery_required(true);
    let mut tx = match ArtifactTransaction::begin(&context.app_data, &scan.roots, state).await {
        Ok(tx) => tx,
        Err(error) => {
            artifact_policy::refresh(state).await;
            return Err((error, false, 0));
        }
    };
    let prepare = async {
        let notify = |done, total| {
            progress(app, request_id, "stage", done, total);
            if cancel.load(Ordering::Acquire) {
                Err(CANCELLED.into())
            } else {
                Ok(())
            }
        };
        let files = adapters::prepare_artifact(scan, id, target, state, &mut tx, &notify).await?;
        let document = state.artifact_policy_document()?.with_mode(id, target)?;
        let policy_path = tx.replace(&context.app_data.join(artifact_policy::POLICY_FILENAME))?;
        artifact_transaction::durable_write(
            &policy_path,
            &artifact_policy::encode(state, &document).await?,
        )?;
        let marker_path = tx.replace(&context.app_data.join(artifact_policy::POLICY_MARKER))?;
        artifact_transaction::durable_write(&marker_path, b"1")?;
        if cancel.load(Ordering::Acquire) {
            return Err(CANCELLED.into());
        }
        Ok::<usize, String>(files)
    }
    .await;
    let prepared_files = prepare.as_ref().copied().unwrap_or(0);
    let outcome = match prepare {
        Ok(files) => {
            progress(app, request_id, "commit", 0, 1);
            tx.commit().map(|_| files)
        }
        Err(error) => Err(error),
    };
    match outcome {
        Ok(files) => {
            artifact_policy::refresh(state).await;
            Ok(files)
        }
        Err(mut error) => {
            let committed = tx.is_committed();
            progress(
                app,
                request_id,
                if committed { "commit" } else { "rollback" },
                0,
                1,
            );
            if let Err(recovery) = tx.recover() {
                error.push_str(&format!("; recovery required: {recovery}"));
            }
            artifact_policy::refresh(state).await;
            Err((error, committed, if committed { prepared_files } else { 0 }))
        }
    }
}

#[tauri::command]
pub fn encryption_cancel_artifact_policy(request_id: String) -> Result<(), String> {
    validate_identifier(&request_id)?;
    let control = controller()
        .lock()
        .map_err(|_| "artifact controller unavailable")?;
    if let Some(active) = &control.active {
        if active.request_id != request_id {
            return Err("artifact operation identifier does not match".into());
        }
        active.cancel.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub fn encryption_release_artifact_preview(token: String) -> Result<(), String> {
    validate_identifier(&token)?;
    let mut control = controller()
        .lock()
        .map_err(|_| "artifact controller unavailable")?;
    if control
        .preview
        .as_ref()
        .is_some_and(|p| p.public.token == token)
    {
        control.preview = None;
    }
    sorng_encryption::log_adapter::release_artifact_preview(&token);
    Ok(())
}

#[tauri::command]
pub async fn encryption_recover_artifact_transition<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, EncryptionState>,
    storage_state: State<'_, SecureStorageState>,
    backup_state: State<'_, BackupServiceState>,
    recording_state: State<'_, RecordingServiceState>,
) -> Result<(), String> {
    if controller()
        .lock()
        .map_err(|_| "artifact controller unavailable")?
        .active
        .is_some()
    {
        return Err("wait for the active artifact operation".into());
    }
    let _guard = sorng_encryption::settings_coordinator::lock().await;
    let context = roots(
        &app,
        &state,
        &storage_state,
        &backup_state,
        &recording_state,
    )
    .await?;
    let mut allowed = context.backups.clone();
    allowed.extend([
        context.app_data.clone(),
        context.recordings.clone(),
        context.logs.clone(),
    ]);
    if let Some(parent) = context.legacy_storage.parent() {
        allowed.push(parent.to_path_buf());
    }
    let outcome = if artifact_transaction::has_pending(&context.app_data)? {
        let state = state.inner().clone();
        let runtime = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            runtime.block_on(ArtifactTransaction::recover_pending(
                &context.app_data,
                &allowed,
                &state,
            ))
        })
        .await
        .map_err(|e| format!("artifact recovery task failed: {e}"))?
    } else {
        Ok(())
    };
    artifact_policy::refresh(&state).await;
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_and_operation_ids_reject_protected_unknown_duplicates_and_paths() {
        assert!(validate_selection(DATA_ARTIFACTS).is_ok());
        for ids in [
            vec![],
            vec![ArtifactKind::KeyRing],
            vec![ArtifactKind::ArtifactPolicy],
            vec![ArtifactKind::Settings, ArtifactKind::Settings],
        ] {
            assert!(validate_selection(&ids).is_err());
        }
        for id in ["", "../escape", "with space", &"a".repeat(81)] {
            assert!(validate_identifier(id).is_err());
        }
        assert!(validate_identifier("request-fixture_1").is_ok());
        assert!(serde_json::from_str::<ArtifactKind>("\"unknown\"").is_err());
    }
}
