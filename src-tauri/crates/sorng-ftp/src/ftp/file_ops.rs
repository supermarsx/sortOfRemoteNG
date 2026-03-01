//! File-level operations — upload, download, append, resume, delete, etc.
//! All transfer operations update `TRANSFER_PROGRESS`.

use crate::ftp::client::FtpClient;
use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::transfer::DataStream;
use crate::ftp::types::*;
use crate::ftp::TRANSFER_PROGRESS;
use std::path::Path;
use std::time::Instant;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Default chunk size for streaming transfers (64 KiB).
const DEFAULT_CHUNK: usize = 65_536;

impl FtpClient {
    // ─── DOWNLOAD (RETR) ─────────────────────────────────────────

    /// Download a remote file to a local path.
    pub async fn download(
        &mut self,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<&str>,
    ) -> FtpResult<u64> {
        self.download_inner(remote_path, local_path, transfer_id, 0)
            .await
    }

    /// Resume a download from the given offset.
    pub async fn resume_download(
        &mut self,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<&str>,
    ) -> FtpResult<u64> {
        let offset = if Path::new(local_path).exists() {
            let meta = fs::metadata(local_path).await?;
            meta.len()
        } else {
            0
        };
        self.download_inner(remote_path, local_path, transfer_id, offset)
            .await
    }

    async fn download_inner(
        &mut self,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<&str>,
        resume_offset: u64,
    ) -> FtpResult<u64> {
        // Ensure binary mode for download
        self.set_type(TransferType::Binary).await?;

        // Get file size for progress (best effort)
        let total_bytes = if self.features.size {
            self.size(remote_path).await.ok()
        } else {
            None
        };

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

        // Open data channel + issue RETR
        let ds = self.open_data_channel().await?;
        let resp = self
            .codec
            .execute(&format!("RETR {}", remote_path))
            .await?;
        if !resp.is_preliminary() && !resp.is_success() {
            return Err(FtpError::from_reply(resp.code, &resp.text()));
        }

        // Open local file
        let mut file = if resume_offset > 0 {
            fs::OpenOptions::new()
                .write(true)
                .append(true)
                .open(local_path)
                .await?
        } else {
            // Ensure parent directories exist
            if let Some(parent) = Path::new(local_path).parent() {
                fs::create_dir_all(parent).await?;
            }
            fs::File::create(local_path).await?
        };

        // Stream with progress
        let tid = transfer_id.unwrap_or("").to_string();
        let started = Instant::now();
        let mut transferred = resume_offset;
        let mut buf = vec![0u8; DEFAULT_CHUNK];

        let bytes_read = match ds {
            DataStream::Plain(mut tcp) => {
                loop {
                    let n = tcp.read(&mut buf).await?;
                    if n == 0 {
                        break;
                    }
                    file.write_all(&buf[..n]).await?;
                    transferred += n as u64;
                    self.update_progress(
                        &tid,
                        remote_path,
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
                    let n = tls.read(&mut buf).await?;
                    if n == 0 {
                        break;
                    }
                    file.write_all(&buf[..n]).await?;
                    transferred += n as u64;
                    self.update_progress(
                        &tid,
                        remote_path,
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

        file.flush().await?;
        drop(file);

        // Read 226 completion
        let done = self.codec.read_response().await?;
        if !done.is_success() {
            return Err(FtpError::from_reply(done.code, &done.text()));
        }

        self.info.bytes_downloaded += bytes_read;
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
        let offset = if self.features.size {
            self.size(remote_path).await.unwrap_or(0)
        } else {
            0
        };
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
        // Ensure binary mode
        self.set_type(TransferType::Binary).await?;

        // Get local file size for progress
        let meta = fs::metadata(local_path).await?;
        let total_bytes = meta.len();

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

        let bytes_written = match ds {
            DataStream::Plain(mut tcp) => {
                loop {
                    let n = file.read(&mut buf).await?;
                    if n == 0 {
                        break;
                    }
                    tcp.write_all(&buf[..n]).await?;
                    transferred += n as u64;
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
                tcp.flush().await?;
                tcp.shutdown().await?;
                transferred - resume_offset
            }
            DataStream::Tls(mut tls) => {
                loop {
                    let n = file.read(&mut buf).await?;
                    if n == 0 {
                        break;
                    }
                    tls.write_all(&buf[..n]).await?;
                    transferred += n as u64;
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
                tls.flush().await?;
                tls.shutdown().await?;
                transferred - resume_offset
            }
        };

        // Read 226 completion
        let done = self.codec.read_response().await?;
        if !done.is_success() {
            return Err(FtpError::from_reply(done.code, &done.text()));
        }

        self.info.bytes_uploaded += bytes_written;
        self.complete_progress(&tid);
        self.touch();

        Ok(transferred)
    }

    // ─── Progress helpers ────────────────────────────────────────

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
                    Some(((t - transferred) / speed) as u32)
                } else {
                    Some(0)
                }
            }).flatten()
        } else {
            None
        };
        let percent = total_bytes
            .map(|t| if t > 0 { (transferred as f64 / t as f64 * 100.0) as f32 } else { 100.0 })
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
