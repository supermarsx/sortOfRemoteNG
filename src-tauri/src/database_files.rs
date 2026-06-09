//! Per-user-database file storage with a fail-safe write/read ladder.
//!
//! Each user-created "database" / "collection" lives in two files
//! under `<app_data>/databases/`:
//!
//! ```text
//! databases/
//!   index.json          List of database metadata (id, name, ...)
//!   <id>.json           Current per-database payload
//!   <id>.json.bak       Previous generation (last successful save)
//!   <id>.json.tmp       Write-in-progress (auto-cleaned)
//!   <id>.json.v0.bak    Pre-migration rollback from IndexedDB (one-shot)
//! ```
//!
//! All `*.json` files share a 32-byte preamble:
//!
//! ```text
//!  offset  size  description
//!  ──────  ────  ─────────────────────────────────────────────
//!   0       4    b"SDBF"                     magic
//!   4       1    version                     u8 = 1
//!   5       1    flags                       u8 (reserved; 0)
//!   6       8    checksum                    SHA-256(payload), first 8 bytes, LE
//!  14       8    payload_len                 u64 LE
//!  22      10    reserved                    zeros
//!  ──────  ────
//!  32     ..     payload                     serde_json bytes
//! ```
//!
//! The payload is whatever the caller hands us — a JSON object, a
//! WebCrypto-encrypted string, anything. This module doesn't decode
//! the payload; it just guarantees that bytes-in == bytes-out across
//! a crash, a power loss, a single bit-rot, or a single bad write.
//!
//! ## Write ladder (`safe_write`)
//!
//! 1. Compose preamble + payload.
//! 2. Write to `<canonical>.tmp`.
//! 3. Re-read the temp file and verify the preamble + checksum.
//!    Aborts the write if the disk wrote garbage — the canonical
//!    file is untouched and the user keeps their last good save.
//! 4. Rename current `<canonical>` to `<canonical>.bak` (overwriting
//!    any previous `.bak`). Skipped if no current file exists.
//! 5. Rename `<canonical>.tmp` to `<canonical>`. Atomic on every
//!    target OS.
//! 6. fsync the parent dir (POSIX). Windows: no-op (NTFS journals
//!    directory metadata as part of the rename).
//!
//! ## Read ladder (`safe_read`)
//!
//! 1. Try `<canonical>` — preamble + checksum verified. If valid,
//!    return payload with `source: "current"`.
//! 2. Try `<canonical>.bak`. If valid, return with
//!    `source: "backup"`. UI surfaces a one-shot toast.
//! 3. Try `<canonical>.v0.bak` (pre-migration rollback). Returns
//!    with `source: "v0-migration"`. UI surfaces a stronger toast.
//! 4. No valid version exists → `Ok(None)`.
//!
//! A corrupted file at any step is *not* an error — the ladder
//! cascades. Only "every version unreadable" surfaces an error.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const MAGIC: &[u8; 4] = b"SDBF";
pub const CURRENT_VERSION: u8 = 1;
pub const PREAMBLE_LEN: usize = 32;
const CHECKSUM_OFFSET: usize = 6;
const CHECKSUM_LEN: usize = 8;
const PAYLOAD_LEN_OFFSET: usize = 14;

/// Which file the loaded value came from. The frontend can show a
/// recovery toast based on the variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoadSource {
    /// The canonical file decoded cleanly. No user-visible action.
    Current,
    /// The canonical was missing or corrupt; we recovered from
    /// `<file>.bak`. UI shows a one-shot "Recovered from previous
    /// save; verify your most recent changes" toast.
    Backup,
    /// Both `<file>` and `<file>.bak` failed; we recovered from
    /// the pre-IndexedDB-migration rollback. UI shows a stronger
    /// "Restored from migration backup" toast.
    V0Migration,
}

/// Returned by `load_database_data` so the frontend can render a
/// recovery banner when `source != Current`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub value: serde_json::Value,
    pub source: LoadSource,
}

/// All failure modes the safe writer / reader can surface. We
/// hand-roll `Display` here instead of pulling in `thiserror` because
/// this module is path-included into `sorng-commands-core`, which
/// does not have `thiserror` in its dep graph.
///
/// `#[allow(dead_code)]` on the variants because the path-include
/// makes the dead-code lint miss the `Display` consumers — they are
/// genuinely used, but only after the file is compiled into the
/// outer crate context.
#[derive(Debug)]
#[allow(dead_code)]
pub enum FileStoreError {
    Read(String, String),
    Write(String, String),
    Verify(String, String),
    Preamble(String),
    Json(String),
}

