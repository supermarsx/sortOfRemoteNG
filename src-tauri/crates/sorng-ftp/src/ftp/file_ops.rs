//! File-level operations — upload, download, append, resume, delete, etc.
//! All transfer operations update `TRANSFER_PROGRESS`.

use crate::ftp::client::{validate_remote_path, FtpClient};
use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::transfer::DataStream;
use crate::ftp::types::*;
use crate::ftp::{MAX_TRACKED_TRANSFERS, TRANSFER_PROGRESS};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;

/// Default chunk size for streaming transfers (64 KiB).
const DEFAULT_CHUNK: usize = 65_536;
const MAX_TRANSFER_BYTES: u64 = 16 * 1_024 * 1_024 * 1_024;
const MAX_FAILURE_PATH_CHARS: usize = 1_024;

#[derive(Clone, Copy)]
enum DownloadMode {
    Fresh,
    ResumeExisting { offset: u64 },
}

enum PublishMode {
    NoClobber,
    ReplaceExisting {
        expected_len: u64,
        expected_modified: Option<SystemTime>,
        permissions: std::fs::Permissions,
    },
}

struct DownloadTarget {
    file: Option<fs::File>,
    final_path: PathBuf,
    staging_path: PathBuf,
    publish_mode: PublishMode,
    retain_on_failure: bool,
    received_remote_data: bool,
    handled: bool,
}

impl DownloadTarget {
    fn file_mut(&mut self) -> FtpResult<&mut fs::File> {
        self.file
            .as_mut()
            .ok_or_else(|| FtpError::io_error("FTP download staging file is unavailable"))
    }

    fn note_remote_data(&mut self) {
        self.received_remote_data = true;
    }

    async fn fail(mut self, mut error: FtpError) -> FtpError {
        self.file.take();
        let display = bounded_path(&self.staging_path);
        if self.retain_on_failure && self.received_remote_data {
            self.handled = true;
            append_error_context(
                &mut error,
                &format!("incomplete download retained at {display}"),
            );
            return error;
        }

        let cleanup = fs::remove_file(&self.staging_path).await;
        self.handled = true;
        match cleanup {
            Ok(()) => append_error_context(&mut error, "incomplete download staging removed"),
            Err(cleanup_error) if cleanup_error.kind() == ErrorKind::NotFound => {
                append_error_context(&mut error, "incomplete download staging absent")
            }
            Err(cleanup_error) => append_error_context(
                &mut error,
                &format!(
                    "incomplete staging cleanup failed at {display}: {}",
                    cleanup_error
                ),
            ),
        }
        error
    }

    async fn publish(mut self) -> FtpResult<()> {
        self.file.take();
        let publication = match &self.publish_mode {
            PublishMode::NoClobber => fs::hard_link(&self.staging_path, &self.final_path)
                .await
                .map_err(|error| {
                    if error.kind() == ErrorKind::AlreadyExists {
                        FtpError::invalid_config(
                            "Download destination appeared before publication; refusing to overwrite it",
                        )
                    } else {
                        FtpError::io_error(format!(
                            "Could not atomically publish FTP download without overwriting: {error}"
                        ))
                    }
                }),
            PublishMode::ReplaceExisting {
                expected_len,
                expected_modified,
                permissions,
            } => {
                let current =
                    fs::symlink_metadata(&self.final_path).await.map_err(FtpError::from)?;
                let modified_changed = expected_modified
                    .as_ref()
                    .is_some_and(|expected| current.modified().ok().as_ref() != Some(expected));
                if current.file_type().is_symlink()
                    || !current.is_file()
                    || current.len() != *expected_len
                    || modified_changed
                {
                    Err(FtpError::invalid_config(
                        "Resume destination changed before publication; refusing to replace it",
                    ))
                } else {
                    fs::set_permissions(&self.staging_path, permissions.clone())
                        .await
                        .map_err(FtpError::from)?;
                    atomic_replace(&self.staging_path, &self.final_path)
                        .await
                        .map_err(|error| {
                            FtpError::io_error(format!(
                                "Could not atomically publish resumed FTP download: {error}"
                            ))
                        })
                }
            }
        };

        if let Err(error) = publication {
            return Err(self.fail(error).await);
        }

        if matches!(&self.publish_mode, PublishMode::NoClobber) {
            self.handled = true;
            if let Err(error) = fs::remove_file(&self.staging_path).await {
                if error.kind() != ErrorKind::NotFound {
                    return Err(FtpError::io_error(format!(
                        "Download was published, but staging cleanup failed at {}: {}",
                        bounded_path(&self.staging_path),
                        error
                    )));
                }
            }
        } else {
            self.handled = true;
        }
        Ok(())
    }
}

