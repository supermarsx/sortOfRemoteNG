//! Two-way sync between a local folder and a Dropbox folder.

use crate::types::*;
use chrono::{DateTime, Utc};
use regex::Regex;
use std::collections::HashMap;
use uuid::Uuid;

/// Manages sync configurations and state.
pub struct SyncManager {
    configs: HashMap<String, SyncConfig>,
    statuses: HashMap<String, SyncRunResult>,
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            statuses: HashMap::new(),
        }
    }

    /// Add or update a sync configuration.
    pub fn upsert_config(&mut self, config: SyncConfig) -> String {
        let id = config.id.clone();
        self.configs.insert(id.clone(), config);
        id
    }

    /// Create a new sync config with generated ID.
    pub fn create_config(
        &mut self,
        name: &str,
        account_name: &str,
        local_path: &str,
        dropbox_path: &str,
        direction: SyncDirection,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let config = SyncConfig {
            id: id.clone(),
            name: name.to_string(),
            account_name: account_name.to_string(),
            local_path: local_path.to_string(),
            dropbox_path: dropbox_path.to_string(),
            direction,
            interval_seconds: 300,
            enabled: true,
            exclude_patterns: Vec::new(),
            delete_on_remote: false,
            created_at: Utc::now(),
            last_sync: None,
            last_error: None,
        };
        self.configs.insert(id.clone(), config);
        id
    }

    /// Remove a sync configuration.
    pub fn remove_config(&mut self, id: &str) -> bool {
        self.configs.remove(id).is_some()
    }

    /// Get a sync configuration by ID.
    pub fn get_config(&self, id: &str) -> Option<&SyncConfig> {
        self.configs.get(id)
    }

    /// List all sync configurations.
    pub fn list_configs(&self) -> Vec<&SyncConfig> {
        self.configs.values().collect()
    }

    /// Set exclusion patterns on a config.
    pub fn set_exclude_patterns(&mut self, id: &str, patterns: Vec<String>) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.exclude_patterns = patterns;
            true
        } else {
            false
        }
    }

    /// Check whether a file path matches any exclusion pattern.
    pub fn is_excluded(&self, id: &str, path: &str) -> bool {
        let config = match self.configs.get(id) {
            Some(c) => c,
            None => return false,
        };
        is_path_excluded(path, &config.exclude_patterns)
    }

    /// Record the result of a sync run.
    pub fn record_run(&mut self, id: &str, result: SyncRunResult) {
        if let Some(c) = self.configs.get_mut(id) {
            c.last_sync = Some(result.finished_at);
            if !result.errors.is_empty() {
                c.last_error = Some(result.errors.join("; "));
            } else {
                c.last_error = None;
            }
        }
        self.statuses.insert(id.to_string(), result);
    }

    /// Get the last sync result for a config.
    pub fn last_run(&self, id: &str) -> Option<&SyncRunResult> {
        self.statuses.get(id)
    }

    /// Enable or disable a sync config.
    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.enabled = enabled;
            true
        } else {
            false
        }
    }

    /// Set the sync interval (seconds) for a config.
    pub fn set_sync_interval(&mut self, id: &str, secs: u64) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.interval_seconds = secs;
            true
        } else {
            false
        }
    }

    /// Set delete-on-remote behaviour.
    pub fn set_delete_on_remote(&mut self, id: &str, val: bool) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.delete_on_remote = val;
            true
        } else {
            false
        }
    }
}

impl Default for SyncManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Check if a path matches any glob-like exclude patterns.
///
/// Supports:
/// - `*.ext` — match by extension
/// - `exact_name` — match by exact file/folder name segment
/// - Patterns starting with `/` are anchored to the root.
pub fn is_path_excluded(path: &str, patterns: &[String]) -> bool {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    for pat in patterns {
        if pat.starts_with("*.") {
            let ext = &pat[1..]; // e.g. ".tmp"
            if path.ends_with(ext) {
                return true;
            }
        } else if let Ok(re) = Regex::new(pat) {
            if re.is_match(path) {
                return true;
            }
        } else {
            // plain name match
            if segments.contains(&pat.as_str()) {
                return true;
            }
        }
    }
    false
}

/// Determine what action is needed for a file based on local/remote timestamps.
pub fn determine_sync_action(
    local_modified: Option<DateTime<Utc>>,
    remote_modified: Option<DateTime<Utc>>,
    direction: &SyncDirection,
) -> SyncAction {
    match (local_modified, remote_modified) {
        (Some(_), None) => match direction {
            SyncDirection::Upload | SyncDirection::Bidirectional => SyncAction::Uploaded,
            SyncDirection::Download => SyncAction::Deleted,
        },
        (None, Some(_)) => match direction {
            SyncDirection::Download | SyncDirection::Bidirectional => SyncAction::Downloaded,
            SyncDirection::Upload => SyncAction::Deleted,
        },
        (Some(l), Some(r)) => {
            if l > r {
                match direction {
                    SyncDirection::Upload | SyncDirection::Bidirectional => SyncAction::Uploaded,
                    SyncDirection::Download => SyncAction::Downloaded,
                }
            } else if r > l {
                match direction {
                    SyncDirection::Download | SyncDirection::Bidirectional => SyncAction::Downloaded,
                    SyncDirection::Upload => SyncAction::Uploaded,
                }
            } else {
                SyncAction::Skipped
            }
        }
        (None, None) => SyncAction::Skipped,
    }
}

