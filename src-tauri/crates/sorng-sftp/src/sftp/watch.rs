// ── File watching / sync ─────────────────────────────────────────────────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use crate::sftp::ACTIVE_WATCHES;
use chrono::Utc;
use log::info;
use uuid::Uuid;

const LIBSSH2_FX_NO_SUCH_FILE: i32 = 2;
const REMOTE_STAT_ABORTED: &str = "Remote destination could not be verified; upload was aborted";
const REMOTE_PARENT_ABORTED: &str =
    "Remote parent directory could not be prepared; upload was aborted";

#[derive(Debug, Clone, Copy)]
struct LocalFileSnapshot {
    size: u64,
    modified: u64,
}

#[derive(Debug, Clone, Copy)]
enum RemoteDestination {
    Missing,
    Existing { size: u64, modified: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PushFileOutcome {
    Uploaded,
    Skipped,
    Errored,
}

trait PushSession {
    async fn inspect_remote_destination(
        &mut self,
        session_id: &str,
        remote_path: &str,
    ) -> Result<RemoteDestination, String>;

    async fn ensure_remote_parent(
        &mut self,
        session_id: &str,
        remote_parent: &str,
    ) -> Result<(), String>;

    async fn perform_push_upload(&mut self, request: SftpTransferRequest) -> bool;
}

impl PushSession for SftpService {
    async fn inspect_remote_destination(
        &mut self,
        session_id: &str,
        remote_path: &str,
    ) -> Result<RemoteDestination, String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        match sftp.stat(std::path::Path::new(remote_path)) {
            Ok(stat) => Ok(RemoteDestination::Existing {
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0),
            }),
            Err(error) if is_remote_not_found(error.code()) => Ok(RemoteDestination::Missing),
            Err(error) => Err(error.to_string()),
        }
    }

    async fn ensure_remote_parent(
        &mut self,
        session_id: &str,
        remote_parent: &str,
    ) -> Result<(), String> {
        self.mkdir_p(session_id, remote_parent, None).await
    }

    async fn perform_push_upload(&mut self, request: SftpTransferRequest) -> bool {
        matches!(self.upload(request).await, Ok(result) if result.success)
    }
}

impl SftpService {
    /// Start watching a remote directory for changes.
    pub async fn watch_start(&mut self, config: WatchConfig) -> Result<String, String> {
        let watch_id = Uuid::new_v4().to_string();
        let interval = if config.interval_secs > 0 {
            config.interval_secs
        } else {
            30
        };

        let (tx, _rx) = tokio::sync::mpsc::channel::<()>(1);

        let state = WatchState {
            config: config.clone(),
            active: true,
            shutdown_tx: tx.clone(),
        };

        if let Ok(mut watches) = ACTIVE_WATCHES.lock() {
            watches.insert(watch_id.clone(), state);
        }

        info!(
            "SFTP watch started: {} (remote={}, interval={}s)",
            watch_id, config.remote_path, interval
        );

        Ok(watch_id)
    }

    /// Stop a watch subscription.
    pub async fn watch_stop(&mut self, watch_id: &str) -> Result<(), String> {
        if let Ok(mut watches) = ACTIVE_WATCHES.lock() {
            if let Some(state) = watches.get_mut(watch_id) {
                state.active = false;
                let _ = state.shutdown_tx.try_send(());
                watches.remove(watch_id);
                info!("SFTP watch stopped: {}", watch_id);
                return Ok(());
            }
        }
        Err(format!("Watch '{}' not found", watch_id))
    }

