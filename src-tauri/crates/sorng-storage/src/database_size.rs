//! Read-only metadata for current database files, independent of unlock state.

use crate::database_transaction::validate_database_id;
use serde::Serialize;
use std::{fs, io::ErrorKind, path::Path};

pub const MAX_DATABASE_SIZE_BATCH: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseFileSizeStatus {
    Measured,
    Missing,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseFileSize {
    pub database_id: String,
    pub bytes: Option<u64>,
    pub status: DatabaseFileSizeStatus,
}

/// Validate the entire request before resolving paths, taking locks or doing I/O.
pub fn validate_database_ids(database_ids: &[String]) -> Result<(), String> {
    if database_ids.len() > MAX_DATABASE_SIZE_BATCH {
        return Err("database size batch must contain at most 256 ids".into());
    }
    for id in database_ids {
        validate_database_id(id)?;
    }
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    // Junctions and other Windows reparse points must not redirect this probe.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    false
}

fn directory_status(root: &Path) -> Option<DatabaseFileSizeStatus> {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => None,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            // Windows also reports NotFound for `regular-file/child`. Verify
            // the nearest existing ancestor before calling a root missing.
            root.parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .and_then(directory_status)
                .or(Some(DatabaseFileSizeStatus::Missing))
        }
        _ => Some(DatabaseFileSizeStatus::Unavailable),
    }
}

