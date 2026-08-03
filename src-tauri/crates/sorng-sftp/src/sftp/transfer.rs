// ── Transfer engine – chunked, resumable uploads & downloads ─────────────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use crate::sftp::TRANSFER_PROGRESS;
use chrono::Utc;
use log::warn;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_TRANSFER_CHUNK_SIZE: u64 = 8 * 1024 * 1024;
const MAX_TRANSFER_RETRIES: u32 = 5;
const MAX_RETRY_DELAY_MS: u64 = 30_000;
const MAX_REMOTE_PATH_BYTES: usize = 4096;
const MAX_LOCAL_PATH_BYTES: usize = 32_768;
const MAX_TRACKED_TRANSFERS: usize = 512;

pub(crate) fn validate_remote_file_path(path: &str) -> Result<(), String> {
    if path.len() > MAX_REMOTE_PATH_BYTES
        || !path.starts_with('/')
        || path == "/"
        || path.contains('\\')
        || path.chars().any(|c| c == '\0' || c.is_control())
        || path
            .split('/')
            .any(|component| matches!(component, "." | ".."))
    {
        return Err(
            "Remote file path must be a bounded absolute POSIX path without traversal".to_string(),
        );
    }
    Ok(())
}

fn validate_transfer_request(request: &SftpTransferRequest) -> Result<(), String> {
    checked_chunk_size(request.chunk_size)?;
    validate_remote_file_path(&request.remote_path)?;
    if request.local_path.is_empty()
        || request.local_path.len() > MAX_LOCAL_PATH_BYTES
        || request
            .local_path
            .chars()
            .any(|c| c == '\0' || c.is_control())
        || request.retry_count > MAX_TRANSFER_RETRIES
        || request.retry_delay_ms > MAX_RETRY_DELAY_MS
        || matches!(request.bandwidth_limit_kbps, Some(0))
    {
        return Err(
            "Transfer request contains an invalid path, retry, or bandwidth value".to_string(),
        );
    }
    Ok(())
}

fn checked_chunk_size(chunk_size: u64) -> Result<usize, String> {
    if chunk_size == 0 || chunk_size > MAX_TRANSFER_CHUNK_SIZE {
        return Err(format!(
            "Transfer chunk size must be between 1 and {} bytes",
            MAX_TRANSFER_CHUNK_SIZE
        ));
    }
    usize::try_from(chunk_size).map_err(|_| "Transfer chunk size is unsupported".to_string())
}

fn regular_local_upload(path: &str) -> Result<std::fs::Metadata, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Cannot inspect local file '{}': {}", path, e))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Refusing to upload local symlink '{}'", path));
    }
    if !metadata.is_file() {
        return Err(format!(
            "Local upload source '{}' is not a regular file",
            path
        ));
    }
    Ok(metadata)
}

fn reject_local_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "Refusing to write through local symlink '{}'",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Cannot inspect local destination '{}': {}",
            path.display(),
            error
        )),
    }
}

fn staging_path(destination: &Path, transfer_id: &str) -> Result<PathBuf, String> {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Local download destination must have a valid file name".to_string())?;
    Ok(parent.join(format!(".{}.sorng-part-{}", name, transfer_id)))
}

struct PartialDownloadGuard {
    path: PathBuf,
    armed: bool,
}

impl PartialDownloadGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PartialDownloadGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn commit_staged_download(
    staging: &Path,
    destination: &Path,
    transfer_id: &str,
    overwrite: bool,
) -> Result<(), String> {
    reject_local_symlink(destination)?;
    if !destination.exists() {
        return std::fs::rename(staging, destination).map_err(|e| {
            format!(
                "Failed to commit download '{}': {}",
                destination.display(),
                e
            )
        });
    }
    if !overwrite {
        return Err(format!(
            "Local destination '{}' appeared during transfer; overwrite is disabled",
            destination.display()
        ));
    }

    let backup = destination.with_extension(format!("sorng-old-{}", transfer_id));
    std::fs::rename(destination, &backup).map_err(|e| {
        format!(
            "Failed to protect existing destination '{}': {}",
            destination.display(),
            e
        )
    })?;
    if let Err(error) = std::fs::rename(staging, destination) {
        let rollback = std::fs::rename(&backup, destination);
        return Err(match rollback {
            Ok(()) => format!("Failed to commit download; original restored: {}", error),
            Err(rollback_error) => format!(
                "Failed to commit download and restore original '{}': {}; rollback: {}",
                destination.display(),
                error,
                rollback_error
            ),
        });
    }
    let _ = std::fs::remove_file(backup);
    Ok(())
}

impl SftpService {
    // ── Single-file upload (chunked) ─────────────────────────────────────────

