// sorng-recording – Storage / persistence module
//
// Handles saving recordings to disk, loading, indexing, and cleanup.
// File layout:
//   <storage_dir>/
//     recordings/
//       <id>.json          – SavedRecordingEnvelope (JSON)
//     macros/
//       <id>.json          – MacroRecording (JSON)
//     config.json          – RecordingGlobalConfig

use std::path::{Path, PathBuf};

use crate::error::{RecordingError, RecordingResult};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Durable atomic write
// ═══════════════════════════════════════════════════════════════════════
//
// Recording envelopes, macros, and media sidecars are the recording
// subsystem's crown-jewel data. A bare `std::fs::write` is neither atomic
// (a crash mid-write truncates the file) nor durable (a crash after a
// rename can leave a committed directory entry pointing at un-flushed
// bytes). `durable_write` gives both: write to a per-target temp,
// `sync_all()` the handle, rename, then fsync the parent dir (POSIX; a
// no-op on Windows, where NTFS journals the directory metadata with the
// rename). This mirrors `sorng-storage::durable` and `database_files.rs`;
// it's re-implemented here because `sorng-recording` depends only on
// `sorng-encryption`, not `sorng-storage`.

fn durable_temp_sibling(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sorng-recording".to_string());
    let tmp_name = format!(".{file_name}.tmp");
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join(tmp_name),
        _ => PathBuf::from(tmp_name),
    }
}

#[cfg(unix)]
fn durable_sync_parent_dir(path: &Path) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
    }
}

#[cfg(not(unix))]
fn durable_sync_parent_dir(_path: &Path) {}

/// Atomic + durable write. Ensures the parent dir exists, writes to a
/// temp sibling, fsyncs it, renames into place, then fsyncs the parent
/// dir (POSIX). Returns a `StorageError` on any failure with the temp
/// cleaned up.
pub fn durable_write(path: &Path, bytes: &[u8]) -> RecordingResult<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| RecordingError::StorageError(format!("mkdir {}: {}", parent.display(), e)))?;
        }
    }
    let tmp = durable_temp_sibling(path);
    let write_res = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(())
    })();
    if let Err(e) = write_res {
        let _ = std::fs::remove_file(&tmp);
        return Err(RecordingError::StorageError(format!(
            "write {}: {}",
            tmp.display(),
            e
        )));
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(RecordingError::StorageError(format!(
            "rename {} -> {}: {}",
            tmp.display(),
            path.display(),
            e
        )));
    }
    durable_sync_parent_dir(path);
    Ok(())
}

/// Resolve the storage root.  If the config has a custom dir use it,
/// otherwise fall back to `<app_data>/recording`.
pub fn storage_root(config_dir: Option<&str>, app_data_dir: &str) -> PathBuf {
    match config_dir {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(app_data_dir).join("recording"),
    }
}

fn recordings_dir(root: &Path) -> PathBuf {
    root.join("recordings")
}

fn macros_dir(root: &Path) -> PathBuf {
    root.join("macros")
}

fn config_path(root: &Path) -> PathBuf {
    root.join("config.json")
}

/// Ensure directories exist.
pub fn ensure_dirs(root: &Path) -> RecordingResult<()> {
    std::fs::create_dir_all(recordings_dir(root))
        .map_err(|e| RecordingError::StorageError(format!("create recordings dir: {}", e)))?;
    std::fs::create_dir_all(macros_dir(root))
        .map_err(|e| RecordingError::StorageError(format!("create macros dir: {}", e)))?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Recording envelopes
// ═══════════════════════════════════════════════════════════════════════

/// Persist a single envelope to disk.
pub fn save_envelope(root: &Path, envelope: &SavedRecordingEnvelope) -> RecordingResult<()> {
    let dir = recordings_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RecordingError::StorageError(format!("mkdir: {}", e)))?;
    let path = dir.join(format!("{}.json", envelope.id));
    let json = serde_json::to_string_pretty(envelope)?;
    durable_write(&path, json.as_bytes())?;
    Ok(())
}

/// Load a single envelope by ID.
pub fn load_envelope(root: &Path, id: &str) -> RecordingResult<SavedRecordingEnvelope> {
    let path = recordings_dir(root).join(format!("{}.json", id));
    let json = std::fs::read_to_string(&path)
        .map_err(|e| RecordingError::StorageError(format!("read {}: {}", path.display(), e)))?;
    let envelope: SavedRecordingEnvelope = serde_json::from_str(&json)?;
    Ok(envelope)
}

/// Load all envelopes from disk.
pub fn load_all_envelopes(root: &Path) -> RecordingResult<Vec<SavedRecordingEnvelope>> {
    let dir = recordings_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut envelopes = Vec::new();
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            match std::fs::read_to_string(&path) {
                Ok(json) => match serde_json::from_str::<SavedRecordingEnvelope>(&json) {
                    Ok(env) => envelopes.push(env),
                    Err(e) => {
                        log::warn!("Skip malformed envelope {}: {}", path.display(), e);
                    }
                },
                Err(e) => {
                    log::warn!("Skip unreadable file {}: {}", path.display(), e);
                }
            }
        }
    }
    envelopes.sort_by_key(|envelope| std::cmp::Reverse(envelope.saved_at));
    Ok(envelopes)
}

/// Delete an envelope by ID.
pub fn delete_envelope(root: &Path, id: &str) -> RecordingResult<()> {
    let path = recordings_dir(root).join(format!("{}.json", id));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| RecordingError::StorageError(format!("delete: {}", e)))?;
    }
    Ok(())
}

/// Delete all envelopes.
pub fn clear_envelopes(root: &Path) -> RecordingResult<usize> {
    let dir = recordings_dir(root);
    if !dir.exists() {
        return Ok(0);
    }
    let mut count = 0;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json")
            && std::fs::remove_file(&path).is_ok()
        {
            count += 1;
        }
    }
    Ok(count)
}

/// Total size (bytes) of all envelope files on disk.
pub fn storage_size(root: &Path) -> RecordingResult<u64> {
    let dir = recordings_dir(root);
    if !dir.exists() {
        return Ok(0);
    }
    let mut total: u64 = 0;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            total += meta.len();
        }
    }
    Ok(total)
}

// ═══════════════════════════════════════════════════════════════════════
//  Macro persistence
// ═══════════════════════════════════════════════════════════════════════

pub fn save_macro(root: &Path, macro_rec: &MacroRecording) -> RecordingResult<()> {
    let dir = macros_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RecordingError::StorageError(format!("mkdir: {}", e)))?;
    let path = dir.join(format!("{}.json", macro_rec.id));
    let json = serde_json::to_string_pretty(macro_rec)?;
    durable_write(&path, json.as_bytes())?;
    Ok(())
}

pub fn load_all_macros(root: &Path) -> RecordingResult<Vec<MacroRecording>> {
    let dir = macros_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut macros = Vec::new();
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            match std::fs::read_to_string(&path) {
                Ok(json) => match serde_json::from_str::<MacroRecording>(&json) {
                    Ok(m) => macros.push(m),
                    Err(e) => {
                        log::warn!("Skip malformed macro {}: {}", path.display(), e);
                    }
                },
                Err(e) => {
                    log::warn!("Skip unreadable macro {}: {}", path.display(), e);
                }
            }
        }
    }
    macros.sort_by_key(|recording| std::cmp::Reverse(recording.updated_at));
    Ok(macros)
}

pub fn delete_macro_file(root: &Path, macro_id: &str) -> RecordingResult<()> {
    let path = macros_dir(root).join(format!("{}.json", macro_id));
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| RecordingError::StorageError(format!("delete macro: {}", e)))?;
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Config persistence
// ═══════════════════════════════════════════════════════════════════════

pub fn save_config(root: &Path, config: &RecordingGlobalConfig) -> RecordingResult<()> {
    std::fs::create_dir_all(root)
        .map_err(|e| RecordingError::StorageError(format!("mkdir: {}", e)))?;
    let path = config_path(root);
    let json = serde_json::to_string_pretty(config)?;
    durable_write(&path, json.as_bytes())?;
    Ok(())
}

pub fn load_config(root: &Path) -> RecordingResult<RecordingGlobalConfig> {
    let path = config_path(root);
    if !path.exists() {
        return Ok(RecordingGlobalConfig::default());
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| RecordingError::StorageError(format!("read config: {}", e)))?;
    let config: RecordingGlobalConfig = serde_json::from_str(&json)?;
    Ok(config)
}

// ═══════════════════════════════════════════════════════════════════════
//  Auto-cleanup (files on disk)
// ═══════════════════════════════════════════════════════════════════════

/// Remove envelopes older than `days` from disk.  Returns count deleted.
pub fn cleanup_old_envelopes(root: &Path, days: u64) -> RecordingResult<usize> {
    let dir = recordings_dir(root);
    if !dir.exists() {
        return Ok(0);
    }
    let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
    let mut deleted = 0;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;
    for entry in entries {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // Try to read and check date
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(env) = serde_json::from_str::<SavedRecordingEnvelope>(&json) {
                if env.saved_at < cutoff && std::fs::remove_file(&path).is_ok() {
                    deleted += 1;
                }
            }
        }
    }
    Ok(deleted)
}

/// Enforce max storage size by deleting oldest envelopes until under budget.
pub fn enforce_storage_limit(root: &Path, max_bytes: u64) -> RecordingResult<usize> {
    let mut envelopes = load_all_envelopes(root)?;
    // Sort oldest first
    envelopes.sort_by_key(|envelope| envelope.saved_at);

    let mut total = storage_size(root)?;
    let mut deleted = 0;
    while total > max_bytes && !envelopes.is_empty() {
        let oldest = envelopes.remove(0);
        if delete_envelope(root, &oldest.id).is_ok() {
            total = total.saturating_sub(oldest.size_bytes);
            deleted += 1;
        }
    }
    Ok(deleted)
}

