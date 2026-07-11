//! Durable atomic file writes.
//!
//! The classic "write temp + rename" pattern is *atomic* (a reader sees
//! either the whole old file or the whole new file) but not *durable*: on
//! a crash or power-loss the filesystem can commit the rename (the
//! directory entry now points at the new inode) while the new file's data
//! blocks were never flushed, leaving a zero-length / garbage target with
//! the previous good content already gone.
//!
//! [`durable_write`] closes that window the same way `database_files.rs`
//! does: `sync_all()` the temp file handle *before* the rename, then
//! fsync the parent directory *after* it (POSIX; a no-op on Windows,
//! where NTFS journals the directory metadata as part of the rename).
//!
//! It also folds in the t21 resilience the settings writer already had —
//! a bounded retry with a per-attempt `create_dir_all` self-heal — so a
//! transient failure (AV momentarily locking the temp, the app-data dir
//! vanishing mid-session, a temp sweep racing the rename) is ridden out
//! rather than surfaced as a bare `os error 2` and a lost write.

use std::io::Write;
use std::path::{Path, PathBuf};

/// Attempts before giving up. Rides out transient AV locks / a
/// momentarily-vanished parent dir / a swept temp.
const MAX_ATTEMPTS: u32 = 3;
/// Base linear back-off between attempts (10ms, 20ms). Only ever paid on
/// the failure path.
const BACKOFF: std::time::Duration = std::time::Duration::from_millis(10);

/// Per-target temp sibling: `<dir>/.<name>.tmp`. Lives in the same
/// directory as the target so the final `rename` stays on one filesystem
/// and is atomic, and is name-derived so two concurrent writers to
/// different targets in the same dir don't clobber each other's in-flight
/// bytes.
fn temp_sibling(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sorng-store".to_string());
    let tmp_name = format!(".{file_name}.tmp");
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join(tmp_name),
        _ => PathBuf::from(tmp_name),
    }
}

fn write_and_sync(tmp: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = std::fs::File::create(tmp)?;
    f.write_all(bytes)?;
    // Flush the data + file metadata to stable storage BEFORE the rename.
    // This is the barrier that turns an atomic write into a durable one.
    f.sync_all()?;
    Ok(())
}

/// fsync the directory holding `path` so the rename itself is durable.
/// POSIX-only — on Windows the NTFS journal handles directory metadata
/// as part of the rename, and opening a directory as a file to fsync it
/// isn't supported, so this is a graceful no-op.
#[cfg(unix)]
fn sync_parent_dir(path: &Path) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_path: &Path) {}

/// Write `bytes` to `path` atomically *and* durably, with a bounded retry
/// and per-attempt parent-dir self-heal.
///
/// On success the bytes are guaranteed flushed to stable storage and the
/// rename is durable (POSIX). On final failure the error is
/// path-prefixed so it's diagnosable instead of a context-free OS error.
pub fn durable_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_sibling(path);
    let mut last_err: Option<String> = None;

    for attempt in 0..MAX_ATTEMPTS {
        // Self-heal a missing parent every attempt: the dir may have been
        // deleted between a previous attempt and this one, or never
        // existed (a relocated known-folder).
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    last_err = Some(e.to_string());
                    sleep_backoff(attempt);
                    continue;
                }
            }
        }

        if let Err(e) = write_and_sync(&tmp, bytes) {
            last_err = Some(e.to_string());
            let _ = std::fs::remove_file(&tmp);
            sleep_backoff(attempt);
            continue;
        }

        match std::fs::rename(&tmp, path) {
            Ok(()) => {
                sync_parent_dir(path);
                return Ok(());
            }
            Err(e) => {
                last_err = Some(e.to_string());
                // Don't leak the temp on a failed rename (best-effort).
                let _ = std::fs::remove_file(&tmp);
                sleep_backoff(attempt);
            }
        }
    }

    Err(format!(
        "durable write {}: {}",
        path.display(),
        last_err.unwrap_or_else(|| "unknown error".to_string())
    ))
}

fn sleep_backoff(attempt: u32) {
    if attempt + 1 < MAX_ATTEMPTS {
        std::thread::sleep(BACKOFF * (attempt + 1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_bytes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        durable_write(&path, b"hello").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn overwrites_atomically_without_leftover_temp() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        durable_write(&path, b"old").unwrap();
        durable_write(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert!(!temp_sibling(&path).exists(), "temp must be renamed away");
    }

    #[test]
    fn self_heals_missing_parent_dir() {
        let dir = tempdir().unwrap();
        // Two levels that don't exist yet — the writer must create them.
        let path = dir.path().join("nested").join("deeper").join("data.json");
        assert!(!path.parent().unwrap().exists());
        durable_write(&path, b"x").unwrap();
        assert!(path.exists());
    }

    #[test]
    fn leftover_temp_does_not_block_next_write() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        // Pre-plant a stale temp from a pretend-killed prior writer.
        std::fs::write(temp_sibling(&path), b"stale junk").unwrap();
        durable_write(&path, b"fresh").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"fresh");
        assert!(!temp_sibling(&path).exists());
    }
}
