//! Recoverable per-database security changes. Callers hold the shared settings coordinator.
//!
//! Only newly encoded payload/index bytes are staged. Original files are renamed,
//! never decrypted, into rollback slots. The journal stores identifiers and hashes,
//! not payloads or passwords. A separate durable commit receipt distinguishes a
//! rollback from post-commit cleanup even if the process stops between any two steps.

use crate::sdbf::{encode_preamble, safe_read_raw, LoadSource};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const JOURNAL: &str = ".database-security-transaction";
const RECEIPT: &str = ".database-security-committed";
const SUFFIXES: [&str; 4] = ["", ".bak", ".tmp", ".v0.bak"];

// Unlike sdbf::sibling (which inserts a dot), these suffixes include their dot
// and the empty suffix denotes the actual canonical generation.
fn sibling(canonical: &Path, suffix: &str) -> PathBuf {
    let mut name = canonical.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Journal {
    version: u8,
    database_id: String,
    token: String,
    original_hashes: Vec<Option<Vec<u8>>>,
    payload_hash: Vec<u8>,
    index_hash: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionOutcome {
    pub committed: bool,
    pub cleanup_pending: bool,
    pub warnings: Vec<String>,
}

/// IDs are logical names, never paths, ADS streams, role suffixes or DOS devices.
pub fn validate_database_id(id: &str) -> Result<(), String> {
    let folded = id.to_ascii_lowercase();
    let device = matches!(folded.as_str(), "index" | "con" | "prn" | "aux" | "nul")
        || (folded.len() == 4
            && (folded.starts_with("com") || folded.starts_with("lpt"))
            && matches!(folded.as_bytes()[3], b'1'..=b'9'));
    if id.is_empty()
        || id.len() > 128
        || id.trim() != id
        || device
        || !id
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ' '))
    {
        return Err(
            "invalid database id: use a non-reserved name without path or device syntax".into(),
        );
    }
    Ok(())
}