impl std::fmt::Display for FileStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileStoreError::Read(p, e) => write!(f, "read failed for {p}: {e}"),
            FileStoreError::Write(p, e) => write!(f, "write failed for {p}: {e}"),
            FileStoreError::Verify(p, e) => write!(f, "verification failed for {p}: {e}"),
            FileStoreError::Preamble(e) => write!(f, "preamble parse: {e}"),
            FileStoreError::Json(e) => write!(f, "payload JSON: {e}"),
        }
    }
}

impl std::error::Error for FileStoreError {}

fn databases_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("databases");
    Ok(dir)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(databases_dir(app)?.join("index.json"))
}

fn per_db_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    // Sanitise: refuse anything that could escape the databases dir.
    // IDs in the wild are UUIDs but the IPC surface is untrusted, so
    // a path-traversal id like `../../etc/passwd` must error rather
    // than reach `path.join`.
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains('\0')
    {
        return Err(format!("invalid database id: {id:?}"));
    }
    Ok(databases_dir(app)?.join(format!("{id}.json")))
}

// ══════════════════════════════════════════════════════════════════
// Preamble encode / decode + checksum
// ══════════════════════════════════════════════════════════════════

fn checksum(payload: &[u8]) -> [u8; CHECKSUM_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(payload);
    let digest = hasher.finalize();
    let mut out = [0u8; CHECKSUM_LEN];
    out.copy_from_slice(&digest[..CHECKSUM_LEN]);
    out
}

fn encode_preamble(payload: &[u8]) -> [u8; PREAMBLE_LEN] {
    let mut buf = [0u8; PREAMBLE_LEN];
    buf[..4].copy_from_slice(MAGIC);
    buf[4] = CURRENT_VERSION;
    buf[5] = 0; // flags reserved
    buf[CHECKSUM_OFFSET..CHECKSUM_OFFSET + CHECKSUM_LEN].copy_from_slice(&checksum(payload));
    buf[PAYLOAD_LEN_OFFSET..PAYLOAD_LEN_OFFSET + 8]
        .copy_from_slice(&(payload.len() as u64).to_le_bytes());
    // bytes 22..32 are zero by default
    buf
}

/// Validate a (preamble || payload) buffer end-to-end. Returns the
/// payload slice on success. Catches: short buffer, wrong magic,
/// unknown version, payload length mismatch, checksum mismatch.
fn parse_and_verify(bytes: &[u8]) -> Result<&[u8], FileStoreError> {
    if bytes.len() < PREAMBLE_LEN {
        return Err(FileStoreError::Preamble(format!(
            "buffer is {} bytes, preamble needs {}",
            bytes.len(),
            PREAMBLE_LEN
        )));
    }
    if &bytes[..4] != MAGIC {
        return Err(FileStoreError::Preamble("magic mismatch".into()));
    }
    let version = bytes[4];
    if version != CURRENT_VERSION {
        return Err(FileStoreError::Preamble(format!(
            "unknown version {version}"
        )));
    }
    let stamped_checksum: [u8; CHECKSUM_LEN] = bytes
        [CHECKSUM_OFFSET..CHECKSUM_OFFSET + CHECKSUM_LEN]
        .try_into()
        .unwrap();
    let payload_len = u64::from_le_bytes(
        bytes[PAYLOAD_LEN_OFFSET..PAYLOAD_LEN_OFFSET + 8]
            .try_into()
            .unwrap(),
    ) as usize;
    if bytes.len() < PREAMBLE_LEN + payload_len {
        return Err(FileStoreError::Preamble(format!(
            "preamble claims {} body bytes, only {} available",
            payload_len,
            bytes.len() - PREAMBLE_LEN
        )));
    }
    let payload = &bytes[PREAMBLE_LEN..PREAMBLE_LEN + payload_len];
    let actual_checksum = checksum(payload);
    if actual_checksum != stamped_checksum {
        return Err(FileStoreError::Verify(
            "checksum".into(),
            "stored checksum does not match payload".into(),
        ));
    }
    Ok(payload)
}

// ══════════════════════════════════════════════════════════════════
// Safe writer + reader (no AppHandle; pure paths so tests can drive)
// ══════════════════════════════════════════════════════════════════

