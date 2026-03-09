//! Rollback and backup lifecycle management.

use chrono::Utc;
use log::{debug, info, warn};
use std::path::Path;

use crate::error::UpdateError;
use crate::types::RollbackInfo;

/// Manages rollback backups for the application.
pub struct RollbackManager {
    pub rollback_info: Option<RollbackInfo>,
}

impl Default for RollbackManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RollbackManager {
    /// Create a new, empty `RollbackManager`.
    pub fn new() -> Self {
        Self {
            rollback_info: None,
        }
    }

    /// Create a backup of the current application directory.
    ///
    /// The backup is stored under `<app_dir>/backups/<version>_<timestamp>/`.
    pub async fn create_backup(
        &mut self,
        app_dir: &str,
        version: &str,
    ) -> Result<RollbackInfo, UpdateError> {
        let now = Utc::now();
        let ts = now.format("%Y%m%d%H%M%S").to_string();
        let backup_name = format!("{version}_{ts}");

        let backup_dir = Path::new(app_dir).join("backups").join(&backup_name);
        tokio::fs::create_dir_all(&backup_dir).await?;

        info!("backing up {} to {}", app_dir, backup_dir.display());

        let total_bytes = copy_dir_recursive(Path::new(app_dir), &backup_dir, true).await?;

        let info = RollbackInfo {
            previous_version: version.to_string(),
            backup_path: backup_dir.to_string_lossy().to_string(),
            created_at: now,
            size_bytes: total_bytes,
        };

        self.rollback_info = Some(info.clone());

        info!(
            "backup complete: {} ({total_bytes} bytes)",
            backup_dir.display()
        );
        Ok(info)
    }

    /// Restore the application to the state captured in `info`.
    pub async fn rollback(&self, info: &RollbackInfo, app_dir: &str) -> Result<(), UpdateError> {
        let backup_path = Path::new(&info.backup_path);
        if !backup_path.exists() {
            return Err(UpdateError::RollbackError(format!(
                "backup not found: {}",
                info.backup_path
            )));
        }

        info!(
            "rolling back to {} from {}",
            info.previous_version, info.backup_path
        );

        // Copy the backup back over the app dir. We skip the backups
        // folder itself to avoid recursion.
        copy_dir_recursive(backup_path, Path::new(app_dir), false).await?;

        info!("rollback to {} complete", info.previous_version);
        Ok(())
    }

    /// Delete old backups, keeping only the most recent `keep_count`.
    pub async fn cleanup_old_backups(backup_dir: &str, keep_count: usize) {
        let dir = Path::new(backup_dir);
        if !dir.exists() {
            return;
        }

        let mut entries: Vec<(String, std::time::SystemTime)> = Vec::new();

        let mut read_dir = match tokio::fs::read_dir(dir).await {
            Ok(rd) => rd,
            Err(e) => {
                warn!("cannot read backup dir {backup_dir}: {e}");
                return;
            }
        };

        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                let modified = entry
                    .metadata()
                    .await
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .unwrap_or(std::time::UNIX_EPOCH);
                entries.push((path.to_string_lossy().to_string(), modified));
            }
        }

        // Sort newest-first.
        entries.sort_by(|a, b| b.1.cmp(&a.1));

        for (path, _) in entries.iter().skip(keep_count) {
            debug!("removing old backup: {path}");
            let _ = tokio::fs::remove_dir_all(path).await;
        }
    }

    /// List all available rollback points under `backup_dir`.
    pub async fn get_available_rollbacks(backup_dir: &str) -> Vec<RollbackInfo> {
        let dir = Path::new(backup_dir);
        if !dir.exists() {
            return vec![];
        }

        let mut results: Vec<RollbackInfo> = Vec::new();

        let mut read_dir = match tokio::fs::read_dir(dir).await {
            Ok(rd) => rd,
            Err(_) => return vec![],
        };

        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // Parse the version from the folder name (format: VERSION_TIMESTAMP).
            let version = name.split('_').next().unwrap_or(&name).to_string();

            let meta = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };

            let created_at = meta
                .modified()
                .ok()
                .map(|t| {
                    let dur = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                    chrono::DateTime::from_timestamp(dur.as_secs() as i64, 0)
                        .unwrap_or_else(Utc::now)
                })
                .unwrap_or_else(Utc::now);

            let size = dir_size(&path).await;

            results.push(RollbackInfo {
                previous_version: version,
                backup_path: path.to_string_lossy().to_string(),
                created_at,
                size_bytes: size,
            });
        }

        // Sort newest-first.
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Recursively copy a directory tree.
///
/// If `skip_backups` is true the `backups` subdirectory is skipped to
/// avoid recursive copies.
///
/// Returns the total bytes copied.
async fn copy_dir_recursive(
    src: &Path,
    dest: &Path,
    skip_backups: bool,
) -> Result<u64, UpdateError> {
    let mut total: u64 = 0;

    let mut read_dir = tokio::fs::read_dir(src).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip the backups folder when backing-up to prevent infinite recursion.
        if skip_backups && name == "backups" {
            continue;
        }

        // Also skip .pending_update marker.
        if name == ".pending_update" {
            continue;
        }

        let dest_entry = dest.join(&name);

        if entry_path.is_dir() {
            tokio::fs::create_dir_all(&dest_entry).await?;
            total += Box::pin(copy_dir_recursive(&entry_path, &dest_entry, false)).await?;
        } else {
            let bytes = tokio::fs::copy(&entry_path, &dest_entry)
                .await
                .map_err(|e| {
                    UpdateError::IoError(format!(
                        "copy {} → {}: {e}",
                        entry_path.display(),
                        dest_entry.display()
                    ))
                })?;
            total += bytes;
        }
    }

    Ok(total)
}

/// Calculate the total size of a directory recursively.
async fn dir_size(path: &Path) -> u64 {
    let mut total: u64 = 0;
    let mut read_dir = match tokio::fs::read_dir(path).await {
        Ok(rd) => rd,
        Err(_) => return 0,
    };

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let p = entry.path();
        if p.is_dir() {
            total += Box::pin(dir_size(&p)).await;
        } else if let Ok(m) = entry.metadata().await {
            total += m.len();
        }
    }
    total
}