/// Measure only `<root>/<id>.json`, including every on-disk envelope byte.
/// The caller supplies the application's databases directory, never an IPC path.
/// Results retain request order and duplicates. Files are never opened for
/// content access; no index, backup, transaction journal or key is consulted.
pub async fn get_database_file_sizes(
    root: &Path,
    database_ids: Vec<String>,
) -> Result<Vec<DatabaseFileSize>, String> {
    validate_database_ids(&database_ids)?;
    if database_ids.is_empty() {
        return Ok(Vec::new());
    }

    // This read briefly joins ordinary database write serialization so it cannot
    // observe the gap between canonical -> backup and temporary -> canonical.
    // It also excludes key/representation transitions without triggering recovery.
    let _guard = sorng_encryption::settings_coordinator::lock_settings_write().await;
    let root_status = directory_status(root);

    Ok(database_ids
        .into_iter()
        .map(|database_id| {
            let (bytes, status) = if let Some(status) = root_status {
                (None, status)
            } else {
                match fs::symlink_metadata(root.join(format!("{database_id}.json"))) {
                    Ok(metadata) if metadata.is_file() && !is_link(&metadata) => {
                        (Some(metadata.len()), DatabaseFileSizeStatus::Measured)
                    }
                    Err(error) if error.kind() == ErrorKind::NotFound => {
                        (None, DatabaseFileSizeStatus::Missing)
                    }
                    _ => (None, DatabaseFileSizeStatus::Unavailable),
                }
            };
            DatabaseFileSize {
                database_id,
                bytes,
                status,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_encryption::settings_coordinator;
    use std::{future::Future, task::Poll, time::Duration};

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    fn row(id: &str, bytes: Option<u64>, status: DatabaseFileSizeStatus) -> DatabaseFileSize {
        DatabaseFileSize {
            database_id: id.into(),
            bytes,
            status,
        }
    }

    #[tokio::test]
    async fn measures_plain_sdbf_encrypted_and_opaque_bytes_without_keys() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        let plain = br#"{"connections":[]}"#.to_vec();
        // Fixture creation only: drop every key before asking for metadata.
        let encrypted = {
            let dek = sorng_encryption::MasterDek::generate();
            let key = dek.sub_key(sorng_encryption::ArtifactKind::Connections);
            crate::envelope_io::encrypt_with_subkey(&key, &plain).unwrap()
        };
        let framed =
            |payload: &[u8]| [crate::sdbf::encode_preamble(payload).as_slice(), payload].concat();
        let fixtures = [
            ("plain", plain.clone()),
            ("sdbf", framed(&plain)),
            ("encrypted", framed(&encrypted)),
            ("opaque", vec![0xff, 0, 0x80, 0x42, 0]),
            ("empty", Vec::new()),
        ];
        for (id, bytes) in &fixtures {
            fs::write(root.path().join(format!("{id}.json")), bytes).unwrap();
        }
        let actual = get_database_file_sizes(
            root.path(),
            fixtures.iter().map(|(id, _)| (*id).into()).collect(),
        )
        .await
        .unwrap();
        let expected: Vec<_> = fixtures
            .iter()
            .map(|(id, bytes)| {
                row(
                    id,
                    Some(bytes.len() as u64),
                    DatabaseFileSizeStatus::Measured,
                )
            })
            .collect();
        assert_eq!(actual, expected);
        for (id, bytes) in fixtures {
            assert_eq!(
                fs::read(root.path().join(format!("{id}.json"))).unwrap(),
                bytes
            );
        }
    }

    #[tokio::test]
    async fn preserves_unicode_spaces_order_and_duplicates() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("日本語 café 01.json"), b"1234567").unwrap();
        let actual = get_database_file_sizes(
            root.path(),
            ids(&["日本語 café 01", "absent", "日本語 café 01"]),
        )
        .await
        .unwrap();
        assert_eq!(
            actual,
            vec![
                row("日本語 café 01", Some(7), DatabaseFileSizeStatus::Measured),
                row("absent", None, DatabaseFileSizeStatus::Missing),
                row("日本語 café 01", Some(7), DatabaseFileSizeStatus::Measured),
            ]
        );
    }

    #[tokio::test]
    async fn missing_root_stays_missing_and_is_not_created() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("databases");
        assert_eq!(
            get_database_file_sizes(&root, ids(&["missing"]))
                .await
                .unwrap(),
            vec![row("missing", None, DatabaseFileSizeStatus::Missing)]
        );
        assert!(!root.exists());
    }

    #[tokio::test]
    async fn ignores_backups_index_and_pending_recovery() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        let files = [
            ("current.json", b"123".as_slice()),
            ("current.json.bak", b"longer backup".as_slice()),
            ("missing.json.bak", b"backup only".as_slice()),
            ("missing.json.v0.bak", b"migration backup".as_slice()),
            ("missing.json.tmp", b"temporary".as_slice()),
            ("index.json", b"invalid index".as_slice()),
            (
                ".database-security-transaction",
                b"invalid journal".as_slice(),
            ),
            (
                ".database-security-committed",
                b"invalid receipt".as_slice(),
            ),
        ];
        for (name, bytes) in files {
            fs::write(root.path().join(name), bytes).unwrap();
        }
        assert_eq!(
            get_database_file_sizes(root.path(), ids(&["current", "missing"]))
                .await
                .unwrap(),
            vec![
                row("current", Some(3), DatabaseFileSizeStatus::Measured),
                row("missing", None, DatabaseFileSizeStatus::Missing),
            ]
        );
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), files.len());
        for (name, bytes) in files {
            assert_eq!(fs::read(root.path().join(name)).unwrap(), bytes);
        }
    }

    #[tokio::test]
    async fn invalid_ids_reject_the_entire_batch_before_io_or_locking() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        let _blocked = settings_coordinator::lock().await;
        for id in [
            "",
            " ",
            " leading",
            "trailing ",
            ".",
            "..",
            "../escape",
            "a/b",
            "a\\b",
            "C:\\data",
            "a:stream",
            "index",
            "INDEX",
            "Con",
            "PRN",
            "aux",
            "NUL",
            "COM1",
            "lpt9",
            "db.json",
            "db.trust",
            "a\0b",
            "a\nb",
            "a?b",
            &"x".repeat(129),
            &"é".repeat(65),
        ] {
            let error = tokio::time::timeout(
                Duration::from_secs(1),
                get_database_file_sizes(root.path(), ids(&["valid", id])),
            )
            .await
            .expect("invalid input must not acquire the storage lock")
            .unwrap_err();
            assert_eq!(error, validate_database_id(id).unwrap_err());
            assert!(!error.contains(&root.path().display().to_string()));
        }
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn batch_bound_accepts_256_and_rejects_257_before_io_or_locking() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("db.json"), b"bounded").unwrap();
        let at_limit = vec!["db".into(); MAX_DATABASE_SIZE_BATCH];
        let rows = get_database_file_sizes(root.path(), at_limit.clone())
            .await
            .unwrap();
        assert_eq!(rows.len(), MAX_DATABASE_SIZE_BATCH);
        assert!(rows
            .iter()
            .all(|entry| entry == &row("db", Some(7), DatabaseFileSizeStatus::Measured)));
        let _blocked = settings_coordinator::lock().await;
        let mut too_many = at_limit;
        too_many.push("db".into());
        assert_eq!(
            tokio::time::timeout(
                Duration::from_secs(1),
                get_database_file_sizes(root.path(), too_many)
            )
            .await
            .expect("oversized input must not acquire the storage lock")
            .unwrap_err(),
            "database size batch must contain at most 256 ids"
        );
    }

    #[tokio::test]
    async fn empty_batch_needs_no_directory_or_lock() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        let _blocked = settings_coordinator::lock().await;
        assert!(tokio::time::timeout(
            Duration::from_secs(1),
            get_database_file_sizes(&root.path().join("absent"), Vec::new()),
        )
        .await
        .unwrap()
        .unwrap()
        .is_empty());
    }

    #[tokio::test]
    async fn nonregular_root_and_database_paths_are_unavailable() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("directory.json")).unwrap();
        fs::write(root.path().join("file"), b"not a directory").unwrap();
        assert_eq!(
            get_database_file_sizes(root.path(), ids(&["directory"]))
                .await
                .unwrap(),
            vec![row("directory", None, DatabaseFileSizeStatus::Unavailable)]
        );
        for path in [root.path().join("file"), root.path().join("file/child")] {
            assert_eq!(
                get_database_file_sizes(&path, ids(&["db"])).await.unwrap(),
                vec![row("db", None, DatabaseFileSizeStatus::Unavailable)]
            );
        }
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    #[cfg_attr(
        windows,
        ignore = "requires Windows symbolic-link privilege or Developer Mode"
    )]
    async fn symlink_files_dangling_links_and_symlink_roots_are_unavailable() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("databases");
        fs::create_dir(&root).unwrap();
        let target = parent.path().join("private");
        fs::write(&target, b"must not follow this link").unwrap();
        #[cfg(unix)]
        use std::os::unix::fs::symlink as symlink_file;
        #[cfg(unix)]
        use std::os::unix::fs::symlink as symlink_dir;
        #[cfg(windows)]
        use std::os::windows::fs::{symlink_dir, symlink_file};
        symlink_file(&target, root.join("link.json")).unwrap();
        symlink_file(parent.path().join("absent"), root.join("dangling.json")).unwrap();
        let linked_root = parent.path().join("linked-root");
        symlink_dir(&root, &linked_root).unwrap();
        assert_eq!(
            get_database_file_sizes(&root, ids(&["link", "dangling"]))
                .await
                .unwrap(),
            vec![
                row("link", None, DatabaseFileSizeStatus::Unavailable),
                row("dangling", None, DatabaseFileSizeStatus::Unavailable),
            ]
        );
        assert_eq!(
            get_database_file_sizes(&linked_root, ids(&["db"]))
                .await
                .unwrap(),
            vec![row("db", None, DatabaseFileSizeStatus::Unavailable)]
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_junction_roots_and_database_paths_are_unavailable() {
        use std::os::windows::process::CommandExt;
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("databases");
        let target = parent.path().join("private");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(target.join("db.json"), b"must not measure through junction").unwrap();
        let linked_root = parent.path().join("linked-root");
        // Directory junction creation needs no symbolic-link privilege.
        for link in [&linked_root, &root.join("junction.json")] {
            let output = std::process::Command::new("cmd.exe")
                .args(["/D", "/C", "mklink", "/J"])
                .arg(link)
                .arg(&target)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "junction fixture failed: {output:?}"
            );
        }
        assert_eq!(
            get_database_file_sizes(&linked_root, ids(&["db"]))
                .await
                .unwrap(),
            vec![row("db", None, DatabaseFileSizeStatus::Unavailable)]
        );
        assert_eq!(
            get_database_file_sizes(&root, ids(&["junction"]))
                .await
                .unwrap(),
            vec![row("junction", None, DatabaseFileSizeStatus::Unavailable)]
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn metadata_succeeds_while_windows_denies_content_reads() {
        use std::os::windows::fs::OpenOptionsExt;
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("locked.json");
        fs::write(&path, b"opaque locked database bytes").unwrap();
        let _deny_read = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(
            fs::read(&path).is_err(),
            "fixture must deny actual content reads"
        );
        assert_eq!(
            get_database_file_sizes(root.path(), ids(&["locked"]))
                .await
                .unwrap(),
            vec![row("locked", Some(28), DatabaseFileSizeStatus::Measured)]
        );
    }

    #[tokio::test]
    async fn waits_for_writes_and_transitions_then_observes_current_file() {
        let _fixture = crate::STORAGE_FIXTURE.lock().await;
        let root = tempfile::tempdir().unwrap();
        for transition in [false, true] {
            let guard = if transition {
                settings_coordinator::lock().await
            } else {
                settings_coordinator::lock_settings_write().await
            };
            let mut pending = std::pin::pin!(get_database_file_sizes(root.path(), ids(&["db"])));
            std::future::poll_fn(|cx| {
                assert!(pending.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
            fs::write(
                root.path().join("db.json"),
                if transition {
                    b"after".as_slice()
                } else {
                    b"first write".as_slice()
                },
            )
            .unwrap();
            drop(guard);
            let rows = tokio::time::timeout(Duration::from_secs(1), pending)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                rows,
                vec![row(
                    "db",
                    Some(if transition { 5 } else { 11 }),
                    DatabaseFileSizeStatus::Measured
                )]
            );
            assert!(
                settings_coordinator::try_lock().is_ok(),
                "probe must release its lease"
            );
        }
    }

    #[test]
    fn wire_rows_are_camel_case_with_nullable_u64_bytes_and_closed_statuses() {
        let rows = vec![
            row("measured", Some(u64::MAX), DatabaseFileSizeStatus::Measured),
            row("missing", None, DatabaseFileSizeStatus::Missing),
            row("unavailable", None, DatabaseFileSizeStatus::Unavailable),
        ];
        assert_eq!(
            serde_json::to_value(rows).unwrap(),
            serde_json::json!([
                {"databaseId": "measured", "bytes": u64::MAX, "status": "measured"},
                {"databaseId": "missing", "bytes": null, "status": "missing"},
                {"databaseId": "unavailable", "bytes": null, "status": "unavailable"},
            ])
        );
    }
}
