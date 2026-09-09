//! Verified same-profile master-key recovery. A portable blob authenticates its
//! password, not membership in this profile. Current canonical evidence must
//! authenticate before a native delayed, one-shot receipt replacement is armed.
use crate::{ArtifactKind, EncryptionState, MasterDek};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;
use zeroize::Zeroizing;

const DELAY: Duration = Duration::from_secs(10);
const LIFETIME: Duration = Duration::from_secs(120);
const MAX_EVIDENCE: u64 = 64 * 1024 * 1024;
const MAX_OLD_WRAPPER: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyHealth {
    pub proven: bool,
    pub critical_failure: bool,
    pub verified: Vec<String>,
    pub issues: Vec<String>,
    #[serde(skip)]
    fingerprint: String,
}

fn read_optional(root: &Path, path: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    // A not-yet-created managed directory is absent, not corrupt. Validate the
    // existing ancestor chain before accepting absence (including broken links).
    if matches!(std::fs::symlink_metadata(path), Err(ref error) if error.kind() == std::io::ErrorKind::NotFound)
    {
        for ancestor in path.ancestors().skip(1) {
            match std::fs::symlink_metadata(ancestor) {
                Ok(_) => {
                    crate::artifact_transaction::validate_regular_path(ancestor, ancestor, false)?;
                    return Ok(None);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("file ancestry could not be verified".into()),
            }
        }
        return Err("file ancestry is unavailable".into());
    }
    crate::artifact_transaction::validate_regular_path(root, path, true)?;
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("file presence could not be verified".into()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit {
        return Err("not a bounded regular file".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .map_err(|_| "file could not be opened")?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "file could not be read")?;
    if bytes.len() as u64 > limit {
        return Err("file exceeded its size limit while reading".into());
    }
    Ok(Some(bytes))
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn payload(bytes: &[u8]) -> Result<&[u8], &'static str> {
    if !bytes.starts_with(b"SDBF") {
        return Ok(bytes);
    }
    if bytes.len() < 32 || bytes[4] != 1 {
        return Err("invalid database storage preamble");
    }
    let length = u64::from_le_bytes(bytes[14..22].try_into().unwrap());
    if length != (bytes.len() - 32) as u64 {
        return Err("database storage length mismatch");
    }
    Ok(&bytes[32..])
}

/// Current evidence only: never .bak, .v0.bak, imported files or retained-key
/// fallbacks. A primary receipt conflict cannot be overruled by an older file.
pub fn inspect_candidate(root: &Path, candidate: &MasterDek) -> KeyHealth {
    let mut result = KeyHealth {
        proven: false,
        critical_failure: false,
        verified: vec![],
        issues: vec![],
        fingerprint: String::new(),
    };
    let mut fingerprint = Sha256::new();
    let mut primary_present = false;
    let mut primary_failure = false;
    let mut secondary_failure = false;
    for (relative, kind, primary, limit) in [
        (
            crate::artifact_policy::POLICY_FILENAME,
            ArtifactKind::ArtifactPolicy,
            true,
            crate::artifact_policy::MAX_POLICY_BYTES,
        ),
        (
            crate::key_ring::KEY_RING_FILENAME,
            ArtifactKind::KeyRing,
            true,
            MAX_EVIDENCE,
        ),
        ("settings.enc", ArtifactKind::Settings, false, MAX_EVIDENCE),
        (
            "databases/index.json",
            ArtifactKind::DatabasesIndex,
            false,
            MAX_EVIDENCE,
        ),
    ] {
        fingerprint.update(relative.as_bytes());
        let outcome = read_optional(root, &root.join(relative), limit);
        match outcome {
            Ok(None) => {
                fingerprint.update(b"absent");
                continue;
            }
            Ok(Some(bytes)) => {
                fingerprint.update(Sha256::digest(&bytes));
                if primary {
                    primary_present = true;
                }
                let authenticated = payload(&bytes).and_then(|data| {
                    // A plaintext index is legitimate, but provides no key proof.
                    if !primary
                        && relative.ends_with(".json")
                        && !data.starts_with(crate::envelope::MAGIC)
                    {
                        let index: serde_json::Value = serde_json::from_slice(data)
                            .map_err(|_| "unrecognized plaintext database index")?;
                        return if index.is_array() {
                            Ok(false)
                        } else {
                            Err("unrecognized plaintext database index")
                        };
                    }
                    let (_, plain) = crate::envelope::read_envelope(&candidate.sub_key(kind), data)
                        .map_err(|_| "authentication failed or encrypted data is damaged")?;
                    let plain = Zeroizing::new(plain);
                    if kind == ArtifactKind::ArtifactPolicy {
                        let policy: crate::artifact_policy::PolicyDocument =
                            serde_json::from_slice(&plain)
                                .map_err(|_| "authenticated policy is malformed")?;
                        policy
                            .validate()
                            .map_err(|_| "authenticated policy is unsupported")?;
                    }
                    Ok(true)
                });
                match authenticated {
                    Ok(true) => result.verified.push(relative.into()),
                    Ok(false) => {}
                    Err(error) => {
                        result.issues.push(format!("{relative}: {error}"));
                        if primary {
                            primary_failure = true;
                        } else {
                            secondary_failure = true;
                        }
                    }
                }
            }
            Err(error) => {
                fingerprint.update(error.as_bytes());
                result.issues.push(format!("{relative}: {error}"));
                if primary {
                    primary_present = true;
                    primary_failure = true;
                } else {
                    secondary_failure = true;
                }
            }
        }
    }
    result.proven =
        !result.verified.is_empty() && !primary_failure && (primary_present || !secondary_failure);
    result.critical_failure = primary_failure || (!primary_present && secondary_failure);
    result.fingerprint = format!("{:x}", fingerprint.finalize());
    result
}

/// Normal unlock may use a trusted receipt before any artifact has been saved,
/// but it must not install a key that contradicts recognized current evidence.
pub fn validate_unlock_candidate(root: &Path, candidate: &MasterDek) -> Result<KeyHealth, String> {
    let health = inspect_candidate(root, candidate);
    if health.critical_failure {
        return Err(format!("Critical master-key validation failure. Preserve existing files and use verified recovery. {}", health.issues.join("; ")));
    }
    Ok(health)
}

static HEALTH: OnceLock<Mutex<std::collections::HashMap<u64, (u64, KeyHealth)>>> = OnceLock::new();
/// Non-authoritative status cache. Only fresh proof checks authorize recovery;
/// this snapshot reports the last key-load/explicit inspection, not all files.
pub fn cache_health(state: &EncryptionState, health: KeyHealth) {
    if let Ok(mut cache) = HEALTH
        .get_or_init(|| Mutex::new(std::collections::HashMap::new()))
        .lock()
    {
        cache.insert(
            state.database_session_owner(),
            (state.key_generation(), health),
        );
    }
}
pub fn cached_health(state: &EncryptionState) -> Option<KeyHealth> {
    let cache = HEALTH
        .get_or_init(|| Mutex::new(std::collections::HashMap::new()))
        .lock()
        .ok()?;
    let (generation, health) = cache.get(&state.database_session_owner())?;
    (*generation == state.key_generation()).then(|| health.clone())
}

pub fn record_load_failure(state: &EncryptionState, message: &str) {
    cache_health(
        state,
        KeyHealth {
            proven: false,
            critical_failure: true,
            verified: vec![],
            issues: vec![message.into()],
            fingerprint: String::new(),
        },
    );
}

/// Caller holds the storage coordinator. A detected mismatch must revoke native
/// credentials as well as block the renderer; never retain a known-invalid key.
pub async fn accept_inspected_health(
    state: &EncryptionState,
    generation: u64,
    health: KeyHealth,
) -> Result<KeyHealth, String> {
    if generation != state.key_generation() {
        return Err("Key state changed during inspection".into());
    }
    if health.critical_failure {
        state.lock().await;
    }
    cache_health(state, health.clone());
    Ok(health)
}

fn wrapper_snapshot(root: &Path) -> Result<Option<Vec<u8>>, String> {
    read_optional(root, &root.join("dek.enc"), MAX_OLD_WRAPPER)
}

fn control_fingerprint(root: &Path, candidate: &MasterDek) -> Result<(String, bool), String> {
    let mut hash = Sha256::new();
    let mut found = false;
    for relative in [
        "artifact-transition.enc",
        "artifact-transition.enc.pending",
        "databases/.database-security-transaction",
        "databases/.database-security-committed",
    ] {
        hash.update(relative.as_bytes());
        if let Some(bytes) = read_optional(root, &root.join(relative), MAX_EVIDENCE)? {
            found = true;
            hash.update(Sha256::digest(&bytes));
            if relative.starts_with("artifact-transition") {
                let (_, plain) = crate::envelope::read_envelope(
                    &candidate.sub_key(ArtifactKind::ArtifactPolicy),
                    &bytes,
                )
                .map_err(|_| {
                    "Pending artifact journal does not authenticate with the recovery key"
                })?;
                let _plain = Zeroizing::new(plain);
            }
        } else {
            hash.update(b"absent");
        }
    }
    // Full master rotation can contain generations under different masters;
    // this same-key receipt flow must not guess which generation won.
    for directory in [root.to_path_buf(), root.join("databases")] {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("Could not inspect key-transition markers".into()),
        };
        for (index, entry) in entries.enumerate() {
            if index >= 16_384 {
                return Err("Key-transition inspection limit reached".into());
            }
            let entry = entry.map_err(|_| "Could not inspect key-transition marker")?;
            if entry
                .file_name()
                .to_string_lossy()
                .contains(".sorng-rotation-")
            {
                return Err("An unfinished master rotation requires recovery of its exact generations; same-key restore cannot replace those receipts".into());
            }
        }
    }
    Ok((format!("{:x}", hash.finalize()), found))
}

struct Pending {
    token: String,
    owner: u64,
    window: String,
    root: PathBuf,
    generation: u64,
    source: PathBuf,
    source_hash: String,
    old_wrapper: Option<Vec<u8>>,
    proof_hash: String,
    control_hash: String,
    candidate: MasterDek,
    replacement: Vec<u8>,
    ready_at: Instant,
    expires_at: Instant,
}
static PENDING: OnceLock<Mutex<Option<Pending>>> = OnceLock::new();
static PREPARATION: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
fn pending() -> std::sync::MutexGuard<'static, Option<Pending>> {
    PENDING
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

/// Called synchronously by the matching live state's lock/install barrier.
/// Detached snapshots have independent owners and cannot cancel this candidate.
pub fn cancel_owner(owner: u64) {
    let mut guard = pending();
    if guard.as_ref().is_some_and(|item| item.owner == owner) {
        *guard = None;
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryChallenge {
    pub token: String,
    pub delay_ms: u64,
    pub expires_in_ms: u64,
    pub verified: Vec<String>,
    pub warnings: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub restored: bool,
    pub old_wrapper_backup: Option<String>,
    pub warnings: Vec<String>,
}

fn require_scope(window: &tauri::WebviewWindow, source: &Path) -> Result<(), String> {
    if !source.is_absolute()
        || !window
            .app_handle()
            .try_fs_scope()
            .is_some_and(|scope| scope.is_allowed(source))
    {
        return Err("Select the recovery file using the native file picker".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn encryption_master_key_health(
    app: tauri::AppHandle,
    state: tauri::State<'_, EncryptionState>,
) -> Result<KeyHealth, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Profile directory unavailable")?;
    let generation = state.key_generation();
    let key = state
        .with_master(|master| MasterDek::from_bytes(master.bytes_for_password_wrap()).unwrap())
        .await;
    match key {
        Some(key) => {
            let health = tokio::task::spawn_blocking(move || inspect_candidate(&root, &key))
                .await
                .map_err(|_| "Key health inspection failed")?;
            let _guard = crate::settings_coordinator::lock().await;
            let health = accept_inspected_health(&state, generation, health).await?;
            if health.critical_failure {
                let _ = app.emit(crate::commands::EVENT_LOCKED, ());
            }
            Ok(health)
        }
        None => Ok(cached_health(&state).unwrap_or_else(|| KeyHealth {
            proven: false,
            critical_failure: false,
            verified: vec![],
            issues: vec![
                "Master key is locked; a recovery candidate must prove current profile membership."
                    .into(),
            ],
            fingerprint: String::new(),
        })),
    }
}

#[tauri::command]
pub async fn encryption_prepare_master_recovery(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EncryptionState>,
    source_path: String,
    backup_password: String,
    new_password: String,
) -> Result<RecoveryChallenge, String> {
    let backup_password = Zeroizing::new(backup_password);
    let new_password = Zeroizing::new(new_password);
    let _preparation = PREPARATION
        .try_acquire()
        .map_err(|_| "A recovery file is already being authenticated; wait for it to finish")?;
    if source_path.len() > 4096
        || backup_password.is_empty()
        || backup_password.len() > 1024
        || new_password.is_empty()
        || new_password.len() > 1024
    {
        return Err("Recovery path or password length is invalid (passwords:1–1024 bytes)".into());
    }
    let root = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|_| "Profile directory unavailable")?;
    let source = PathBuf::from(source_path);
    require_scope(&window, &source)?;
    let source_parent = source.parent().ok_or("Recovery file has no parent")?;
    let blob = read_optional(
        source_parent,
        &source,
        crate::password_wrap::FILE_LEN as u64,
    )?
    .ok_or("Recovery file is missing")?;
    let generation = state.key_generation();
    let source_hash = digest(&blob);
    let (candidate, replacement, _preparation) = tokio::task::spawn_blocking(move || {
        let candidate = crate::password_wrap::unwrap(&backup_password, &blob)
            .map_err(|_| "Recovery password or file authentication failed")?;
        let replacement = crate::password_wrap::wrap(
            &new_password,
            &candidate,
            crate::password_wrap::Argon2Params::OWASP,
        )
        .map_err(|error| error.to_string())?;
        // The permit stays with the blocking KDF if its IPC future is cancelled.
        Ok::<_, String>((candidate, replacement, _preparation))
    })
    .await
    .map_err(|_| "Recovery authentication task failed")??;
    let _coordinator = crate::settings_coordinator::lock().await;
    if generation != state.key_generation() {
        return Err("Key state changed; start recovery again".into());
    }
    let old_wrapper = wrapper_snapshot(&root)?;
    let usable_wrapper_shape = old_wrapper
        .as_ref()
        .is_some_and(|bytes| crate::password_wrap::inspect_format(bytes).is_ok());
    if usable_wrapper_shape
        && state
            .with_master(|key| inspect_candidate(&root, key).proven)
            .await
            == Some(true)
    {
        return Err(
            "Current master key already authenticates this profile; use normal password settings"
                .into(),
        );
    }
    let proof = inspect_candidate(&root, &candidate);
    if !proof.proven {
        return Err(format!("Recovery key does not prove membership in the current profile. No file was changed. {}", proof.issues.join("; ")));
    }
    let (control_hash, has_pending) = control_fingerprint(&root, &candidate)?;
    let mut random = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let token = digest(&random);
    let owner = state.database_session_owner();
    let now = Instant::now();
    *pending() = Some(Pending {
        token: token.clone(),
        owner,
        window: window.label().into(),
        root,
        generation,
        source,
        source_hash,
        old_wrapper,
        proof_hash: proof.fingerprint,
        control_hash,
        candidate,
        replacement,
        ready_at: now + DELAY,
        expires_at: now + LIFETIME,
    });
    let expiry_token = token.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LIFETIME).await;
        let mut guard = pending();
        if guard
            .as_ref()
            .is_some_and(|item| item.token == expiry_token)
        {
            *guard = None;
        }
    });
    let mut warnings = proof.issues;
    if has_pending {
        warnings.push("An interrupted storage transaction remains unchanged. Restoring the key enables its separate coordinated recovery; normal writes may remain blocked.".into());
    }
    Ok(RecoveryChallenge {
        token,
        delay_ms: DELAY.as_millis() as u64,
        expires_in_ms: LIFETIME.as_millis() as u64,
        verified: proof.verified,
        warnings,
    })
}

fn take_ready(
    token: &str,
    owner: u64,
    window: &str,
    generation: u64,
    root: &Path,
    now: Instant,
) -> Result<Pending, String> {
    let mut guard = pending();
    let item = guard
        .as_ref()
        .ok_or("Recovery challenge is missing, cancelled or already used")?;
    if item.token != token || item.owner != owner || item.window != window || item.root != root {
        return Err("Recovery challenge belongs to another request or window".into());
    }
    if now >= item.expires_at || generation != item.generation {
        *guard = None;
        return Err("Recovery challenge expired or key state changed".into());
    }
    if now < item.ready_at {
        return Err("The native 10-second recovery safety delay has not elapsed".into());
    }
    guard
        .take()
        .ok_or("Recovery challenge is unavailable".into())
}

fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Receipt has no parent")?;
    crate::artifact_transaction::validate_regular_path(parent, path, true)?;
    let mut stage = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Could not create private recovery stage")?;
    stage
        .write_all(bytes)
        .and_then(|_| stage.as_file_mut().sync_all())
        .map_err(|_| "Could not persist recovery stage")?;
    stage
        .persist(path)
        .map_err(|_| "Could not atomically replace password receipt")?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|_| "Could not synchronize recovery directory")?;
    Ok(())
}

