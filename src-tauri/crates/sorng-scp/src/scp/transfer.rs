// ── Transfer engine – SCP upload & download with chunked I/O ─────────────────

use crate::scp::history;
use crate::scp::service::ScpService;
use crate::scp::types::*;
use crate::scp::SCP_TRANSFER_PROGRESS;
use chrono::Utc;
use log::{info, warn};
use std::io::{Read, Write};
use std::path::Path;
use uuid::Uuid;

impl ScpService {
    // ── SCP Upload ───────────────────────────────────────────────────────────

    pub async fn upload(
        &mut self,
        request: ScpTransferRequest,
    ) -> Result<ScpTransferResult, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        // Validate local file
        let metadata = std::fs::metadata(&request.local_path)
            .map_err(|e| format!("Cannot read local file '{}': {}", request.local_path, e))?;
        let total_bytes = metadata.len();

        // Optionally create parent directories on remote
        if request.create_parents {
            if let Some(parent) = Path::new(&request.remote_path).parent() {
                let parent_str = parent.to_string_lossy().to_string();
                if !parent_str.is_empty() && parent_str != "/" {
                    self.remote_mkdir_p(&request.session_id, &parent_str)?;
                }
            }
        }

        // Check overwrite
        if !request.overwrite {
            if self.remote_exists(&request.session_id, &request.remote_path)? {
                return Err(format!(
                    "Remote file '{}' already exists and overwrite is disabled",
                    request.remote_path
                ));
            }
        }

