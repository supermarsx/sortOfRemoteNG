//! Download management with progress tracking and cancellation.

use log::{debug, info, warn};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::error::UpdateError;
use crate::types::{DownloadProgress, UpdateInfo};

/// Manages downloading of update artefacts with progress and
/// cancellation support.
pub struct UpdateDownloader {
    client: reqwest::Client,
    progress: Arc<Mutex<Option<DownloadProgress>>>,
    cancelled: Arc<AtomicBool>,
}

impl Default for UpdateDownloader {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateDownloader {
    /// Create a new downloader.
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("SortOfRemoteNG-Updater/0.1")
            .build()
            .unwrap_or_default();
        Self {
            client,
            progress: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Create with an existing `reqwest::Client`.
    pub fn with_client(client: reqwest::Client) -> Self {
        Self {
            client,
            progress: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Download the update described by `info` into `dest_dir`.
    ///
    /// Returns the local path to the downloaded file.  Progress is
    /// tracked internally and may be queried via [`get_progress`].
    pub async fn download_update(
        &self,
        info: &UpdateInfo,
        dest_dir: &str,
    ) -> Result<String, UpdateError> {
        if self.progress.lock().await.is_some() {
            return Err(UpdateError::DownloadInProgress);
        }

        self.cancelled.store(false, AtomicOrdering::SeqCst);

        let url = &info.download_url;
        if url.is_empty() {
            return Err(UpdateError::NetworkError(
                "download URL is empty".to_string(),
            ));
        }

        info!("downloading update from {url}");

        let response = self.client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(UpdateError::NetworkError(format!(
                "download failed: HTTP {}",
                response.status()
            )));
        }

        let total_bytes = response.content_length().unwrap_or(info.download_size);

        // Derive filename from URL.
        let filename = url.rsplit('/').next().unwrap_or("update.bin").to_string();

        let dest_path: PathBuf = Path::new(dest_dir).join(&filename);

        // Ensure the destination directory exists.
        if let Some(parent) = dest_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut file = tokio::fs::File::create(&dest_path).await?;

        let mut bytes_downloaded: u64 = 0;
        let start = std::time::Instant::now();

        // Initialise progress.
        {
            let mut pg = self.progress.lock().await;
            *pg = Some(DownloadProgress {
                url: url.clone(),
                bytes_downloaded: 0,
                total_bytes,
                speed_bps: 0,
                eta_seconds: 0,
            });
        }

        // Stream the response body chunk by chunk via the `chunk()` API.
        let mut resp = response;
        while let Some(chunk) = resp.chunk().await? {
            if self.cancelled.load(AtomicOrdering::SeqCst) {
                drop(file);
                let _ = tokio::fs::remove_file(&dest_path).await;
                let mut pg = self.progress.lock().await;
                *pg = None;
                return Err(UpdateError::DownloadCancelled);
            }

            file.write_all(&chunk).await?;
            bytes_downloaded += chunk.len() as u64;

            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            let speed_bps = (bytes_downloaded as f64 / elapsed) as u64;
            let remaining = total_bytes.saturating_sub(bytes_downloaded);
            let eta_seconds = if speed_bps > 0 {
                remaining / speed_bps
            } else {
                0
            };

            let mut pg = self.progress.lock().await;
            *pg = Some(DownloadProgress {
                url: url.clone(),
                bytes_downloaded,
                total_bytes,
                speed_bps,
                eta_seconds,
            });
        }

        file.flush().await?;

        info!(
            "download complete: {} ({bytes_downloaded} bytes)",
            dest_path.display()
        );

        // Clear progress.
        {
            let mut pg = self.progress.lock().await;
            *pg = None;
        }

        Ok(dest_path.to_string_lossy().to_string())
    }

    /// Return a snapshot of the current download progress, if any.
    pub async fn get_progress(&self) -> Option<DownloadProgress> {
        self.progress.lock().await.clone()
    }

    /// Cancel the current download.
    pub fn cancel_download(&self) {
        warn!("download cancellation requested");
        self.cancelled.store(true, AtomicOrdering::SeqCst);
    }
}

// ─── Checksum verification ──────────────────────────────────────────

/// Verify that the SHA-256 hash of `file_path` matches `expected_sha256`.
///
/// `expected_sha256` should be a lowercase hex string.
///
/// Returns `Ok(true)` on match, `Ok(false)` on mismatch, or an error
/// if the file cannot be read.
pub async fn verify_checksum(file_path: &str, expected_sha256: &str) -> Result<bool, UpdateError> {
    if expected_sha256.is_empty() {
        debug!("no checksum provided – skipping verification");
        return Ok(true);
    }

    let data = tokio::fs::read(file_path).await?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let result = hasher.finalize();
    let hex = format!("{result:x}");

    let matches = hex.eq_ignore_ascii_case(expected_sha256);
    if !matches {
        warn!("checksum mismatch for {file_path}: expected {expected_sha256}, got {hex}");
    }
    Ok(matches)
}