fn commit_receipt(
    item: &Pending,
    before_replace: impl FnOnce() -> Result<(), String>,
) -> Result<Option<String>, String> {
    commit_receipt_with(item, before_replace, atomic_replace)
}

fn commit_receipt_with(
    item: &Pending,
    before_replace: impl FnOnce() -> Result<(), String>,
    write: impl Fn(&Path, &[u8]) -> Result<(), String>,
) -> Result<Option<String>, String> {
    if digest(
        &read_optional(
            item.source
                .parent()
                .ok_or("Recovery source has no parent")?,
            &item.source,
            crate::password_wrap::FILE_LEN as u64,
        )?
        .ok_or("Recovery source disappeared")?,
    ) != item.source_hash
    {
        return Err("Recovery source changed; start again".into());
    }
    if wrapper_snapshot(&item.root)? != item.old_wrapper {
        return Err("Local password receipt changed; start again".into());
    }
    let proof = inspect_candidate(&item.root, &item.candidate);
    if !proof.proven || proof.fingerprint != item.proof_hash {
        return Err("Current profile evidence changed; start again".into());
    }
    if control_fingerprint(&item.root, &item.candidate)?.0 != item.control_hash {
        return Err("Storage recovery state changed; start again".into());
    }
    let backup_name = item
        .old_wrapper
        .as_ref()
        .map(|_| format!("dek.enc.recovery-{}.bak", &item.token[..16]));
    if let (Some(name), Some(bytes)) = (&backup_name, &item.old_wrapper) {
        crate::artifact_transaction::durable_write(&item.root.join(name), bytes)?;
    }
    before_replace()?;
    let path = item.root.join("dek.enc");
    let result = write(&path, &item.replacement).and_then(|_| {
        if wrapper_snapshot(&item.root)?.as_deref() != Some(item.replacement.as_slice()) {
            return Err("Password receipt verification failed".into());
        }
        Ok(())
    });
    if let Err(error) = result {
        let rollback = match &item.old_wrapper {
            Some(bytes) => write(&path, bytes),
            None => match std::fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err("Could not remove new receipt".into()),
            },
        };
        return Err(if rollback.is_err() {
            format!("{error}; rollback failed. Preserve the recovery backup and existing files.")
        } else {
            error
        });
    }
    Ok(backup_name)
}