// ═══════════════════════════════════════════════════════════════════════
//  Export helpers  (write encoded data to a file path)
// ═══════════════════════════════════════════════════════════════════════

pub fn write_export(path: &Path, data: &str) -> RecordingResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| RecordingError::StorageError(format!("mkdir export: {}", e)))?;
    }
    std::fs::write(path, data)
        .map_err(|e| RecordingError::StorageError(format!("write export: {}", e)))?;
    Ok(())
}

pub fn write_export_bytes(path: &Path, data: &[u8]) -> RecordingResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| RecordingError::StorageError(format!("mkdir export: {}", e)))?;
    }
    std::fs::write(path, data)
        .map_err(|e| RecordingError::StorageError(format!("write export bytes: {}", e)))?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Encryption-at-rest dispatch (Phase 2a wiring)
//
//  Layout — separate filenames per format, mirroring the settings codec:
//    <id>.json      → v0 plaintext
//    <id>.json.enc  → v2 envelope under ArtifactKind::RecordingsMeta
//                     (or ArtifactKind::Macros for macros)
//
//  Dispatch rules:
//   - Read: prefer `.json.enc`. If present but state is locked, error.
//     If only `.json` exists, return the plaintext.
//   - Write: when `state.is_unlocked()` → `.json.enc` (and delete the
//     stale `.json` to prevent rollback). When locked → `.json`. This
//     matches the settings policy and keeps in-progress recordings
//     working even if auto-lock fires mid-session.
//   - List: scan once, dedupe by id, prefer `.enc`; if a `.enc` cannot
//     be decrypted because the state is locked, the entry is silently
//     skipped (rather than failing the whole library load).
//   - Delete: remove both variants for the same id; safe no-op when
//     either is already gone.
// ═══════════════════════════════════════════════════════════════════════

use sorng_encryption::artifacts::{
    macros as macros_codec, recording_media as media_codec,
    recording_meta as meta_codec,
};
use sorng_encryption::envelope::{MasterKeyStorage, SALT_LEN};
use sorng_encryption::password_wrap::Argon2Params;
use sorng_encryption::EncryptionState;

const ENC_SUFFIX: &str = ".json.enc";

fn envelope_enc_path(root: &Path, id: &str) -> PathBuf {
    recordings_dir(root).join(format!("{}{}", id, ENC_SUFFIX))
}
fn envelope_plain_path(root: &Path, id: &str) -> PathBuf {
    recordings_dir(root).join(format!("{}.json", id))
}
fn macro_enc_path(root: &Path, id: &str) -> PathBuf {
    macros_dir(root).join(format!("{}{}", id, ENC_SUFFIX))
}
fn macro_plain_path(root: &Path, id: &str) -> PathBuf {
    macros_dir(root).join(format!("{}.json", id))
}

/// Save an envelope, picking the format from the encryption state.
/// When unlocked, writes `.json.enc` and removes any stale `.json`
/// shadow. When locked, falls back to plaintext (auto-lock during a
/// recording must not lose data — the next save after unlock will
/// upgrade the file).
pub async fn save_envelope_dispatched(
    root: &Path,
    envelope: &SavedRecordingEnvelope,
    enc: &EncryptionState,
) -> RecordingResult<()> {
    let dir = recordings_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RecordingError::StorageError(format!("mkdir: {}", e)))?;

    if enc.is_unlocked().await {
        let value = serde_json::to_value(envelope)?;
        // Wrap in an object if needed — codec requires object root.
        let obj = if value.is_object() {
            value
        } else {
            serde_json::json!({ "envelope": value })
        };
        let blob = meta_codec::write(
            enc,
            &obj,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .map_err(|e| RecordingError::StorageError(format!("encrypt envelope: {}", e)))?;
        let enc_path = envelope_enc_path(root, &envelope.id);
        durable_write(&enc_path, &blob)?;
        // Sweep the stale plaintext shadow if it exists.
        let plain = envelope_plain_path(root, &envelope.id);
        if plain.exists() {
            let _ = std::fs::remove_file(&plain);
        }
        Ok(())
    } else {
        save_envelope(root, envelope)
    }
}

/// Load a single envelope by id, preferring the encrypted variant.
/// Returns `Locked` when only the `.enc` is present and the state is
/// not unlocked.
pub async fn load_envelope_dispatched(
    root: &Path,
    id: &str,
    enc: &EncryptionState,
) -> RecordingResult<SavedRecordingEnvelope> {
    let enc_path = envelope_enc_path(root, id);
    if enc_path.exists() {
        if !enc.is_unlocked().await {
            return Err(RecordingError::StorageError(
                "recording metadata is encrypted; unlock first".into(),
            ));
        }
        let bytes = std::fs::read(&enc_path).map_err(|e| {
            RecordingError::StorageError(format!("read {}: {}", enc_path.display(), e))
        })?;
        let value = meta_codec::read(enc, &bytes)
            .await
            .map_err(|e| RecordingError::StorageError(format!("decrypt envelope: {}", e)))?
            .ok_or_else(|| RecordingError::StorageError("empty envelope payload".into()))?;
        // Unwrap the envelope back if it was wrapped on write.
        let raw = value.get("envelope").cloned().unwrap_or(value);
        let envelope: SavedRecordingEnvelope = serde_json::from_value(raw)?;
        return Ok(envelope);
    }
    load_envelope(root, id)
}

/// List all envelopes, dispatching per-file. When state is locked,
/// `.enc` files are silently skipped (with a warn log) so the library
/// view still renders any remaining plaintext entries.
pub async fn load_all_envelopes_dispatched(
    root: &Path,
    enc: &EncryptionState,
) -> RecordingResult<Vec<SavedRecordingEnvelope>> {
    let dir = recordings_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let unlocked = enc.is_unlocked().await;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;

    use std::collections::HashMap;
    // Map id → envelope, with `.enc` winning over `.json` for the same id.
    let mut by_id: HashMap<String, (bool, SavedRecordingEnvelope)> = HashMap::new();
    for entry in entries {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Branch on extension(s)
        if let Some(stem) = name.strip_suffix(ENC_SUFFIX) {
            // <id>.json.enc
            if !unlocked {
                log::debug!("skip locked .enc envelope: {}", name);
                continue;
            }
            let bytes = match std::fs::read(&path) {
                Ok(b) => b,
                Err(e) => {
                    log::warn!("read {} failed: {}", path.display(), e);
                    continue;
                }
            };
            let value = match meta_codec::read(enc, &bytes).await {
                Ok(Some(v)) => v,
                Ok(None) => continue,
                Err(e) => {
                    log::warn!("decrypt {} failed: {}", path.display(), e);
                    continue;
                }
            };
            let raw = value.get("envelope").cloned().unwrap_or(value);
            match serde_json::from_value::<SavedRecordingEnvelope>(raw) {
                Ok(env) => {
                    by_id.insert(stem.to_string(), (true, env));
                }
                Err(e) => log::warn!("parse envelope {}: {}", path.display(), e),
            }
        } else if name.ends_with(".json") && !name.ends_with(ENC_SUFFIX) {
            let id = name.trim_end_matches(".json").to_string();
            // Don't shadow an already-loaded encrypted entry for this id.
            if by_id.get(&id).map(|(enc_won, _)| *enc_won).unwrap_or(false) {
                continue;
            }
            match std::fs::read_to_string(&path) {
                Ok(json) => match serde_json::from_str::<SavedRecordingEnvelope>(&json) {
                    Ok(env) => {
                        by_id.entry(id).or_insert((false, env));
                    }
                    Err(e) => log::warn!("parse {}: {}", path.display(), e),
                },
                Err(e) => log::warn!("read {}: {}", path.display(), e),
            }
        }
    }
    // Second pass: drop any plaintext entry whose id also has an `.enc`
    // (we may have inserted plaintext before seeing the `.enc` due to
    // readdir order).
    let mut out: Vec<SavedRecordingEnvelope> =
        by_id.into_iter().map(|(_, (_, env))| env).collect();
    out.sort_by_key(|envelope| std::cmp::Reverse(envelope.saved_at));
    Ok(out)
}

/// Delete both variants of an envelope id. Safe no-op for either.
pub fn delete_envelope_all_variants(root: &Path, id: &str) -> RecordingResult<()> {
    let plain = envelope_plain_path(root, id);
    let enc = envelope_enc_path(root, id);
    if plain.exists() {
        std::fs::remove_file(&plain)
            .map_err(|e| RecordingError::StorageError(format!("delete plain: {}", e)))?;
    }
    if enc.exists() {
        std::fs::remove_file(&enc)
            .map_err(|e| RecordingError::StorageError(format!("delete enc: {}", e)))?;
    }
    Ok(())
}

// ── Macros ─────────────────────────────────────────────────────────────

pub async fn save_macro_dispatched(
    root: &Path,
    macro_rec: &MacroRecording,
    enc: &EncryptionState,
) -> RecordingResult<()> {
    let dir = macros_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RecordingError::StorageError(format!("mkdir: {}", e)))?;

    if enc.is_unlocked().await {
        let value = serde_json::to_value(macro_rec)?;
        let obj = if value.is_object() {
            value
        } else {
            serde_json::json!({ "macro": value })
        };
        let blob = macros_codec::write(
            enc,
            &obj,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .map_err(|e| RecordingError::StorageError(format!("encrypt macro: {}", e)))?;
        let enc_path = macro_enc_path(root, &macro_rec.id);
        durable_write(&enc_path, &blob)?;
        let plain = macro_plain_path(root, &macro_rec.id);
        if plain.exists() {
            let _ = std::fs::remove_file(&plain);
        }
        Ok(())
    } else {
        save_macro(root, macro_rec)
    }
}