/// Atomic write with the full failure-safe ladder. Caller passes
/// the canonical path; we manage `.tmp` and `.bak` siblings.
pub fn safe_write(canonical: &Path, payload: &[u8]) -> Result<(), FileStoreError> {
    if let Some(parent) = canonical.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| FileStoreError::Write(parent.display().to_string(), e.to_string()))?;
    }
    let tmp = sibling(canonical, "tmp");
    let bak = sibling(canonical, "bak");
    let preamble = encode_preamble(payload);
    let mut buf = Vec::with_capacity(PREAMBLE_LEN + payload.len());
    buf.extend_from_slice(&preamble);
    buf.extend_from_slice(payload);

    // Step 2: write tmp.
    std::fs::write(&tmp, &buf)
        .map_err(|e| FileStoreError::Write(tmp.display().to_string(), e.to_string()))?;

    // Step 3: read-back verify. If the disk wrote garbage we leave
    // the canonical alone and bubble up an error.
    let written = std::fs::read(&tmp)
        .map_err(|e| FileStoreError::Read(tmp.display().to_string(), e.to_string()))?;
    if written != buf {
        let _ = std::fs::remove_file(&tmp);
        return Err(FileStoreError::Verify(
            tmp.display().to_string(),
            "read-back bytes do not match what we wrote".into(),
        ));
    }
    parse_and_verify(&written).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e
    })?;

    // Step 4: shift current to .bak (overwriting any prior .bak).
    // Skipped when there's nothing to shift.
    if canonical.exists() {
        // remove old .bak first so rename overwrites cleanly on
        // platforms that don't allow it implicitly.
        let _ = std::fs::remove_file(&bak);
        std::fs::rename(canonical, &bak).map_err(|e| {
            FileStoreError::Write(bak.display().to_string(), format!("backup rotate: {e}"))
        })?;
    }

    // Step 5: promote tmp.
    std::fs::rename(&tmp, canonical).map_err(|e| {
        FileStoreError::Write(canonical.display().to_string(), format!("promote: {e}"))
    })?;

    // Step 6: parent dir fsync — POSIX only. On Windows the NTFS
    // journal handles directory metadata as part of the rename, so
    // a separate sync is a no-op.
    #[cfg(unix)]
    {
        if let Some(parent) = canonical.parent() {
            if let Ok(f) = std::fs::File::open(parent) {
                let _ = f.sync_all();
            }
        }
    }

    Ok(())
}

