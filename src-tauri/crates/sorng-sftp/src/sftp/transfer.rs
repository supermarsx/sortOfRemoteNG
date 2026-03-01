// ── Transfer engine – chunked, resumable uploads & downloads ─────────────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use crate::sftp::TRANSFER_PROGRESS;
use chrono::Utc;
use log::warn;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use uuid::Uuid;

impl SftpService {
    // ── Single-file upload (chunked) ─────────────────────────────────────────

    pub async fn upload(
        &mut self,
        request: SftpTransferRequest,
    ) -> Result<TransferResult, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        // Validate local file
        let metadata = std::fs::metadata(&request.local_path)
            .map_err(|e| format!("Cannot read local file '{}': {}", request.local_path, e))?;
        let total_bytes = metadata.len();

        // Determine starting offset for resume
        let start_offset = if request.resume {
            self.remote_file_size(&request.session_id, &request.remote_path)
                .unwrap_or(0)
        } else {
            0
        };

        // Init progress
        let progress = TransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: request.session_id.clone(),
            direction: TransferDirection::Upload,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            total_bytes,
            transferred_bytes: start_offset,
            percent: if total_bytes > 0 {
                (start_offset as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            },
            speed_bytes_per_sec: 0.0,
            eta_secs: None,
            status: TransferStatus::InProgress,
            started_at: started,
            error: None,
            retry_attempt: 0,
        };

        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            map.insert(transfer_id.clone(), progress.clone());
        }

        // Retry loop
        let mut last_error: Option<String> = None;
        for attempt in 0..=request.retry_count {
            if attempt > 0 {
                warn!(
                    "Transfer {} retry {}/{}",
                    transfer_id, attempt, request.retry_count
                );
                tokio::time::sleep(std::time::Duration::from_millis(request.retry_delay_ms)).await;
                if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
                    if let Some(p) = map.get_mut(&transfer_id) {
                        p.retry_attempt = attempt;
                    }
                }
            }

            match self
                .do_upload(&transfer_id, &request, total_bytes, start_offset)
                .await
            {
                Ok(transferred) => {
                    // Optional checksum verification
                    let checksum = if request.verify_checksum {
                        self.update_progress_status(&transfer_id, TransferStatus::Verifying);
                        match self.checksum(&request.session_id, &request.remote_path).await {
                            Ok(c) => Some(c),
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

                    self.update_progress_status(&transfer_id, TransferStatus::Completed);

                    // Update session stats
                    if let Some(handle) = self.sessions.get_mut(&request.session_id) {
                        handle.info.bytes_uploaded += transferred;
                    }

                    return Ok(TransferResult {
                        transfer_id,
                        success: true,
                        bytes_transferred: transferred,
                        duration_ms: duration,
                        average_speed_bps: avg_speed,
                        checksum,
                        error: None,
                    });
                }
                Err(e) => {
                    last_error = Some(e);
                }
            }
        }

        let err = last_error.unwrap_or_else(|| "Unknown upload error".into());
        self.update_progress_error(&transfer_id, &err);

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
        Ok(TransferResult {
            transfer_id,
            success: false,
            bytes_transferred: 0,
            duration_ms: duration,
            average_speed_bps: 0.0,
            checksum: None,
            error: Some(err),
        })
    }

    async fn do_upload(
        &mut self,
        transfer_id: &str,
        request: &SftpTransferRequest,
        total_bytes: u64,
        start_offset: u64,
    ) -> Result<u64, String> {
        let chunk_size = request.chunk_size as usize;

        // Open local file
        let mut local_file = std::fs::File::open(&request.local_path)
            .map_err(|e| format!("Failed to open '{}': {}", request.local_path, e))?;

        if start_offset > 0 {
            local_file
                .seek(SeekFrom::Start(start_offset))
                .map_err(|e| format!("Failed to seek local file: {}", e))?;
        }

        // Open remote file
        let (sftp, _handle) = self.sftp_channel(&request.session_id)?;

        let open_flags = if start_offset > 0 {
            ssh2::OpenFlags::WRITE | ssh2::OpenFlags::APPEND
        } else {
            ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::TRUNCATE
        };

        let open_type = ssh2::OpenType::File;
        let mut remote_file = sftp
            .open_mode(Path::new(&request.remote_path), open_flags, 0o644, open_type)
            .map_err(|e| format!("Failed to open remote '{}': {}", request.remote_path, e))?;

        let mut transferred: u64 = start_offset;
        let mut buf = vec![0u8; chunk_size];
        let bw_limit = request.bandwidth_limit_kbps.map(|k| k * 1024); // bytes/sec
        let epoch = std::time::Instant::now();

        loop {
            let n = local_file
                .read(&mut buf)
                .map_err(|e| format!("Read error: {}", e))?;
            if n == 0 {
                break;
            }

            remote_file
                .write_all(&buf[..n])
                .map_err(|e| format!("Write error: {}", e))?;

            transferred += n as u64;

            // Update progress
            let elapsed = epoch.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                (transferred - start_offset) as f64 / elapsed
            } else {
                0.0
            };
            let remaining = total_bytes.saturating_sub(transferred);
            let eta = if speed > 0.0 {
                Some(remaining as f64 / speed)
            } else {
                None
            };

            if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(transfer_id) {
                    p.transferred_bytes = transferred;
                    p.percent = if total_bytes > 0 {
                        (transferred as f64 / total_bytes as f64) * 100.0
                    } else {
                        100.0
                    };
                    p.speed_bytes_per_sec = speed;
                    p.eta_secs = eta;

                    // Check for cancellation
                    if p.status == TransferStatus::Cancelled {
                        return Err("Transfer cancelled".into());
                    }
                }
            }

            // Bandwidth throttle
            if let Some(limit) = bw_limit {
                let expected_time = (transferred - start_offset) as f64 / limit as f64;
                if elapsed < expected_time {
                    let sleep_dur = expected_time - elapsed;
                    std::thread::sleep(std::time::Duration::from_secs_f64(sleep_dur));
                }
            }
        }

        // Preserve timestamps
        if request.preserve_timestamps {
            if let Ok(lm) = std::fs::metadata(&request.local_path) {
                if let Ok(mod_time) = lm.modified() {
                    let ts = mod_time
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let mut stat = sftp
                        .stat(Path::new(&request.remote_path))
                        .unwrap_or(ssh2::FileStat {
                            size: None,
                            uid: None,
                            gid: None,
                            perm: None,
                            atime: None,
                            mtime: None,
                        });
                    stat.mtime = Some(ts);
                    let _ = sftp.setstat(Path::new(&request.remote_path), stat);
                }
            }
        }

        Ok(transferred - start_offset)
    }

    // ── Single-file download (chunked) ───────────────────────────────────────

    pub async fn download(
        &mut self,
        request: SftpTransferRequest,
    ) -> Result<TransferResult, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        // Get remote file size
        let total_bytes = self
            .remote_file_size(&request.session_id, &request.remote_path)
            .unwrap_or(0);

        // Resume offset
        let start_offset = if request.resume {
            std::fs::metadata(&request.local_path)
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        // Init progress
        let progress = TransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: request.session_id.clone(),
            direction: TransferDirection::Download,
            local_path: request.local_path.clone(),
            remote_path: request.remote_path.clone(),
            total_bytes,
            transferred_bytes: start_offset,
            percent: if total_bytes > 0 {
                (start_offset as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            },
            speed_bytes_per_sec: 0.0,
            eta_secs: None,
            status: TransferStatus::InProgress,
            started_at: started,
            error: None,
            retry_attempt: 0,
        };

        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            map.insert(transfer_id.clone(), progress);
        }

        // Retry loop
        let mut last_error: Option<String> = None;
        for attempt in 0..=request.retry_count {
            if attempt > 0 {
                warn!(
                    "Download {} retry {}/{}",
                    transfer_id, attempt, request.retry_count
                );
                tokio::time::sleep(std::time::Duration::from_millis(request.retry_delay_ms)).await;
                if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
                    if let Some(p) = map.get_mut(&transfer_id) {
                        p.retry_attempt = attempt;
                    }
                }
            }

            match self
                .do_download(&transfer_id, &request, total_bytes, start_offset)
                .await
            {
                Ok(transferred) => {
                    let checksum = if request.verify_checksum {
                        self.update_progress_status(&transfer_id, TransferStatus::Verifying);
                        // Local hash
                        compute_local_checksum(&request.local_path).ok()
                    } else {
                        None
                    };

                    let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
                    let avg_speed = transferred as f64 / (duration as f64 / 1000.0);

                    self.update_progress_status(&transfer_id, TransferStatus::Completed);

                    if let Some(handle) = self.sessions.get_mut(&request.session_id) {
                        handle.info.bytes_downloaded += transferred;
                    }

                    return Ok(TransferResult {
                        transfer_id,
                        success: true,
                        bytes_transferred: transferred,
                        duration_ms: duration,
                        average_speed_bps: avg_speed,
                        checksum,
                        error: None,
                    });
                }
                Err(e) => {
                    last_error = Some(e);
                }
            }
        }

        let err = last_error.unwrap_or_else(|| "Unknown download error".into());
        self.update_progress_error(&transfer_id, &err);

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;
        Ok(TransferResult {
            transfer_id,
            success: false,
            bytes_transferred: 0,
            duration_ms: duration,
            average_speed_bps: 0.0,
            checksum: None,
            error: Some(err),
        })
    }

    async fn do_download(
        &mut self,
        transfer_id: &str,
        request: &SftpTransferRequest,
        total_bytes: u64,
        start_offset: u64,
    ) -> Result<u64, String> {
        let chunk_size = request.chunk_size as usize;

        let (sftp, _handle) = self.sftp_channel(&request.session_id)?;

        let mut remote_file = sftp
            .open(Path::new(&request.remote_path))
            .map_err(|e| format!("Failed to open remote '{}': {}", request.remote_path, e))?;

        if start_offset > 0 {
            use std::io::Seek;
            remote_file
                .seek(SeekFrom::Start(start_offset))
                .map_err(|e| format!("Failed to seek remote file: {}", e))?;
        }

        // Open local file
        let mut local_file = if start_offset > 0 {
            std::fs::OpenOptions::new()
                .write(true)
                .append(true)
                .open(&request.local_path)
                .map_err(|e| format!("Failed to open local '{}': {}", request.local_path, e))?
        } else {
            // Ensure parent directory exists
            if let Some(parent) = Path::new(&request.local_path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::File::create(&request.local_path)
                .map_err(|e| format!("Failed to create local '{}': {}", request.local_path, e))?
        };

        let mut transferred: u64 = start_offset;
        let mut buf = vec![0u8; chunk_size];
        let bw_limit = request.bandwidth_limit_kbps.map(|k| k * 1024);
        let epoch = std::time::Instant::now();

        loop {
            let n = remote_file
                .read(&mut buf)
                .map_err(|e| format!("Read error: {}", e))?;
            if n == 0 {
                break;
            }

            local_file
                .write_all(&buf[..n])
                .map_err(|e| format!("Write error: {}", e))?;

            transferred += n as u64;

            let elapsed = epoch.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                (transferred - start_offset) as f64 / elapsed
            } else {
                0.0
            };
            let remaining = total_bytes.saturating_sub(transferred);
            let eta = if speed > 0.0 {
                Some(remaining as f64 / speed)
            } else {
                None
            };

            if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
                if let Some(p) = map.get_mut(transfer_id) {
                    p.transferred_bytes = transferred;
                    p.percent = if total_bytes > 0 {
                        (transferred as f64 / total_bytes as f64) * 100.0
                    } else {
                        100.0
                    };
                    p.speed_bytes_per_sec = speed;
                    p.eta_secs = eta;

                    if p.status == TransferStatus::Cancelled {
                        return Err("Transfer cancelled".into());
                    }
                }
            }

            // Bandwidth throttle
            if let Some(limit) = bw_limit {
                let expected_time = (transferred - start_offset) as f64 / limit as f64;
                if elapsed < expected_time {
                    std::thread::sleep(std::time::Duration::from_secs_f64(
                        expected_time - elapsed,
                    ));
                }
            }
        }

        local_file.flush().map_err(|e| format!("Flush error: {}", e))?;

        // Preserve timestamps
        if request.preserve_timestamps {
            if let Ok(remote_stat) = sftp.stat(Path::new(&request.remote_path)) {
                if let Some(mtime) = remote_stat.mtime {
                    let ft = filetime::FileTime::from_unix_time(mtime as i64, 0);
                    let _ = filetime::set_file_mtime(&request.local_path, ft);
                }
            }
        }

        Ok(transferred - start_offset)
    }

    // ── Batch transfer ───────────────────────────────────────────────────────

    pub async fn batch_transfer(
        &mut self,
        batch: SftpBatchTransfer,
    ) -> Result<BatchTransferResult, String> {
        let started = Utc::now();
        let total_items = batch.items.len();
        let mut results: Vec<TransferResult> = Vec::with_capacity(total_items);
        let mut succeeded = 0usize;
        let mut failed = 0usize;
        let skipped = 0usize;
        let mut total_bytes = 0u64;

        for item in &batch.items {
            let request = SftpTransferRequest {
                session_id: batch.session_id.clone(),
                local_path: item.local_path.clone(),
                remote_path: item.remote_path.clone(),
                direction: item.direction.clone(),
                chunk_size: batch.chunk_size,
                resume: false,
                on_conflict: ConflictResolution::Overwrite,
                preserve_timestamps: true,
                preserve_permissions: false,
                bandwidth_limit_kbps: None,
                retry_count: 2,
                retry_delay_ms: 1000,
                verify_checksum: batch.verify_checksums,
            };

            let result = match item.direction {
                TransferDirection::Upload => self.upload(request).await,
                TransferDirection::Download => self.download(request).await,
            };

            match result {
                Ok(r) => {
                    if r.success {
                        succeeded += 1;
                        total_bytes += r.bytes_transferred;
                    } else {
                        failed += 1;
                        if matches!(batch.on_error, BatchErrorPolicy::Abort) {
                            results.push(r);
                            break;
                        }
                    }
                    results.push(r);
                }
                Err(e) => {
                    failed += 1;
                    results.push(TransferResult {
                        transfer_id: Uuid::new_v4().to_string(),
                        success: false,
                        bytes_transferred: 0,
                        duration_ms: 0,
                        average_speed_bps: 0.0,
                        checksum: None,
                        error: Some(e),
                    });
                    if matches!(batch.on_error, BatchErrorPolicy::Abort) {
                        break;
                    }
                }
            }
        }

        let duration = (Utc::now() - started).num_milliseconds().max(1) as u64;

        Ok(BatchTransferResult {
            total_items,
            succeeded,
            failed,
            skipped,
            total_bytes,
            duration_ms: duration,
            results,
        })
    }

    // ── Progress / control helpers ───────────────────────────────────────────

    pub fn get_transfer_progress(&self, transfer_id: &str) -> Option<TransferProgress> {
        TRANSFER_PROGRESS
            .lock()
            .ok()
            .and_then(|map| map.get(transfer_id).cloned())
    }

    pub fn list_active_transfers(&self) -> Vec<TransferProgress> {
        TRANSFER_PROGRESS
            .lock()
            .ok()
            .map(|map| {
                map.values()
                    .filter(|p| {
                        matches!(
                            p.status,
                            TransferStatus::InProgress | TransferStatus::Queued | TransferStatus::Paused
                        )
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn cancel_transfer(&self, transfer_id: &str) -> Result<(), String> {
        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = TransferStatus::Cancelled;
                return Ok(());
            }
        }
        Err(format!("Transfer '{}' not found", transfer_id))
    }

    pub fn pause_transfer(&self, transfer_id: &str) -> Result<(), String> {
        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = TransferStatus::Paused;
                return Ok(());
            }
        }
        Err(format!("Transfer '{}' not found", transfer_id))
    }

    pub fn clear_completed_transfers(&self) -> usize {
        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            let before = map.len();
            map.retain(|_, p| {
                !matches!(
                    p.status,
                    TransferStatus::Completed | TransferStatus::Failed | TransferStatus::Cancelled
                )
            });
            before - map.len()
        } else {
            0
        }
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fn remote_file_size(&mut self, session_id: &str, path: &str) -> Result<u64, String> {
        let (sftp, _) = self.sftp_channel(session_id)?;
        let stat = sftp
            .stat(Path::new(path))
            .map_err(|e| format!("stat '{}' failed: {}", path, e))?;
        Ok(stat.size.unwrap_or(0))
    }

    fn update_progress_status(&self, transfer_id: &str, status: TransferStatus) {
        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = status;
            }
        }
    }

    fn update_progress_error(&self, transfer_id: &str, error: &str) {
        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = TransferStatus::Failed;
                p.error = Some(error.to_string());
            }
        }
    }
}

// ── Standalone helper ────────────────────────────────────────────────────────

fn compute_local_checksum(path: &str) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Cannot open '{}': {}", path, e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}