fn hash(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

fn regular_or_missing(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_file() && !meta.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(format!(
            "refusing non-regular database transaction path {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("inspect {}: {error}", path.display())),
    }
}

fn validate_root(root: &Path) -> Result<(), String> {
    let meta =
        std::fs::symlink_metadata(root).map_err(|e| format!("inspect database directory: {e}"))?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("database transaction directory must be a real directory".into());
    }
    Ok(())
}

fn root_exists(root: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(root) {
        Ok(_) => {
            validate_root(root)?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("inspect database directory: {error}")),
    }
}

fn rename_durable(source: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
        }
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // Same-volume, no replacement; WRITE_THROUGH waits for the move to flush.
        if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0x8) } == 0 {
            return Err(format!(
                "durable database rename: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    std::fs::rename(source, destination)
        .map_err(|error| format!("rename database generation: {error}"))
}

fn sync_directory(root: &Path) -> Result<(), String> {
    #[cfg(unix)]
    std::fs::File::open(root)
        .and_then(|file| file.sync_all())
        .map_err(|e| format!("sync database directory: {e}"))?;
    #[cfg(not(unix))]
    let _ = root; // Windows generation moves use MoveFileExW(WRITE_THROUGH).
    Ok(())
}

fn remove_regular(path: &Path) -> Result<(), String> {
    if regular_or_missing(path)? {
        std::fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

fn canonical_paths(root: &Path, journal: &Journal) -> Vec<PathBuf> {
    [
        root.join(format!("{}.json", journal.database_id)),
        root.join("index.json"),
    ]
    .iter()
    .flat_map(|path| SUFFIXES.iter().map(move |suffix| sibling(path, suffix)))
    .collect()
}

fn slot(root: &Path, token: &str, index: usize, kind: &str) -> PathBuf {
    root.join(format!(".db-security-{token}-{index}.{kind}"))
}

fn preflight_paths(root: &Path, journal: &Journal) -> Result<(), String> {
    for canonical in canonical_paths(root, journal) {
        regular_or_missing(&canonical)?;
    }
    for index in 0..journal.original_hashes.len() {
        for kind in ["old", "new"] {
            for suffix in SUFFIXES {
                regular_or_missing(&sibling(&slot(root, &journal.token, index, kind), suffix))?;
            }
        }
    }
    for name in [JOURNAL, RECEIPT] {
        for suffix in SUFFIXES {
            regular_or_missing(&sibling(&root.join(name), suffix))?;
        }
    }
    Ok(())
}

fn remove_slot(root: &Path, journal: &Journal, index: usize, kind: &str) -> Result<(), String> {
    for suffix in SUFFIXES {
        remove_regular(&sibling(&slot(root, &journal.token, index, kind), suffix))?;
    }
    Ok(())
}

fn validate_journal(journal: &Journal) -> Result<(), String> {
    validate_database_id(&journal.database_id)?;
    if journal.version != 1
        || journal.token.len() != 32
        || !journal.token.bytes().all(|c| c.is_ascii_hexdigit())
        || journal.original_hashes.len() != 8
        || journal
            .original_hashes
            .iter()
            .flatten()
            .any(|h| h.len() != 32)
        || journal.payload_hash.len() != 32
        || journal.index_hash.len() != 32
    {
        return Err("invalid database transaction journal".into());
    }
    Ok(())
}

fn read_journal(path: &Path) -> Result<Option<Journal>, String> {
    if !regular_or_missing(path)? {
        return Ok(None);
    }
    let Some((bytes, LoadSource::Current)) = safe_read_raw(path).map_err(|e| e.to_string())? else {
        return Err(
            "database transaction journal is damaged; recovery requires its current generation"
                .into(),
        );
    };
    let journal: Journal = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid database transaction journal: {e}"))?;
    validate_journal(&journal)?;
    Ok(Some(journal))
}

fn write_fresh(
    path: &Path,
    bytes: &[u8],
    label: &str,
    fault: &dyn Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    use std::io::Write;
    let temporary = sibling(path, ".tmp");
    if regular_or_missing(path)? || regular_or_missing(&temporary)? {
        return Err("fresh database transaction generation already exists".into());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| format!("create transaction generation: {e}"))?;
    file.write_all(&encode_preamble(bytes))
        .and_then(|()| file.write_all(bytes))
        .map_err(|e| format!("write transaction generation: {e}"))?;
    fault(&format!("{label}-flush"))?;
    file.sync_all()
        .map_err(|e| format!("flush transaction generation: {e}"))?;
    drop(file);
    verify_payload(&temporary, &hash(bytes))?;
    fault(&format!("{label}-rename"))?;
    rename_durable(&temporary, path)?;
    sync_directory(
        path.parent()
            .ok_or("transaction generation has no parent")?,
    )
}

fn write_journal(
    path: &Path,
    journal: &Journal,
    label: &str,
    fault: &dyn Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    for suffix in SUFFIXES {
        regular_or_missing(&sibling(path, suffix))?;
    }
    let bytes = serde_json::to_vec(journal).map_err(|e| e.to_string())?;
    write_fresh(path, &bytes, label, fault)
}

fn verify_payload(path: &Path, expected: &[u8]) -> Result<(), String> {
    if !regular_or_missing(path)? {
        return Err(format!("missing transaction generation {}", path.display()));
    }
    let Some((bytes, LoadSource::Current)) = safe_read_raw(path).map_err(|e| e.to_string())? else {
        return Err(format!("invalid transaction generation {}", path.display()));
    };
    if hash(&bytes) != expected {
        return Err(format!(
            "transaction generation hash mismatch {}",
            path.display()
        ));
    }
    Ok(())
}

fn remove_control_files(root: &Path) -> Result<(), String> {
    // The receipt remains authoritative if cleanup stops after removing the journal.
    for name in [JOURNAL, RECEIPT] {
        for suffix in [".bak", ".tmp", ".v0.bak", ""] {
            remove_regular(&sibling(&root.join(name), suffix))?;
        }
        sync_directory(root)?;
    }
    Ok(())
}

fn finish_committed(
    root: &Path,
    journal: &Journal,
    fault: &dyn Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    preflight_paths(root, journal)?;
    let paths = canonical_paths(root, journal);
    for index in [0, 1, 4, 5] {
        verify_payload(
            &paths[index],
            if index < 4 {
                &journal.payload_hash
            } else {
                &journal.index_hash
            },
        )?;
    }
    for index in 0..journal.original_hashes.len() {
        fault(&format!("cleanup-{index}"))?;
        remove_slot(root, journal, index, "old")?;
        remove_slot(root, journal, index, "new")?;
    }
    sync_directory(root)?;
    fault("cleanup-control")?;
    remove_control_files(root)
}

/// Does not create a directory. An absent directory is a valid first-run state.
pub fn recover(root: &Path) -> Result<Option<TransactionOutcome>, String> {
    recover_with(root, &|_| Ok(()))
}

fn recover_with(
    root: &Path,
    fault: &dyn Fn(&str) -> Result<(), String>,
) -> Result<Option<TransactionOutcome>, String> {
    if !root_exists(root)? {
        return Ok(None);
    }
    validate_root(root)?;
    let journal = read_journal(&root.join(JOURNAL))?;
    let receipt = read_journal(&root.join(RECEIPT))?;
    if let (Some(a), Some(b)) = (&journal, &receipt) {
        if a.token != b.token
            || a.database_id != b.database_id
            || a.original_hashes != b.original_hashes
            || a.payload_hash != b.payload_hash
            || a.index_hash != b.index_hash
        {
            return Err("database transaction receipt does not match its journal".into());
        }
    }
    if let Some(committed) = receipt {
        return Ok(Some(match finish_committed(root, &committed, fault) {
            Ok(()) => TransactionOutcome {
                committed: true,
                cleanup_pending: false,
                warnings: vec![],
            },
            Err(error) => TransactionOutcome {
                committed: true,
                cleanup_pending: true,
                warnings: vec![error],
            },
        }));
    }
    let Some(journal) = journal else {
        // Before the prepared journal is installed, no generation/stage is touched.
        // An interrupted first journal write can only leave its own temporary file.
        for name in [JOURNAL, RECEIPT] {
            for suffix in SUFFIXES {
                regular_or_missing(&sibling(&root.join(name), suffix))?;
            }
        }
        remove_control_files(root)?;
        return Ok(None);
    };
    preflight_paths(root, &journal)?;
    // Validate EVERY rollback source before restoring any. A bad later path must
    // not leave a partially repaired earlier file.
    for (index, canonical) in canonical_paths(root, &journal).iter().enumerate() {
        let original = slot(root, &journal.token, index, "old");
        let source = if regular_or_missing(&original)? {
            &original
        } else {
            canonical
        };
        if let Some(expected) = &journal.original_hashes[index] {
            if !regular_or_missing(source)?
                || hash(&std::fs::read(source).map_err(|e| e.to_string())?) != *expected
            {
                return Err("original database generation is unavailable or damaged; recovery stopped without changing files".into());
            }
        } else if regular_or_missing(&original)? {
            return Err(
                "unexpected rollback generation; recovery stopped without changing files".into(),
            );
        }
    }
    for (index, canonical) in canonical_paths(root, &journal).iter().enumerate() {
        let original = slot(root, &journal.token, index, "old");
        if regular_or_missing(&original)? {
            let bytes = std::fs::read(&original).map_err(|e| format!("read rollback: {e}"))?;
            if Some(hash(&bytes)) != journal.original_hashes[index] {
                return Err("rollback generation hash mismatch".into());
            }
            remove_regular(canonical)?;
            rename_durable(&original, canonical)?;
            sync_directory(root)?;
        } else if let Some(expected) = &journal.original_hashes[index] {
            if !regular_or_missing(canonical)?
                || hash(&std::fs::read(canonical).map_err(|e| e.to_string())?) != *expected
            {
                return Err("original database generation is unavailable; recovery stopped without guessing".into());
            }
        } else {
            remove_regular(canonical)?;
        }
        remove_slot(root, &journal, index, "new")?;
    }
    sync_directory(root)?;
    remove_control_files(root)?;
    Ok(Some(TransactionOutcome {
        committed: false,
        cleanup_pending: false,
        warnings: vec![],
    }))
}

/// Read-only status probe: never repairs or removes any artifact.
pub fn pending(root: &Path) -> Result<bool, String> {
    if !root_exists(root)? {
        return Ok(false);
    }
    for name in [JOURNAL, RECEIPT] {
        for suffix in SUFFIXES {
            if regular_or_missing(&sibling(&root.join(name), suffix))? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Install a payload/index pair and matching recovery backups. Bytes are already
/// master-protected by the caller wherever that policy is configured.
pub fn commit(
    root: &Path,
    database_id: &str,
    payload: &[u8],
    index: &[u8],
) -> Result<TransactionOutcome, String> {
    if let Some(previous) = recover(root)? {
        if previous.cleanup_pending {
            return Err(format!(
                "previous database security cleanup is pending: {}",
                previous.warnings.join("; ")
            ));
        }
    }
    match commit_with(root, database_id, payload, index, &|_| Ok(())) {
        Ok(outcome) => Ok(outcome),
        Err(error) => match recover(root) {
            Ok(Some(outcome)) if outcome.committed => Ok(outcome),
            Ok(_) => Err(error),
            Err(recovery) => Err(format!("{error}; recovery is pending: {recovery}")),
        },
    }
}

fn commit_with(
    root: &Path,
    database_id: &str,
    payload: &[u8],
    index: &[u8],
    fault: &dyn Fn(&str) -> Result<(), String>,
) -> Result<TransactionOutcome, String> {
    validate_database_id(database_id)?;
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    validate_root(root)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let mut journal = Journal {
        version: 1,
        database_id: database_id.into(),
        token,
        original_hashes: vec![],
        payload_hash: hash(payload),
        index_hash: hash(index),
    };
    let paths = canonical_paths(root, &journal);
    for path in &paths {
        journal.original_hashes.push(if regular_or_missing(path)? {
            Some(hash(
                &std::fs::read(path).map_err(|e| format!("read original generation: {e}"))?,
            ))
        } else {
            None
        });
    }
    preflight_paths(root, &journal)?;
    fault("journal")?;
    write_journal(&root.join(JOURNAL), &journal, "journal", fault)?;
    fault("journal-sync")?;
    sync_directory(root)?;
    for target in [0, 1, 4, 5] {
        fault(&format!("stage-{target}"))?;
        let staged = slot(root, &journal.token, target, "new");
        regular_or_missing(&staged)?;
        write_fresh(
            &staged,
            if target < 4 { payload } else { index },
            &format!("stage-{target}"),
            fault,
        )?;
        verify_payload(
            &staged,
            if target < 4 {
                &journal.payload_hash
            } else {
                &journal.index_hash
            },
        )?;
    }
    for (target, canonical) in paths.iter().enumerate() {
        fault(&format!("move-{target}"))?;
        if journal.original_hashes[target].is_some() {
            let original = slot(root, &journal.token, target, "old");
            if regular_or_missing(&original)? {
                return Err("rollback slot already exists".into());
            }
            rename_durable(canonical, &original)?;
            fault(&format!("move-sync-{target}"))?;
            sync_directory(root)?;
        }
    }
    for target in [0, 1, 4, 5] {
        fault(&format!("install-{target}"))?;
        rename_durable(&slot(root, &journal.token, target, "new"), &paths[target])?;
        fault(&format!("install-sync-{target}"))?;
        sync_directory(root)?;
        verify_payload(
            &paths[target],
            if target < 4 {
                &journal.payload_hash
            } else {
                &journal.index_hash
            },
        )?;
    }
    fault("commit-marker")?;
    write_journal(&root.join(RECEIPT), &journal, "receipt", fault)?;
    sync_directory(root)?;
    let outcome = match finish_committed(root, &journal, fault) {
        Ok(()) => TransactionOutcome {
            committed: true,
            cleanup_pending: false,
            warnings: vec![],
        },
        Err(error) => TransactionOutcome {
            committed: true,
            cleanup_pending: true,
            warnings: vec![error],
        },
    };
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdbf::safe_write;

    fn fixture() -> (tempfile::TempDir, Vec<(PathBuf, Vec<u8>)>) {
        let dir = tempfile::tempdir().unwrap();
        for name in ["Personal.json", "index.json"] {
            safe_write(&dir.path().join(name), b"old-one").unwrap();
            safe_write(&dir.path().join(name), b"old-two").unwrap();
            std::fs::write(
                sibling(&dir.path().join(name), ".v0.bak"),
                b"original legacy bytes",
            )
            .unwrap();
        }
        let originals = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                let bytes = std::fs::read(&path).unwrap();
                (path, bytes)
            })
            .collect();
        (dir, originals)
    }

    #[test]
    fn rejects_unsafe_ids_and_retains_safe_human_names() {
        for id in [
            "", "index", "INDEX", "../x", "a/b", "a\\b", "x:stream", "x.trust", "x.", "CON",
            "com1", "LPT9", " x", "x ",
        ] {
            assert!(validate_database_id(id).is_err(), "{id}");
        }
        for id in [
            "Personal",
            "work_prod_2026",
            "my database",
            "123e4567-e89b-12d3-a456-426614174000",
        ] {
            assert!(validate_database_id(id).is_ok(), "{id}");
        }
    }

    #[test]
    fn every_precommit_boundary_recovers_original_bytes_after_restart() {
        let boundaries: Vec<String> = [
            "stage-0",
            "stage-1",
            "stage-4",
            "stage-5",
            "journal",
            "journal-sync",
            "journal-flush",
            "journal-rename",
            "receipt-flush",
            "receipt-rename",
            "commit-marker",
        ]
        .into_iter()
        .map(String::from)
        .chain([0, 1, 4, 5].into_iter().map(|n| format!("stage-{n}-flush")))
        .chain(
            [0, 1, 4, 5]
                .into_iter()
                .map(|n| format!("stage-{n}-rename")),
        )
        .chain((0..8).map(|n| format!("move-{n}")))
        .chain(
            [0, 1, 3, 4, 5, 7]
                .into_iter()
                .map(|n| format!("move-sync-{n}")),
        )
        .chain([0, 1, 4, 5].into_iter().map(|n| format!("install-{n}")))
        .chain(
            [0, 1, 4, 5]
                .into_iter()
                .map(|n| format!("install-sync-{n}")),
        )
        .collect();
        for boundary in boundaries {
            let (dir, originals) = fixture();
            let failure = |point: &str| {
                if point == boundary {
                    Err("simulated process stop".into())
                } else {
                    Ok(())
                }
            };
            assert!(
                commit_with(
                    dir.path(),
                    "Personal",
                    b"new protected payload",
                    b"new protected index",
                    &failure
                )
                .is_err(),
                "{boundary}"
            );
            recover(dir.path()).unwrap();
            assert_eq!(
                std::fs::read_dir(dir.path()).unwrap().count(),
                originals.len(),
                "{boundary}"
            );
            for (path, bytes) in originals {
                assert_eq!(std::fs::read(path).unwrap(), bytes, "{boundary}");
            }
        }
    }

    #[test]
    fn committed_cleanup_failures_are_explicit_and_restart_finishes_new_pair() {
        for boundary in (0..8)
            .map(|n| format!("cleanup-{n}"))
            .chain(["cleanup-control".into()])
        {
            let (dir, _) = fixture();
            let outcome = commit_with(
                dir.path(),
                "Personal",
                b"new protected payload",
                b"new protected index",
                &|point| {
                    if point == boundary {
                        Err("cleanup denied".into())
                    } else {
                        Ok(())
                    }
                },
            )
            .unwrap();
            assert!(outcome.committed && outcome.cleanup_pending);
            assert!(pending(dir.path()).unwrap());
            let recovered = recover(dir.path()).unwrap().unwrap();
            assert!(recovered.committed && !recovered.cleanup_pending);
            for name in ["Personal.json", "Personal.json.bak"] {
                verify_payload(&dir.path().join(name), &hash(b"new protected payload")).unwrap();
            }
            for name in ["index.json", "index.json.bak"] {
                verify_payload(&dir.path().join(name), &hash(b"new protected index")).unwrap();
            }
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 4);
        }
    }

    #[test]
    fn malformed_journal_fails_closed_without_changing_originals() {
        let (dir, originals) = fixture();
        safe_write(
            &dir.path().join(JOURNAL),
            br#"{"version":1,"database_id":"../outside"}"#,
        )
        .unwrap();
        assert!(recover(dir.path()).is_err());
        for (path, bytes) in originals {
            assert_eq!(std::fs::read(path).unwrap(), bytes);
        }
    }

    #[test]
    fn damaged_late_rollback_fails_before_restoring_any_earlier_file() {
        let (dir, _) = fixture();
        assert!(
            commit_with(dir.path(), "Personal", b"new", b"index", &|point| {
                if point == "install-0" {
                    Err("stop".into())
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        let journal = read_journal(&dir.path().join(JOURNAL)).unwrap().unwrap();
        std::fs::write(slot(dir.path(), &journal.token, 7, "old"), b"tampered").unwrap();
        assert!(recover(dir.path()).is_err());
        assert!(!dir.path().join("Personal.json").exists());
        assert!(slot(dir.path(), &journal.token, 0, "old").exists());
    }

    #[test]
    fn late_nonregular_path_fails_before_any_recovery_write() {
        let (dir, _) = fixture();
        assert!(
            commit_with(dir.path(), "Personal", b"new", b"index", &|point| {
                if point == "install-0" {
                    Err("stop".into())
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        let journal = read_journal(&dir.path().join(JOURNAL)).unwrap().unwrap();
        std::fs::create_dir(slot(dir.path(), &journal.token, 7, "new")).unwrap();
        assert!(recover(dir.path()).is_err());
        assert!(!dir.path().join("Personal.json").exists());
        assert!(slot(dir.path(), &journal.token, 0, "old").exists());
    }

    #[test]
    fn status_is_strictly_read_only_even_with_a_pending_transaction() {
        let (dir, _) = fixture();
        assert!(
            commit_with(dir.path(), "Personal", b"new", b"index", &|point| {
                if point == "install-0" {
                    Err("stop".into())
                } else {
                    Ok(())
                }
            })
            .is_err()
        );
        let before: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert!(pending(dir.path()).unwrap());
        let after: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(before, after);
        assert!(!dir.path().join("Personal.json").exists());
    }

    #[test]
    fn success_removes_old_password_and_plaintext_rollback_generations() {
        let (dir, _) = fixture();
        let outcome = commit(dir.path(), "Personal", b"new ciphertext", b"new index").unwrap();
        assert!(outcome.committed && !outcome.cleanup_pending);
        assert!(!pending(dir.path()).unwrap());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 4);
    }
}
