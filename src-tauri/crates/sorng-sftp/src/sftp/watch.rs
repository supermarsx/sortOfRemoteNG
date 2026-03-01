// ── File watching / sync ─────────────────────────────────────────────────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use crate::sftp::ACTIVE_WATCHES;
use chrono::Utc;
use log::info;
use uuid::Uuid;

impl SftpService {
    /// Start watching a remote directory for changes.
    pub async fn watch_start(
        &mut self,
        config: WatchConfig,
    ) -> Result<String, String> {
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

        let remote_entries = self.list_directory(session_id, remote_path, options).await?;

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
            let remote_dest = format!("{}/{}", remote_path, relative.replace('\\', "/"));

            // Check remote stat
            let needs_upload = match self.stat(session_id, &remote_dest).await {
                Ok(remote_stat) => {
                    let local_meta = std::fs::metadata(local_file).map_err(|e| e.to_string())?;
                    let local_mtime = local_meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let remote_mtime = remote_stat.modified.unwrap_or(0);
                    local_meta.len() != remote_stat.size || local_mtime > remote_mtime
                }
                Err(_) => true, // remote doesn't exist
            };

            if !needs_upload {
                skipped += 1;
                continue;
            }

            // Ensure remote parent directory exists
            if let Some(parent) = std::path::Path::new(&remote_dest).parent() {
                let parent_str = parent.to_string_lossy().to_string();
                let _ = self.mkdir_p(session_id, &parent_str, None).await;
            }

            let req = SftpTransferRequest {
                session_id: session_id.to_string(),
                local_path: local_file.clone(),
                remote_path: remote_dest,
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

            match self.upload(req).await {
                Ok(r) if r.success => uploaded += 1,
                _ => errors += 1,
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
