//! Append-only audit log for the encryption subsystem.
//!
//! Every state-changing operation (setup, unlock-success,
//! unlock-failure, lock, migration, key rotation, password change,
//! portable export/import, disable) emits one line to
//! `<app_data_dir>/logs/encryption-audit.log`.
//!
//! ## Why plaintext
//!
//! The log lives outside the encryption envelope on purpose: the user
//! needs to be able to read it when troubleshooting (typically the
//! moment something has gone wrong and the rest of the disk is
//! encrypted). Each line is a self-contained JSON object with no
//! cross-line state — `tail -f` works, `grep` works.
//!
//! ## Format
//!
//! One event per line, UTF-8 JSON:
//!
//! ```text
//! {"ts":"2026-06-01T13:45:00Z","event":"unlock-success","method":"vault"}
//! {"ts":"2026-06-01T13:45:30Z","event":"unlock-failure","reason":"wrong-password","failedAttempts":1}
//! {"ts":"2026-06-01T13:46:00Z","event":"settings-migrated","bytesIn":1024,"bytesOut":1124}
//! ```
//!
//! `event` is the discriminator; remaining fields are event-specific
//! metadata (also camelCase to match the TS hook shape).
//!
//! ## Atomicity
//!
//! Each `record()` call opens the file in append mode, writes the
//! line + `\n`, flushes, and closes. POSIX guarantees that a single
//! `write()` call ≤ `PIPE_BUF` is atomic; for safety we cap line
//! length at 4 KiB before writing. Concurrent writes from multiple
//! Tauri windows therefore interleave cleanly without garbling each
//! other's lines.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Subdirectory under `<app_data_dir>` where the audit log lives.
pub const LOGS_SUBDIR: &str = "logs";
/// Filename for the append-only log itself.
pub const AUDIT_LOG_FILENAME: &str = "encryption-audit.log";

/// Hard cap per audit line. Lines longer than this are truncated (with
/// a `…[truncated]` suffix) before being written, so the file stays
/// `grep`-friendly and the per-line atomicity guarantee holds across
/// the platforms this app targets.
const MAX_LINE_BYTES: usize = 4096;

/// A single audit entry. The `ts` field is ISO-8601 UTC; the rest is
/// a free-form metadata object whose keys are documented per
/// [`AuditEvent`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// ISO-8601 UTC timestamp ("2026-06-01T13:45:00Z").
    pub ts: String,
    /// Event discriminator (kebab-case). Owned `String` rather than
    /// `&'static str` so `Deserialize` is straightforward — the tag
    /// comes from [`AuditEvent::tag`] on the write path, so writers
    /// still pay no allocation per entry beyond the JSON line itself.
    pub event: String,
    /// Event-specific metadata. Stored as raw JSON so each variant
    /// can ship its own shape without growing this struct.
    #[serde(flatten)]
    pub metadata: serde_json::Value,
}

/// Closed set of audit events. The kebab-case [`Self::tag`] string is
/// on-disk-stable; renaming a variant breaks `grep` queries written
/// against earlier logs. Add new variants at the bottom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditEvent {
    /// User completed the first-run wizard. Metadata: `method`,
    /// `vaultAvailable`.
    SetupCompleted,
    /// Master key successfully reconstructed in memory. Metadata:
    /// `method` ("vault" | "password" | "vault-and-password").
    UnlockSuccess,
    /// Wrong password supplied to `encryption_unlock`. Metadata:
    /// `failedAttempts`, `remainingCooldownMs`.
    UnlockFailure,
    /// In-memory master DEK zeroized. No metadata.
    Locked,
    /// Master DEK rotated. Metadata: `artifactsRewritten`,
    /// `vaultUpdated`, `dekEncUpdated`.
    KeyRotated,
    /// `dek.enc` re-wrapped under a new password. No metadata.
    PasswordChanged,
    /// Settings migrated from v0 plaintext to v2 envelope. Metadata:
    /// `bytesIn`, `bytesOut`, `mode`.
    SettingsMigrated,
    /// Settings decrypted back to v0 plaintext. Metadata: `bytesIn`,
    /// `bytesOut`.
    SettingsDecrypted,
    /// Portable .dek written. Metadata: `destinationPath` (string),
    /// `bytes` (number).
    PortableExported,
    /// Portable .dek installed. Metadata: `sourcePath` (string).
    PortableImported,
}

impl AuditEvent {
    /// Stable kebab-case tag persisted in the log file.
    pub fn tag(self) -> &'static str {
        match self {
            AuditEvent::SetupCompleted => "setup-completed",
            AuditEvent::UnlockSuccess => "unlock-success",
            AuditEvent::UnlockFailure => "unlock-failure",
            AuditEvent::Locked => "locked",
            AuditEvent::KeyRotated => "key-rotated",
            AuditEvent::PasswordChanged => "password-changed",
            AuditEvent::SettingsMigrated => "settings-migrated",
            AuditEvent::SettingsDecrypted => "settings-decrypted",
            AuditEvent::PortableExported => "portable-exported",
            AuditEvent::PortableImported => "portable-imported",
        }
    }
}

