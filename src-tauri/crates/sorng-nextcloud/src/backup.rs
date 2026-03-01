// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · backup
// ──────────────────────────────────────────────────────────────────────────────
// Backup engine:
//  • Manage backup configurations
//  • Run backups (archive local files → upload to Nextcloud)
//  • Retention / pruning
//  • Backup history tracking
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::files;
use crate::folders;
use crate::types::*;
use chrono::Utc;
use log::{info, warn};
use std::collections::HashMap;
use uuid::Uuid;

/// Manages backup configurations and their run history.
pub struct BackupManager {
    configs: HashMap<String, BackupConfig>,
    history: Vec<BackupResult>,
    max_history: usize,
}

impl BackupManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            history: Vec::new(),
            max_history: 100,
        }
    }

    // ── Config management ────────────────────────────────────────────────

    pub fn add_config(&mut self, config: BackupConfig) {
        self.configs.insert(config.id.clone(), config);
    }

    pub fn remove_config(&mut self, id: &str) -> Option<BackupConfig> {
        self.configs.remove(id)
    }

    pub fn get_config(&self, id: &str) -> Option<&BackupConfig> {
        self.configs.get(id)
    }

    pub fn get_config_mut(&mut self, id: &str) -> Option<&mut BackupConfig> {
        self.configs.get_mut(id)
    }

    pub fn list_configs(&self) -> Vec<&BackupConfig> {
        self.configs.values().collect()
    }

    pub fn update_config(&mut self, config: BackupConfig) {
        self.configs.insert(config.id.clone(), config);
    }

    pub fn enabled_configs(&self) -> Vec<&BackupConfig> {
        self.configs.values().filter(|c| c.enabled).collect()
    }

    // ── History ──────────────────────────────────────────────────────────

    pub fn history(&self) -> &[BackupResult] {
        &self.history
    }

    pub fn history_for_config(&self, config_id: &str) -> Vec<&BackupResult> {
        self.history
            .iter()
            .filter(|h| h.config_id == config_id)
            .collect()
    }

    pub fn last_backup(&self, config_id: &str) -> Option<&BackupResult> {
        self.history
            .iter()
            .rev()
            .find(|h| h.config_id == config_id)
    }

    fn record_result(&mut self, result: BackupResult) {
        self.history.push(result);
        while self.history.len() > self.max_history {
            self.history.remove(0);
        }
    }

    // ── Execution ────────────────────────────────────────────────────────

    /// Run a backup for a specific config.
    pub async fn run_backup(
        &mut self,
        config_id: &str,
        client: &NextcloudClient,
    ) -> Result<BackupResult, String> {
        let config = self
            .configs
            .get(config_id)
            .cloned()
            .ok_or_else(|| format!("backup config {} not found", config_id))?;

        if !config.enabled {
            return Err(format!("backup config {} is disabled", config_id));
        }

        info!("Starting backup: {} ({})", config.id, config.label);
        let started_at = Utc::now();

        // Collect data to back up
        let mut payload = Vec::new();

        for path in &config.includes.extra_paths {
            match std::fs::read(path) {
                Ok(data) => payload.extend_from_slice(&data),
                Err(e) => warn!("backup: skip {}: {}", path, e),
            }
        }

        // Generate backup filename
        let filename = generate_backup_filename(&config.label, &started_at);
        let remote_path = folders::join_path(&config.remote_dir, &filename);

        // Ensure remote directory exists
        let _ = folders::create_folder_recursive(client, &config.remote_dir).await;

        // Upload
        let size = payload.len() as u64;
        let upload_args = files::build_upload_args(&remote_path, true);
        match files::upload(client, &upload_args, payload).await {
            Ok(()) => {
                let result = BackupResult {
                    config_id: config.id.clone(),
                    started_at,
                    finished_at: Some(Utc::now()),
                    remote_path: remote_path.clone(),
                    size_bytes: size,
                    success: true,
                    error: None,
                };
                self.record_result(result.clone());

                // Prune old backups if retention is set
                if config.retention_count > 0 {
                    let _ = self
                        .prune_old_backups(config_id, client, config.retention_count)
                        .await;
                }

                info!("Backup {} complete: {} bytes → {}", config.id, size, remote_path);
                Ok(result)
            }
            Err(e) => {
                let result = BackupResult {
                    config_id: config.id.clone(),
                    started_at,
                    finished_at: Some(Utc::now()),
                    remote_path,
                    size_bytes: 0,
                    success: false,
                    error: Some(e.clone()),
                };
                self.record_result(result.clone());
                Err(e)
            }
        }
    }

    /// Run all enabled backups.
    pub async fn run_all_backups(
        &mut self,
        client: &NextcloudClient,
    ) -> Vec<BackupResult> {
        let ids: Vec<String> = self
            .configs
            .values()
            .filter(|c| c.enabled)
            .map(|c| c.id.clone())
            .collect();

        let mut results = Vec::new();
        for id in ids {
            match self.run_backup(&id, client).await {
                Ok(r) => results.push(r),
                Err(e) => warn!("backup {} failed: {}", id, e),
            }
        }
        results
    }

    // ── Pruning ──────────────────────────────────────────────────────────

    /// Delete old backups beyond the retention count.
    async fn prune_old_backups(
        &self,
        config_id: &str,
        client: &NextcloudClient,
        retention: u32,
    ) -> Result<u32, String> {
        let history: Vec<&BackupResult> = self
            .history
            .iter()
            .filter(|h| h.config_id == config_id && h.success)
            .collect();

        if history.len() <= retention as usize {
            return Ok(0);
        }

        let to_delete = &history[..(history.len() - retention as usize)];
        let mut deleted = 0u32;

        for entry in to_delete {
            match files::delete_file(client, &entry.remote_path).await {
                Ok(()) => {
                    deleted += 1;
                    info!("Pruned old backup: {}", entry.remote_path);
                }
                Err(e) => warn!("Failed to prune {}: {}", entry.remote_path, e),
            }
        }

        Ok(deleted)
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Create a new backup config with defaults.
pub fn build_backup_config(label: &str, remote_dir: &str) -> BackupConfig {
    BackupConfig {
        id: Uuid::new_v4().to_string(),
        label: label.to_string(),
        includes: BackupIncludes {
            connections: true,
            credentials: false,
            settings: true,
            scripts: false,
            extra_paths: Vec::new(),
        },
        remote_dir: remote_dir.to_string(),
        retention_count: 5,
        enabled: true,
        interval_secs: 0,
        compress: false,
        encrypt: false,
        passphrase: None,
    }
}

/// Generate a backup filename with timestamp.
fn generate_backup_filename(label: &str, timestamp: &chrono::DateTime<Utc>) -> String {
    let sanitized: String = label
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!(
        "backup_{}_{}",
        sanitized,
        timestamp.format("%Y%m%d_%H%M%S")
    )
}

/// Calculate the total size of backup history for a config.
pub fn total_backup_size(history: &[BackupResult], config_id: &str) -> u64 {
    history
        .iter()
        .filter(|h| h.config_id == config_id && h.success)
        .map(|h| h.size_bytes)
        .sum()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_backup_config_defaults() {
        let c = build_backup_config("Daily", "/Backups/daily");
        assert!(c.enabled);
        assert_eq!(c.retention_count, 5);
        assert!(c.includes.connections);
        assert!(!c.includes.credentials);
        assert!(!c.compress);
        assert!(!c.encrypt);
    }

    #[test]
    fn backup_filename_format() {
        let ts = chrono::DateTime::parse_from_rfc3339("2024-01-15T10:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let name = generate_backup_filename("My Backup", &ts);
        assert!(name.starts_with("backup_My_Backup_"));
        assert!(name.contains("20240115_103000"));
    }

    #[test]
    fn backup_filename_sanitizes_special_chars() {
        let ts = Utc::now();
        let name = generate_backup_filename("test/file:name", &ts);
        assert!(!name.contains('/'));
        assert!(!name.contains(':'));
    }

    #[test]
    fn backup_manager_config_crud() {
        let mut mgr = BackupManager::new();
        assert!(mgr.list_configs().is_empty());

        let c = build_backup_config("Test", "/Backups");
        let id = c.id.clone();
        mgr.add_config(c);
        assert_eq!(mgr.list_configs().len(), 1);
        assert!(mgr.get_config(&id).is_some());

        let removed = mgr.remove_config(&id);
        assert!(removed.is_some());
        assert!(mgr.list_configs().is_empty());
    }

    #[test]
    fn backup_manager_enabled_only() {
        let mut mgr = BackupManager::new();

        let mut c1 = build_backup_config("Active", "/a");
        c1.enabled = true;
        let mut c2 = build_backup_config("Inactive", "/b");
        c2.enabled = false;

        mgr.add_config(c1);
        mgr.add_config(c2);

        assert_eq!(mgr.enabled_configs().len(), 1);
    }

    #[test]
    fn backup_history_tracking() {
        let mut mgr = BackupManager::new();
        let c = build_backup_config("Test", "/Backups");
        let cid = c.id.clone();
        mgr.add_config(c);

        let result = BackupResult {
            config_id: cid.clone(),
            started_at: Utc::now(),
            finished_at: Some(Utc::now()),
            remote_path: "/Backups/backup_test_123".into(),
            size_bytes: 1024,
            success: true,
            error: None,
        };

        mgr.record_result(result);
        assert_eq!(mgr.history().len(), 1);
        assert!(mgr.last_backup(&cid).is_some());
    }

    #[test]
    fn backup_history_capped() {
        let mut mgr = BackupManager::new();
        mgr.max_history = 3;

        for i in 0..5 {
            mgr.record_result(BackupResult {
                config_id: "test".into(),
                started_at: Utc::now(),
                finished_at: Some(Utc::now()),
                remote_path: format!("/backup_{}", i),
                size_bytes: 100,
                success: true,
                error: None,
            });
        }

        assert_eq!(mgr.history().len(), 3);
    }

    #[test]
    fn total_backup_size_calculation() {
        let history = vec![
            BackupResult {
                config_id: "a".into(),
                started_at: Utc::now(),
                finished_at: None,
                remote_path: "/b1".into(),
                size_bytes: 100,
                success: true,
                error: None,
            },
            BackupResult {
                config_id: "a".into(),
                started_at: Utc::now(),
                finished_at: None,
                remote_path: "/b2".into(),
                size_bytes: 200,
                success: true,
                error: None,
            },
            BackupResult {
                config_id: "a".into(),
                started_at: Utc::now(),
                finished_at: None,
                remote_path: "/b3".into(),
                size_bytes: 50,
                success: false,
                error: Some("err".into()),
            },
            BackupResult {
                config_id: "other".into(),
                started_at: Utc::now(),
                finished_at: None,
                remote_path: "/o1".into(),
                size_bytes: 999,
                success: true,
                error: None,
            },
        ];

        assert_eq!(total_backup_size(&history, "a"), 300);
        assert_eq!(total_backup_size(&history, "other"), 999);
        assert_eq!(total_backup_size(&history, "missing"), 0);
    }
}
