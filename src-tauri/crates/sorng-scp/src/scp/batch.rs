// ── Batch & recursive directory transfer ─────────────────────────────────────

use crate::scp::service::ScpService;
use crate::scp::types::*;
use crate::scp::SCP_TRANSFER_PROGRESS;
use chrono::Utc;
use glob::Pattern;
use log::warn;
use std::path::Path;
use uuid::Uuid;

impl ScpService {
    // ── Batch transfer (multiple independent files) ──────────────────────────

    pub async fn batch_transfer(
        &mut self,
        request: ScpBatchTransferRequest,
    ) -> Result<ScpBatchTransferResult, String> {
        let started = Utc::now();
        let total = request.items.len();
        let mut succeeded = 0usize;
        let mut failed = 0usize;
        let mut skipped = 0usize;
        let mut total_bytes = 0u64;
        let mut results = Vec::new();

        for item in &request.items {
            let transfer_request = ScpTransferRequest {
                session_id: request.session_id.clone(),
                local_path: item.local_path.clone(),
                remote_path: item.remote_path.clone(),
                chunk_size: 1_048_576,
                verify_checksum: request.verify_checksum,
                retry_count: 3,
                retry_delay_ms: 2000,
                file_mode: item.file_mode,
                preserve_times: true,
                create_parents: true,
                overwrite: true,
            };

            let result = match item.direction {
                ScpTransferDirection::Upload => self.upload(transfer_request).await,
                ScpTransferDirection::Download => self.download(transfer_request).await,
            };

            match result {
                Ok(r) => {
                    total_bytes += r.bytes_transferred;
                    succeeded += 1;
                    results.push(r);
                }
                Err(e) => {
                    failed += 1;
                    results.push(ScpTransferResult {
                        transfer_id: Uuid::new_v4().to_string(),
                        direction: item.direction.clone(),
                        local_path: item.local_path.clone(),
                        remote_path: item.remote_path.clone(),
                        bytes_transferred: 0,
                        duration_ms: 0,
                        average_speed: 0.0,
                        checksum: None,
                        success: false,
                        error: Some(e.clone()),
                    });

                    if request.stop_on_error {
                        // Skip remaining items
                        skipped = total - succeeded - failed;
                        break;
                    }
                }
            }
        }

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;

        Ok(ScpBatchTransferResult {
            total,
            succeeded,
            failed,
            skipped,
            total_bytes,
            duration_ms: duration,
            results,
        })
    }

    // ── Recursive directory upload ───────────────────────────────────────────

    pub async fn upload_directory(
        &mut self,
        request: ScpDirectoryTransferRequest,
    ) -> Result<ScpDirectoryTransferResult, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        let local_base = Path::new(&request.local_path);
        if !local_base.is_dir() {
            return Err(format!("'{}' is not a directory", request.local_path));
        }

        // Compile include/exclude patterns
        let include_pat = request
            .include_pattern
            .as_ref()
            .and_then(|p| Pattern::new(p).ok());
        let exclude_pat = request
            .exclude_pattern
            .as_ref()
            .and_then(|p| Pattern::new(p).ok());

        // Walk the local directory
        let mut walker = walkdir::WalkDir::new(&request.local_path);
        if !request.follow_symlinks {
            // walkdir follows symlinks by default; we need to build with follow_links
        }
        if let Some(max_depth) = request.max_depth {
            walker = walker.max_depth(max_depth);
        }
        walker = walker.follow_links(request.follow_symlinks);

        let entries: Vec<walkdir::DirEntry> = walker
            .into_iter()
            .filter_map(|e| e.ok())
            .collect();