#[tauri::command]
pub async fn encryption_commit_master_recovery(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EncryptionState>,
    token: String,
) -> Result<RecoveryReport, String> {
    let _coordinator = crate::settings_coordinator::lock().await;
    let root = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|_| "Profile directory unavailable")?;
    let item = take_ready(
        &token,
        state.database_session_owner(),
        window.label(),
        state.key_generation(),
        &root,
        Instant::now(),
    )?;
    require_scope(&window, &item.source)?;
    let backup = commit_receipt(&item, || {
        crate::audit::record(&root, crate::audit::AuditEvent::PortableImported, serde_json::json!({"method":"verified-same-profile-recovery", "phase":"receipt-commit-authorized"})).map_err(|_| "Recovery audit could not be persisted; receipt unchanged".into())
    })?;
    let health = inspect_candidate(&root, &item.candidate);
    state.install(item.candidate).await;
    cache_health(&state, health);
    let mut warnings = vec!["OS vault, artifact policy and encrypted data were not rewritten. Use the new local password on future starts.".into()];
    if let Some(error) = state.artifact_policy_error() {
        warnings.push(format!(
            "Key receipt restored, but artifact policy still requires attention: {error}"
        ));
    }
    let _ = window
        .app_handle()
        .emit(crate::commands::EVENT_UNLOCKED, ());
    Ok(RecoveryReport {
        restored: true,
        old_wrapper_backup: backup,
        warnings,
    })
}

