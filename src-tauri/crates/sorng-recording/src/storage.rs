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

use sorng_encryption::artifacts::{macros as macros_codec, recording_meta as meta_codec};
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
        std::fs::write(&enc_path, &blob).map_err(|e| {
            RecordingError::StorageError(format!("write {}: {}", enc_path.display(), e))
        })?;
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
    out.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
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
        std::fs::write(&enc_path, &blob).map_err(|e| {
            RecordingError::StorageError(format!("write {}: {}", enc_path.display(), e))
        })?;
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
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
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

// ── Migration helpers ──────────────────────────────────────────────────

/// One-shot migration of all `<id>.json` envelopes under `<root>`'s
/// recordings dir to `<id>.json.enc`. Each source file is archived to
/// `<id>.json.v0.bak` before being deleted, mirroring the settings-
/// migration safety net. Returns `(migrated, skipped)` counts.
pub async fn migrate_all_envelopes_to_encrypted(
    root: &Path,
    enc: &EncryptionState,
) -> RecordingResult<(usize, usize)> {
    if !enc.is_unlocked().await {
        return Err(RecordingError::StorageError(
            "cannot migrate while encryption is locked".into(),
        ));
    }
    let dir = recordings_dir(root);
    if !dir.exists() {
        return Ok((0, 0));
    }
    let mut migrated = 0usize;
    let mut skipped = 0usize;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;
    for entry in entries {
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
        let json = match std::fs::read_to_string(&path) {
            Ok(j) => j,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let envelope: SavedRecordingEnvelope = match serde_json::from_str(&json) {
            Ok(env) => env,
            Err(_) => {
                skipped += 1;
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
    }
    Ok((migrated, skipped))
}

/// Same for macros. Counts symmetric.
pub async fn migrate_all_macros_to_encrypted(
    root: &Path,
    enc: &EncryptionState,
) -> RecordingResult<(usize, usize)> {
    if !enc.is_unlocked().await {
        return Err(RecordingError::StorageError(
            "cannot migrate while encryption is locked".into(),
        ));
    }
    let dir = macros_dir(root);
    if !dir.exists() {
        return Ok((0, 0));
    }
    let mut migrated = 0usize;
    let mut skipped = 0usize;
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| RecordingError::StorageError(format!("readdir: {}", e)))?;
    for entry in entries {
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
        let json = match std::fs::read_to_string(&path) {
            Ok(j) => j,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let m: MacroRecording = match serde_json::from_str(&json) {
            Ok(m) => m,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let bak = path.with_extension("json.v0.bak");
        let _ = std::fs::rename(&path, &bak);
        save_macro_dispatched(root, &m, enc).await?;
        migrated += 1;
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
}
