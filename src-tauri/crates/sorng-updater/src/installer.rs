//! Installation, backup creation, and restart scheduling.

use log::{debug, info};
use std::path::Path;

use crate::downloader;
use crate::error::UpdateError;
use crate::rollback::RollbackManager;
use crate::types::RollbackInfo;

/// Handles the actual application-update installation flow.
pub struct UpdateInstaller;

impl Default for UpdateInstaller {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateInstaller {
    /// Create a new installer.
    pub fn new() -> Self {
        Self
    }

    /// Verify the downloaded artefact and prepare for installation.
    ///
    /// This checks that the file exists and optionally verifies the
    /// SHA-256 checksum when `expected_sha256` is provided.
    pub async fn prepare_install(
        &self,
        downloaded_path: &str,
        expected_sha256: &str,
    ) -> Result<(), UpdateError> {
        info!("preparing install from {downloaded_path}");

        let path = Path::new(downloaded_path);
        if !path.exists() {
            return Err(UpdateError::IoError(format!(
                "downloaded file not found: {downloaded_path}"
            )));
        }

        let meta = tokio::fs::metadata(path).await?;
        if meta.len() == 0 {
            return Err(UpdateError::IoError("downloaded file is empty".to_string()));
        }

        if !expected_sha256.is_empty() {
            let ok = downloader::verify_checksum(downloaded_path, expected_sha256).await?;
            if !ok {
                return Err(UpdateError::ChecksumMismatch {
                    expected: expected_sha256.to_string(),
                    actual: "see log for details".to_string(),
                });
            }
        }

        debug!("install preparation complete");
        Ok(())
    }

    /// Create a rollback point by backing up the current application
    /// directory.
    pub async fn create_rollback_point(
        &self,
        current_version: &str,
        app_dir: &str,
    ) -> Result<RollbackInfo, UpdateError> {
        info!("creating rollback point for v{current_version}");

        let mut mgr = RollbackManager::new();
        let info = mgr.create_backup(app_dir, current_version).await?;

        info!(
            "rollback point created at {} ({} bytes)",
            info.backup_path, info.size_bytes
        );
        Ok(info)
    }

    /// Apply the update by copying/extracting the downloaded artefact
    /// into `app_dir`.
    ///
    /// This is a simplified copy-based installer. A production version
    /// would invoke the platform-specific installer (e.g. `.msi`,
    /// `.dmg`, `.AppImage`).
    pub async fn install_update(
        &self,
        downloaded_path: &str,
        app_dir: &str,
    ) -> Result<(), UpdateError> {
        info!("installing update from {downloaded_path} to {app_dir}");

        let src = Path::new(downloaded_path);
        if !src.exists() {
            return Err(UpdateError::IoError(format!(
                "downloaded file not found: {downloaded_path}"
            )));
        }

        let dest_dir = Path::new(app_dir);
        tokio::fs::create_dir_all(dest_dir).await?;

        let file_name = src
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let dest_file = dest_dir.join(&file_name);
        tokio::fs::copy(src, &dest_file).await.map_err(|e| {
            UpdateError::InstallError(format!("failed to copy update artefact: {e}"))
        })?;

        // If the artefact is a known archive type, mark it for
        // extraction (implementation would be platform-specific).
        if file_name.ends_with(".tar.gz")
            || file_name.ends_with(".zip")
            || file_name.ends_with(".appimage")
        {
            debug!(
                "archive detected ({file_name}) – in production this would \
                 be extracted/applied automatically"
            );
        }

        info!("update installed successfully");
        Ok(())
    }

    /// Schedule the update to be applied the next time the app restarts.
    ///
    /// This writes a marker file that the app checks on startup.
    pub async fn schedule_install_on_restart(
        &self,
        downloaded_path: &str,
        app_dir: &str,
    ) -> Result<(), UpdateError> {
        info!("scheduling install-on-restart for {downloaded_path}");

        let marker_path = Path::new(app_dir).join(".pending_update");
        tokio::fs::write(&marker_path, downloaded_path)
            .await
            .map_err(|e| {
                UpdateError::InstallError(format!("failed to write restart marker: {e}"))
            })?;

        info!("restart marker written to {}", marker_path.display());
        Ok(())
    }

    /// Check whether a pending install-on-restart marker exists and
    /// return the path to the staged artefact.
    pub async fn check_pending_install(app_dir: &str) -> Option<String> {
        let marker_path = Path::new(app_dir).join(".pending_update");
        if marker_path.exists() {
            tokio::fs::read_to_string(&marker_path).await.ok()
        } else {
            None
        }
    }

    /// Remove the install-on-restart marker after a successful update.
    pub async fn clear_pending_install(app_dir: &str) -> Result<(), UpdateError> {
        let marker_path = Path::new(app_dir).join(".pending_update");
        if marker_path.exists() {
            tokio::fs::remove_file(&marker_path).await?;
        }
        Ok(())
    }
}
