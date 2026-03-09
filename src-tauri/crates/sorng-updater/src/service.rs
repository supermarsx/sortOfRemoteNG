//! Service façade for the updater.
//!
//! Wraps all subsystems behind a single `Arc<Mutex<..>>` state
//! compatible with Tauri's managed-state model.

use std::sync::Arc;
use tokio::sync::Mutex;

use chrono::Utc;
use log::info;

use crate::checker::UpdateChecker;
use crate::downloader::{self, UpdateDownloader};
use crate::error::UpdateError;
use crate::installer::UpdateInstaller;
use crate::rollback::RollbackManager;
use crate::types::*;

/// Type alias for the Tauri managed state.
pub type UpdaterServiceState = Arc<Mutex<UpdaterService>>;

/// Top-level façade wrapping checker, downloader, installer, and
/// rollback manager.
pub struct UpdaterService {
    pub config: UpdateConfig,
    pub status: UpdateStatus,
    pub current_version: String,
    pub history: Vec<UpdateHistory>,
    checker: UpdateChecker,
    downloader: UpdateDownloader,
    installer: UpdateInstaller,
    rollback_mgr: RollbackManager,
    last_check: Option<chrono::DateTime<Utc>>,
    latest_info: Option<UpdateInfo>,
    downloaded_path: Option<String>,
    app_dir: String,
}