    /// List all active watches.
    pub async fn watch_list(&self) -> Vec<WatchInfo> {
        if let Ok(watches) = ACTIVE_WATCHES.lock() {
            watches
                .iter()
                .map(|(id, state)| WatchInfo {
                    id: id.clone(),
                    remote_path: state.config.remote_path.clone(),
                    local_path: state.config.local_path.clone(),
                    session_id: state.config.session_id.clone(),
                    active: state.active,
                    interval_secs: state.config.interval_secs,
                })
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Perform a one-shot sync: compare remote vs local and download changes.
    pub async fn sync_pull(
        &mut self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<SyncResult, String> {
        let options = SftpListOptions {
            include_hidden: false,
            sort_by: SftpSortField::Name,
            ascending: true,
            filter_glob: None,
            filter_type: None,
            recursive: true,
            max_depth: Some(10),
        };

        let remote_entries = self
            .list_directory(session_id, remote_path, options)
            .await?;

        let mut downloaded = 0u64;
        let mut skipped = 0u64;
        let mut errors = 0u64;

        for entry in &remote_entries {
            if entry.entry_type != SftpEntryType::File {
                continue;
            }

            // Compute relative path
            let relative = entry
                .path
                .strip_prefix(remote_path)
                .unwrap_or(&entry.path)
                .trim_start_matches('/');
            let local_dest = format!("{}/{}", local_path, relative);

            // Check if local file is up-to-date
            if let Ok(local_meta) = std::fs::metadata(&local_dest) {
                let local_mtime = local_meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                let remote_mtime = entry.modified.unwrap_or(0);
                if local_meta.len() == entry.size && local_mtime >= remote_mtime {
                    skipped += 1;
                    continue;
                }
            }

            // Ensure parent dir
            if let Some(parent) = std::path::Path::new(&local_dest).parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            let req = SftpTransferRequest {
                session_id: session_id.to_string(),
                local_path: local_dest,
                remote_path: entry.path.clone(),
                direction: TransferDirection::Download,
                chunk_size: 1_048_576,
                resume: false,
                on_conflict: ConflictResolution::Overwrite,
                preserve_timestamps: true,
                preserve_permissions: false,
                bandwidth_limit_kbps: None,
                retry_count: 1,
                retry_delay_ms: 1000,
                verify_checksum: false,
            };

            match self.download(req).await {
                Ok(r) if r.success => downloaded += 1,
                _ => errors += 1,
            }
        }

        Ok(SyncResult {
            direction: "pull".to_string(),
            files_transferred: downloaded,
            files_skipped: skipped,
            files_errored: errors,
            timestamp: Utc::now(),
        })
    }

    /// One-shot sync: push local changes to remote.
    pub async fn sync_push(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<SyncResult, String> {
        let mut uploaded = 0u64;
        let mut skipped = 0u64;
        let mut errors = 0u64;

        let local_files = collect_local_files(local_path)?;

        for local_file in &local_files {
            let relative = local_file
                .strip_prefix(local_path)
                .unwrap_or(local_file)
                .trim_start_matches('/')
                .trim_start_matches('\\');
            let remote_dest = format!(
                "{}/{}",
                remote_path.trim_end_matches('/'),
                relative.replace('\\', "/")
            );
            let local_snapshot = local_file_snapshot(local_file)?;

            match push_local_file(self, session_id, local_file, &remote_dest, local_snapshot)
                .await?
            {
                PushFileOutcome::Uploaded => uploaded += 1,
                PushFileOutcome::Skipped => skipped += 1,
                PushFileOutcome::Errored => errors += 1,
            }
        }

        Ok(SyncResult {
            direction: "push".to_string(),
            files_transferred: uploaded,
            files_skipped: skipped,
            files_errored: errors,
            timestamp: Utc::now(),
        })
    }
}

// ── Extra types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchInfo {
    pub id: String,
    pub remote_path: String,
    pub local_path: String,
    pub session_id: String,
    pub active: bool,
    pub interval_secs: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub direction: String,
    pub files_transferred: u64,
    pub files_skipped: u64,
    pub files_errored: u64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn collect_local_files(root: &str) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(root)];

    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Cannot read '{}': {}", dir.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }

    Ok(files)
}

fn local_file_snapshot(path: &str) -> Result<LocalFileSnapshot, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|_| "Local upload source could not be inspected; sync was aborted".to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    Ok(LocalFileSnapshot {
        size: metadata.len(),
        modified,
    })
}

fn is_remote_not_found(code: ssh2::ErrorCode) -> bool {
    matches!(code, ssh2::ErrorCode::SFTP(code) if code == LIBSSH2_FX_NO_SUCH_FILE)
}

fn remote_parent(path: &str) -> Option<&str> {
    path.rsplit_once('/')
        .map(|(parent, _)| parent)
        .filter(|parent| !parent.is_empty())
}

async fn push_local_file<S: PushSession>(
    session: &mut S,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
    local: LocalFileSnapshot,
) -> Result<PushFileOutcome, String> {
    let destination = session
        .inspect_remote_destination(session_id, remote_path)
        .await
        .map_err(|_| REMOTE_STAT_ABORTED.to_string())?;

    let needs_upload = match destination {
        RemoteDestination::Missing => true,
        RemoteDestination::Existing { size, modified } => {
            local.size != size || local.modified > modified
        }
    };
    if !needs_upload {
        return Ok(PushFileOutcome::Skipped);
    }

    if let Some(parent) = remote_parent(remote_path) {
        session
            .ensure_remote_parent(session_id, parent)
            .await
            .map_err(|_| REMOTE_PARENT_ABORTED.to_string())?;
    }

    let request = SftpTransferRequest {
        session_id: session_id.to_string(),
        local_path: local_path.to_string(),
        remote_path: remote_path.to_string(),
        direction: TransferDirection::Upload,
        chunk_size: 1_048_576,
        resume: false,
        on_conflict: ConflictResolution::Overwrite,
        preserve_timestamps: true,
        preserve_permissions: false,
        bandwidth_limit_kbps: None,
        retry_count: 1,
        retry_delay_ms: 1000,
        verify_checksum: false,
    };

    if session.perform_push_upload(request).await {
        Ok(PushFileOutcome::Uploaded)
    } else {
        Ok(PushFileOutcome::Errored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakePushSession {
        inspection: Option<Result<RemoteDestination, String>>,
        parent_result: Result<(), String>,
        upload_success: bool,
        inspected_paths: Vec<String>,
        prepared_parents: Vec<String>,
        uploads: Vec<SftpTransferRequest>,
    }

    impl FakePushSession {
        fn new(inspection: Result<RemoteDestination, String>) -> Self {
            Self {
                inspection: Some(inspection),
                parent_result: Ok(()),
                upload_success: true,
                inspected_paths: Vec::new(),
                prepared_parents: Vec::new(),
                uploads: Vec::new(),
            }
        }
    }

    impl PushSession for FakePushSession {
        async fn inspect_remote_destination(
            &mut self,
            _session_id: &str,
            remote_path: &str,
        ) -> Result<RemoteDestination, String> {
            self.inspected_paths.push(remote_path.to_string());
            self.inspection
                .take()
                .expect("fake inspection should be called exactly once")
        }

        async fn ensure_remote_parent(
            &mut self,
            _session_id: &str,
            remote_parent: &str,
        ) -> Result<(), String> {
            self.prepared_parents.push(remote_parent.to_string());
            self.parent_result.clone()
        }

        async fn perform_push_upload(&mut self, request: SftpTransferRequest) -> bool {
            self.uploads.push(request);
            self.upload_success
        }
    }

    fn snapshot(size: u64, modified: u64) -> LocalFileSnapshot {
        LocalFileSnapshot { size, modified }
    }

    #[test]
    fn only_sftp_no_such_file_is_treated_as_missing() {
        assert!(is_remote_not_found(ssh2::ErrorCode::SFTP(2)));
        assert!(!is_remote_not_found(ssh2::ErrorCode::SFTP(3)));
        assert!(!is_remote_not_found(ssh2::ErrorCode::SFTP(4)));
        assert!(!is_remote_not_found(ssh2::ErrorCode::Session(-1)));
    }

    #[tokio::test]
    async fn genuine_not_found_uploads_with_the_existing_overwrite_policy() {
        let mut session = FakePushSession::new(Ok(RemoteDestination::Missing));

        let outcome = push_local_file(
            &mut session,
            "session-1",
            "C:/safe/file.txt",
            "/remote/file.txt",
            snapshot(12, 20),
        )
        .await
        .expect("a genuinely missing destination should be uploadable");

        assert_eq!(outcome, PushFileOutcome::Uploaded);
        assert_eq!(session.prepared_parents, ["/remote"]);
        assert_eq!(session.uploads.len(), 1);
        assert!(matches!(
            session.uploads[0].on_conflict,
            ConflictResolution::Overwrite
        ));
    }

    #[tokio::test]
    async fn permission_or_ambiguous_stat_error_aborts_without_upload() {
        let mut session = FakePushSession::new(Err(
            "permission denied while inspecting /remote/private.txt".to_string(),
        ));

        let error = push_local_file(
            &mut session,
            "session-1",
            "C:/safe/file.txt",
            "/remote/private.txt",
            snapshot(12, 20),
        )
        .await
        .expect_err("an ambiguous stat failure must abort the push");

        assert_eq!(error, REMOTE_STAT_ABORTED);
        assert!(!error.contains("private.txt"));
        assert!(!error.contains("permission denied"));
        assert!(session.prepared_parents.is_empty());
        assert!(session.uploads.is_empty());
    }

    #[tokio::test]
    async fn parent_creation_failure_propagates_without_upload() {
        let mut session = FakePushSession::new(Ok(RemoteDestination::Missing));
        session.parent_result = Err("permission denied for /remote/secret".to_string());

        let error = push_local_file(
            &mut session,
            "session-1",
            "C:/safe/file.txt",
            "/remote/secret/file.txt",
            snapshot(12, 20),
        )
        .await
        .expect_err("parent creation failure must abort the push");

        assert_eq!(error, REMOTE_PARENT_ABORTED);
        assert!(!error.contains("/remote/secret"));
        assert_eq!(session.prepared_parents, ["/remote/secret"]);
        assert!(session.uploads.is_empty());
    }

    #[tokio::test]
    async fn genuine_existing_destination_preserves_skip_and_overwrite_semantics() {
        let mut unchanged = FakePushSession::new(Ok(RemoteDestination::Existing {
            size: 12,
            modified: 20,
        }));
        let outcome = push_local_file(
            &mut unchanged,
            "session-1",
            "C:/safe/file.txt",
            "/remote/file.txt",
            snapshot(12, 20),
        )
        .await
        .expect("an unchanged existing destination should be skipped");
        assert_eq!(outcome, PushFileOutcome::Skipped);
        assert!(unchanged.prepared_parents.is_empty());
        assert!(unchanged.uploads.is_empty());

        let mut changed = FakePushSession::new(Ok(RemoteDestination::Existing {
            size: 11,
            modified: 20,
        }));
        let outcome = push_local_file(
            &mut changed,
            "session-1",
            "C:/safe/file.txt",
            "/remote/file.txt",
            snapshot(12, 20),
        )
        .await
        .expect("a changed existing destination should be overwritten");
        assert_eq!(outcome, PushFileOutcome::Uploaded);
        assert_eq!(changed.uploads.len(), 1);
        assert!(matches!(
            changed.uploads[0].on_conflict,
            ConflictResolution::Overwrite
        ));
    }
}