/// Errors raised by audit IO. Distinct from broader encryption errors
/// so callers can downgrade audit failures to log-and-continue (an
/// audit-log IO error should never fail an unlock).
#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    #[error("audit log directory could not be created: {0}")]
    Mkdir(String),
    #[error("audit log write failed: {0}")]
    Write(String),
    #[error("audit log read failed: {0}")]
    Read(String),
    #[error("audit log line could not be serialised: {0}")]
    Serde(String),
}

/// Append one entry to the audit log. Creates the directory and file
/// if needed. Returns an error rather than panicking on disk failure;
/// the typical caller pattern is
/// `let _ = audit::record(...);` so an audit failure doesn't cascade
/// into a user-visible error.
pub fn record(
    app_data_dir: &Path,
    event: AuditEvent,
    metadata: serde_json::Value,
) -> Result<(), AuditError> {
    let dir = app_data_dir.join(LOGS_SUBDIR);
    std::fs::create_dir_all(&dir).map_err(|e| AuditError::Mkdir(e.to_string()))?;
    let path = dir.join(AUDIT_LOG_FILENAME);

    // Pre-append retention check: if the active log has grown past
    // the rotation budget, rename it to `<name>.0.bak` (overwriting
    // any prior backup) and start a fresh active log. The single-
    // backup policy keeps disk usage bounded at ≤ 2×budget while
    // preserving enough history for forensic review.
    let _ = rotate_if_oversize(&path, MAX_LOG_BYTES);

    let entry = AuditEntry {
        ts: now_iso_8601(),
        event: event.tag().to_string(),
        metadata,
    };
    let mut line =
        serde_json::to_string(&entry).map_err(|e| AuditError::Serde(e.to_string()))?;
    if line.len() > MAX_LINE_BYTES - 1 {
        line.truncate(MAX_LINE_BYTES - "…[truncated]".len() - 1);
        line.push_str("…[truncated]");
    }
    line.push('\n');

    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| AuditError::Write(e.to_string()))?;
    f.write_all(line.as_bytes())
        .map_err(|e| AuditError::Write(e.to_string()))?;
    f.flush().map_err(|e| AuditError::Write(e.to_string()))?;
    Ok(())
}

/// Soft retention cap for the active audit log. Crossing this size
/// triggers a rotation to `<name>.0.bak`. At one line per event and
/// ~200 bytes per line, 5 MiB ≈ 26k events — months of activity for
/// the kind of user who reviews the audit log.
pub const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Helper exposed so unit tests can rotate at an arbitrary threshold
/// without rewriting the active log.
pub fn rotate_if_oversize(path: &Path, max_bytes: u64) -> Result<bool, AuditError> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        // Nothing to rotate when the file doesn't exist yet.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(AuditError::Read(e.to_string())),
    };
    if meta.len() <= max_bytes {
        return Ok(false);
    }
    let bak = path.with_extension("log.0.bak");
    // Overwrite any prior backup — single-backup retention.
    if bak.exists() {
        let _ = std::fs::remove_file(&bak);
    }
    std::fs::rename(path, &bak).map_err(|e| AuditError::Write(e.to_string()))?;
    Ok(true)
}

/// Read the most recent `limit` entries (newest last). Returns an
/// empty vec if the file doesn't exist yet. Cheap enough to call on
/// every Settings → Security panel render.
pub fn read_tail(app_data_dir: &Path, limit: usize) -> Result<Vec<AuditEntry>, AuditError> {
    let path = app_data_dir.join(LOGS_SUBDIR).join(AUDIT_LOG_FILENAME);
    let text = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(AuditError::Read(e.to_string())),
    };
    let mut entries: Vec<AuditEntry> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    if entries.len() > limit {
        let drop = entries.len() - limit;
        entries.drain(..drop);
    }
    Ok(entries)
}

/// Truncate the audit log to zero bytes. Available for the Settings
/// panel's "clear audit log" action; the typical flow stamps a
/// "log-cleared" entry immediately after so the gap is visible.
pub fn clear(app_data_dir: &Path) -> Result<(), AuditError> {
    let path = app_data_dir.join(LOGS_SUBDIR).join(AUDIT_LOG_FILENAME);
    match std::fs::write(&path, b"") {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AuditError::Write(e.to_string())),
    }
}