#[tauri::command]
pub fn encryption_cancel_master_recovery(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, EncryptionState>,
    token: String,
) -> Result<(), String> {
    let mut guard = pending();
    if let Some(item) = guard.as_ref() {
        if item.token == token
            && item.owner == state.database_session_owner()
            && item.window == window.label()
        {
            *guard = None;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    static FIXTURE: Mutex<()> = Mutex::new(());
    fn encrypted(root: &Path, name: &str, key: &MasterDek, kind: ArtifactKind, plain: &[u8]) {
        let bytes = crate::envelope::write_envelope(
            &key.sub_key(kind),
            &crate::EnvelopeHeader::new_vault([7; 12]),
            plain,
        )
        .unwrap();
        std::fs::write(root.join(name), bytes).unwrap();
    }
    fn fixture() -> (tempfile::TempDir, Pending) {
        let dir = tempfile::tempdir().unwrap();
        let candidate = MasterDek::generate();
        encrypted(
            dir.path(),
            "artifact-policy.enc",
            &candidate,
            ArtifactKind::ArtifactPolicy,
            br#"{"version":1,"revision":4,"overrides":{}}"#,
        );
        let params = crate::Argon2Params {
            memory_kib: 8192,
            time_cost: 1,
            parallelism: 1,
        };
        let original = crate::password_wrap::wrap("old-password", &candidate, params).unwrap();
        std::fs::write(dir.path().join("dek.enc"), &original).unwrap();
        let replacement = crate::password_wrap::wrap("new-password", &candidate, params).unwrap();
        let source = dir.path().join("export.dek");
        std::fs::write(&source, &original).unwrap();
        let health = inspect_candidate(dir.path(), &candidate);
        assert!(health.proven, "{:?}", health.issues);
        let now = Instant::now();
        let control_hash = control_fingerprint(dir.path(), &candidate).unwrap().0;
        let item = Pending {
            token: "0123456789abcdef0123456789abcdef".into(),
            owner: 7,
            window: "main".into(),
            root: dir.path().into(),
            generation: 3,
            source,
            source_hash: digest(&original),
            old_wrapper: Some(original),
            proof_hash: health.fingerprint,
            control_hash,
            candidate,
            replacement,
            ready_at: now + DELAY,
            expires_at: now + LIFETIME,
        };
        (dir, item)
    }

    #[test]
    fn canonical_primary_proof_rejects_wrong_and_backup_only_keys() {
        let (dir, item) = fixture();
        let wrong = MasterDek::generate();
        encrypted(
            dir.path(),
            "settings.enc.bak",
            &wrong,
            ArtifactKind::Settings,
            b"{}",
        );
        assert!(!inspect_candidate(dir.path(), &wrong).proven);
        assert!(inspect_candidate(dir.path(), &wrong).critical_failure);
        std::fs::remove_file(dir.path().join("artifact-policy.enc")).unwrap();
        assert!(!inspect_candidate(dir.path(), &wrong).proven);
        assert!(!inspect_candidate(dir.path(), &item.candidate).proven);
    }

    #[test]
    fn primary_conflict_is_not_overruled_but_secondary_corruption_is_reported() {
        let (dir, item) = fixture();
        std::fs::write(dir.path().join("settings.enc"), b"damaged").unwrap();
        let health = inspect_candidate(dir.path(), &item.candidate);
        assert!(health.proven);
        assert!(!health.critical_failure);
        assert_eq!(health.issues.len(), 1);
        encrypted(
            dir.path(),
            "settings.enc",
            &item.candidate,
            ArtifactKind::Settings,
            b"{}",
        );
        std::fs::write(dir.path().join("artifact-policy.enc"), b"damaged").unwrap();
        let health = inspect_candidate(dir.path(), &item.candidate);
        assert!(!health.proven);
        assert!(health.critical_failure);
        assert!(health.verified.contains(&"settings.enc".into()));
    }

    #[test]
    fn no_proof_is_not_recovery_and_recognized_mismatch_blocks_normal_unlock() {
        let empty = tempfile::tempdir().unwrap();
        let key = MasterDek::generate();
        assert!(!inspect_candidate(empty.path(), &key).proven);
        assert!(validate_unlock_candidate(empty.path(), &key).is_ok());
        encrypted(
            empty.path(),
            "settings.enc",
            &key,
            ArtifactKind::Settings,
            b"{}",
        );
        assert!(validate_unlock_candidate(empty.path(), &MasterDek::generate()).is_err());
    }

    #[test]
    fn delay_scope_expiry_generation_cancel_and_replay_are_native_authority() {
        let _guard = FIXTURE.lock().unwrap();
        let (dir, item) = fixture();
        let ready = item.ready_at;
        let expiry = item.expires_at;
        let token = item.token.clone();
        *pending() = Some(item);
        assert!(take_ready(
            &token,
            7,
            "main",
            3,
            dir.path(),
            ready - Duration::from_millis(1)
        )
        .err()
        .unwrap()
        .contains("10-second"));
        for (owner, window, root) in [
            (8, "main", dir.path()),
            (7, "detached", dir.path()),
            (7, "main", Path::new("another-profile")),
        ] {
            assert!(take_ready(&token, owner, window, 3, root, ready).is_err());
        }
        assert!(take_ready(&token, 7, "main", 3, dir.path(), ready).is_ok());
        assert!(take_ready(&token, 7, "main", 3, dir.path(), ready).is_err());
        let (_, mut item) = fixture();
        item.root = dir.path().into();
        item.expires_at = expiry;
        *pending() = Some(item);
        assert!(take_ready(&token, 7, "main", 3, dir.path(), expiry).is_err());
        assert!(pending().is_none());
        let (_, mut item) = fixture();
        item.root = dir.path().into();
        *pending() = Some(item);
        assert!(take_ready(&token, 7, "main", 4, dir.path(), ready).is_err());
        assert!(pending().is_none());
        let (_, item) = fixture();
        *pending() = Some(item);
        cancel_owner(8);
        assert!(pending().is_some());
        cancel_owner(7);
        assert!(pending().is_none());
    }

    #[test]
    fn commit_changes_only_wrapper_and_keeps_verified_recoverable_original() {
        let (dir, item) = fixture();
        let policy = std::fs::read(dir.path().join("artifact-policy.enc")).unwrap();
        let backup = commit_receipt(&item, || Ok(())).unwrap().unwrap();
        assert_eq!(
            std::fs::read(dir.path().join(backup)).unwrap(),
            item.old_wrapper.unwrap()
        );
        assert_eq!(
            std::fs::read(dir.path().join("artifact-policy.enc")).unwrap(),
            policy
        );
        let saved = std::fs::read(dir.path().join("dek.enc")).unwrap();
        let restored = crate::password_wrap::unwrap("new-password", &saved).unwrap();
        assert_eq!(
            restored.bytes_for_password_wrap(),
            item.candidate.bytes_for_password_wrap()
        );
    }

    #[test]
    fn source_wrapper_evidence_drift_and_audit_failure_never_replace_receipt() {
        for case in 0..4 {
            let (dir, item) = fixture();
            match case {
                0 => std::fs::write(&item.source, b"changed").unwrap(),
                1 => std::fs::write(dir.path().join("dek.enc"), b"newer receipt").unwrap(),
                2 => std::fs::write(dir.path().join("artifact-policy.enc"), b"changed").unwrap(),
                _ => {}
            }
            let before = std::fs::read(dir.path().join("dek.enc")).unwrap();
            assert!(commit_receipt(&item, || if case == 3 {
                Err("audit failed".into())
            } else {
                Ok(())
            })
            .is_err());
            assert_eq!(std::fs::read(dir.path().join("dek.enc")).unwrap(), before);
        }
    }

    #[test]
    fn failed_or_unverified_receipt_write_rolls_back_without_installing_key() {
        for corrupt_success in [false, true] {
            let (dir, item) = fixture();
            let count = std::cell::Cell::new(0);
            assert!(commit_receipt_with(
                &item,
                || Ok(()),
                |path, bytes| {
                    count.set(count.get() + 1);
                    if count.get() == 1 {
                        std::fs::write(path, b"partial").unwrap();
                        return if corrupt_success {
                            Ok(())
                        } else {
                            Err("injected persistence failure".into())
                        };
                    }
                    atomic_replace(path, bytes)
                }
            )
            .is_err());
            assert_eq!(
                std::fs::read(dir.path().join("dek.enc")).unwrap(),
                item.old_wrapper.unwrap()
            );
        }
    }

    #[tokio::test]
    async fn same_key_restore_preserves_pending_journal_and_write_block() {
        let (dir, mut item) = fixture();
        encrypted(
            dir.path(),
            crate::artifact_transaction::JOURNAL_FILENAME,
            &item.candidate,
            ArtifactKind::ArtifactPolicy,
            br#"{"version":1,"phase":"preparing"}"#,
        );
        let journal_path = dir
            .path()
            .join(crate::artifact_transaction::JOURNAL_FILENAME);
        let journal = std::fs::read(&journal_path).unwrap();
        item.control_hash = control_fingerprint(dir.path(), &item.candidate).unwrap().0;
        let state = EncryptionState::new();
        crate::artifact_policy::initialize(&state, dir.path()).await;
        assert!(state.artifact_recovery_required());
        commit_receipt(&item, || Ok(())).unwrap();
        state.install(item.candidate).await;
        assert_eq!(std::fs::read(&journal_path).unwrap(), journal);
        assert!(state.artifact_recovery_required());
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, true)
            .is_err());
    }

    #[test]
    fn journal_drift_and_unknown_rotation_cannot_reuse_challenge() {
        let (dir, item) = fixture();
        encrypted(
            dir.path(),
            crate::artifact_transaction::JOURNAL_FILENAME,
            &item.candidate,
            ArtifactKind::ArtifactPolicy,
            b"{}",
        );
        assert!(commit_receipt(&item, || Ok(()))
            .unwrap_err()
            .contains("recovery state changed"));
        std::fs::remove_file(
            dir.path()
                .join(crate::artifact_transaction::JOURNAL_FILENAME),
        )
        .unwrap();
        std::fs::write(
            dir.path()
                .join("settings.enc.sorng-rotation-fixture.backup"),
            b"old-generation",
        )
        .unwrap();
        assert!(control_fingerprint(dir.path(), &item.candidate)
            .unwrap_err()
            .contains("unfinished master rotation"));
    }

    #[tokio::test]
    async fn cached_failure_is_sanitized_and_scoped_to_key_generation() {
        let state = EncryptionState::new();
        record_load_failure(&state, "Current profile rejected the OS-vault key");
        assert!(cached_health(&state).unwrap().critical_failure);
        state.install(MasterDek::generate()).await;
        assert!(cached_health(&state).is_none());
        assert!(cached_health(&EncryptionState::new()).is_none());
    }

    #[tokio::test]
    async fn loaded_wrong_key_is_quarantined_and_old_inspection_cannot_lock_new_generation() {
        let (dir, item) = fixture();
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let generation = state.key_generation();
        let health = state
            .with_master(|key| inspect_candidate(dir.path(), key))
            .await
            .unwrap();
        assert!(health.critical_failure);
        accept_inspected_health(&state, generation, health.clone())
            .await
            .unwrap();
        assert!(!state.is_unlocked().await);
        assert!(state
            .resolve_write_policy(ArtifactKind::Settings, false)
            .is_err());
        assert!(state
            .resolve_write_policy(ArtifactKind::Connections, true)
            .is_err());
        assert!(cached_health(&state).unwrap().critical_failure);
        state.install(item.candidate).await;
        assert!(accept_inspected_health(&state, generation, health)
            .await
            .is_err());
        assert!(state.is_unlocked().await);
        assert!(cached_health(&state).is_none());
    }
}