    pub async fn upload(&mut self, request: SftpTransferRequest) -> Result<TransferResult, String> {
        validate_transfer_request(&request)?;
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        // Validate local file
        let metadata = regular_local_upload(&request.local_path)?;
        let total_bytes = metadata.len();

        // Determine starting offset for resume
        let start_offset = if request.resume {
            self.remote_file_size(&request.session_id, &request.remote_path)
                .unwrap_or(0)
        } else {
            0
        };
        if start_offset > total_bytes {
            return Err(format!(
                "Cannot resume upload: remote size {} exceeds local size {}",
                start_offset, total_bytes
            ));
        }

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

        {
            let mut map = TRANSFER_PROGRESS
                .lock()
                .map_err(|_| "SFTP transfer progress state is unavailable".to_string())?;
            map.retain(|_, item| {
                !matches!(
                    &item.status,
                    TransferStatus::Completed | TransferStatus::Failed | TransferStatus::Cancelled
                )
            });
            if map.len() >= MAX_TRACKED_TRANSFERS {
                return Err("Too many active SFTP transfers".to_string());
            }
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
                        let local = match compute_local_checksum(Path::new(&request.local_path)) {
                            Ok(value) => value,
                            Err(error) => {
                                last_error = Some(error);
                                continue;
                            }
                        };
                        match self
                            .checksum(&request.session_id, &request.remote_path)
                            .await
                        {
                            Ok(remote) if remote == local => Some(local),
                            Ok(_) => {
                                last_error = Some("SFTP upload checksum mismatch".to_string());
                                continue;
                            }
                            Err(error) => {
                                last_error = Some(format!("SFTP upload checksum failed: {error}"));
                                continue;
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
        let chunk_size = checked_chunk_size(request.chunk_size)?;

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
            .open_mode(
                Path::new(&request.remote_path),
                open_flags,
                0o644,
                open_type,
            )
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
                    let mut stat =
                        sftp.stat(Path::new(&request.remote_path))
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
        validate_transfer_request(&request)?;
        let transfer_id = Uuid::new_v4().to_string();
        let started = Utc::now();

        // Get remote file size
        let total_bytes = self.remote_file_size(&request.session_id, &request.remote_path)?;

        // Resume offset
        let local_path = Path::new(&request.local_path);
        reject_local_symlink(local_path)?;
        let resume = request.resume || matches!(request.on_conflict, ConflictResolution::Resume);
        let start_offset = if resume {
            match std::fs::symlink_metadata(local_path) {
                Ok(metadata) if metadata.is_file() => metadata.len(),
                Ok(_) => {
                    return Err(format!(
                        "Local resume destination '{}' is not a regular file",
                        request.local_path
                    ));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
                Err(error) => {
                    return Err(format!(
                        "Cannot inspect local destination '{}': {}",
                        request.local_path, error
                    ));
                }
            }
        } else {
            if local_path.exists() && !matches!(request.on_conflict, ConflictResolution::Overwrite)
            {
                return Err(format!(
                    "Local file '{}' exists and conflict policy does not authorize overwrite",
                    request.local_path
                ));
            }
            0
        };
        if start_offset > total_bytes {
            return Err(format!(
                "Cannot resume download: local size {} exceeds remote size {}",
                start_offset, total_bytes
            ));
        }

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

        {
            let mut map = TRANSFER_PROGRESS
                .lock()
                .map_err(|_| "SFTP transfer progress state is unavailable".to_string())?;
            map.retain(|_, item| {
                !matches!(
                    &item.status,
                    TransferStatus::Completed | TransferStatus::Failed | TransferStatus::Cancelled
                )
            });
            if map.len() >= MAX_TRACKED_TRANSFERS {
                return Err("Too many active SFTP transfers".to_string());
            }
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
                        match compute_local_checksum(Path::new(&request.local_path)) {
                            Ok(value) => Some(value),
                            Err(error) => {
                                last_error = Some(error);
                                continue;
                            }
                        }
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
        let chunk_size = checked_chunk_size(request.chunk_size)?;
        let expected_checksum = if request.verify_checksum {
            Some(
                self.checksum(&request.session_id, &request.remote_path)
                    .await?,
            )
        } else {
            None
        };

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

        let destination = Path::new(&request.local_path);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create local directory '{}': {}",
                    parent.display(),
                    e
                )
            })?;
        }
        let staged_path = (start_offset == 0)
            .then(|| staging_path(destination, transfer_id))
            .transpose()?;
        let output_path = staged_path.as_deref().unwrap_or(destination);
        let mut partial_guard = staged_path.clone().map(PartialDownloadGuard::new);
        let mut local_file = if start_offset > 0 {
            std::fs::OpenOptions::new()
                .append(true)
                .open(destination)
                .map_err(|e| format!("Failed to open local '{}': {}", request.local_path, e))?
        } else {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output_path)
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
                    std::thread::sleep(std::time::Duration::from_secs_f64(expected_time - elapsed));
                }
            }
        }

        local_file
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;
        if transferred != total_bytes {
            return Err(format!(
                "SFTP download ended at {} bytes; expected {}",
                transferred, total_bytes
            ));
        }
        drop(local_file);
        if let Some(expected) = expected_checksum {
            let actual = compute_local_checksum(output_path)?;
            if actual != expected {
                return Err(
                    "SFTP download checksum mismatch; staged file was discarded".to_string()
                );
            }
        }
        if let Some(staged) = staged_path.as_deref() {
            commit_staged_download(
                staged,
                destination,
                transfer_id,
                matches!(request.on_conflict, ConflictResolution::Overwrite),
            )?;
            if let Some(guard) = partial_guard.as_mut() {
                guard.disarm();
            }
        }

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
                            TransferStatus::InProgress
                                | TransferStatus::Queued
                                | TransferStatus::Paused
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

fn compute_local_checksum(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open '{}': {}", path.display(), e))?;
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

#[cfg(test)]
mod transfer_safety_tests {
    use super::*;

    #[test]
    fn rejects_zero_and_oversized_chunks() {
        assert!(checked_chunk_size(0).is_err());
        assert!(checked_chunk_size(MAX_TRANSFER_CHUNK_SIZE + 1).is_err());
        assert_eq!(checked_chunk_size(64 * 1024).unwrap(), 64 * 1024);
    }
}