        // Init progress
        let progress = ScpTransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: request.session_id.clone(),
            direction: ScpTransferDirection::Upload,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            total_bytes,
            transferred_bytes: 0,
            percent: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_secs: None,
            status: ScpTransferStatus::InProgress,
            started_at: started,
            error: None,
            retry_attempt: 0,
            current_file: Some(request.local_path.clone()),
            files_total: 1,
            files_completed: 0,
        };

        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            map.insert(transfer_id.clone(), progress);
        }

        // Retry loop
        let mut last_error: Option<String> = None;
        for attempt in 0..=request.retry_count {
            if attempt > 0 {
                warn!(
                    "SCP upload {} retry {}/{}",
                    transfer_id, attempt, request.retry_count
                );
                tokio::time::sleep(std::time::Duration::from_millis(request.retry_delay_ms)).await;
                if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                    if let Some(p) = map.get_mut(&transfer_id) {
                        p.retry_attempt = attempt;
                    }
                }
            }

            match self.do_upload(&transfer_id, &request, total_bytes).await {
                Ok(transferred) => {
                    // Optional checksum verification
                    let checksum = if request.verify_checksum {
                        self.update_progress_status(&transfer_id, ScpTransferStatus::Verifying);
                        match self.verify_checksum(&request.session_id, &request.local_path, &request.remote_path) {
                            Ok(hash) => Some(hash),
                            Err(e) => {
                                warn!("Checksum verification failed: {}", e);
                                None
                            }
                        }
                    } else {
                        None
                    };

                    let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
                    let avg_speed = transferred as f64 / (duration as f64 / 1000.0);

                    self.update_progress_status(&transfer_id, ScpTransferStatus::Completed);
                    self.update_activity(&request.session_id, transferred, 0);

                    let result = ScpTransferResult {
                        transfer_id: transfer_id.clone(),
                        direction: ScpTransferDirection::Upload,
                        local_path: request.local_path.clone(),
                        remote_path: request.remote_path.clone(),
                        bytes_transferred: transferred,
                        duration_ms: duration,
                        average_speed: avg_speed,
                        checksum,
                        success: true,
                        error: None,
                    };

                    // Record in history
                    history::record_transfer(self, &result, &request.session_id);

                    return Ok(result);
                }
                Err(e) => {
                    last_error = Some(e);
                }
            }
        }

        let err_msg = last_error.unwrap_or_else(|| "Unknown error".into());
        self.update_progress_error(&transfer_id, &err_msg);

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
        let result = ScpTransferResult {
            transfer_id: transfer_id.clone(),
            direction: ScpTransferDirection::Upload,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            bytes_transferred: 0,
            duration_ms: duration,
            average_speed: 0.0,
            checksum: None,
            success: false,
            error: Some(err_msg.clone()),
        };

        history::record_transfer(self, &result, &request.session_id);
        Err(err_msg)
    }

    /// Internal upload via SCP.
    async fn do_upload(
        &self,
        transfer_id: &str,
        request: &ScpTransferRequest,
        total_bytes: u64,
    ) -> Result<u64, String> {
        let session = self.get_session(&request.session_id)?;
        let remote_path = Path::new(&request.remote_path);

        // Get local file times for preservation
        let times = if request.preserve_times {
            std::fs::metadata(&request.local_path)
                .ok()
                .and_then(|m| {
                    let mtime = m
                        .modified()
                        .ok()?
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()?
                        .as_secs();
                    let atime = m
                        .accessed()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(mtime);
                    Some((mtime, atime))
                })
        } else {
            None
        };

        // Open SCP send channel
        let mut channel = session
            .scp_send(remote_path, request.file_mode, total_bytes, times)
            .map_err(|e| format!("SCP send init failed: {}", e))?;

        // Open local file and stream it
        let mut local_file = std::fs::File::open(&request.local_path)
            .map_err(|e| format!("Cannot open '{}': {}", request.local_path, e))?;

        let chunk_size = request.chunk_size as usize;
        let mut buffer = vec![0u8; chunk_size];
        let mut transferred: u64 = 0;
        let start = std::time::Instant::now();

        loop {
            let n = local_file
                .read(&mut buffer)
                .map_err(|e| format!("Local read error: {}", e))?;
            if n == 0 {
                break;
            }
            channel
                .write_all(&buffer[..n])
                .map_err(|e| format!("SCP write error: {}", e))?;

            transferred += n as u64;

            // Update progress
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            let speed = transferred as f64 / elapsed;
            let remaining = total_bytes.saturating_sub(transferred);
            let eta = if speed > 0.0 {
                Some(remaining as f64 / speed)
            } else {
                None
            };

            if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(transfer_id) {
                    // Check for cancellation
                    if p.status == ScpTransferStatus::Cancelled {
                        return Err("Transfer cancelled by user".into());
                    }
                    p.transferred_bytes = transferred;
                    p.percent = if total_bytes > 0 {
                        (transferred as f64 / total_bytes as f64) * 100.0
                    } else {
                        100.0
                    };
                    p.speed_bytes_per_sec = speed;
                    p.eta_secs = eta;
                }
            }
        }

        // Close the SCP channel (sends EOF)
        channel
            .send_eof()
            .map_err(|e| format!("Failed to send EOF: {}", e))?;
        channel
            .wait_eof()
            .map_err(|e| format!("Failed waiting for EOF: {}", e))?;
        channel
            .close()
            .map_err(|e| format!("Failed to close channel: {}", e))?;
        channel
            .wait_close()
            .map_err(|e| format!("Failed waiting for close: {}", e))?;

        info!(
            "SCP uploaded {} bytes to {}",
            transferred, request.remote_path
        );
        Ok(transferred)
    }

    // ── SCP Download ─────────────────────────────────────────────────────────

    pub async fn download(
        &mut self,
        request: ScpTransferRequest,
    ) -> Result<ScpTransferResult, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        // Ensure local parent directory exists
        if let Some(parent) = Path::new(&request.local_path).parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create directory '{}': {}", parent.display(), e))?;
            }
        }

        // Check overwrite
        if !request.overwrite && Path::new(&request.local_path).exists() {
            return Err(format!(
                "Local file '{}' already exists and overwrite is disabled",
                request.local_path
            ));
        }

        // Init progress (total_bytes will be updated once we know the remote size)
        let progress = ScpTransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: request.session_id.clone(),
            direction: ScpTransferDirection::Download,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            total_bytes: 0,
            transferred_bytes: 0,
            percent: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_secs: None,
            status: ScpTransferStatus::InProgress,
            started_at: started,
            error: None,
            retry_attempt: 0,
            current_file: Some(request.remote_path.clone()),
            files_total: 1,
            files_completed: 0,
        };

        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            map.insert(transfer_id.clone(), progress);
        }

        // Retry loop
        let mut last_error: Option<String> = None;
        for attempt in 0..=request.retry_count {
            if attempt > 0 {
                warn!(
                    "SCP download {} retry {}/{}",
                    transfer_id, attempt, request.retry_count
                );
                tokio::time::sleep(std::time::Duration::from_millis(request.retry_delay_ms)).await;
                if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                    if let Some(p) = map.get_mut(&transfer_id) {
                        p.retry_attempt = attempt;
                    }
                }
            }

            match self.do_download(&transfer_id, &request).await {
                Ok(transferred) => {
                    // Optional checksum verification
                    let checksum = if request.verify_checksum {
                        self.update_progress_status(&transfer_id, ScpTransferStatus::Verifying);
                        match self.verify_checksum(&request.session_id, &request.local_path, &request.remote_path) {
                            Ok(hash) => Some(hash),
                            Err(e) => {
                                warn!("Checksum verification failed: {}", e);
                                None
                            }
                        }
                    } else {
                        None
                    };

                    let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
                    let avg_speed = transferred as f64 / (duration as f64 / 1000.0);

                    self.update_progress_status(&transfer_id, ScpTransferStatus::Completed);
                    self.update_activity(&request.session_id, 0, transferred);

                    let result = ScpTransferResult {
                        transfer_id: transfer_id.clone(),
                        direction: ScpTransferDirection::Download,
                        local_path: request.local_path.clone(),
                        remote_path: request.remote_path.clone(),
                        bytes_transferred: transferred,
                        duration_ms: duration,
                        average_speed: avg_speed,
                        checksum,
                        success: true,
                        error: None,
                    };

                    history::record_transfer(self, &result, &request.session_id);
                    return Ok(result);
                }
                Err(e) => {
                    last_error = Some(e);
                }
            }
        }

        let err_msg = last_error.unwrap_or_else(|| "Unknown error".into());
        self.update_progress_error(&transfer_id, &err_msg);

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
        let result = ScpTransferResult {
            transfer_id: transfer_id.clone(),
            direction: ScpTransferDirection::Download,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            bytes_transferred: 0,
            duration_ms: duration,
            average_speed: 0.0,
            checksum: None,
            success: false,
            error: Some(err_msg.clone()),
        };

        history::record_transfer(self, &result, &request.session_id);
        Err(err_msg)
    }

    /// Internal download via SCP.
    async fn do_download(
        &self,
        transfer_id: &str,
        request: &ScpTransferRequest,
    ) -> Result<u64, String> {
        let session = self.get_session(&request.session_id)?;
        let remote_path = Path::new(&request.remote_path);

        // Open SCP receive channel
        let (mut channel, stat) = session
            .scp_recv(remote_path)
            .map_err(|e| format!("SCP recv init failed for '{}': {}", request.remote_path, e))?;

        let total_bytes = stat.size();

        // Update progress with known total
        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.total_bytes = total_bytes;
            }
        }

        // Open local file for writing
        let mut local_file = std::fs::File::create(&request.local_path)
            .map_err(|e| format!("Cannot create '{}': {}", request.local_path, e))?;

        let chunk_size = request.chunk_size as usize;
        let mut buffer = vec![0u8; chunk_size];
        let mut transferred: u64 = 0;
        let start = std::time::Instant::now();

        loop {
            let n = channel
                .read(&mut buffer)
                .map_err(|e| format!("SCP read error: {}", e))?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buffer[..n])
                .map_err(|e| format!("Local write error: {}", e))?;

            transferred += n as u64;

            // Update progress
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            let speed = transferred as f64 / elapsed;
            let remaining = total_bytes.saturating_sub(transferred);
            let eta = if speed > 0.0 {
                Some(remaining as f64 / speed)
            } else {
                None
            };

            if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(transfer_id) {
                    if p.status == ScpTransferStatus::Cancelled {
                        // Clean up partial file on cancel
                        drop(local_file);
                        let _ = std::fs::remove_file(&request.local_path);
                        return Err("Transfer cancelled by user".into());
                    }
                    p.transferred_bytes = transferred;
                    p.percent = if total_bytes > 0 {
                        (transferred as f64 / total_bytes as f64) * 100.0
                    } else {
                        100.0
                    };
                    p.speed_bytes_per_sec = speed;
                    p.eta_secs = eta;
                }
            }

            // Stop at the expected file size
            if transferred >= total_bytes {
                break;
            }
        }

        // Ensure local file is flushed
        local_file
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;

        // Close the channel
        channel.send_eof().ok();
        channel.wait_eof().ok();
        channel.close().ok();
        channel.wait_close().ok();

        // Preserve times if requested
        if request.preserve_times {
            // Set file times using stat mode from SCP
            // (SCP ScpFileStat doesn't expose mtime/atime directly, so we'll
            //  optionally use the remote stat if available)
            self.try_preserve_local_times(&request.local_path, &request.session_id, &request.remote_path);
        }

        info!(
            "SCP downloaded {} bytes from {}",
            transferred, request.remote_path
        );
        Ok(transferred)
    }

    // ── Helper: verify checksum match ────────────────────────────────────────

    fn verify_checksum(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<String, String> {
        let local_hash = ScpService::local_checksum(local_path)?;
        let remote_hash = self.remote_checksum(session_id, remote_path)?;

        if local_hash != remote_hash {
            return Err(format!(
                "Checksum mismatch: local={}, remote={}",
                local_hash, remote_hash
            ));
        }

        Ok(local_hash)
    }

    // ── Helper: preserve local file times from remote ────────────────────────

    fn try_preserve_local_times(
        &self,
        local_path: &str,
        session_id: &str,
        remote_path: &str,
    ) {
        // Best-effort: get remote mtime and apply to local file
        if let Ok(info) = self.remote_stat(session_id, remote_path) {
            if let Some(mtime) = info.mtime {
                let mtime_sys = std::time::UNIX_EPOCH
                    + std::time::Duration::from_secs(mtime.timestamp() as u64);
                let atime_sys = info
                    .atime
                    .map(|a| {
                        std::time::UNIX_EPOCH
                            + std::time::Duration::from_secs(a.timestamp() as u64)
                    })
                    .unwrap_or(mtime_sys);
                let _ = filetime::set_file_times(
                    local_path,
                    filetime::FileTime::from_system_time(atime_sys),
                    filetime::FileTime::from_system_time(mtime_sys),
                );
            }
        }
    }

    // ── Progress helpers ─────────────────────────────────────────────────────

    pub(crate) fn update_progress_status(&self, transfer_id: &str, status: ScpTransferStatus) {
        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = status;
                if p.status == ScpTransferStatus::Completed {
                    p.files_completed = p.files_total;
                    p.percent = 100.0;
                }
            }
        }
    }

    pub(crate) fn update_progress_error(&self, transfer_id: &str, error: &str) {
        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = ScpTransferStatus::Failed;
                p.error = Some(error.to_string());
            }
        }
    }

    /// Cancel an active transfer.
    pub fn cancel_transfer(&self, transfer_id: &str) -> Result<(), String> {
        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                if p.status == ScpTransferStatus::InProgress
                    || p.status == ScpTransferStatus::Pending
                {
                    p.status = ScpTransferStatus::Cancelled;
                    return Ok(());
                }
                return Err(format!(
                    "Cannot cancel transfer in {:?} state",
                    p.status
                ));
            }
        }
        Err(format!("Transfer '{}' not found", transfer_id))
    }

    /// Get progress for a specific transfer.
    pub fn get_transfer_progress(
        &self,
        transfer_id: &str,
    ) -> Result<ScpTransferProgress, String> {
        if let Ok(map) = SCP_TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get(transfer_id) {
                return Ok(p.clone());
            }
        }
        Err(format!("Transfer '{}' not found", transfer_id))
    }

    /// List all active transfers.
    pub fn list_active_transfers(&self) -> Vec<ScpTransferProgress> {
        if let Ok(map) = SCP_TRANSFER_PROGRESS.lock() {
            map.values().cloned().collect()
        } else {
            Vec::new()
        }
    }

    /// Clear completed/failed/cancelled transfers from progress tracking.
    pub fn clear_completed_transfers(&self) -> u32 {
        if let Ok(mut map) = SCP_TRANSFER_PROGRESS.lock() {
            let before = map.len();
            map.retain(|_, p| {
                p.status != ScpTransferStatus::Completed
                    && p.status != ScpTransferStatus::Failed
                    && p.status != ScpTransferStatus::Cancelled
            });
            (before - map.len()) as u32
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cancel_transfer_not_found() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let result = svc.cancel_transfer("nonexistent");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_transfer_progress_not_found() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let result = svc.get_transfer_progress("nonexistent");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_active_transfers_empty() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let list = svc.list_active_transfers();
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn test_clear_completed_empty() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let cleared = svc.clear_completed_transfers();
        assert_eq!(cleared, 0);
    }

    #[test]
    fn test_transfer_direction_serialization() {
        let dir = ScpTransferDirection::Upload;
        let json = serde_json::to_string(&dir).unwrap();
        assert_eq!(json, "\"upload\"");

        let dir2: ScpTransferDirection = serde_json::from_str("\"download\"").unwrap();
        assert_eq!(dir2, ScpTransferDirection::Download);
    }

    #[test]
    fn test_transfer_status_serialization() {
        let status = ScpTransferStatus::InProgress;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"inProgress\"");
    }
}