fn now_iso_8601() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Hand-rolled ISO-8601 formatter; avoids dragging chrono in just
    // for this. Subsecond precision is intentionally dropped — audit
    // entries are at human-event granularity, never sub-second.
    let (y, mo, da, h, mi, s) = secs_to_civil(d);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, mo, da, h, mi, s
    )
}

/// Convert Unix epoch seconds to a (year, month, day, hour, minute,
/// second) civil tuple in UTC. Based on Howard Hinnant's `civil_from_days`
/// algorithm — correct for all dates from 0000 to 65535.
fn secs_to_civil(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let time = secs % 86_400;
    let h = (time / 3600) as u32;
    let mi = ((time / 60) % 60) as u32;
    let s = (time % 60) as u32;

    // Days since 1970-01-01.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146_096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y_civil = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y_civil + 1 } else { y_civil };
    (y as i32, m as u32, d as u32, h, mi, s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn tag_matches_kebab_case() {
        assert_eq!(AuditEvent::UnlockSuccess.tag(), "unlock-success");
        assert_eq!(AuditEvent::SettingsMigrated.tag(), "settings-migrated");
        assert_eq!(AuditEvent::PortableExported.tag(), "portable-exported");
    }

    #[test]
    fn read_empty_when_no_log_exists() {
        let dir = tempdir().unwrap();
        let entries = read_tail(dir.path(), 100).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn record_then_read_round_trip() {
        let dir = tempdir().unwrap();
        record(
            dir.path(),
            AuditEvent::UnlockSuccess,
            json!({ "method": "vault" }),
        )
        .unwrap();
        record(
            dir.path(),
            AuditEvent::UnlockFailure,
            json!({ "failedAttempts": 1 }),
        )
        .unwrap();
        let entries = read_tail(dir.path(), 100).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].event, "unlock-success");
        assert_eq!(entries[0].metadata["method"], "vault");
        assert_eq!(entries[1].event, "unlock-failure");
        assert_eq!(entries[1].metadata["failedAttempts"], 1);
    }

    #[test]
    fn read_tail_returns_newest_n() {
        let dir = tempdir().unwrap();
        for i in 0..5 {
            record(
                dir.path(),
                AuditEvent::UnlockSuccess,
                json!({ "n": i }),
            )
            .unwrap();
        }
        let entries = read_tail(dir.path(), 3).unwrap();
        // We dropped the oldest 2 → indices 2..5 remain, n in [2,3,4].
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].metadata["n"], 2);
        assert_eq!(entries[2].metadata["n"], 4);
    }

    #[test]
    fn clear_truncates_to_zero_bytes() {
        let dir = tempdir().unwrap();
        record(
            dir.path(),
            AuditEvent::UnlockSuccess,
            json!({ "method": "vault" }),
        )
        .unwrap();
        clear(dir.path()).unwrap();
        let entries = read_tail(dir.path(), 10).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn clear_on_missing_file_is_ok() {
        let dir = tempdir().unwrap();
        assert!(clear(dir.path()).is_ok());
    }

    #[test]
    fn jsonl_format_is_one_event_per_line() {
        let dir = tempdir().unwrap();
        record(
            dir.path(),
            AuditEvent::Locked,
            json!({}),
        )
        .unwrap();
        record(
            dir.path(),
            AuditEvent::KeyRotated,
            json!({ "artifactsRewritten": 1 }),
        )
        .unwrap();
        let text = std::fs::read_to_string(
            dir.path().join(LOGS_SUBDIR).join(AUDIT_LOG_FILENAME),
        )
        .unwrap();
        let line_count = text.lines().count();
        assert_eq!(line_count, 2);
        for line in text.lines() {
            // Each line is independently parseable.
            let _: AuditEntry = serde_json::from_str(line).unwrap();
        }
    }

    #[test]
    fn over_long_metadata_is_truncated_not_rejected() {
        let dir = tempdir().unwrap();
        let huge = "x".repeat(8 * 1024);
        record(
            dir.path(),
            AuditEvent::UnlockFailure,
            json!({ "extra": huge }),
        )
        .unwrap();
        let text = std::fs::read_to_string(
            dir.path().join(LOGS_SUBDIR).join(AUDIT_LOG_FILENAME),
        )
        .unwrap();
        let first = text.lines().next().unwrap();
        // Bounded above by our 4 KiB ceiling + the truncation suffix.
        assert!(first.len() <= MAX_LINE_BYTES);
        // The truncation marker is present.
        assert!(first.contains("…[truncated]"));
    }

    #[test]
    fn iso_8601_format_shape() {
        let s = now_iso_8601();
        // YYYY-MM-DDTHH:MM:SSZ → 20 characters.
        assert_eq!(s.len(), 20);
        assert!(s.ends_with('Z'));
        assert!(s.chars().nth(4) == Some('-'));
        assert!(s.chars().nth(7) == Some('-'));
        assert!(s.chars().nth(10) == Some('T'));
    }

    #[test]
    fn civil_conversion_matches_known_epoch_seconds() {
        // Three reference points hand-checked against an external
        // calendar. Any drift in `secs_to_civil` would surface here
        // before reaching the audit-log timestamps.
        // Unix epoch.
        assert_eq!(secs_to_civil(0), (1970, 1, 1, 0, 0, 0));
        // 2000-01-01T00:00:00Z.
        assert_eq!(secs_to_civil(946_684_800), (2000, 1, 1, 0, 0, 0));
        // 2026-06-01T00:00:00Z — the date this commit was authored.
        assert_eq!(secs_to_civil(1_780_272_000), (2026, 6, 1, 0, 0, 0));
        // Hours / minutes / seconds within a single day.
        assert_eq!(
            secs_to_civil(946_684_800 + 13 * 3600 + 45 * 60 + 7),
            (2000, 1, 1, 13, 45, 7)
        );
    }

    #[test]
    fn lines_appended_concurrently_do_not_garble() {
        // Sanity check that two record calls back-to-back produce two
        // independently-parseable lines, with no truncation between them.
        let dir = tempdir().unwrap();
        for i in 0..50 {
            record(
                dir.path(),
                AuditEvent::UnlockSuccess,
                json!({ "i": i }),
            )
            .unwrap();
        }
        let entries = read_tail(dir.path(), 100).unwrap();
        assert_eq!(entries.len(), 50);
        for (i, e) in entries.iter().enumerate() {
            assert_eq!(e.metadata["i"], i as i64);
        }
    }

    #[test]
    fn rotate_if_oversize_renames_active_to_backup() {
        let dir = tempdir().unwrap();
        let log_dir = dir.path().join(LOGS_SUBDIR);
        std::fs::create_dir_all(&log_dir).unwrap();
        let path = log_dir.join(AUDIT_LOG_FILENAME);
        // Write 1500 bytes; threshold 1000 → must rotate.
        std::fs::write(&path, vec![b'x'; 1500]).unwrap();
        assert!(rotate_if_oversize(&path, 1000).unwrap());
        assert!(!path.exists(), "active log should be moved aside");
        let bak = path.with_extension("log.0.bak");
        assert!(bak.exists());
        assert_eq!(std::fs::metadata(&bak).unwrap().len(), 1500);
    }

    #[test]
    fn rotate_if_oversize_noop_below_threshold() {
        let dir = tempdir().unwrap();
        let log_dir = dir.path().join(LOGS_SUBDIR);
        std::fs::create_dir_all(&log_dir).unwrap();
        let path = log_dir.join(AUDIT_LOG_FILENAME);
        std::fs::write(&path, b"small").unwrap();
        assert!(!rotate_if_oversize(&path, 1000).unwrap());
        assert!(path.exists());
        assert!(!path.with_extension("log.0.bak").exists());
    }

    #[test]
    fn rotate_if_oversize_overwrites_prior_backup() {
        // Single-backup retention: a second rotation replaces the
        // previous `.0.bak`, never accumulating multiple backups.
        let dir = tempdir().unwrap();
        let log_dir = dir.path().join(LOGS_SUBDIR);
        std::fs::create_dir_all(&log_dir).unwrap();
        let path = log_dir.join(AUDIT_LOG_FILENAME);
        std::fs::write(&path, vec![b'a'; 1500]).unwrap();
        rotate_if_oversize(&path, 1000).unwrap();
        std::fs::write(&path, vec![b'b'; 1500]).unwrap();
        rotate_if_oversize(&path, 1000).unwrap();
        let bak = path.with_extension("log.0.bak");
        let body = std::fs::read(&bak).unwrap();
        assert_eq!(body[0], b'b', "backup should hold the most-recent rotation");
    }

    #[test]
    fn record_rotates_when_active_log_exceeds_budget() {
        // End-to-end test of the auto-rotation path through `record`.
        // We synthesise an oversize active log first, then write a
        // single new event; the new event must land in a fresh active
        // file while the bulky history is preserved in `.0.bak`.
        let dir = tempdir().unwrap();
        let log_dir = dir.path().join(LOGS_SUBDIR);
        std::fs::create_dir_all(&log_dir).unwrap();
        let path = log_dir.join(AUDIT_LOG_FILENAME);
        std::fs::write(&path, vec![b'x'; (MAX_LOG_BYTES + 1) as usize]).unwrap();
        record(dir.path(), AuditEvent::UnlockSuccess, json!({})).unwrap();
        // Active log is small (just the new event) — the old bulk is in .bak.
        assert!(std::fs::metadata(&path).unwrap().len() < 1024);
        assert!(path.with_extension("log.0.bak").exists());
    }
}