pub async fn load_all_macros_dispatched(
    root: &Path,
    enc: &EncryptionState,
) -> RecordingResult<Vec<MacroRecording>> {
    let dir = macros_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let unlocked = enc.is_unlocked().await;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;

    use std::collections::HashMap;
    let mut by_id: HashMap<String, (bool, MacroRecording)> = HashMap::new();
    for entry in entries {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if let Some(stem) = name.strip_suffix(ENC_SUFFIX) {
            if !unlocked {
                log::debug!("skip locked .enc macro: {}", name);
                continue;
            }
            let bytes = match std::fs::read(&path) {
                Ok(b) => b,
                Err(e) => {
                    log::warn!("read {}: {}", path.display(), e);
                    continue;
                }
            };
            let value = match macros_codec::read(enc, &bytes).await {
                Ok(Some(v)) => v,
                Ok(None) => continue,
                Err(e) => {
                    log::warn!("decrypt {}: {}", path.display(), e);
                    continue;
                }
            };
            let raw = value.get("macro").cloned().unwrap_or(value);
            match serde_json::from_value::<MacroRecording>(raw) {
                Ok(m) => {
                    by_id.insert(stem.to_string(), (true, m));
                }
                Err(e) => log::warn!("parse macro {}: {}", path.display(), e),
            }
        } else if name.ends_with(".json") && !name.ends_with(ENC_SUFFIX) {
            let id = name.trim_end_matches(".json").to_string();
            if by_id.get(&id).map(|(enc_won, _)| *enc_won).unwrap_or(false) {
                continue;
            }
            match std::fs::read_to_string(&path) {
                Ok(json) => match serde_json::from_str::<MacroRecording>(&json) {
                    Ok(m) => {
                        by_id.entry(id).or_insert((false, m));
                    }
                    Err(e) => log::warn!("parse {}: {}", path.display(), e),
                },
                Err(e) => log::warn!("read {}: {}", path.display(), e),
            }
        }
    }
    let mut out: Vec<MacroRecording> = by_id.into_iter().map(|(_, (_, m))| m).collect();
    out.sort_by_key(|recording| std::cmp::Reverse(recording.updated_at));
    Ok(out)
}

pub fn delete_macro_all_variants(root: &Path, macro_id: &str) -> RecordingResult<()> {
    let plain = macro_plain_path(root, macro_id);
    let enc = macro_enc_path(root, macro_id);
    if plain.exists() {
        std::fs::remove_file(&plain)
            .map_err(|e| RecordingError::StorageError(format!("delete plain macro: {}", e)))?;
    }
    if enc.exists() {
        std::fs::remove_file(&enc)
            .map_err(|e| RecordingError::StorageError(format!("delete enc macro: {}", e)))?;
    }
    Ok(())
}

// ══════════════════════════════════════════════════════════════════════
//  Media blob dispatch (Phase 2b wiring — streaming AEAD)
//
//  Media files (.webm, .mp4, .gif, frame manifests) can run into tens of
//  MiB and the player needs random access for scrub / seek. They use the
//  chunked AEAD codec in `sorng-encryption::artifacts::recording_media`:
//  fixed-size plaintext chunks (default 64 KiB), each independently
//  AES-256-GCM-encrypted with a 12-byte nonce = (per-file random prefix
//  || chunk index big-endian).
//
//  Filename layout under `<root>/recordings/`:
//    <basename>          → plaintext v0 (existing behaviour, the
//                          extension is intrinsic to the media type —
//                          e.g. `<id>.webm`)
//    <basename>.enc      → v2 chunked stream (any media type — the
//                          `.enc` suffix marks the envelope, not the
//                          contained format)
//
//  Read dispatch: prefer `.enc` when present; magic-byte sniff on the
//  raw bytes (first 6 bytes = `SORNG\0`) for callers that have already
//  loaded the file.
// ══════════════════════════════════════════════════════════════════════

const MEDIA_ENC_SUFFIX: &str = ".enc";

fn media_enc_path(root: &Path, basename: &str) -> PathBuf {
    recordings_dir(root).join(format!("{}{}", basename, MEDIA_ENC_SUFFIX))
}

fn media_plain_path(root: &Path, basename: &str) -> PathBuf {
    recordings_dir(root).join(basename)
}

/// Magic-byte sniff for an in-memory media blob. Returns `true` iff the
/// buffer starts with the v2 envelope magic — the streaming codec
/// shares the same prefix as the whole-file envelope, so the kind byte
/// at offset 7 disambiguates further (chunked-stream = 2, whole-file
/// envelope = 0/1). For media paths we only need to know whether to
/// route through the streaming codec at all.
pub fn is_encrypted_media_blob(bytes: &[u8]) -> bool {
    bytes.len() >= 8
        && &bytes[..6] == sorng_encryption::envelope::MAGIC
        // kind byte: media streaming codec emits `2`. Whole-file
        // envelopes emit `0` (settings/recording_meta/macros) so we
        // don't accidentally pick those up here.
        && bytes[7] == 2
}

/// Save a media blob, picking the codec from the encryption state.
/// When unlocked → `<basename>.enc` (streaming AEAD, random-access
/// friendly). When locked → plain `<basename>` so an auto-lock mid-
/// recording can't break the active capture, matching the policy for
/// every other artifact in this module.
pub async fn save_media_blob_dispatched(
    root: &Path,
    basename: &str,
    bytes: &[u8],
    enc: &EncryptionState,
) -> RecordingResult<()> {
    let dir = recordings_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RecordingError::StorageError(format!("mkdir: {}", e)))?;

    if enc.is_unlocked().await {
        let blob = media_codec::write_one_shot(
            enc,
            bytes,
            MasterKeyStorage::Vault,
            None, // default 64 KiB chunks
        )
        .await
        .map_err(|e| RecordingError::StorageError(format!("encrypt media: {}", e)))?;
        let enc_path = media_enc_path(root, basename);
        durable_write(&enc_path, &blob)?;
        let plain = media_plain_path(root, basename);
        if plain.exists() {
            let _ = std::fs::remove_file(&plain);
        }
        Ok(())
    } else {
        let plain = media_plain_path(root, basename);
        durable_write(&plain, bytes)?;
        Ok(())
    }
}

/// Load the entire media blob, decrypting if the file is encrypted.
/// For playback paths that load the whole recording into memory
/// (typically GIFs and short clips); see
/// [`read_media_chunk_dispatched`] for seek-friendly access.
pub async fn load_media_blob_dispatched(
    root: &Path,
    basename: &str,
    enc: &EncryptionState,
) -> RecordingResult<Vec<u8>> {
    let enc_path = media_enc_path(root, basename);
    if enc_path.exists() {
        if !enc.is_unlocked().await {
            return Err(RecordingError::StorageError(
                "media is encrypted; unlock first".into(),
            ));
        }
        let bytes = std::fs::read(&enc_path).map_err(|e| {
            RecordingError::StorageError(format!("read {}: {}", enc_path.display(), e))
        })?;
        return media_codec::read_all(enc, &bytes)
            .await
            .map_err(|e| RecordingError::StorageError(format!("decrypt media: {}", e)));
    }
    let plain = media_plain_path(root, basename);
    std::fs::read(&plain)
        .map_err(|e| RecordingError::StorageError(format!("read {}: {}", plain.display(), e)))
}

/// Random-access read for a single 64 KiB chunk. The video player
/// computes `chunk_index = byte_offset / chunk_size` from its
/// requested timestamp and asks for that one chunk; no decryption work
/// is done on the chunks before or after. Falls back to "read whole
/// plaintext file then return the slice" when the file isn't
/// encrypted — keeps the contract symmetric so callers don't have to
/// branch on the file format.
pub async fn read_media_chunk_dispatched(
    root: &Path,
    basename: &str,
    chunk_index: u32,
    chunk_size_hint: usize,
    enc: &EncryptionState,
) -> RecordingResult<Vec<u8>> {
    let enc_path = media_enc_path(root, basename);
    if enc_path.exists() {
        if !enc.is_unlocked().await {
            return Err(RecordingError::StorageError(
                "media is encrypted; unlock first".into(),
            ));
        }
        let bytes = std::fs::read(&enc_path).map_err(|e| {
            RecordingError::StorageError(format!("read {}: {}", enc_path.display(), e))
        })?;
        return media_codec::read_chunk(enc, &bytes, chunk_index)
            .await
            .map_err(|e| RecordingError::StorageError(format!("decrypt chunk: {}", e)));
    }
    let plain = media_plain_path(root, basename);
    let all = std::fs::read(&plain)
        .map_err(|e| RecordingError::StorageError(format!("read {}: {}", plain.display(), e)))?;
    let start = (chunk_index as usize)
        .checked_mul(chunk_size_hint)
        .ok_or_else(|| RecordingError::StorageError("chunk index overflow".into()))?;
    if start >= all.len() {
        return Err(RecordingError::StorageError(format!(
            "chunk {} past end of plain media",
            chunk_index
        )));
    }
    let end = (start + chunk_size_hint).min(all.len());
    Ok(all[start..end].to_vec())
}

// ── Master-key rotation support ────────────────────────────────────────
//
// The orchestrator in `app/src/encryption_rotation_commands.rs` walks
// every encrypted file under the recordings root. These helpers list
// the file paths and re-encrypt each one in place under a freshly
// rotated DEK. They take two `EncryptionState` references — `from`
// to decrypt the existing ciphertext, `to` to produce the new — so
// the orchestrator can keep both keys live for the brief rotation
// window without temporarily swapping the live service state.

/// List every `*.json.enc` envelope under the recordings dir.
pub fn list_encrypted_envelope_paths(root: &Path) -> Vec<PathBuf> {
    let dir = recordings_dir(root);
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(ENC_SUFFIX) {
                    out.push(path);
                }
            }
        }
    }
    out
}

/// List every `*.json.enc` macro envelope under the macros dir.
pub fn list_encrypted_macro_paths(root: &Path) -> Vec<PathBuf> {
    let dir = macros_dir(root);
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(ENC_SUFFIX) {
                    out.push(path);
                }
            }
        }
    }
    out
}