/// Generate a conflict-renamed path.
///
/// Example: `/docs/report.pdf` → `/docs/report (conflict 2024-01-15T12:00:00Z).pdf`
pub fn conflict_rename(path: &str, timestamp: &DateTime<Utc>) -> String {
    let ts = timestamp.format("%Y-%m-%dT%H-%M-%SZ").to_string();
    if let Some(dot_pos) = path.rfind('.') {
        let (base, ext) = path.split_at(dot_pos);
        format!("{base} (conflict {ts}){ext}")
    } else {
        format!("{path} (conflict {ts})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn create_and_list_configs() {
        let mut mgr = SyncManager::new();
        let id = mgr.create_config("Sync1", "acct", "/local/docs", "/remote/docs", SyncDirection::Bidirectional);
        assert_eq!(mgr.list_configs().len(), 1);
        assert!(mgr.get_config(&id).is_some());
    }

    #[test]
    fn remove_config() {
        let mut mgr = SyncManager::new();
        let id = mgr.create_config("S", "a", "/a", "/b", SyncDirection::Upload);
        assert!(mgr.remove_config(&id));
        assert!(!mgr.remove_config(&id));
    }

    #[test]
    fn exclude_patterns() {
        let mut mgr = SyncManager::new();
        let id = mgr.create_config("S", "a", "/a", "/b", SyncDirection::Upload);
        mgr.set_exclude_patterns(&id, vec!["*.tmp".into(), "node_modules".into()]);
        assert!(mgr.is_excluded(&id, "/path/to/file.tmp"));
        assert!(!mgr.is_excluded(&id, "/path/to/file.txt"));
    }

    #[test]
    fn is_path_excluded_extension() {
        assert!(is_path_excluded("/a/b.tmp", &["*.tmp".into()]));
        assert!(!is_path_excluded("/a/b.txt", &["*.tmp".into()]));
    }

    #[test]
    fn is_path_excluded_regex() {
        assert!(is_path_excluded("/build/output.js", &["build".into()]));
    }

    #[test]
    fn sync_action_upload_new_local() {
        let action = determine_sync_action(
            Some(Utc::now()),
            None,
            &SyncDirection::Upload,
        );
        assert!(matches!(action, SyncAction::Uploaded));
    }

    #[test]
    fn sync_action_download_new_remote() {
        let action = determine_sync_action(
            None,
            Some(Utc::now()),
            &SyncDirection::Download,
        );
        assert!(matches!(action, SyncAction::Downloaded));
    }

    #[test]
    fn sync_action_skip_same_time() {
        let t = Utc::now();
        let action = determine_sync_action(Some(t), Some(t), &SyncDirection::Bidirectional);
        assert!(matches!(action, SyncAction::Skipped));
    }

    #[test]
    fn sync_action_local_newer_upload() {
        let local = Utc::now();
        let remote = local - Duration::hours(1);
        let action = determine_sync_action(Some(local), Some(remote), &SyncDirection::Upload);
        assert!(matches!(action, SyncAction::Uploaded));
    }

    #[test]
    fn sync_action_remote_newer_download() {
        let remote = Utc::now();
        let local = remote - Duration::hours(1);
        let action = determine_sync_action(Some(local), Some(remote), &SyncDirection::Download);
        assert!(matches!(action, SyncAction::Downloaded));
    }

    #[test]
    fn conflict_rename_with_ext() {
        let ts = Utc::now();
        let renamed = conflict_rename("/docs/report.pdf", &ts);
        assert!(renamed.contains("conflict"));
        assert!(renamed.ends_with(".pdf"));
    }

    #[test]
    fn conflict_rename_no_ext() {
        let ts = Utc::now();
        let renamed = conflict_rename("/docs/Makefile", &ts);
        assert!(renamed.contains("conflict"));
    }

    #[test]
    fn enabled_toggle() {
        let mut mgr = SyncManager::new();
        let id = mgr.create_config("S", "a", "/a", "/b", SyncDirection::Upload);
        assert!(mgr.set_enabled(&id, false));
        assert!(!mgr.get_config(&id).unwrap().enabled);
    }

    #[test]
    fn sync_interval_set() {
        let mut mgr = SyncManager::new();
        let id = mgr.create_config("S", "a", "/a", "/b", SyncDirection::Upload);
        mgr.set_sync_interval(&id, 600);
        assert_eq!(mgr.get_config(&id).unwrap().interval_seconds, 600);
    }

    #[test]
    fn record_and_get_run() {
        let mut mgr = SyncManager::new();
        let id = mgr.create_config("S", "a", "/a", "/b", SyncDirection::Upload);
        let run = SyncRunResult {
            sync_id: id.clone(),
            started_at: Utc::now(),
            finished_at: Utc::now(),
            files_uploaded: 5,
            files_downloaded: 0,
            files_deleted: 1,
            files_skipped: 10,
            conflicts: 0,
            errors: vec![],
        };
        mgr.record_run(&id, run);
        let last = mgr.last_run(&id).unwrap();
        assert_eq!(last.files_uploaded, 5);
    }

    #[test]
    fn default_impl() {
        let mgr = SyncManager::default();
        assert_eq!(mgr.list_configs().len(), 0);
    }
}