impl UpdaterService {
    /// Create a new `UpdaterService` wrapped in `Arc<Mutex<..>>`.
    pub fn new(
        current_version: impl Into<String>,
        app_dir: impl Into<String>,
    ) -> UpdaterServiceState {
        let service = Self {
            config: UpdateConfig::default(),
            status: UpdateStatus::UpToDate,
            current_version: current_version.into(),
            history: Vec::new(),
            checker: UpdateChecker::new(),
            downloader: UpdateDownloader::new(),
            installer: UpdateInstaller::new(),
            rollback_mgr: RollbackManager::new(),
            last_check: None,
            latest_info: None,
            downloaded_path: None,
            app_dir: app_dir.into(),
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with custom configuration.
    pub fn with_config(
        config: UpdateConfig,
        current_version: impl Into<String>,
        app_dir: impl Into<String>,
    ) -> UpdaterServiceState {
        let service = Self {
            config,
            status: UpdateStatus::UpToDate,
            current_version: current_version.into(),
            history: Vec::new(),
            checker: UpdateChecker::new(),
            downloader: UpdateDownloader::new(),
            installer: UpdateInstaller::new(),
            rollback_mgr: RollbackManager::new(),
            last_check: None,
            latest_info: None,
            downloaded_path: None,
            app_dir: app_dir.into(),
        };
        Arc::new(Mutex::new(service))
    }

    // ── Check ───────────────────────────────────────────────────

    /// Check for updates using the configured channel.
    pub async fn check_for_updates(&mut self) -> Result<UpdateStatus, UpdateError> {
        if !self.config.enabled {
            return Ok(UpdateStatus::UpToDate);
        }

        self.status = UpdateStatus::Checking;

        let result = self
            .checker
            .check_for_updates(&self.config, &self.current_version)
            .await;

        self.last_check = Some(Utc::now());

        match result {
            Ok(ref status) => {
                self.status = status.clone();
                if let UpdateStatus::UpdateAvailable { ref info } = status {
                    self.latest_info = Some(info.clone());
                }
            }
            Err(ref e) => {
                self.status = UpdateStatus::Error {
                    message: e.to_string(),
                };
            }
        }

        result
    }

    // ── Download ────────────────────────────────────────────────

    /// Download the latest available update.
    pub async fn download_update(&mut self) -> Result<String, UpdateError> {
        let info = self
            .latest_info
            .clone()
            .ok_or(UpdateError::NoUpdateAvailable)?;

        self.status = UpdateStatus::Downloading {
            progress_pct: 0.0,
            bytes_downloaded: 0,
            total_bytes: info.download_size,
        };

        let download_dir = std::path::Path::new(&self.app_dir)
            .join("downloads")
            .to_string_lossy()
            .to_string();

        let path = self
            .downloader
            .download_update(&info, &download_dir)
            .await?;
        self.downloaded_path = Some(path.clone());

        // Verify checksum.
        if !info.checksum_sha256.is_empty() {
            let ok = downloader::verify_checksum(&path, &info.checksum_sha256).await?;
            if !ok {
                self.status = UpdateStatus::Error {
                    message: "checksum verification failed".to_string(),
                };
                return Err(UpdateError::ChecksumMismatch {
                    expected: info.checksum_sha256.clone(),
                    actual: "see log".to_string(),
                });
            }
        }

        self.status = UpdateStatus::UpdateAvailable { info: info.clone() };
        Ok(path)
    }

    /// Cancel an in-progress download.
    pub fn cancel_download(&self) {
        self.downloader.cancel_download();
    }

    /// Get current download progress.
    pub async fn get_download_progress(&self) -> Option<DownloadProgress> {
        self.downloader.get_progress().await
    }

    // ── Install ─────────────────────────────────────────────────

    /// Install the previously downloaded update.
    pub async fn install_update(&mut self) -> Result<(), UpdateError> {
        let path = self
            .downloaded_path
            .clone()
            .ok_or(UpdateError::InstallError(
                "no downloaded update to install".to_string(),
            ))?;

        let info = self
            .latest_info
            .clone()
            .ok_or(UpdateError::NoUpdateAvailable)?;

        self.status = UpdateStatus::Installing;

        // Prepare.
        self.installer
            .prepare_install(&path, &info.checksum_sha256)
            .await?;

        // Create rollback point.
        let _rollback = self
            .installer
            .create_rollback_point(&self.current_version, &self.app_dir)
            .await?;

        // Install.
        self.installer.install_update(&path, &self.app_dir).await?;

        // Record history.
        let entry = UpdateHistory {
            id: uuid::Uuid::new_v4().to_string(),
            from_version: self.current_version.clone(),
            to_version: info.version.clone(),
            channel: self.config.channel.clone(),
            timestamp: Utc::now(),
            success: true,
            error: None,
            rollback_available: true,
        };
        self.history.push(entry);

        self.current_version = info.version.clone();
        self.status = UpdateStatus::UpToDate;
        self.latest_info = None;
        self.downloaded_path = None;

        info!("update installed successfully");
        Ok(())
    }

    /// Schedule the update to be installed on next app restart.
    pub async fn schedule_install_on_restart(&self) -> Result<(), UpdateError> {
        let path = self
            .downloaded_path
            .as_deref()
            .ok_or(UpdateError::InstallError(
                "no downloaded update to schedule".to_string(),
            ))?;
        self.installer
            .schedule_install_on_restart(path, &self.app_dir)
            .await
    }

    // ── Rollback ────────────────────────────────────────────────

    /// Roll the application back to a previous version.
    pub async fn rollback(&mut self, info: &RollbackInfo) -> Result<(), UpdateError> {
        self.rollback_mgr.rollback(info, &self.app_dir).await?;

        let entry = UpdateHistory {
            id: uuid::Uuid::new_v4().to_string(),
            from_version: self.current_version.clone(),
            to_version: info.previous_version.clone(),
            channel: self.config.channel.clone(),
            timestamp: Utc::now(),
            success: true,
            error: None,
            rollback_available: false,
        };
        self.history.push(entry);

        self.current_version = info.previous_version.clone();
        self.status = UpdateStatus::UpToDate;
        Ok(())
    }

    /// Get available rollback points.
    pub async fn get_rollbacks(&self) -> Vec<RollbackInfo> {
        let backup_dir = std::path::Path::new(&self.app_dir)
            .join("backups")
            .to_string_lossy()
            .to_string();
        RollbackManager::get_available_rollbacks(&backup_dir).await
    }

    // ── Config / status ─────────────────────────────────────────

    /// Replace the updater configuration.
    pub fn update_config(&mut self, config: UpdateConfig) {
        self.config = config;
    }

    /// Set just the update channel.
    pub fn set_channel(&mut self, channel: UpdateChannel) {
        self.config.channel = channel;
    }

    /// Get the current update status.
    pub fn get_status(&self) -> UpdateStatus {
        self.status.clone()
    }

    /// Get the current configuration.
    pub fn get_config(&self) -> UpdateConfig {
        self.config.clone()
    }

    /// Build a [`VersionInfo`] summary.
    pub fn get_version_info(&self) -> VersionInfo {
        let update_available = matches!(self.status, UpdateStatus::UpdateAvailable { .. });
        VersionInfo {
            current_version: self.current_version.clone(),
            latest_version: self.latest_info.as_ref().map(|i| i.version.clone()),
            channel: self.config.channel.clone(),
            last_check: self.last_check,
            update_available,
        }
    }

    /// Get the full update history.
    pub fn get_history(&self) -> Vec<UpdateHistory> {
        self.history.clone()
    }

    /// Get release notes for the latest available update.
    pub fn get_release_notes(&self) -> Option<String> {
        self.latest_info.as_ref().map(|i| i.release_notes.clone())
    }
}