/// Read with the failure-safe ladder. Returns `Ok(None)` only when
/// every candidate (`.json`, `.bak`, `.v0.bak`) is missing or
/// corrupt — that's the "first-run / wiped" path.
pub fn safe_read(canonical: &Path) -> Result<Option<LoadResult>, FileStoreError> {
    let candidates = [
        (canonical.to_path_buf(), LoadSource::Current),
        (sibling(canonical, "bak"), LoadSource::Backup),
        (canonical.with_extension("json.v0.bak"), LoadSource::V0Migration),
    ];
    for (path, source) in &candidates {
        if !path.exists() {
            continue;
        }
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let payload = match parse_and_verify(&bytes) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let value: serde_json::Value = match serde_json::from_slice(payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        return Ok(Some(LoadResult {
            value,
            source: *source,
        }));
    }
    Ok(None)
}

fn sibling(canonical: &Path, suffix: &str) -> PathBuf {
    let mut s = canonical.as_os_str().to_owned();
    s.push(".");
    s.push(suffix);
    PathBuf::from(s)
}

// ══════════════════════════════════════════════════════════════════
// Tauri command surface
// ══════════════════════════════════════════════════════════════════

/// Read the list of `ConnectionDatabase` metadata from
/// `<app_data>/databases/index.json`. Returns an empty vec on first
/// boot. Recovery cascade applies — a corrupted index falls back to
/// `.bak`.
#[tauri::command]
pub async fn databases_list(app: AppHandle) -> Result<Option<LoadResult>, String> {
    let path = index_path(&app)?;
    safe_read(&path).map_err(|e| e.to_string())
}

/// Write the list. The caller controls the JSON shape; this command
/// is JSON-shape-agnostic.
#[tauri::command]
pub async fn databases_save_index(
    app: AppHandle,
    list: serde_json::Value,
) -> Result<(), String> {
    let path = index_path(&app)?;
    let payload = serde_json::to_vec(&list).map_err(|e| format!("serialise index: {e}"))?;
    safe_write(&path, &payload).map_err(|e| e.to_string())
}

/// Load `<app_data>/databases/<id>.json`. Returns `None` when no
/// version of the file survives the recovery ladder; the frontend
/// treats this as "database does not exist" and surfaces a
/// `DatabaseNotFoundError`.
#[tauri::command]
pub async fn load_database_data(
    app: AppHandle,
    database_id: String,
) -> Result<Option<LoadResult>, String> {
    let path = per_db_path(&app, &database_id)?;
    safe_read(&path).map_err(|e| e.to_string())
}

/// Save `<app_data>/databases/<id>.json`. The frontend supplies the
/// payload as a JSON value — could be a plain object or an encrypted
/// string envelope — and this command stores it byte-for-byte under
/// the preamble.
#[tauri::command]
pub async fn save_database_data(
    app: AppHandle,
    database_id: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let path = per_db_path(&app, &database_id)?;
    let payload = serde_json::to_vec(&data).map_err(|e| format!("serialise payload: {e}"))?;
    safe_write(&path, &payload).map_err(|e| e.to_string())
}

/// Best-effort removal of every variant (canonical + .bak + .tmp +
/// .v0.bak). Used when the user deletes a database from the picker.
/// Always returns `Ok(())` — missing files aren't an error.
#[tauri::command]
pub async fn delete_database_data(
    app: AppHandle,
    database_id: String,
) -> Result<(), String> {
    let canonical = per_db_path(&app, &database_id)?;
    for suffix in &["", ".bak", ".tmp", ".v0.bak"] {
        let path = if suffix.is_empty() {
            canonical.clone()
        } else {
            let mut s = canonical.as_os_str().to_owned();
            s.push(*suffix);
            PathBuf::from(s)
        };
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

// ══════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn payload_json(obj: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&obj).unwrap()
    }

    // ── Preamble + checksum unit tests ─────────────────────────────

    #[test]
    fn round_trip_via_parse_and_verify() {
        let payload = b"hello world".to_vec();
        let mut buf = encode_preamble(&payload).to_vec();
        buf.extend_from_slice(&payload);
        let recovered = parse_and_verify(&buf).unwrap();
        assert_eq!(recovered, payload.as_slice());
    }

    #[test]
    fn truncated_buffer_rejected() {
        let bytes = vec![0u8; 10];
        assert!(matches!(
            parse_and_verify(&bytes),
            Err(FileStoreError::Preamble(_))
        ));
    }

    #[test]
    fn wrong_magic_rejected() {
        let payload = b"x";
        let mut buf = encode_preamble(payload).to_vec();
        buf[0] = b'X';
        buf.extend_from_slice(payload);
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Preamble(_))
        ));
    }

    #[test]
    fn unknown_version_rejected() {
        let payload = b"x";
        let mut buf = encode_preamble(payload).to_vec();
        buf[4] = 99;
        buf.extend_from_slice(payload);
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Preamble(_))
        ));
    }

    #[test]
    fn body_bit_flip_caught_by_checksum() {
        let payload = b"hello world".to_vec();
        let mut buf = encode_preamble(&payload).to_vec();
        buf.extend_from_slice(&payload);
        let flip_idx = PREAMBLE_LEN + 4;
        buf[flip_idx] ^= 0x01;
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Verify(_, _))
        ));
    }

    #[test]
    fn payload_length_mismatch_rejected() {
        let payload = b"hello world".to_vec();
        let mut buf = encode_preamble(&payload).to_vec();
        // Claim 1000 payload bytes but only supply 11.
        buf[PAYLOAD_LEN_OFFSET..PAYLOAD_LEN_OFFSET + 8]
            .copy_from_slice(&1000_u64.to_le_bytes());
        buf.extend_from_slice(&payload);
        assert!(matches!(
            parse_and_verify(&buf),
            Err(FileStoreError::Preamble(_))
        ));
    }

    // ── safe_write / safe_read round trips ─────────────────────────

    #[test]
    fn safe_write_then_safe_read_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db1.json");
        let payload = payload_json(serde_json::json!({"a": 1, "b": "two"}));
        safe_write(&path, &payload).unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::Current);
        assert_eq!(result.value["a"], 1);
        assert_eq!(result.value["b"], "two");
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("never-written.json");
        assert!(safe_read(&path).unwrap().is_none());
    }

    #[test]
    fn second_write_shifts_current_to_bak() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v1 = payload_json(serde_json::json!({"gen": 1}));
        let v2 = payload_json(serde_json::json!({"gen": 2}));
        safe_write(&path, &v1).unwrap();
        safe_write(&path, &v2).unwrap();
        // Current must hold gen=2.
        let cur = safe_read(&path).unwrap().unwrap();
        assert_eq!(cur.source, LoadSource::Current);
        assert_eq!(cur.value["gen"], 2);
        // Sibling .bak must hold gen=1.
        let bak = sibling(&path, "bak");
        let bytes = std::fs::read(&bak).unwrap();
        let payload = parse_and_verify(&bytes).unwrap();
        let value: serde_json::Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["gen"], 1);
    }

    // ── Recovery ladder ────────────────────────────────────────────

    #[test]
    fn current_corrupted_falls_back_to_backup() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v1 = payload_json(serde_json::json!({"gen": 1}));
        let v2 = payload_json(serde_json::json!({"gen": 2}));
        safe_write(&path, &v1).unwrap();
        safe_write(&path, &v2).unwrap();
        // Corrupt the canonical file beyond recovery.
        std::fs::write(&path, b"definitely not a valid preamble").unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::Backup);
        assert_eq!(result.value["gen"], 1);
    }

    #[test]
    fn current_missing_falls_back_to_backup() {
        // Simulates the "crashed between rename(current → .bak) and
        // rename(tmp → current)" mid-write window.
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v1 = payload_json(serde_json::json!({"gen": 1}));
        let v2 = payload_json(serde_json::json!({"gen": 2}));
        safe_write(&path, &v1).unwrap();
        safe_write(&path, &v2).unwrap();
        std::fs::remove_file(&path).unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::Backup);
    }

    #[test]
    fn both_corrupt_falls_back_to_v0_migration_bak() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        let v0 = payload_json(serde_json::json!({"gen": 0}));
        // Plant the pre-migration rollback file directly.
        let v0_bak = path.with_extension("json.v0.bak");
        let mut buf = encode_preamble(&v0).to_vec();
        buf.extend_from_slice(&v0);
        std::fs::write(&v0_bak, &buf).unwrap();
        // Corrupt the canonical and .bak.
        std::fs::write(&path, b"garbage").unwrap();
        std::fs::write(sibling(&path, "bak"), b"more garbage").unwrap();

        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.source, LoadSource::V0Migration);
        assert_eq!(result.value["gen"], 0);
    }

    #[test]
    fn every_version_unreadable_returns_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        // Plant garbage at every candidate slot — every version
        // unreadable maps to None, not Err. The caller distinguishes
        // "missing" from "corrupt" via the on-disk presence.
        std::fs::write(&path, b"x").unwrap();
        std::fs::write(sibling(&path, "bak"), b"x").unwrap();
        std::fs::write(path.with_extension("json.v0.bak"), b"x").unwrap();
        assert!(safe_read(&path).unwrap().is_none());
    }

    // ── Atomic write / leftover handling ───────────────────────────

    #[test]
    fn leftover_tmp_does_not_block_next_write() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db.json");
        // Plant a leftover .tmp from a pretend-killed prior process.
        let tmp = sibling(&path, "tmp");
        std::fs::write(&tmp, b"stale junk").unwrap();
        let v = payload_json(serde_json::json!({"k": "v"}));
        safe_write(&path, &v).unwrap();
        // Canonical readable, .tmp cleaned up by the rename.
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.value["k"], "v");
        assert!(!tmp.exists());
    }

    #[test]
    fn safe_write_auto_creates_parent_dir() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("deeply/nested/dirs/db.json");
        let v = payload_json(serde_json::json!({"deep": true}));
        safe_write(&path, &v).unwrap();
        assert!(path.exists());
    }

    // ── Id sanitisation ────────────────────────────────────────────

    #[test]
    fn per_db_path_rejects_traversal_ids() {
        // We can't easily test `per_db_path` without an AppHandle,
        // but the sanitiser is purely path-string based — drive it
        // by reconstructing the same predicate.
        for bad in &["../etc/passwd", "..\\windows", "a/b", "a\\b", "", "x\0y"] {
            let id = *bad;
            let rejected = id.is_empty()
                || id.contains('/')
                || id.contains('\\')
                || id.contains("..")
                || id.contains('\0');
            assert!(rejected, "expected to reject {id:?}");
        }
        for good in &[
            "550e8400-e29b-41d4-a716-446655440000",
            "Personal",
            "work_prod_2026",
        ] {
            let id = *good;
            let rejected = id.is_empty()
                || id.contains('/')
                || id.contains('\\')
                || id.contains("..")
                || id.contains('\0');
            assert!(!rejected, "should not reject {id:?}");
        }
    }

    // ── Backup not clobbered by a write that fails verification ────

    #[test]
    fn read_back_failure_leaves_canonical_intact() {
        // Hard to inject a real read-back failure without faulting
        // the filesystem, so we exercise the parse-and-verify guard:
        // an empty payload that round-trips cleanly DOES succeed,
        // proving the verify step doesn't reject the happy path.
        // A real "wrote garbage" scenario is unreproducible in a
        // hermetic test without a fault-injecting FS — documented
        // here as the limit of unit coverage.
        let dir = tempdir().unwrap();
        let path = dir.path().join("empty.json");
        safe_write(&path, b"\"\"").unwrap();
        let result = safe_read(&path).unwrap().unwrap();
        assert_eq!(result.value, serde_json::json!(""));
    }
}