/// List every media sidecar (`<id>.media.enc`) under the recordings
/// dir. The orchestrator re-encrypts each in place via
/// `rewrite_media_with`.
pub fn list_encrypted_media_paths(root: &Path) -> Vec<PathBuf> {
    let dir = recordings_dir(root);
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // Match the suffix used by `media_enc_path` —
                // `<basename>.enc` where basename typically carries
                // `.media`. Skip the metadata envelope (`.json.enc`).
                if name.ends_with(MEDIA_ENC_SUFFIX) && !name.ends_with(ENC_SUFFIX) {
                    out.push(path);
                }
            }
        }
    }
    out
}

/// Re-encrypt a recording metadata envelope in place under a new
/// master DEK. Returns the new on-disk byte count.
pub async fn rewrite_envelope_with(
    path: &Path,
    from: &EncryptionState,
    to: &EncryptionState,
) -> RecordingResult<u64> {
    let bytes = std::fs::read(path).map_err(|e| {
        RecordingError::StorageError(format!("read {}: {}", path.display(), e))
    })?;
    let value = meta_codec::read(from, &bytes)
        .await
        .map_err(|e| RecordingError::StorageError(format!("decrypt: {}", e)))?
        .unwrap_or_else(|| serde_json::json!({}));
    let blob = meta_codec::write(
        to,
        &value,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .map_err(|e| RecordingError::StorageError(format!("encrypt: {}", e)))?;
    atomic_write_path(path, &blob)?;
    Ok(blob.len() as u64)
}

/// Same as [`rewrite_envelope_with`] but for the macros directory.
pub async fn rewrite_macro_with(
    path: &Path,
    from: &EncryptionState,
    to: &EncryptionState,
) -> RecordingResult<u64> {
    let bytes = std::fs::read(path).map_err(|e| {
        RecordingError::StorageError(format!("read {}: {}", path.display(), e))
    })?;
    let value = macros_codec::read(from, &bytes)
        .await
        .map_err(|e| RecordingError::StorageError(format!("decrypt: {}", e)))?
        .unwrap_or_else(|| serde_json::json!({}));
    let blob = macros_codec::write(
        to,
        &value,
        MasterKeyStorage::Vault,
        Argon2Params::OWASP,
        [0u8; SALT_LEN],
    )
    .await
    .map_err(|e| RecordingError::StorageError(format!("encrypt: {}", e)))?;
    atomic_write_path(path, &blob)?;
    Ok(blob.len() as u64)
}

/// Re-encrypt a media sidecar (chunked-stream codec) under a new
/// master DEK. Read uses `read_all` to fully decrypt every chunk
/// under the old key, then `write_one_shot` re-emits the file under
/// the new key with a freshly randomised nonce prefix.
pub async fn rewrite_media_with(
    path: &Path,
    from: &EncryptionState,
    to: &EncryptionState,
) -> RecordingResult<u64> {
    let bytes = std::fs::read(path).map_err(|e| {
        RecordingError::StorageError(format!("read {}: {}", path.display(), e))
    })?;
    let plaintext = media_codec::read_all(from, &bytes)
        .await
        .map_err(|e| RecordingError::StorageError(format!("decrypt media: {}", e)))?;
    let blob = media_codec::write_one_shot(to, &plaintext, MasterKeyStorage::Vault, None)
        .await
        .map_err(|e| RecordingError::StorageError(format!("encrypt media: {}", e)))?;
    atomic_write_path(path, &blob)?;
    Ok(blob.len() as u64)
}

fn atomic_write_path(path: &Path, bytes: &[u8]) -> RecordingResult<()> {
    // Key-rotation rewrites the encrypted file in place; use the durable
    // writer so a crash mid-rotation can't leave a committed-but-unflushed
    // (truncated / garbage) envelope that the new DEK can't decrypt.
    durable_write(path, bytes)
}

/// Delete both encrypted + plaintext variants of a media blob.
pub fn delete_media_all_variants(root: &Path, basename: &str) -> RecordingResult<()> {
    let plain = media_plain_path(root, basename);
    let enc = media_enc_path(root, basename);
    if plain.exists() {
        std::fs::remove_file(&plain)
            .map_err(|e| RecordingError::StorageError(format!("delete plain media: {}", e)))?;
    }
    if enc.exists() {
        std::fs::remove_file(&enc)
            .map_err(|e| RecordingError::StorageError(format!("delete enc media: {}", e)))?;
    }
    Ok(())
}

/// Export a media buffer to an arbitrary path (used by the
/// `export-to-file` UI actions). When the encryption state is unlocked
/// and `wrap_with_encryption` is `true`, the exported file uses the v2
/// streaming codec — the consumer must round-trip back through
/// `read_exported_media` to decrypt. When the caller wants a portable
/// file (one that doesn't need this app's master key to decrypt), pass
/// `wrap_with_encryption = false` and the bytes land as-is.
pub async fn write_exported_media(
    path: &Path,
    bytes: &[u8],
    enc: Option<&EncryptionState>,
    wrap_with_encryption: bool,
) -> RecordingResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| RecordingError::StorageError(format!("mkdir export: {}", e)))?;
    }
    let payload = if wrap_with_encryption {
        let state = enc.ok_or_else(|| {
            RecordingError::StorageError(
                "wrap_with_encryption requested but no encryption state supplied".into(),
            )
        })?;
        if !state.is_unlocked().await {
            return Err(RecordingError::StorageError(
                "cannot export encrypted media while locked".into(),
            ));
        }
        media_codec::write_one_shot(state, bytes, MasterKeyStorage::Vault, None)
            .await
            .map_err(|e| RecordingError::StorageError(format!("encrypt export: {}", e)))?
    } else {
        bytes.to_vec()
    };
    std::fs::write(path, &payload)
        .map_err(|e| RecordingError::StorageError(format!("write export: {}", e)))
}

/// Inverse of [`write_exported_media`] — auto-detects whether the file
/// at `path` is encrypted (magic-byte sniff) and decrypts if so.
pub async fn read_exported_media(
    path: &Path,
    enc: Option<&EncryptionState>,
) -> RecordingResult<Vec<u8>> {
    let bytes = std::fs::read(path)
        .map_err(|e| RecordingError::StorageError(format!("read {}: {}", path.display(), e)))?;
    if is_encrypted_media_blob(&bytes) {
        let state = enc.ok_or_else(|| {
            RecordingError::StorageError(
                "media file is encrypted but no encryption state supplied".into(),
            )
        })?;
        return media_codec::read_all(state, &bytes)
            .await
            .map_err(|e| RecordingError::StorageError(format!("decrypt export: {}", e)));
    }
    Ok(bytes)
}

// ══════════════════════════════════════════════════════════════════════
//  In-flight crash-recovery snapshots (incremental durability)
// ──────────────────────────────────────────────────────────────────────
//  A live terminal recording buffers its entries in RAM and only persists
//  at stop (see `service.rs`). A crash / power-loss / hard-kill mid-session
//  would otherwise lose the ENTIRE recording, not just a truncated tail.
//
//  To bound that loss, the service periodically writes a full snapshot of
//  the in-progress recording here. Each snapshot is an INDEPENDENT AEAD
//  envelope produced by `meta_codec::write`, which uses a fresh random
//  nonce + salt per call — so overwriting the previous snapshot on each
//  flush never reuses a nonce and needs no manual nonce/chunk bookkeeping
//  (this is the deliberate scheme choice over appending to a shared-key
//  stream, which would require careful nonce sequencing). On the next boot
//  the service recovers any orphaned snapshot (a session that never
//  reached a clean stop) into the library, then clears it.
//
//  Snapshots live in `<root>/inflight/`, OUTSIDE `recordings/`, so the
//  library scanners (`load_all_envelopes*`) never pick them up.
// ══════════════════════════════════════════════════════════════════════

fn inflight_dir(root: &Path) -> PathBuf {
    root.join("inflight")
}

fn terminal_snapshot_path(root: &Path, id: &str) -> PathBuf {
    inflight_dir(root).join(format!("{}.snapshot", id))
}

/// Durably write a crash-recovery snapshot of an in-progress terminal
/// recording. `enc = Some(state)` writes an AEAD envelope (the state must
/// be unlocked); `enc = None` writes plaintext JSON and is only ever used
/// under the caller's explicit encrypt-at-rest opt-out, mirroring the
/// persist policy for every other artifact in this module.
pub async fn write_terminal_snapshot(
    root: &Path,
    recording: &TerminalRecording,
    enc: Option<&EncryptionState>,
) -> RecordingResult<()> {
    let dir = inflight_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| RecordingError::StorageError(format!("mkdir inflight: {}", e)))?;
    let path = terminal_snapshot_path(root, &recording.metadata.recording_id);

    let bytes = if let Some(state) = enc {
        let value = serde_json::to_value(recording)?;
        meta_codec::write(
            state,
            &value,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .map_err(|e| RecordingError::StorageError(format!("encrypt snapshot: {}", e)))?
    } else {
        serde_json::to_vec(recording)?
    };
    durable_write(&path, &bytes)
}

/// Read + decode a terminal snapshot. Returns `Ok(None)` when the file is
/// absent. An encrypted snapshot with `enc = None` (or a locked state)
/// surfaces an error so the caller can skip it and retry on a later
/// unlocked boot rather than dropping the data.
pub async fn read_terminal_snapshot(
    root: &Path,
    id: &str,
    enc: Option<&EncryptionState>,
) -> RecordingResult<Option<TerminalRecording>> {
    let path = terminal_snapshot_path(root, id);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(RecordingError::StorageError(format!(
                "read snapshot {}: {}",
                path.display(),
                e
            )))
        }
    };

    let is_envelope =
        bytes.len() >= 6 && &bytes[..6] == sorng_encryption::envelope::MAGIC;
    let value: serde_json::Value = if is_envelope {
        let state = enc.ok_or_else(|| {
            RecordingError::StorageError(
                "in-flight snapshot is encrypted; unlock first to recover it".into(),
            )
        })?;
        meta_codec::read(state, &bytes)
            .await
            .map_err(|e| RecordingError::StorageError(format!("decrypt snapshot: {}", e)))?
            .ok_or_else(|| RecordingError::StorageError("empty snapshot payload".into()))?
    } else {
        serde_json::from_slice(&bytes)?
    };
    let recording: TerminalRecording = serde_json::from_value(value)?;
    Ok(Some(recording))
}