impl Drop for DownloadTarget {
    fn drop(&mut self) {
        self.file.take();
        if !(self.handled || self.retain_on_failure && self.received_remote_data) {
            let _ = std::fs::remove_file(&self.staging_path);
        }
    }
}

async fn prepare_parent(path: &Path) -> FtpResult<()> {
    let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    else {
        return Ok(());
    };
    for ancestor in parent
        .ancestors()
        .filter(|ancestor| !ancestor.as_os_str().is_empty())
    {
        match fs::symlink_metadata(ancestor).await {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(FtpError::invalid_config(
                        "Download parent path contains a symlink or non-directory",
                    ));
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    fs::create_dir_all(parent).await?;
    let metadata = fs::symlink_metadata(parent).await?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(FtpError::invalid_config(
            "Download parent must be a real directory",
        ));
    }
    Ok(())
}

fn staging_path(path: &Path) -> FtpResult<PathBuf> {
    if path.as_os_str().is_empty() || path.file_name().is_none() {
        return Err(FtpError::invalid_config(
            "Download destination must name a file",
        ));
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path.as_os_str().to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(parent.join(format!(".sorng-ftp-{hash:016x}.partial")))
}

async fn open_download_target(
    local_path: &str,
    mode: DownloadMode,
    retain_on_failure: bool,
    io_timeout: Duration,
) -> FtpResult<DownloadTarget> {
    let path = Path::new(local_path);
    prepare_parent(path).await?;
    let publish_mode = match mode {
        DownloadMode::Fresh => match fs::symlink_metadata(path).await {
            Ok(_) => {
                return Err(FtpError::invalid_config(
                    "Download destination already exists; use resume explicitly",
                ))
            }
            Err(error) if error.kind() == ErrorKind::NotFound => PublishMode::NoClobber,
            Err(error) => return Err(error.into()),
        },
        DownloadMode::ResumeExisting { offset } => {
            let metadata = fs::symlink_metadata(path).await?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(FtpError::invalid_config(
                    "Resume destination must be a regular non-symlink file",
                ));
            }
            if metadata.len() != offset {
                return Err(FtpError::invalid_config(
                    "Resume destination changed while preparing the transfer",
                ));
            }
            PublishMode::ReplaceExisting {
                expected_len: offset,
                expected_modified: metadata.modified().ok(),
                permissions: metadata.permissions(),
            }
        }
    };

    let stage_path = staging_path(path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let stage_file = options.open(&stage_path).await.map_err(|error| {
        if error.kind() == ErrorKind::AlreadyExists {
            FtpError::invalid_config(format!(
                "A retained or stale FTP staging file already exists at {}",
                bounded_path(&stage_path)
            ))
        } else {
            error.into()
        }
    })?;

    let mut target = DownloadTarget {
        file: Some(stage_file),
        final_path: path.to_path_buf(),
        staging_path: stage_path,
        publish_mode,
        retain_on_failure,
        received_remote_data: false,
        handled: false,
    };

    if let DownloadMode::ResumeExisting { offset } = mode {
        copy_existing_prefix(path, target.file_mut()?, offset, io_timeout).await?;
    }
    Ok(target)
}

async fn copy_existing_prefix(
    source_path: &Path,
    destination: &mut fs::File,
    expected_len: u64,
    io_timeout: Duration,
) -> FtpResult<()> {
    let mut source = fs::File::open(source_path).await?;
    let mut copied = 0u64;
    let mut buffer = vec![0u8; DEFAULT_CHUNK];
    while copied < expected_len {
        let remaining = expected_len.saturating_sub(copied);
        let limit = remaining.min(buffer.len() as u64) as usize;
        let count = timeout(io_timeout, source.read(&mut buffer[..limit]))
            .await
            .map_err(|_| FtpError::timeout("Resume source read timed out"))??;
        if count == 0 {
            return Err(FtpError::io_error(
                "Resume destination changed while copying to protected staging",
            ));
        }
        timeout(io_timeout, destination.write_all(&buffer[..count]))
            .await
            .map_err(|_| FtpError::timeout("Resume staging write timed out"))??;
        copied = copied.saturating_add(count as u64);
    }
    Ok(())
}

fn bounded_path(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .take(MAX_FAILURE_PATH_CHARS)
        .collect()
}

fn append_error_context(error: &mut FtpError, context: &str) {
    error.message = format!("{}; {}", error.message, context)
        .chars()
        .take(4_096)
        .collect();
}

#[cfg(unix)]
async fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination).await
}