        // Count files (not directories) for progress
        let file_entries: Vec<&walkdir::DirEntry> = entries
            .iter()
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                let name = e.file_name().to_string_lossy();
                if let Some(ref pat) = include_pat {
                    if !pat.matches(&name) {
                        return false;
                    }
                }
                if let Some(ref pat) = exclude_pat {
                    if pat.matches(&name) {
                        return false;
                    }
                }
                true
            })
            .collect();

        let files_total = file_entries.len() as u32;
        let mut files_transferred: u32 = 0;
        let mut files_failed: u32 = 0;
        let mut files_skipped: u32 = 0;
        let mut total_bytes: u64 = 0;
        let mut errors: Vec<String> = Vec::new();

        // Init progress
        let progress = ScpTransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: request.session_id.clone(),
            direction: ScpTransferDirection::Upload,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            total_bytes: file_entries.iter().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum(),
            transferred_bytes: 0,
            percent: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_secs: None,
            status: ScpTransferStatus::InProgress,
            started_at: started,
            error: None,
            retry_attempt: 0,
            current_file: None,
            files_total,
            files_completed: 0,
        };

        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            map.insert(transfer_id.clone(), progress);
        }

        // Create remote base directory
        self.remote_mkdir_p(&request.session_id, &request.remote_path)?;

        // First, create all directory entries on remote
        let mut dirs: Vec<&walkdir::DirEntry> = entries
            .iter()
            .filter(|e| e.file_type().is_dir())
            .collect();
        // Sort by depth so parents are created first
        dirs.sort_by_key(|e| e.depth());

        for dir_entry in &dirs {
            let relative = dir_entry
                .path()
                .strip_prefix(&request.local_path)
                .map_err(|e| format!("Path strip error: {}", e))?;
            if relative.as_os_str().is_empty() {
                continue;
            }
            let remote_dir = format!("{}/{}", request.remote_path, relative.to_string_lossy().replace('\\', "/"));
            if let Err(e) = self.remote_mkdir_p(&request.session_id, &remote_dir) {
                warn!("Failed to create remote dir '{}': {}", remote_dir, e);
                errors.push(format!("mkdir {}: {}", remote_dir, e));
            }
        }

        // Upload each file
        for file_entry in &file_entries {
            // Check for cancellation
            if let Ok(map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get(&transfer_id) {
                    if p.status == ScpTransferStatus::Cancelled {
                        break;
                    }
                }
            }

            let relative = file_entry
                .path()
                .strip_prefix(&request.local_path)
                .map_err(|e| format!("Path strip error: {}", e))?;
            let remote_file = format!("{}/{}", request.remote_path, relative.to_string_lossy().replace('\\', "/"));
            let local_file = file_entry.path().to_string_lossy().to_string();

            // Update current file in progress
            if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(&transfer_id) {
                    p.current_file = Some(local_file.clone());
                }
            }

            // Check overwrite
            if !request.overwrite {
                if let Ok(true) = self.remote_exists(&request.session_id, &remote_file) {
                    files_skipped += 1;
                    continue;
                }
            }

            let transfer_req = ScpTransferRequest {
                session_id: request.session_id.clone(),
                local_path: local_file.clone(),
                remote_path: remote_file.clone(),
                chunk_size: request.chunk_size,
                verify_checksum: request.verify_checksum,
                retry_count: request.retry_count,
                retry_delay_ms: request.retry_delay_ms,
                file_mode: request.file_mode,
                preserve_times: request.preserve_times,
                create_parents: false, // we already created dirs
                overwrite: request.overwrite,
            };

            match self.upload(transfer_req).await {
                Ok(result) => {
                    total_bytes += result.bytes_transferred;
                    files_transferred += 1;
                }
                Err(e) => {
                    files_failed += 1;
                    errors.push(format!("{}: {}", local_file, e));
                    warn!("SCP dir upload: failed '{}': {}", local_file, e);
                }
            }

            // Update progress
            if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(&transfer_id) {
                    p.files_completed = files_transferred + files_failed + files_skipped;
                    p.transferred_bytes = total_bytes;
                    p.percent = if files_total > 0 {
                        ((files_transferred + files_failed + files_skipped) as f64 / files_total as f64) * 100.0
                    } else {
                        100.0
                    };
                }
            }
        }

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
        let avg_speed = total_bytes as f64 / (duration as f64 / 1000.0);

        self.update_progress_status(&transfer_id, ScpTransferStatus::Completed);

        Ok(ScpDirectoryTransferResult {
            transfer_id,
            direction: ScpTransferDirection::Upload,
            local_path: request.local_path,
            remote_path: request.remote_path,
            files_transferred,
            files_failed,
            files_skipped,
            total_bytes,
            duration_ms: duration,
            average_speed: avg_speed,
            errors,
        })
    }

    // ── Recursive directory download ─────────────────────────────────────────

    pub async fn download_directory(
        &mut self,
        request: ScpDirectoryTransferRequest,
    ) -> Result<ScpDirectoryTransferResult, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        // Create local base directory
        std::fs::create_dir_all(&request.local_path)
            .map_err(|e| format!("Cannot create '{}': {}", request.local_path, e))?;

        // Compile include/exclude patterns
        let include_pat = request
            .include_pattern
            .as_ref()
            .and_then(|p| Pattern::new(p).ok());
        let exclude_pat = request
            .exclude_pattern
            .as_ref()
            .and_then(|p| Pattern::new(p).ok());

        // List remote directory recursively using `find`
        let remote_entries = self.remote_find_files(
            &request.session_id,
            &request.remote_path,
            request.max_depth,
        )?;

        // Filter entries
        let file_entries: Vec<&(String, bool, u64)> = remote_entries
            .iter()
            .filter(|(path, is_dir, _)| {
                if *is_dir {
                    return false;
                }
                let name = Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                if let Some(ref pat) = include_pat {
                    if !pat.matches(&name) {
                        return false;
                    }
                }
                if let Some(ref pat) = exclude_pat {
                    if pat.matches(&name) {
                        return false;
                    }
                }
                true
            })
            .collect();

        let dir_entries: Vec<&(String, bool, u64)> = remote_entries
            .iter()
            .filter(|(_, is_dir, _)| *is_dir)
            .collect();

        let files_total = file_entries.len() as u32;
        let mut files_transferred: u32 = 0;
        let mut files_failed: u32 = 0;
        let mut files_skipped: u32 = 0;
        let mut total_bytes: u64 = 0;
        let mut errors: Vec<String> = Vec::new();

        // Init progress
        let progress = ScpTransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: request.session_id.clone(),
            direction: ScpTransferDirection::Download,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            total_bytes: file_entries.iter().map(|(_, _, s)| s).sum(),
            transferred_bytes: 0,
            percent: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_secs: None,
            status: ScpTransferStatus::InProgress,
            started_at: started,
            error: None,
            retry_attempt: 0,
            current_file: None,
            files_total,
            files_completed: 0,
        };

        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            map.insert(transfer_id.clone(), progress);
        }

        // Create local directory structure
        for (dir_path, _, _) in &dir_entries {
            let relative = dir_path
                .strip_prefix(&request.remote_path)
                .unwrap_or(dir_path)
                .trim_start_matches('/');
            if relative.is_empty() {
                continue;
            }
            let local_dir = Path::new(&request.local_path).join(relative);
            if let Err(e) = std::fs::create_dir_all(&local_dir) {
                errors.push(format!("mkdir {}: {}", local_dir.display(), e));
            }
        }

        // Download each file
        for (remote_file, _, _) in &file_entries {
            // Check cancellation
            if let Ok(map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get(&transfer_id) {
                    if p.status == ScpTransferStatus::Cancelled {
                        break;
                    }
                }
            }

            let relative = remote_file
                .strip_prefix(&request.remote_path)
                .unwrap_or(remote_file)
                .trim_start_matches('/');
            let local_file = Path::new(&request.local_path)
                .join(relative)
                .to_string_lossy()
                .to_string();

            // Update current in progress
            if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(&transfer_id) {
                    p.current_file = Some(remote_file.clone());
                }
            }

            // Ensure parent directory exists locally
            if let Some(parent) = Path::new(&local_file).parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            // Check overwrite
            if !request.overwrite && Path::new(&local_file).exists() {
                files_skipped += 1;
                continue;
            }

            let transfer_req = ScpTransferRequest {
                session_id: request.session_id.clone(),
                local_path: local_file.clone(),
                remote_path: remote_file.clone(),
                chunk_size: request.chunk_size,
                verify_checksum: request.verify_checksum,
                retry_count: request.retry_count,
                retry_delay_ms: request.retry_delay_ms,
                file_mode: request.file_mode,
                preserve_times: request.preserve_times,
                create_parents: false,
                overwrite: request.overwrite,
            };

            match self.download(transfer_req).await {
                Ok(result) => {
                    total_bytes += result.bytes_transferred;
                    files_transferred += 1;
                }
                Err(e) => {
                    files_failed += 1;
                    errors.push(format!("{}: {}", remote_file, e));
                    warn!("SCP dir download: failed '{}': {}", remote_file, e);
                }
            }

            // Update progress
            if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(&transfer_id) {
                    p.files_completed = files_transferred + files_failed + files_skipped;
                    p.transferred_bytes = total_bytes;
                    p.percent = if files_total > 0 {
                        ((files_transferred + files_failed + files_skipped) as f64 / files_total as f64) * 100.0
                    } else {
                        100.0
                    };
                }
            }
        }

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
        let avg_speed = total_bytes as f64 / (duration as f64 / 1000.0);

        self.update_progress_status(&transfer_id, ScpTransferStatus::Completed);

        Ok(ScpDirectoryTransferResult {
            transfer_id,
            direction: ScpTransferDirection::Download,
            local_path: request.local_path,
            remote_path: request.remote_path,
            files_transferred,
            files_failed,
            files_skipped,
            total_bytes,
            duration_ms: duration,
            average_speed: avg_speed,
            errors,
        })
    }

    // ── Helper: recursively list remote files via `find` ─────────────────────

    fn remote_find_files(
        &self,
        session_id: &str,
        path: &str,
        max_depth: Option<usize>,
    ) -> Result<Vec<(String, bool, u64)>, String> {
        let escaped = crate::scp::service::shell_escape(path);
        let depth_arg = max_depth
            .map(|d| format!("-maxdepth {}", d))
            .unwrap_or_default();

        // Use find to list all entries with type and size
        let cmd = format!(
            "find {} {} -printf '%y %s %p\\n' 2>/dev/null || find {} {} -exec stat -f '%HT %z %N' {{}} \\;",
            escaped, depth_arg, escaped, depth_arg
        );

        let output = self.exec_remote(session_id, &cmd)?;
        let mut entries = Vec::new();

        for line in output.lines() {
            let parts: Vec<&str> = line.splitn(3, ' ').collect();
            if parts.len() < 3 {
                continue;
            }
            let file_type = parts[0];
            let size: u64 = parts[1].parse().unwrap_or(0);
            let file_path = parts[2].to_string();

            let is_dir = file_type == "d";
            entries.push((file_path, is_dir, size));
        }

        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_item_serialization() {
        let item = ScpBatchItem {
            local_path: "/tmp/test.txt".to_string(),
            remote_path: "/home/user/test.txt".to_string(),
            direction: ScpTransferDirection::Upload,
            file_mode: 0o644,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("upload"));
        assert!(json.contains("localPath"));
    }

    #[test]
    fn test_batch_result_serialization() {
        let result = ScpBatchTransferResult {
            total: 5,
            succeeded: 3,
            failed: 1,
            skipped: 1,
            total_bytes: 1024,
            duration_ms: 5000,
            results: Vec::new(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"total\":5"));
        assert!(json.contains("\"succeeded\":3"));
    }

    #[test]
    fn test_directory_transfer_result_serialization() {
        let result = ScpDirectoryTransferResult {
            transfer_id: "test".to_string(),
            direction: ScpTransferDirection::Upload,
            local_path: "/tmp/dir".to_string(),
            remote_path: "/home/user/dir".to_string(),
            files_transferred: 10,
            files_failed: 0,
            files_skipped: 2,
            total_bytes: 2048,
            duration_ms: 10000,
            average_speed: 204.8,
            errors: Vec::new(),
        };
        let json = serde_json::to_string(&result).unwrap();
        let parsed: ScpDirectoryTransferResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.files_transferred, 10);
        assert_eq!(parsed.files_skipped, 2);
    }
}