/// List the recording ids that have an orphaned in-flight snapshot on
/// disk. An id here means a session that never reached a clean stop.
pub fn list_terminal_snapshots(root: &Path) -> Vec<String> {
    let dir = inflight_dir(root);
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if let Some(id) = name.strip_suffix(".snapshot") {
                    out.push(id.to_string());
                }
            }
        }
    }
    out
}

/// Remove a terminal snapshot. A missing file is not an error — the
/// caller treats clearing as best-effort.
pub fn clear_terminal_snapshot(root: &Path, id: &str) -> RecordingResult<()> {
    let path = terminal_snapshot_path(root, id);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(RecordingError::StorageError(format!(
            "clear snapshot {}: {}",
            path.display(),
            e
        ))),
    }
}

// ── Migration helpers ──────────────────────────────────────────────────

/// Stage tag for [`MigrationProgress::step`] — lets a Tauri event
/// stream distinguish the envelopes pass from the macros pass without
/// the reporter having to look at the basename.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationStage {
    Envelopes,
    Macros,
}

impl MigrationStage {
    pub fn as_str(self) -> &'static str {
        match self {
            MigrationStage::Envelopes => "envelopes",
            MigrationStage::Macros => "macros",
        }
    }
}

/// Reporter trait the migrators invoke as they walk the source dir.
/// A `NoopProgress` implementation is provided so the simple
/// `migrate_all_*_to_encrypted` entry points stay unchanged.
///
/// Cancellation semantics: `should_cancel` is polled before each
/// per-file unit of work. A `true` return aborts the loop after the
/// current file is committed (or skipped) — the migrator never
/// leaves a half-written sidecar or a missing archive on disk, so
/// cancellation produces a consistent partial state the user can
/// resume from by re-running the command.
pub trait MigrationProgress: Send + Sync {
    /// Called once with the total file count for the active stage.
    fn total(&self, _stage: MigrationStage, _count: usize) {}
    /// Called after each file is processed; `index` is 1-based,
    /// `total` mirrors the value handed to [`Self::total`]. `name` is
    /// the basename of the file just processed.
    fn step(
        &self,
        _stage: MigrationStage,
        _index: usize,
        _total: usize,
        _name: &str,
        _skipped: bool,
    ) {
    }
    /// Polled before each unit of work. Return `true` to abort.
    fn should_cancel(&self) -> bool {
        false
    }
}

/// No-op reporter — every default trait method applies.
pub struct NoopProgress;
impl MigrationProgress for NoopProgress {}

/// One-shot migration of all `<id>.json` envelopes under `<root>`'s
/// recordings dir to `<id>.json.enc`. Each source file is archived to
/// `<id>.json.v0.bak` before being deleted, mirroring the settings-
/// migration safety net. Returns `(migrated, skipped)` counts.
///
/// Thin wrapper around
/// [`migrate_all_envelopes_to_encrypted_with_progress`] using
/// [`NoopProgress`] so callers that don't care about progress
/// reporting stay one-line.
pub async fn migrate_all_envelopes_to_encrypted(
    root: &Path,
    enc: &EncryptionState,
) -> RecordingResult<(usize, usize)> {
    migrate_all_envelopes_to_encrypted_with_progress(root, enc, &NoopProgress).await
}