#[cfg(windows)]
async fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    let source = source.to_path_buf();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || {
        const REPLACEFILE_WRITE_THROUGH: u32 = 0x0000_0001;
        #[link(name = "kernel32")]
        extern "system" {
            fn ReplaceFileW(
                replaced_file_name: *const u16,
                replacement_file_name: *const u16,
                backup_file_name: *const u16,
                replace_flags: u32,
                exclude: *mut std::ffi::c_void,
                reserved: *mut std::ffi::c_void,
            ) -> i32;
        }

        let replaced: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let replacement: Vec<u16> = source
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let result = unsafe {
            ReplaceFileW(
                replaced.as_ptr(),
                replacement.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if result == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    })
    .await
    .map_err(|error| std::io::Error::other(format!("Atomic replace task failed: {error}")))?
}

#[cfg(not(any(unix, windows)))]
async fn atomic_replace(_source: &Path, _destination: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "Atomic replacement is unsupported on this platform",
    ))
}

async fn validate_upload_source(local_path: &str) -> FtpResult<std::fs::Metadata> {
    let metadata = fs::symlink_metadata(local_path).await?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(FtpError::invalid_config(
            "Upload source must be a regular non-symlink file",
        ));
    }
    if metadata.len() > MAX_TRANSFER_BYTES {
        return Err(FtpError::invalid_config(
            "Upload source exceeded the 16 GiB transfer limit",
        ));
    }
    Ok(metadata)
}

impl FtpClient {
    // ─── DOWNLOAD (RETR) ─────────────────────────────────────────

    /// Download a remote file to a local path.
    pub async fn download(
        &mut self,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<&str>,
    ) -> FtpResult<u64> {
        self.download_inner(remote_path, local_path, transfer_id, DownloadMode::Fresh)
            .await
    }

