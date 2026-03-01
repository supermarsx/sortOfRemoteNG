//! Backup manager — scheduled backups of connection configs to Dropbox.

use crate::types::*;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use uuid::Uuid;

/// Manages backup configurations and history.
pub struct BackupManager {
    configs: HashMap<String, BackupConfig>,
    history: HashMap<String, Vec<BackupResult>>,
    max_history: usize,
}

impl BackupManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            history: HashMap::new(),
            max_history: 50,
        }
    }

    /// Create a new backup configuration.
    pub fn create_config(
        &mut self,
        name: &str,
        account_name: &str,
        dropbox_path: &str,
        includes: BackupIncludes,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let config = BackupConfig {
            id: id.clone(),
            name: name.to_string(),
            account_name: account_name.to_string(),
            dropbox_path: dropbox_path.to_string(),
            interval_seconds: 3600,
            enabled: true,
            max_revisions: 30,
            includes,
            created_at: Utc::now(),
            last_backup: None,
            last_error: None,
        };
        self.configs.insert(id.clone(), config);
        id
    }

    /// Update an existing backup configuration.
    pub fn update_config(&mut self, config: BackupConfig) -> bool {
        if self.configs.contains_key(&config.id) {
            self.configs.insert(config.id.clone(), config);
            true
        } else {
            false
        }
    }

    /// Remove a backup configuration.
    pub fn remove_config(&mut self, id: &str) -> bool {
        self.history.remove(id);
        self.configs.remove(id).is_some()
    }

    /// Get a backup configuration by ID.
    pub fn get_config(&self, id: &str) -> Option<&BackupConfig> {
        self.configs.get(id)
    }

    /// Get a mutable reference to a backup configuration.
    pub fn get_config_mut(&mut self, id: &str) -> Option<&mut BackupConfig> {
        self.configs.get_mut(id)
    }

    /// List all backup configurations.
    pub fn list_configs(&self) -> Vec<&BackupConfig> {
        self.configs.values().collect()
    }

    /// Enable or disable a backup config.
    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.enabled = enabled;
            true
        } else {
            false
        }
    }

    /// Set max revisions (how many backups to keep).
    pub fn set_max_revisions(&mut self, id: &str, count: u32) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.max_revisions = count;
            true
        } else {
            false
        }
    }

    /// Set the backup interval in seconds.
    pub fn set_interval(&mut self, id: &str, secs: u64) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.interval_seconds = secs;
            true
        } else {
            false
        }
    }

    /// Record a completed backup result.
    pub fn record_backup(&mut self, id: &str, result: BackupResult) {
        // Update last_backup on the config
        if let Some(c) = self.configs.get_mut(id) {
            if result.success {
                c.last_backup = Some(result.timestamp);
            } else if let Some(ref e) = result.error {
                c.last_error = Some(e.clone());
            }
        }

        let history = self.history.entry(id.to_string()).or_default();
        history.push(result);

        // Trim to max_history
        if history.len() > self.max_history {
            let excess = history.len() - self.max_history;
            history.drain(..excess);
        }
    }

    /// Get backup history for a config.
    pub fn get_history(&self, id: &str) -> Vec<&BackupResult> {
        match self.history.get(id) {
            Some(h) => h.iter().collect(),
            None => vec![],
        }
    }

    /// Get the latest backup result for a config.
    pub fn last_backup(&self, id: &str) -> Option<&BackupResult> {
        self.history.get(id).and_then(|h| h.last())
    }

    /// Get all configs that are enabled and eligible for backup.
    pub fn enabled_configs(&self) -> Vec<&BackupConfig> {
        self.configs.values().filter(|c| c.enabled).collect()
    }

    /// Generate a backup file name with a timestamp.
    pub fn backup_filename(config: &BackupConfig, timestamp: &DateTime<Utc>) -> String {
        let ts = timestamp.format("%Y%m%d_%H%M%S").to_string();
        format!(
            "{}/{}_backup_{}.json",
            config.dropbox_path.trim_end_matches('/'),
            config.name.replace(' ', "_"),
            ts,
        )
    }

    /// List backup files that should be pruned based on max_revisions.
    pub fn files_to_prune(&self, id: &str) -> Vec<String> {
        let config = match self.configs.get(id) {
            Some(c) => c,
            None => return vec![],
        };
        let history = match self.history.get(id) {
            Some(h) => h,
            None => return vec![],
        };

        let successful: Vec<&BackupResult> = history.iter().filter(|r| r.success).collect();
        if successful.len() <= config.max_revisions as usize {
            return vec![];
        }

        let excess = successful.len() - config.max_revisions as usize;
        successful[..excess]
            .iter()
            .filter_map(|r| r.file_path.clone())
            .collect()
    }

    /// Get total backup size for a config.
    pub fn total_backup_size(&self, id: &str) -> u64 {
        match self.history.get(id) {
            Some(h) => h
                .iter()
                .filter(|r| r.success)
                .filter_map(|r| r.file_size)
                .sum(),
            None => 0,
        }
    }

    /// Set max history entries.
    pub fn set_max_history(&mut self, max: usize) {
        self.max_history = max;
    }
}

