//! SDBF — the fail-safe write/read ladder shared by every per-database
//! file (`databases/<id>.json`, `databases/index.json`, and — via t62 —
//! `databases/<id>.trust.json`).
//!
//! Extracted verbatim from `src-tauri/src/database_files.rs` so the
//! trust store can use the same codec; `database_files.rs` re-exports
//! everything here, so its behaviour and tests are unchanged.
//!
//! ```text
//! <canonical>          Current payload
//! <canonical>.bak      Previous generation (last successful save)
//! <canonical>.tmp      Write-in-progress (auto-cleaned)
//! <stem>.json.v0.bak   Pre-migration rollback (one-shot)
//! ```
//!
//! All files share a 32-byte preamble:
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
//!  32     ..     payload                     opaque bytes
//! ```
//!
//! The payload is whatever the caller hands us — a JSON object, a
//! WebCrypto-encrypted string, a SORNG envelope, anything. This module
//! doesn't decode the payload; it just guarantees that bytes-in ==
//! bytes-out across a crash, a power loss, a single bit-rot, or a
//! single bad write.
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
//! ## Read ladder (`safe_read` / `safe_read_raw`)
//!
//! 1. Try `<canonical>` — preamble + checksum verified. If valid,
//!    return payload with `source: "current"`.
//! 2. Try `<canonical>.bak`. If valid, return with
//!    `source: "backup"`. UI surfaces a one-shot toast.
//! 3. Try `<stem>.json.v0.bak` (pre-migration rollback). Returns
//!    with `source: "v0-migration"`. UI surfaces a stronger toast.
//! 4. No valid version exists → `Ok(None)`.
//!
//! A corrupted file at any step is *not* an error — the ladder
//! cascades. Only "every version unreadable" surfaces an error.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const MAGIC: &[u8; 4] = b"SDBF";
pub const CURRENT_VERSION: u8 = 1;
pub const PREAMBLE_LEN: usize = 32;
pub const CHECKSUM_OFFSET: usize = 6;
pub const CHECKSUM_LEN: usize = 8;
pub const PAYLOAD_LEN_OFFSET: usize = 14;

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

/// All failure modes the safe writer / reader can surface. `Display`
/// is hand-rolled (no `thiserror`) so the historical path-include of
/// `database_files.rs` into `sorng-commands-core` keeps compiling.
#[derive(Debug)]
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

// ══════════════════════════════════════════════════════════════════
// Preamble encode / decode + checksum
// ══════════════════════════════════════════════════════════════════

pub fn checksum(payload: &[u8]) -> [u8; CHECKSUM_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(payload);
    let digest = hasher.finalize();
    let mut out = [0u8; CHECKSUM_LEN];
    out.copy_from_slice(&digest[..CHECKSUM_LEN]);
    out
}

pub fn encode_preamble(payload: &[u8]) -> [u8; PREAMBLE_LEN] {
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
pub fn parse_and_verify(bytes: &[u8]) -> Result<&[u8], FileStoreError> {
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
// Safe writer + reader (pure paths so tests can drive)
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
    parse_and_verify(&written).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
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

/// Lower-level read: walks the same recovery ladder as `safe_read`
/// but returns the verified payload BYTES + source instead of parsing
/// them as JSON. Used by the P4 encrypted path — an envelope blob is
/// not valid JSON, so the JSON-parsing step in `safe_read` would
/// false-reject a valid encrypted file.
pub fn safe_read_raw(canonical: &Path) -> Result<Option<(Vec<u8>, LoadSource)>, FileStoreError> {
    let candidates = [
        (canonical.to_path_buf(), LoadSource::Current),
        (sibling(canonical, "bak"), LoadSource::Backup),
        (
            canonical.with_extension("json.v0.bak"),
            LoadSource::V0Migration,
        ),
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
        return Ok(Some((payload.to_vec(), *source)));
    }
    Ok(None)
}

/// Read with the failure-safe ladder. Returns `Ok(None)` only when
/// every candidate (`.json`, `.bak`, `.v0.bak`) is missing or
/// corrupt — that's the "first-run / wiped" path.
pub fn safe_read(canonical: &Path) -> Result<Option<LoadResult>, FileStoreError> {
    let candidates = [
        (canonical.to_path_buf(), LoadSource::Current),
        (sibling(canonical, "bak"), LoadSource::Backup),
        (
            canonical.with_extension("json.v0.bak"),
            LoadSource::V0Migration,
        ),
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

/// `<canonical>.<suffix>` — appends to the full file name, so
/// `db.json` + `bak` → `db.json.bak` (not `db.bak`).
pub fn sibling(canonical: &Path, suffix: &str) -> PathBuf {
    let mut s = canonical.as_os_str().to_owned();
    s.push(".");
    s.push(suffix);
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Round-trip through the extracted codec, then prove the `.bak`
    /// fallback still works from the new location — including for a
    /// non-`.json` canonical name like the trust store will use.
    #[test]
    fn round_trip_and_bak_fallback_from_new_location() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("db1.trust.json");
        let v1 = serde_json::to_vec(&serde_json::json!({"gen": 1})).unwrap();
        let v2 = serde_json::to_vec(&serde_json::json!({"gen": 2})).unwrap();

        safe_write(&path, &v1).unwrap();
        let (raw, source) = safe_read_raw(&path).unwrap().unwrap();
        assert_eq!(source, LoadSource::Current);
        assert_eq!(raw, v1);

        safe_write(&path, &v2).unwrap();
        let cur = safe_read(&path).unwrap().unwrap();
        assert_eq!(cur.source, LoadSource::Current);
        assert_eq!(cur.value["gen"], 2);
        assert!(sibling(&path, "bak").exists());
        assert!(!sibling(&path, "tmp").exists());

        // Corrupt the canonical → ladder must recover gen 1 from .bak.
        std::fs::write(&path, b"definitely not a valid preamble").unwrap();
        let recovered = safe_read(&path).unwrap().unwrap();
        assert_eq!(recovered.source, LoadSource::Backup);
        assert_eq!(recovered.value["gen"], 1);

        // Preamble sanity: magic + checksum survive the trip.
        let bytes = std::fs::read(sibling(&path, "bak")).unwrap();
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(parse_and_verify(&bytes).unwrap(), v1.as_slice());
    }
}