    /// Resume a download from the given offset.
    pub async fn resume_download(
        &mut self,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<&str>,
    ) -> FtpResult<u64> {
        let offset = match fs::symlink_metadata(local_path).await {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(FtpError::invalid_config(
                        "Resume destination must be a regular non-symlink file",
                    ));
                }
                metadata.len()
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Err(FtpError::invalid_config(
                    "Resume destination does not exist; use a fresh download explicitly",
                ))
            }
            Err(error) => return Err(error.into()),
        };
        self.download_inner(
            remote_path,
            local_path,
            transfer_id,
            DownloadMode::ResumeExisting { offset },
        )
        .await
    }

    async fn download_inner(
        &mut self,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<&str>,
        mode: DownloadMode,
    ) -> FtpResult<u64> {
        let remote_path = validate_remote_path(remote_path)?.to_string();
        let resume_offset = match mode {
            DownloadMode::Fresh => 0,
            DownloadMode::ResumeExisting { offset } => offset,
        };
        if resume_offset > MAX_TRANSFER_BYTES {
            return Err(FtpError::invalid_config(
                "Resume offset exceeded the 16 GiB transfer limit",
            ));
        }
        // Ensure binary mode for download
        self.set_type(TransferType::Binary).await?;

        // Get file size for progress (best effort)
        let total_bytes = if self.features.size {
            Some(self.size(&remote_path).await?)
        } else {
            None
        };
        if total_bytes.is_some_and(|size| size > MAX_TRANSFER_BYTES) {
            return Err(FtpError::invalid_config(
                "Remote file exceeded the 16 GiB transfer limit",
            ));
        }
        if total_bytes.is_some_and(|size| size < resume_offset) {
            return Err(FtpError::invalid_config(
                "Remote file is smaller than the resume destination",
            ));
        }

        // REST for resume
        if resume_offset > 0 {
            if !self.features.rest_stream {
                return Err(FtpError::unsupported(
                    "Server does not support REST STREAM for resume",
                ));
            }
            self.codec
                .expect_ok(&format!("REST {}", resume_offset))
                .await?;
        }

        let io_timeout = Duration::from_secs(self.config.data_timeout_sec);
        let mut target = open_download_target(
            local_path,
            mode,
            self.config.retain_incomplete_downloads,
            io_timeout,
        )
        .await?;

        // Open data channel + issue RETR. The final destination still does not
        // exist or remains untouched at this point.
        let ds = match self.open_data_channel().await {
            Ok(stream) => stream,
            Err(error) => return Err(target.fail(error).await),
        };
        let resp = match self.codec.execute(&format!("RETR {}", remote_path)).await {
            Ok(response) => response,
            Err(error) => return Err(target.fail(error).await),
        };
        if !resp.is_preliminary() && !resp.is_success() {
            return Err(target
                .fail(FtpError::from_reply(resp.code, &resp.text()))
                .await);
        }

        // Stream with progress.
        let tid = transfer_id.unwrap_or("").to_string();
        let started = Instant::now();
        let mut transferred = resume_offset;
        let mut buf = vec![0u8; DEFAULT_CHUNK];

        let transfer_result: FtpResult<u64> = async {
            let bytes_read = match ds {
                DataStream::Plain(mut tcp) => {
                    loop {
                        let n = timeout(io_timeout, tcp.read(&mut buf))
                            .await
                            .map_err(|_| FtpError::timeout("FTP download read timed out"))??;
                        if n == 0 {
                            break;
                        }
                        transferred = transferred.saturating_add(n as u64);
                        if transferred > MAX_TRANSFER_BYTES {
                            return Err(FtpError::transfer_failed(
                                "FTP download exceeded the 16 GiB transfer limit",
                            ));
                        }
                        timeout(io_timeout, target.file_mut()?.write_all(&buf[..n]))
                            .await
                            .map_err(|_| FtpError::timeout("Local download write timed out"))??;
                        target.note_remote_data();
                        self.update_progress(
                            &tid,
                            &remote_path,
                            local_path,
                            TransferDirection::Download,
                            total_bytes,
                            transferred,
                            &started,
                        );
                    }
                    transferred - resume_offset
                }
                DataStream::Tls(mut tls) => {
                    loop {
                        let n = timeout(io_timeout, tls.read(&mut buf))
                            .await
                            .map_err(|_| FtpError::timeout("FTPS download read timed out"))??;
                        if n == 0 {
                            break;
                        }
                        transferred = transferred.saturating_add(n as u64);
                        if transferred > MAX_TRANSFER_BYTES {
                            return Err(FtpError::transfer_failed(
                                "FTPS download exceeded the 16 GiB transfer limit",
                            ));
                        }
                        timeout(io_timeout, target.file_mut()?.write_all(&buf[..n]))
                            .await
                            .map_err(|_| FtpError::timeout("Local download write timed out"))??;
                        target.note_remote_data();
                        self.update_progress(
                            &tid,
                            &remote_path,
                            local_path,
                            TransferDirection::Download,
                            total_bytes,
                            transferred,
                            &started,
                        );
                    }
                    transferred - resume_offset
                }
            };

            timeout(io_timeout, target.file_mut()?.flush())
                .await
                .map_err(|_| FtpError::timeout("Local download flush timed out"))??;
            timeout(io_timeout, target.file_mut()?.sync_all())
                .await
                .map_err(|_| FtpError::timeout("Local download sync timed out"))??;

            let done = self.codec.read_response().await?;
            if !done.is_success() {
                return Err(FtpError::from_reply(done.code, &done.text()));
            }
            Ok(bytes_read)
        }
        .await;
        let bytes_read = match transfer_result {
            Ok(bytes) => bytes,
            Err(error) => return Err(target.fail(error).await),
        };
        target.publish().await?;

        self.info.bytes_downloaded = self.info.bytes_downloaded.saturating_add(bytes_read);
        self.complete_progress(&tid);
        self.touch();

        Ok(transferred)
    }

    // ─── UPLOAD (STOR) ───────────────────────────────────────────

    /// Upload a local file to a remote path.
    pub async fn upload(
        &mut self,
        local_path: &str,
        remote_path: &str,
        transfer_id: Option<&str>,
    ) -> FtpResult<u64> {
        validate_remote_path(remote_path)?;
        self.upload_inner(local_path, remote_path, transfer_id, 0, "STOR")
            .await
    }

    /// Resume an upload from the remote file's current size.
    pub async fn resume_upload(
        &mut self,
        local_path: &str,
        remote_path: &str,
        transfer_id: Option<&str>,
    ) -> FtpResult<u64> {
        validate_remote_path(remote_path)?;
        if !self.features.size {
            return Err(FtpError::unsupported(
                "Server does not support SIZE for safe upload resume",
            ));
        }
        let offset = self.size(remote_path).await?;
        self.upload_inner(local_path, remote_path, transfer_id, offset, "STOR")
            .await
    }

    /// Append data to a remote file (APPE).
    pub async fn append(
        &mut self,
        local_path: &str,
        remote_path: &str,
        transfer_id: Option<&str>,
    ) -> FtpResult<u64> {
        validate_remote_path(remote_path)?;
        self.upload_inner(local_path, remote_path, transfer_id, 0, "APPE")
            .await
    }

    async fn upload_inner(
        &mut self,
        local_path: &str,
        remote_path: &str,
        transfer_id: Option<&str>,
        resume_offset: u64,
        command: &str,
    ) -> FtpResult<u64> {
        let remote_path = validate_remote_path(remote_path)?;
        // Ensure binary mode
        self.set_type(TransferType::Binary).await?;

        // Get local file size for progress
        let meta = validate_upload_source(local_path).await?;
        let total_bytes = meta.len();
        if resume_offset > total_bytes {
            return Err(FtpError::invalid_config(
                "Remote resume offset exceeds the local upload size",
            ));
        }

        // REST for resume
        if resume_offset > 0 {
            if !self.features.rest_stream {
                return Err(FtpError::unsupported(
                    "Server does not support REST STREAM for resume",
                ));
            }
            self.codec
                .expect_ok(&format!("REST {}", resume_offset))
                .await?;
        }

        // Open data channel + issue STOR/APPE
        let ds = self.open_data_channel().await?;
        let resp = self
            .codec
            .execute(&format!("{} {}", command, remote_path))
            .await?;
        if !resp.is_preliminary() && !resp.is_success() {
            return Err(FtpError::from_reply(resp.code, &resp.text()));
        }

        // Open local file and seek past resume offset
        let mut file = fs::File::open(local_path).await?;
        if resume_offset > 0 {
            use tokio::io::AsyncSeekExt;
            file.seek(std::io::SeekFrom::Start(resume_offset)).await?;
        }

        let tid = transfer_id.unwrap_or("").to_string();
        let started = Instant::now();
        let mut transferred = resume_offset;
        let mut buf = vec![0u8; DEFAULT_CHUNK];
        let io_timeout = Duration::from_secs(self.config.data_timeout_sec);

        let bytes_written = match ds {
            DataStream::Plain(mut tcp) => {
                loop {
                    let n = timeout(io_timeout, file.read(&mut buf))
                        .await
                        .map_err(|_| FtpError::timeout("Local upload read timed out"))??;
                    if n == 0 {
                        break;
                    }
                    timeout(io_timeout, tcp.write_all(&buf[..n]))
                        .await
                        .map_err(|_| FtpError::timeout("FTP upload write timed out"))??;
                    transferred = transferred.saturating_add(n as u64);
                    self.update_progress(
                        &tid,
                        remote_path,
                        local_path,
                        TransferDirection::Upload,
                        Some(total_bytes),
                        transferred,
                        &started,
                    );
                }
                timeout(io_timeout, tcp.flush())
                    .await
                    .map_err(|_| FtpError::timeout("FTP upload flush timed out"))??;
                timeout(io_timeout, tcp.shutdown())
                    .await
                    .map_err(|_| FtpError::timeout("FTP upload shutdown timed out"))??;
                transferred - resume_offset
            }
            DataStream::Tls(mut tls) => {
                loop {
                    let n = timeout(io_timeout, file.read(&mut buf))
                        .await
                        .map_err(|_| FtpError::timeout("Local upload read timed out"))??;
                    if n == 0 {
                        break;
                    }
                    timeout(io_timeout, tls.write_all(&buf[..n]))
                        .await
                        .map_err(|_| FtpError::timeout("FTPS upload write timed out"))??;
                    transferred = transferred.saturating_add(n as u64);
                    self.update_progress(
                        &tid,
                        remote_path,
                        local_path,
                        TransferDirection::Upload,
                        Some(total_bytes),
                        transferred,
                        &started,
                    );
                }
                timeout(io_timeout, tls.flush())
                    .await
                    .map_err(|_| FtpError::timeout("FTPS upload flush timed out"))??;
                timeout(io_timeout, tls.shutdown())
                    .await
                    .map_err(|_| FtpError::timeout("FTPS upload shutdown timed out"))??;
                transferred - resume_offset
            }
        };

        // Read 226 completion
        let done = self.codec.read_response().await?;
        if !done.is_success() {
            return Err(FtpError::from_reply(done.code, &done.text()));
        }

        self.info.bytes_uploaded = self.info.bytes_uploaded.saturating_add(bytes_written);
        self.complete_progress(&tid);
        self.touch();

        Ok(transferred)
    }

    // ─── Progress helpers ────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    fn update_progress(
        &self,
        transfer_id: &str,
        remote_path: &str,
        local_path: &str,
        direction: TransferDirection,
        total_bytes: Option<u64>,
        transferred: u64,
        started: &Instant,
    ) {
        if transfer_id.is_empty() {
            return;
        }
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        let speed = (transferred as f64 / elapsed) as u64;
        let eta = if speed > 0 {
            total_bytes.map(|t| {
                if t > transferred {
                    ((t - transferred) / speed) as u32
                } else {
                    0
                }
            })
        } else {
            None
        };
        let percent = total_bytes
            .map(|t| {
                if t > 0 {
                    (transferred as f64 / t as f64 * 100.0) as f32
                } else {
                    100.0
                }
            })
            .unwrap_or(0.0);

        let progress = TransferProgress {
            transfer_id: transfer_id.to_string(),
            session_id: self.id.clone(),
            direction,
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            total_bytes,
            transferred_bytes: transferred,
            speed_bps: speed,
            eta_seconds: eta,
            percent,
            state: TransferState::InProgress,
        };

        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            if !map.contains_key(transfer_id) && map.len() >= MAX_TRACKED_TRANSFERS {
                return;
            }
            map.insert(transfer_id.to_string(), progress);
        }
    }

    fn complete_progress(&self, transfer_id: &str) {
        if transfer_id.is_empty() {
            return;
        }
        if let Ok(mut map) = TRANSFER_PROGRESS.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.state = TransferState::Completed;
                p.percent = 100.0;
            }
        }
    }
}