impl Default for BackupManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_result(config_id: &str, file_path: &str, file_size: u64, success: bool, error: Option<&str>) -> BackupResult {
        BackupResult {
            backup_id: Uuid::new_v4().to_string(),
            config_id: config_id.to_string(),
            success,
            file_path: Some(file_path.to_string()),
            file_size: Some(file_size),
            timestamp: Utc::now(),
            error: error.map(|s| s.to_string()),
            rev: None,
        }
    }

    #[test]
    fn create_and_list() {
        let mut mgr = BackupManager::new();
        let includes = BackupIncludes {
            connections: true,
            credentials: false,
            settings: true,
            scripts: true,
            templates: false,
        };
        let id = mgr.create_config("My Backup", "acct", "/backups", includes);
        assert_eq!(mgr.list_configs().len(), 1);
        assert!(mgr.get_config(&id).is_some());
    }

    #[test]
    fn remove_config() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        assert!(mgr.remove_config(&id));
        assert!(!mgr.remove_config(&id));
    }

    #[test]
    fn enable_disable() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        mgr.set_enabled(&id, false);
        assert!(!mgr.get_config(&id).unwrap().enabled);
    }

    #[test]
    fn max_revisions_set() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        mgr.set_max_revisions(&id, 5);
        assert_eq!(mgr.get_config(&id).unwrap().max_revisions, 5);
    }

    #[test]
    fn interval_set() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        mgr.set_interval(&id, 7200);
        assert_eq!(mgr.get_config(&id).unwrap().interval_seconds, 7200);
    }

    #[test]
    fn record_and_history() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        let result = make_result(&id, "/bak/test_backup.json", 1024, true, None);
        mgr.record_backup(&id, result);
        assert_eq!(mgr.get_history(&id).len(), 1);
        assert!(mgr.last_backup(&id).is_some());
    }

    #[test]
    fn last_backup_updated() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        let result = make_result(&id, "/bak/file.json", 512, true, None);
        mgr.record_backup(&id, result);
        assert!(mgr.get_config(&id).unwrap().last_backup.is_some());
    }

    #[test]
    fn backup_filename_format() {
        let config = BackupConfig {
            id: "1".into(),
            name: "My Config".into(),
            account_name: "acct".into(),
            dropbox_path: "/backups".into(),
            interval_seconds: 3600,
            enabled: true,
            max_revisions: 30,
            includes: BackupIncludes::default(),
            created_at: Utc::now(),
            last_backup: None,
            last_error: None,
        };
        let ts = Utc::now();
        let fname = BackupManager::backup_filename(&config, &ts);
        assert!(fname.starts_with("/backups/My_Config_backup_"));
        assert!(fname.ends_with(".json"));
    }

    #[test]
    fn files_to_prune_below_retention() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        mgr.set_max_revisions(&id, 5);
        for i in 0..3 {
            mgr.record_backup(&id, make_result(&id, &format!("/bak/backup_{i}.json"), 100, true, None));
        }
        assert!(mgr.files_to_prune(&id).is_empty());
    }

    #[test]
    fn files_to_prune_above_retention() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        mgr.set_max_revisions(&id, 2);
        for i in 0..5 {
            mgr.record_backup(&id, make_result(&id, &format!("/bak/backup_{i}.json"), 100, true, None));
        }
        let prunable = mgr.files_to_prune(&id);
        assert_eq!(prunable.len(), 3);
    }

    #[test]
    fn total_backup_size_calc() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        for _ in 0..3 {
            mgr.record_backup(&id, make_result(&id, "/bak/f.json", 1000, true, None));
        }
        assert_eq!(mgr.total_backup_size(&id), 3000);
    }

    #[test]
    fn failed_backup_not_counted_size() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        mgr.record_backup(&id, make_result(&id, "/bak/f.json", 1000, false, Some("disk full")));
        assert_eq!(mgr.total_backup_size(&id), 0);
    }

    #[test]
    fn max_history_trim() {
        let mut mgr = BackupManager::new();
        mgr.set_max_history(3);
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        for i in 0..10 {
            mgr.record_backup(&id, make_result(&id, &format!("/bak/backup_{i}.json"), 100, true, None));
        }
        assert_eq!(mgr.get_history(&id).len(), 3);
    }

    #[test]
    fn default_impl() {
        let mgr = BackupManager::default();
        assert_eq!(mgr.list_configs().len(), 0);
    }

    #[test]
    fn update_config_existing() {
        let mut mgr = BackupManager::new();
        let id = mgr.create_config("test", "a", "/bak", BackupIncludes::default());
        let mut cfg = mgr.get_config(&id).unwrap().clone();
        cfg.name = "updated".into();
        assert!(mgr.update_config(cfg));
        assert_eq!(mgr.get_config(&id).unwrap().name, "updated");
    }

    #[test]
    fn update_config_nonexistent() {
        let mut mgr = BackupManager::new();
        let cfg = BackupConfig {
            id: "nonexistent".into(),
            name: "x".into(),
            account_name: "a".into(),
            dropbox_path: "/x".into(),
            interval_seconds: 3600,
            enabled: true,
            max_revisions: 30,
            includes: BackupIncludes::default(),
            created_at: Utc::now(),
            last_backup: None,
            last_error: None,
        };
        assert!(!mgr.update_config(cfg));
    }

    #[test]
    fn enabled_configs_filter() {
        let mut mgr = BackupManager::new();
        mgr.create_config("a", "acct", "/a", BackupIncludes::default());
        let id2 = mgr.create_config("b", "acct", "/b", BackupIncludes::default());
        mgr.set_enabled(&id2, false);
        assert_eq!(mgr.enabled_configs().len(), 1);
    }
}
