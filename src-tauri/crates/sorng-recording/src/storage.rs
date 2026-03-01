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
    std::fs::write(&path, json)
        .map_err(|e| RecordingError::StorageError(format!("write {}: {}", path.display(), e)))?;
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
    envelopes.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
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
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if std::fs::remove_file(&path).is_ok() {
                count += 1;
            }
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
    for entry in entries {
        if let Ok(entry) = entry {
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
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
    std::fs::write(&path, json)
        .map_err(|e| RecordingError::StorageError(format!("write: {}", e)))?;
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
    macros.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
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
    std::fs::write(&path, json)
        .map_err(|e| RecordingError::StorageError(format!("write config: {}", e)))?;
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
                if env.saved_at < cutoff {
                    if std::fs::remove_file(&path).is_ok() {
                        deleted += 1;
                    }
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
    envelopes.sort_by(|a, b| a.saved_at.cmp(&b.saved_at));

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