/// Progress-aware variant of
/// [`migrate_all_envelopes_to_encrypted`]. The reporter is called
/// `total` once with the file count, then `step` per file. A `true`
/// return from `should_cancel` aborts the loop after the current
/// file is committed.
pub async fn migrate_all_envelopes_to_encrypted_with_progress(
    root: &Path,
    enc: &EncryptionState,
    progress: &dyn MigrationProgress,
) -> RecordingResult<(usize, usize)> {
    if !enc.is_unlocked().await {
        return Err(RecordingError::StorageError(
            "cannot migrate while encryption is locked".into(),
        ));
    }
    let dir = recordings_dir(root);
    if !dir.exists() {
        progress.total(MigrationStage::Envelopes, 0);
        return Ok((0, 0));
    }
    // Two-pass: collect the candidate paths first so the reporter
    // gets a stable total count (and so we can short-circuit on an
    // early cancel without holding the readdir iterator open across
    // an `.await`).
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?
    {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.ends_with(".json") || name.ends_with(ENC_SUFFIX) {
            continue;
        }
        candidates.push(path);
    }
    let total = candidates.len();
    progress.total(MigrationStage::Envelopes, total);

    let mut migrated = 0usize;
    let mut skipped = 0usize;
    for (i, path) in candidates.into_iter().enumerate() {
        if progress.should_cancel() {
            break;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let json = match std::fs::read_to_string(&path) {
            Ok(j) => j,
            Err(_) => {
                skipped += 1;
                progress.step(MigrationStage::Envelopes, i + 1, total, &name, true);
                continue;
            }
        };
        let envelope: SavedRecordingEnvelope = match serde_json::from_str(&json) {
            Ok(env) => env,
            Err(_) => {
                skipped += 1;
                progress.step(MigrationStage::Envelopes, i + 1, total, &name, true);
                continue;
            }
        };
        // Archive the plaintext first so the sweep that
        // `save_envelope_dispatched` performs has nothing to remove and
        // the rollback file persists on disk.
        let bak = path.with_extension("json.v0.bak");
        let _ = std::fs::rename(&path, &bak);
        save_envelope_dispatched(root, &envelope, enc).await?;
        migrated += 1;
        progress.step(MigrationStage::Envelopes, i + 1, total, &name, false);
    }
    Ok((migrated, skipped))
}

/// Same for macros. Counts symmetric.
pub async fn migrate_all_macros_to_encrypted(
    root: &Path,
    enc: &EncryptionState,
) -> RecordingResult<(usize, usize)> {
    migrate_all_macros_to_encrypted_with_progress(root, enc, &NoopProgress).await
}

/// Progress-aware variant of [`migrate_all_macros_to_encrypted`]. See
/// the envelope-side documentation for the cancellation contract.
pub async fn migrate_all_macros_to_encrypted_with_progress(
    root: &Path,
    enc: &EncryptionState,
    progress: &dyn MigrationProgress,
) -> RecordingResult<(usize, usize)> {
    if !enc.is_unlocked().await {
        return Err(RecordingError::StorageError(
            "cannot migrate while encryption is locked".into(),
        ));
    }
    let dir = macros_dir(root);
    if !dir.exists() {
        progress.total(MigrationStage::Macros, 0);
        return Ok((0, 0));
    }
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?
    {
        let entry =
            entry.map_err(|e| RecordingError::StorageError(format!("readdir entry: {}", e)))?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.ends_with(".json") || name.ends_with(ENC_SUFFIX) {
            continue;
        }
        candidates.push(path);
    }
    let total = candidates.len();
    progress.total(MigrationStage::Macros, total);

    let mut migrated = 0usize;
    let mut skipped = 0usize;
    for (i, path) in candidates.into_iter().enumerate() {
        if progress.should_cancel() {
            break;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let json = match std::fs::read_to_string(&path) {
            Ok(j) => j,
            Err(_) => {
                skipped += 1;
                progress.step(MigrationStage::Macros, i + 1, total, &name, true);
                continue;
            }
        };
        let m: MacroRecording = match serde_json::from_str(&json) {
            Ok(m) => m,
            Err(_) => {
                skipped += 1;
                progress.step(MigrationStage::Macros, i + 1, total, &name, true);
                continue;
            }
        };
        let bak = path.with_extension("json.v0.bak");
        let _ = std::fs::rename(&path, &bak);
        save_macro_dispatched(root, &m, enc).await?;
        migrated += 1;
        progress.step(MigrationStage::Macros, i + 1, total, &name, false);
    }
    Ok((migrated, skipped))
}

#[cfg(test)]
mod enc_dispatch_tests {
    use super::*;
    use chrono::Utc;
    use sorng_encryption::{EncryptionState, MasterDek};
    use tempfile::tempdir;

    async fn unlocked() -> EncryptionState {
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&[7u8; 32]).unwrap()).await;
        s
    }

    fn fixture_envelope(id: &str) -> SavedRecordingEnvelope {
        SavedRecordingEnvelope {
            id: id.to_string(),
            name: format!("rec-{}", id),
            description: None,
            protocol: RecordingProtocol::Ssh,
            saved_at: Utc::now(),
            duration_ms: 0,
            size_bytes: 42,
            compression: CompressionAlgorithm::None,
            format: ExportFormat::Asciicast,
            tags: vec![],
            connection_id: None,
            connection_name: Some("test".to_string()),
            host: Some("example.com".to_string()),
            data: "fake-data".to_string(),
            media_blob_basename: None,
        }
    }

    fn fixture_macro(id: &str) -> MacroRecording {
        MacroRecording {
            id: id.to_string(),
            name: format!("macro-{}", id),
            description: None,
            category: None,
            steps: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
            tags: vec![],
            target_protocol: RecordingProtocol::Ssh,
        }
    }

    #[tokio::test]
    async fn dispatched_write_unlocked_produces_enc() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        let env = fixture_envelope("a");
        save_envelope_dispatched(tmp.path(), &env, &enc).await.unwrap();
        assert!(envelope_enc_path(tmp.path(), "a").exists());
        assert!(!envelope_plain_path(tmp.path(), "a").exists());
    }

    #[tokio::test]
    async fn dispatched_write_locked_falls_back_to_plaintext() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let locked = EncryptionState::new();
        let env = fixture_envelope("b");
        save_envelope_dispatched(tmp.path(), &env, &locked).await.unwrap();
        assert!(!envelope_enc_path(tmp.path(), "b").exists());
        assert!(envelope_plain_path(tmp.path(), "b").exists());
    }

    #[tokio::test]
    async fn enc_write_sweeps_stale_plaintext() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let env = fixture_envelope("c");
        save_envelope(tmp.path(), &env).unwrap();
        let enc = unlocked().await;
        save_envelope_dispatched(tmp.path(), &env, &enc).await.unwrap();
        assert!(envelope_enc_path(tmp.path(), "c").exists());
        assert!(!envelope_plain_path(tmp.path(), "c").exists());
    }

    #[tokio::test]
    async fn list_prefers_enc_over_plaintext_for_same_id() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        // Pre-plant a stale plaintext that should lose.
        let mut env = fixture_envelope("d");
        env.size_bytes = 1;
        save_envelope(tmp.path(), &env).unwrap();
        // Now write the canonical encrypted one with different size.
        env.size_bytes = 99;
        let enc = unlocked().await;
        // Write the encrypted variant directly without sweeping, to
        // simulate a transient migration window where both files exist.
        let blob = meta_codec::write(
            &enc,
            &serde_json::to_value(&env).unwrap(),
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        std::fs::write(envelope_enc_path(tmp.path(), "d"), &blob).unwrap();
        // Re-plant the plaintext (in case sweep would have removed it):
        save_envelope(tmp.path(), &{ let mut e = env.clone(); e.size_bytes = 1; e }).unwrap();

        let list = load_all_envelopes_dispatched(tmp.path(), &enc).await.unwrap();
        assert_eq!(list.len(), 1, "deduped to one entry");
        assert_eq!(list[0].id, "d");
        assert_eq!(list[0].size_bytes, 99, ".enc must win over .json");
    }

    #[tokio::test]
    async fn locked_state_skips_enc_in_listing() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let unlocked = unlocked().await;
        let env_a = fixture_envelope("a");
        let env_b = fixture_envelope("b");
        save_envelope_dispatched(tmp.path(), &env_a, &unlocked).await.unwrap();
        save_envelope(tmp.path(), &env_b).unwrap(); // remaining plaintext

        let locked = EncryptionState::new();
        let list = load_all_envelopes_dispatched(tmp.path(), &locked).await.unwrap();
        // Encrypted entry is skipped under locked state, plaintext survives.
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "b");
    }

    #[tokio::test]
    async fn delete_removes_both_variants() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let env = fixture_envelope("z");
        let enc = unlocked().await;
        save_envelope(tmp.path(), &env).unwrap();
        save_envelope_dispatched(tmp.path(), &env, &enc).await.unwrap();
        // Re-plant a plaintext that the sweep would have removed.
        save_envelope(tmp.path(), &env).unwrap();
        delete_envelope_all_variants(tmp.path(), "z").unwrap();
        assert!(!envelope_plain_path(tmp.path(), "z").exists());
        assert!(!envelope_enc_path(tmp.path(), "z").exists());
    }

    #[tokio::test]
    async fn migrate_envelopes_one_shot() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        for id in ["a", "b", "c"] {
            save_envelope(tmp.path(), &fixture_envelope(id)).unwrap();
        }
        let enc = unlocked().await;
        let (migrated, skipped) =
            migrate_all_envelopes_to_encrypted(tmp.path(), &enc).await.unwrap();
        assert_eq!(migrated, 3);
        assert_eq!(skipped, 0);
        for id in ["a", "b", "c"] {
            assert!(envelope_enc_path(tmp.path(), id).exists());
            assert!(!envelope_plain_path(tmp.path(), id).exists());
            assert!(tmp.path().join(format!("recordings/{}.json.v0.bak", id)).exists());
        }
        // Round-trip a single one through the dispatched read.
        let loaded = load_envelope_dispatched(tmp.path(), "b", &enc).await.unwrap();
        assert_eq!(loaded.id, "b");
    }

    #[tokio::test]
    async fn rewrite_envelope_with_re_encrypts_under_new_key() {
        // Phase A: snapshot + swap test for the recording-meta path.
        // Write an envelope under DEK A, install DEK B in a fresh
        // state, call `rewrite_envelope_with(A, B)` and confirm the
        // file is now readable only under B.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked().await;
        let env = fixture_envelope("rot1");
        save_envelope_dispatched(tmp.path(), &env, &state_a)
            .await
            .unwrap();
        let enc_path = envelope_enc_path(tmp.path(), "rot1");

        // Build state B with a DIFFERENT master key.
        let state_b = sorng_encryption::EncryptionState::new();
        state_b
            .install(sorng_encryption::MasterDek::from_bytes(&[9u8; 32]).unwrap())
            .await;

        // Pre-condition: state_b cannot decrypt the envelope yet.
        let pre = load_envelope_dispatched(tmp.path(), "rot1", &state_b).await;
        assert!(pre.is_err(), "wrong key must fail GCM auth");

        // Re-key the file in place.
        rewrite_envelope_with(&enc_path, &state_a, &state_b)
            .await
            .unwrap();

        // Post-condition: state_b can read; state_a now cannot.
        let post = load_envelope_dispatched(tmp.path(), "rot1", &state_b)
            .await
            .unwrap();
        assert_eq!(post.id, "rot1");
        let pre_now = load_envelope_dispatched(tmp.path(), "rot1", &state_a).await;
        assert!(pre_now.is_err(), "old key must no longer decrypt");
    }

    #[tokio::test]
    async fn rewrite_media_with_re_encrypts_chunked_stream() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked().await;
        let bytes = media_fixture(150_000);
        save_media_blob_dispatched(tmp.path(), "session.webm", &bytes, &state_a)
            .await
            .unwrap();
        let media_path = media_enc_path(tmp.path(), "session.webm");

        let state_b = sorng_encryption::EncryptionState::new();
        state_b
            .install(sorng_encryption::MasterDek::from_bytes(&[11u8; 32]).unwrap())
            .await;
        let pre = load_media_blob_dispatched(tmp.path(), "session.webm", &state_b).await;
        assert!(pre.is_err());

        rewrite_media_with(&media_path, &state_a, &state_b).await.unwrap();

        let post = load_media_blob_dispatched(tmp.path(), "session.webm", &state_b)
            .await
            .unwrap();
        assert_eq!(post.len(), bytes.len());
        assert_eq!(post[0], bytes[0]);
        assert_eq!(post[bytes.len() - 1], bytes[bytes.len() - 1]);
    }

    #[tokio::test]
    async fn rewrite_macro_with_re_encrypts_macro_envelope() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked().await;
        let m = fixture_macro("rotm");
        save_macro_dispatched(tmp.path(), &m, &state_a).await.unwrap();
        let macro_path = macro_enc_path(tmp.path(), "rotm");

        let state_b = sorng_encryption::EncryptionState::new();
        state_b
            .install(sorng_encryption::MasterDek::from_bytes(&[13u8; 32]).unwrap())
            .await;
        rewrite_macro_with(&macro_path, &state_a, &state_b).await.unwrap();

        let list = load_all_macros_dispatched(tmp.path(), &state_b).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "rotm");
    }

    #[tokio::test]
    async fn list_encrypted_paths_find_files() {
        // Compile-only check that the listing helpers can be called.
        // Behavioural coverage of file inclusion is implicit through
        // the rewrite_*_with tests above.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked().await;
        save_envelope_dispatched(tmp.path(), &fixture_envelope("e1"), &state_a)
            .await
            .unwrap();
        save_media_blob_dispatched(tmp.path(), "m1.webm", b"x", &state_a).await.unwrap();
        save_macro_dispatched(tmp.path(), &fixture_macro("mac1"), &state_a).await.unwrap();
        assert_eq!(list_encrypted_envelope_paths(tmp.path()).len(), 1);
        assert_eq!(list_encrypted_media_paths(tmp.path()).len(), 1);
        assert_eq!(list_encrypted_macro_paths(tmp.path()).len(), 1);
    }

    #[tokio::test]
    async fn macros_round_trip_dispatched() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        let m = fixture_macro("m1");
        save_macro_dispatched(tmp.path(), &m, &enc).await.unwrap();
        assert!(macro_enc_path(tmp.path(), "m1").exists());
        let list = load_all_macros_dispatched(tmp.path(), &enc).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "m1");
    }

    // ────────────────────────────────────────────────────────────────
    // Migration progress + cancellation
    // ────────────────────────────────────────────────────────────────

    /// Recording reporter for unit tests. Captures every event so the
    /// assertion order is independent of which stage ran first, and
    /// flips its cancel flag after a configurable number of `step`
    /// calls so the cancel path can be exercised deterministically.
    type MigrationEvent = (MigrationStage, usize, usize, String, bool);

    struct RecordingReporter {
        events: std::sync::Mutex<Vec<MigrationEvent>>,
        totals: std::sync::Mutex<Vec<(MigrationStage, usize)>>,
        cancel_after: std::sync::atomic::AtomicUsize,
        steps_seen: std::sync::atomic::AtomicUsize,
    }
    impl RecordingReporter {
        fn new(cancel_after: usize) -> Self {
            Self {
                events: std::sync::Mutex::new(Vec::new()),
                totals: std::sync::Mutex::new(Vec::new()),
                cancel_after: std::sync::atomic::AtomicUsize::new(cancel_after),
                steps_seen: std::sync::atomic::AtomicUsize::new(0),
            }
        }
    }
    impl MigrationProgress for RecordingReporter {
        fn total(&self, stage: MigrationStage, count: usize) {
            self.totals.lock().unwrap().push((stage, count));
        }
        fn step(
            &self,
            stage: MigrationStage,
            index: usize,
            total: usize,
            name: &str,
            skipped: bool,
        ) {
            self.events
                .lock()
                .unwrap()
                .push((stage, index, total, name.to_string(), skipped));
            self.steps_seen
                .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        }
        fn should_cancel(&self) -> bool {
            let threshold = self.cancel_after.load(std::sync::atomic::Ordering::Acquire);
            if threshold == usize::MAX {
                return false;
            }
            self.steps_seen.load(std::sync::atomic::Ordering::Acquire) >= threshold
        }
    }

    #[tokio::test]
    async fn migrate_progress_reports_total_and_each_step() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        for id in ["a", "b", "c", "d"] {
            save_envelope(tmp.path(), &fixture_envelope(id)).unwrap();
        }
        let enc = unlocked().await;
        let reporter = RecordingReporter::new(usize::MAX);
        let (migrated, skipped) = migrate_all_envelopes_to_encrypted_with_progress(
            tmp.path(),
            &enc,
            &reporter,
        )
        .await
        .unwrap();
        assert_eq!(migrated, 4);
        assert_eq!(skipped, 0);
        let totals = reporter.totals.lock().unwrap();
        assert_eq!(*totals, vec![(MigrationStage::Envelopes, 4)]);
        let events = reporter.events.lock().unwrap();
        assert_eq!(events.len(), 4, "one step per file");
        // Index must be monotonic and stop at `total`.
        for (i, e) in events.iter().enumerate() {
            assert_eq!(e.0, MigrationStage::Envelopes);
            assert_eq!(e.1, i + 1);
            assert_eq!(e.2, 4);
            assert!(!e.4);
        }
    }

    #[tokio::test]
    async fn migrate_progress_skips_unparseable_files() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        save_envelope(tmp.path(), &fixture_envelope("good")).unwrap();
        // Plant a garbage .json file the migrator must report as skipped.
        std::fs::write(
            recordings_dir(tmp.path()).join("bad.json"),
            b"this is not json",
        )
        .unwrap();
        let enc = unlocked().await;
        let reporter = RecordingReporter::new(usize::MAX);
        let (migrated, skipped) = migrate_all_envelopes_to_encrypted_with_progress(
            tmp.path(),
            &enc,
            &reporter,
        )
        .await
        .unwrap();
        assert_eq!(migrated, 1);
        assert_eq!(skipped, 1);
        let events = reporter.events.lock().unwrap();
        let bad = events.iter().find(|e| e.3 == "bad.json").unwrap();
        assert!(bad.4, "bad.json must be flagged as skipped");
    }

    #[tokio::test]
    async fn migrate_progress_honours_cancel() {
        // 5 envelopes, cancel after 2. The migrator must complete the
        // second file (no half-written sidecar) and skip 3-5.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        for id in ["a", "b", "c", "d", "e"] {
            save_envelope(tmp.path(), &fixture_envelope(id)).unwrap();
        }
        let enc = unlocked().await;
        let reporter = RecordingReporter::new(2);
        let (migrated, skipped) = migrate_all_envelopes_to_encrypted_with_progress(
            tmp.path(),
            &enc,
            &reporter,
        )
        .await
        .unwrap();
        // The first two files must be fully committed.
        assert_eq!(migrated, 2);
        assert_eq!(skipped, 0);
        // And no sidecar is half-written for the cancelled files —
        // a quick existence check on the .v0.bak archive of the
        // *uncommitted* ids proves the loop never started them.
        let remaining_plaintext = std::fs::read_dir(recordings_dir(tmp.path()))
            .unwrap()
            .filter_map(|e| {
                e.ok()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
            })
            .filter(|n| n.ends_with(".json") && !n.ends_with(ENC_SUFFIX))
            .count();
        // Three uncancelled .json files remain on disk untouched.
        assert_eq!(remaining_plaintext, 3);
    }

    #[tokio::test]
    async fn migrate_progress_empty_dir_emits_zero_total() {
        // Edge case: the source dir is missing entirely. The reporter
        // must still see a `total(_, 0)` event so the UI can render
        // "nothing to migrate" instead of spinning forever.
        let tmp = tempdir().unwrap();
        let enc = unlocked().await;
        let reporter = RecordingReporter::new(usize::MAX);
        let (m, s) = migrate_all_envelopes_to_encrypted_with_progress(
            tmp.path(),
            &enc,
            &reporter,
        )
        .await
        .unwrap();
        assert_eq!((m, s), (0, 0));
        let totals = reporter.totals.lock().unwrap();
        assert_eq!(*totals, vec![(MigrationStage::Envelopes, 0)]);
    }

    // ────────────────────────────────────────────────────────────────
    // Phase 2b — media blob dispatch (streaming AEAD)
    // ────────────────────────────────────────────────────────────────

    fn media_fixture(size: usize) -> Vec<u8> {
        // Non-trivial deterministic content so a skipped-encrypt bug
        // surfaces (all-zero buffers happen to look the same encrypted
        // or not at high enough levels of failure).
        (0..size).map(|i| ((i * 31 + 7) % 251) as u8).collect()
    }

    #[tokio::test]
    async fn media_write_unlocked_produces_enc() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        let bytes = media_fixture(150_000); // ~3 chunks under default 64 KiB
        save_media_blob_dispatched(tmp.path(), "session.webm", &bytes, &enc)
            .await
            .unwrap();
        assert!(media_enc_path(tmp.path(), "session.webm").exists());
        assert!(!media_plain_path(tmp.path(), "session.webm").exists());
    }

    #[tokio::test]
    async fn media_write_locked_falls_back_to_plaintext() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let locked = sorng_encryption::EncryptionState::new();
        let bytes = media_fixture(2048);
        save_media_blob_dispatched(tmp.path(), "session.gif", &bytes, &locked)
            .await
            .unwrap();
        assert!(media_plain_path(tmp.path(), "session.gif").exists());
        assert!(!media_enc_path(tmp.path(), "session.gif").exists());
    }

    #[tokio::test]
    async fn media_round_trip_full_payload() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        let bytes = media_fixture(500_000); // ~8 chunks
        save_media_blob_dispatched(tmp.path(), "a.mp4", &bytes, &enc)
            .await
            .unwrap();
        let recovered = load_media_blob_dispatched(tmp.path(), "a.mp4", &enc)
            .await
            .unwrap();
        assert_eq!(recovered.len(), bytes.len());
        // Sample three offsets so a failure message stays small.
        assert_eq!(recovered[0], bytes[0]);
        assert_eq!(recovered[123_456], bytes[123_456]);
        assert_eq!(recovered[bytes.len() - 1], bytes[bytes.len() - 1]);
    }

    #[tokio::test]
    async fn media_random_access_chunk() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        // Use a smaller payload but still spanning multiple chunks of
        // the default 64 KiB size.
        let bytes = media_fixture(64 * 1024 * 3 + 100);
        save_media_blob_dispatched(tmp.path(), "scrub.webm", &bytes, &enc)
            .await
            .unwrap();
        // Read chunk index 2 — corresponds to bytes 131072..196608.
        let chunk = read_media_chunk_dispatched(
            tmp.path(),
            "scrub.webm",
            2,
            64 * 1024,
            &enc,
        )
        .await
        .unwrap();
        assert_eq!(chunk.len(), 64 * 1024);
        let expected_start = 64 * 1024 * 2;
        assert_eq!(chunk[0], bytes[expected_start]);
        assert_eq!(chunk[100], bytes[expected_start + 100]);
    }

    #[tokio::test]
    async fn media_locked_read_blocks_enc() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        save_media_blob_dispatched(tmp.path(), "b.gif", &media_fixture(2000), &enc)
            .await
            .unwrap();
        let locked = sorng_encryption::EncryptionState::new();
        let err = load_media_blob_dispatched(tmp.path(), "b.gif", &locked)
            .await
            .unwrap_err();
        assert!(matches!(err, RecordingError::StorageError(_)));
    }

    #[tokio::test]
    async fn delete_media_removes_both_variants() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        let bytes = media_fixture(2048);
        // Pre-plant a plaintext that the encrypted save would normally sweep.
        std::fs::write(media_plain_path(tmp.path(), "c.webm"), &bytes).unwrap();
        save_media_blob_dispatched(tmp.path(), "c.webm", &bytes, &enc)
            .await
            .unwrap();
        // Re-plant the plaintext to simulate a stale post-migration file.
        std::fs::write(media_plain_path(tmp.path(), "c.webm"), &bytes).unwrap();
        delete_media_all_variants(tmp.path(), "c.webm").unwrap();
        assert!(!media_plain_path(tmp.path(), "c.webm").exists());
        assert!(!media_enc_path(tmp.path(), "c.webm").exists());
    }

    #[tokio::test]
    async fn export_roundtrip_through_disk() {
        // The user-facing `export-to-file` actions land here. When
        // `wrap_with_encryption=true`, the file is encrypted, and
        // `read_exported_media` magic-byte-sniffs to recover.
        let tmp = tempdir().unwrap();
        let enc = unlocked().await;
        let dest = tmp.path().join("export.mp4");
        let bytes = media_fixture(70_000);
        write_exported_media(&dest, &bytes, Some(&enc), true)
            .await
            .unwrap();
        let on_disk = std::fs::read(&dest).unwrap();
        assert!(is_encrypted_media_blob(&on_disk));
        let recovered = read_exported_media(&dest, Some(&enc)).await.unwrap();
        assert_eq!(recovered.len(), bytes.len());
        assert_eq!(recovered[0], bytes[0]);
    }

    #[tokio::test]
    async fn export_unwrapped_passthrough() {
        // `wrap_with_encryption=false` produces a portable file the
        // user can hand to another program without this app's key.
        let tmp = tempdir().unwrap();
        let dest = tmp.path().join("portable.webm");
        let bytes = media_fixture(4096);
        write_exported_media(&dest, &bytes, None, false).await.unwrap();
        let on_disk = std::fs::read(&dest).unwrap();
        assert_eq!(on_disk, bytes);
        assert!(!is_encrypted_media_blob(&on_disk));
        // `read_exported_media` returns it unchanged (no decryption).
        let recovered = read_exported_media(&dest, None).await.unwrap();
        assert_eq!(recovered, bytes);
    }

    #[tokio::test]
    async fn export_wrap_requires_state() {
        let tmp = tempdir().unwrap();
        let dest = tmp.path().join("oops.webm");
        let err = write_exported_media(&dest, b"x", None, true)
            .await
            .unwrap_err();
        assert!(matches!(err, RecordingError::StorageError(_)));
    }

    #[tokio::test]
    async fn export_wrap_blocked_when_locked() {
        let tmp = tempdir().unwrap();
        let dest = tmp.path().join("oops.webm");
        let locked = sorng_encryption::EncryptionState::new();
        let err = write_exported_media(&dest, b"x", Some(&locked), true)
            .await
            .unwrap_err();
        assert!(matches!(err, RecordingError::StorageError(_)));
    }

    // ────────────────────────────────────────────────────────────────
    // Layer B — filesystem error paths, leftover-file recovery, and
    //          vault eviction simulations (recording-meta + media).
    // ────────────────────────────────────────────────────────────────

    async fn unlocked_with_bytes(bytes: [u8; 32]) -> EncryptionState {
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&bytes).unwrap()).await;
        s
    }

    #[tokio::test]
    async fn missing_parent_dir_creates_or_errors_cleanly_recording() {
        // save_envelope_dispatched calls fs::create_dir_all(&dir) where
        // dir = <root>/recordings. As long as <root>'s parent exists,
        // the writer auto-creates the chain — verify behaviour with a
        // multi-level non-existent root.
        // Observed implementation behaviour: AUTO-MKDIR (recursive).
        let tmp = tempdir().unwrap();
        let nested_root = tmp.path().join("nonexistent/deep/path");
        assert!(!nested_root.exists());

        let enc = unlocked().await;
        let env = fixture_envelope("autocreate");
        let result = save_envelope_dispatched(&nested_root, &env, &enc).await;
        assert!(
            result.is_ok(),
            "writer should auto-mkdir, got: {result:?}"
        );
        // The recordings subdir now exists with the .enc file inside.
        assert!(nested_root.join("recordings").exists());
        assert!(envelope_enc_path(&nested_root, "autocreate").exists());
    }

    #[tokio::test]
    async fn garbage_canonical_file_surfaces_parse_error_on_load_recording() {
        // Plant 500 deterministic non-JSON bytes as <id>.json under
        // recordings/. Per contract, the listing silently SKIPS
        // malformed entries (warn-logged) rather than failing the
        // whole load. Verify empty list + no panic.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let garbage: Vec<u8> = (0..500u32).map(|i| ((i * 251 + 17) % 256) as u8).collect();
        std::fs::write(
            recordings_dir(tmp.path()).join("garbage.json"),
            &garbage,
        )
        .unwrap();

        let enc = unlocked().await;
        let list = load_all_envelopes_dispatched(tmp.path(), &enc).await.unwrap();
        assert_eq!(
            list.len(),
            0,
            "garbage .json must be silently skipped, not error"
        );
    }

    #[tokio::test]
    async fn load_against_missing_file_returns_none_recording() {
        // No recordings dir → empty list, per documented contract.
        let tmp = tempdir().unwrap();
        let enc = unlocked().await;
        let list = load_all_envelopes_dispatched(tmp.path(), &enc).await.unwrap();
        assert!(list.is_empty());

        // load_envelope_dispatched against a missing id surfaces an
        // error (no Ok(None) shape in this API).
        let result = load_envelope_dispatched(tmp.path(), "missing", &enc).await;
        assert!(result.is_err(), "missing id must surface as Err");
    }

    #[tokio::test]
    async fn leftover_tmp_file_does_not_block_next_write_recording() {
        // save_envelope_dispatched now routes through `durable_write`,
        // which uses its OWN dot-prefixed temp (`.<id>.json.enc.tmp`).
        // Plant stale non-dot leftovers (`<id>.json.enc.tmp` +
        // `<id>.json.enc.rotating`) from a pretend prior crash and verify
        // a normal write still succeeds and round-trips — the durable
        // writer neither collides with nor is blocked by them.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let enc = unlocked().await;
        let id = "leftover";
        let stale_tmp = recordings_dir(tmp.path()).join(format!("{}.json.enc.tmp", id));
        let stale_rotating = recordings_dir(tmp.path())
            .join(format!("{}.json.enc.rotating", id));
        std::fs::write(&stale_tmp, b"prior-crash artefact").unwrap();
        std::fs::write(&stale_rotating, b"prior-rotation artefact").unwrap();

        let env = fixture_envelope(id);
        save_envelope_dispatched(tmp.path(), &env, &enc).await.unwrap();

        // The canonical .enc file holds the new content.
        assert!(envelope_enc_path(tmp.path(), id).exists());
        // The round-trip read confirms it's the freshly written one.
        let loaded = load_envelope_dispatched(tmp.path(), id, &enc).await.unwrap();
        assert_eq!(loaded.id, id);
    }

    #[tokio::test]
    async fn wrong_master_dek_after_eviction_fails_cleanly_recording_meta() {
        // Save an envelope under state_a's DEK, evict state_a, install
        // state_b with DIFFERENT bytes. Listing must silently SKIP the
        // un-decryptable file (warn-logged), per the documented contract.
        // A direct `load_envelope_dispatched` must Err clean.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked_with_bytes([1u8; 32]).await;
        let env = fixture_envelope("evict-meta");
        save_envelope_dispatched(tmp.path(), &env, &state_a).await.unwrap();

        let state_b = unlocked_with_bytes([2u8; 32]).await;
        // load_envelope_dispatched surfaces the decrypt error.
        let result = load_envelope_dispatched(tmp.path(), "evict-meta", &state_b).await;
        assert!(result.is_err(), "wrong-key load must error, got: {result:?}");
        let err = result.unwrap_err();
        let msg = format!("{}", err).to_lowercase();
        assert!(
            msg.contains("decrypt")
                || msg.contains("auth")
                || msg.contains("unlock")
                || msg.contains("invalid"),
            "expected a clean decrypt error, got: {err}"
        );

        // The listing silently skips and returns an empty list.
        let list = load_all_envelopes_dispatched(tmp.path(), &state_b).await.unwrap();
        assert_eq!(
            list.len(),
            0,
            "list must silently skip un-decryptable .enc files"
        );
    }

    #[tokio::test]
    async fn right_master_dek_after_eviction_decodes_cleanly_recording_meta() {
        // state_b uses the SAME bytes — both direct load and listing
        // succeed and the envelope round-trips.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked_with_bytes([4u8; 32]).await;
        let env = fixture_envelope("evict-meta-ok");
        save_envelope_dispatched(tmp.path(), &env, &state_a).await.unwrap();

        let state_b = unlocked_with_bytes([4u8; 32]).await;
        let loaded = load_envelope_dispatched(tmp.path(), "evict-meta-ok", &state_b)
            .await
            .unwrap();
        assert_eq!(loaded.id, "evict-meta-ok");
        let list = load_all_envelopes_dispatched(tmp.path(), &state_b).await.unwrap();
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn wrong_master_dek_after_eviction_fails_cleanly_recording_media() {
        // Same scenario for the media blob path.
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked_with_bytes([6u8; 32]).await;
        let bytes = media_fixture(8_000);
        save_media_blob_dispatched(tmp.path(), "evict.webm", &bytes, &state_a)
            .await
            .unwrap();

        let state_b = unlocked_with_bytes([7u8; 32]).await;
        let result = load_media_blob_dispatched(tmp.path(), "evict.webm", &state_b).await;
        assert!(result.is_err(), "wrong-key media load must error");
        let err = result.unwrap_err();
        let msg = format!("{}", err).to_lowercase();
        assert!(
            msg.contains("decrypt")
                || msg.contains("auth")
                || msg.contains("unlock")
                || msg.contains("invalid"),
            "expected a clean decrypt error, got: {err}"
        );
    }

    #[tokio::test]
    async fn right_master_dek_after_eviction_decodes_cleanly_recording_media() {
        let tmp = tempdir().unwrap();
        ensure_dirs(tmp.path()).unwrap();
        let state_a = unlocked_with_bytes([8u8; 32]).await;
        let bytes = media_fixture(8_000);
        save_media_blob_dispatched(tmp.path(), "evict-ok.webm", &bytes, &state_a)
            .await
            .unwrap();

        let state_b = unlocked_with_bytes([8u8; 32]).await;
        let recovered = load_media_blob_dispatched(tmp.path(), "evict-ok.webm", &state_b)
            .await
            .unwrap();
        assert_eq!(recovered.len(), bytes.len());
        assert_eq!(recovered[0], bytes[0]);
        assert_eq!(recovered[bytes.len() - 1], bytes[bytes.len() - 1]);
    }

    #[tokio::test]
    async fn is_encrypted_media_blob_discriminates() {
        // The whole-file envelope codec emits kind=0 / 1; the media
        // codec emits kind=2. The sniff must only fire on kind=2.
        let bytes_short = vec![0u8; 4];
        assert!(!is_encrypted_media_blob(&bytes_short));

        let mut bytes_envelope = vec![0u8; 32];
        bytes_envelope[..6].copy_from_slice(sorng_encryption::envelope::MAGIC);
        bytes_envelope[6] = 2; // version
        bytes_envelope[7] = 0; // kind = envelope, NOT media
        assert!(!is_encrypted_media_blob(&bytes_envelope));

        let mut bytes_media = vec![0u8; 32];
        bytes_media[..6].copy_from_slice(sorng_encryption::envelope::MAGIC);
        bytes_media[6] = 2;
        bytes_media[7] = 2; // kind = chunked-stream
        assert!(is_encrypted_media_blob(&bytes_media));
    }
}
