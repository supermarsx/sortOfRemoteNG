//! File watcher — poll-based change detection using Dropbox cursors.

use crate::types::*;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use uuid::Uuid;

/// Manages file-change watching configurations.
pub struct WatchManager {
    configs: HashMap<String, WatchConfig>,
    changes: HashMap<String, Vec<FileChange>>,
    max_changes: usize,
}

impl WatchManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            changes: HashMap::new(),
            max_changes: 500,
        }
    }

    /// Create a new watch configuration.
    pub fn create_watch(
        &mut self,
        name: &str,
        account_name: &str,
        dropbox_path: &str,
        recursive: bool,
        interval_seconds: u64,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let config = WatchConfig {
            id: id.clone(),
            name: name.to_string(),
            account_name: account_name.to_string(),
            dropbox_path: dropbox_path.to_string(),
            recursive,
            interval_seconds,
            enabled: true,
            created_at: Utc::now(),
            cursor: None,
            last_poll: None,
        };
        self.configs.insert(id.clone(), config);
        id
    }

    /// Remove a watch configuration.
    pub fn remove_watch(&mut self, id: &str) -> bool {
        self.changes.remove(id);
        self.configs.remove(id).is_some()
    }

    /// Get a watch config by ID.
    pub fn get_watch(&self, id: &str) -> Option<&WatchConfig> {
        self.configs.get(id)
    }

    /// List all watch configs.
    pub fn list_watches(&self) -> Vec<&WatchConfig> {
        self.configs.values().collect()
    }

    /// Enable or disable a watch.
    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> bool {
        if let Some(c) = self.configs.get_mut(id) {
            c.enabled = enabled;
            true
        } else {
            false
        }
    }

    /// Store a cursor for a watch.
    pub fn set_cursor(&mut self, id: &str, cursor: String) {
        if let Some(c) = self.configs.get_mut(id) {
            c.cursor = Some(cursor);
        }
    }

    /// Get the current cursor for a watch.
    pub fn get_cursor(&self, id: &str) -> Option<&str> {
        self.configs
            .get(id)
            .and_then(|c| c.cursor.as_deref())
    }

    /// Update the last poll time.
    pub fn update_last_poll(&mut self, id: &str) {
        if let Some(c) = self.configs.get_mut(id) {
            c.last_poll = Some(Utc::now());
        }
    }

    /// Record detected changes.
    pub fn record_changes(&mut self, id: &str, new_changes: Vec<FileChange>) {
        let changes = self.changes.entry(id.to_string()).or_default();
        changes.extend(new_changes);

        if changes.len() > self.max_changes {
            let excess = changes.len() - self.max_changes;
            changes.drain(..excess);
        }
    }

    /// Get all recorded changes for a watch.
    pub fn get_changes(&self, id: &str) -> Vec<&FileChange> {
        match self.changes.get(id) {
            Some(c) => c.iter().collect(),
            None => vec![],
        }
    }

    /// Get changes since a given timestamp.
    pub fn get_changes_since(&self, id: &str, since: DateTime<Utc>) -> Vec<&FileChange> {
        match self.changes.get(id) {
            Some(c) => c.iter().filter(|ch| ch.detected_at >= since).collect(),
            None => vec![],
        }
    }

    /// Clear all recorded changes for a watch.
    pub fn clear_changes(&mut self, id: &str) {
        self.changes.remove(id);
    }

    /// Convert a Dropbox metadata entry to a FileChange.
    pub fn metadata_to_change(watch_id: &str, meta: &Metadata) -> FileChange {
        let change_type = match meta.tag {
            MetadataTag::File => ChangeType::Modified,
            MetadataTag::Folder => ChangeType::Added,
            MetadataTag::Deleted => ChangeType::Deleted,
        };
        FileChange {
            watch_id: watch_id.to_string(),
            metadata: meta.clone(),
            change_type,
            detected_at: Utc::now(),
        }
    }

    /// Get active (enabled) watches.
    pub fn active_watches(&self) -> Vec<&WatchConfig> {
        self.configs.values().filter(|c| c.enabled).collect()
    }

    /// Get the number of pending changes across all watches.
    pub fn total_pending_changes(&self) -> usize {
        self.changes.values().map(|c| c.len()).sum()
    }

    /// Set the maximum number of stored changes per watch.
    pub fn set_max_changes(&mut self, max: usize) {
        self.max_changes = max;
    }
}

impl Default for WatchManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper: build a minimal test Metadata value.
#[cfg(test)]
fn test_meta(tag: MetadataTag, name: &str, path: &str) -> Metadata {
    let is_file = matches!(tag, MetadataTag::File);
    Metadata {
        tag,
        name: name.to_string(),
        path_lower: Some(path.to_lowercase()),
        path_display: Some(path.to_string()),
        id: None,
        size: if is_file { Some(1024) } else { None },
        rev: None,
        content_hash: None,
        client_modified: None,
        server_modified: None,
        is_downloadable: None,
        media_info: None,
        symlink_info: None,
        sharing_info: None,
        property_groups: None,
        has_explicit_shared_members: None,
        file_lock_info: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn create_and_list() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/remote/folder", true, 30);
        assert_eq!(mgr.list_watches().len(), 1);
        assert!(mgr.get_watch(&id).is_some());
    }

    #[test]
    fn remove_watch() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/remote", false, 60);
        assert!(mgr.remove_watch(&id));
        assert!(!mgr.remove_watch(&id));
    }

    #[test]
    fn enable_disable() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/remote", true, 30);
        mgr.set_enabled(&id, false);
        assert!(!mgr.get_watch(&id).unwrap().enabled);
    }

    #[test]
    fn cursor_management() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/remote", true, 30);
        assert!(mgr.get_cursor(&id).is_none());
        mgr.set_cursor(&id, "cursor_abc".into());
        assert_eq!(mgr.get_cursor(&id).unwrap(), "cursor_abc");
    }

    #[test]
    fn record_and_get_changes() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/remote", true, 30);
        let meta1 = test_meta(MetadataTag::File, "file1.txt", "/remote/file1.txt");
        let meta2 = test_meta(MetadataTag::File, "file2.txt", "/remote/file2.txt");
        let changes = vec![
            WatchManager::metadata_to_change(&id, &meta1),
            WatchManager::metadata_to_change(&id, &meta2),
        ];
        mgr.record_changes(&id, changes);
        assert_eq!(mgr.get_changes(&id).len(), 2);
    }

    #[test]
    fn get_changes_since() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/remote", true, 30);
        let old_time = Utc::now() - Duration::hours(2);
        let recent_time = Utc::now();
        let meta = test_meta(MetadataTag::File, "old.txt", "/old.txt");
        let old_change = FileChange {
            watch_id: id.clone(),
            metadata: meta.clone(),
            change_type: ChangeType::Modified,
            detected_at: old_time,
        };
        let new_meta = test_meta(MetadataTag::File, "new.txt", "/new.txt");
        let new_change = FileChange {
            watch_id: id.clone(),
            metadata: new_meta,
            change_type: ChangeType::Added,
            detected_at: recent_time,
        };
        mgr.record_changes(&id, vec![old_change, new_change]);
        let since = Utc::now() - Duration::hours(1);
        let recent = mgr.get_changes_since(&id, since);
        assert_eq!(recent.len(), 1);
    }

    #[test]
    fn clear_changes() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/remote", true, 30);
        let meta = test_meta(MetadataTag::File, "x.txt", "/x.txt");
        mgr.record_changes(&id, vec![WatchManager::metadata_to_change(&id, &meta)]);
        assert_eq!(mgr.get_changes(&id).len(), 1);
        mgr.clear_changes(&id);
        assert_eq!(mgr.get_changes(&id).len(), 0);
    }

    #[test]
    fn metadata_to_change_file() {
        let meta = test_meta(MetadataTag::File, "test.txt", "/test.txt");
        let change = WatchManager::metadata_to_change("w1", &meta);
        assert_eq!(change.watch_id, "w1");
        assert!(matches!(change.change_type, ChangeType::Modified));
    }

    #[test]
    fn metadata_to_change_deleted() {
        let meta = test_meta(MetadataTag::Deleted, "removed.txt", "/removed.txt");
        let change = WatchManager::metadata_to_change("w1", &meta);
        assert!(matches!(change.change_type, ChangeType::Deleted));
    }

    #[test]
    fn active_watches() {
        let mut mgr = WatchManager::new();
        mgr.create_watch("A", "acct", "/a", true, 30);
        let id2 = mgr.create_watch("B", "acct", "/b", true, 30);
        mgr.set_enabled(&id2, false);
        assert_eq!(mgr.active_watches().len(), 1);
    }

    #[test]
    fn total_pending_changes() {
        let mut mgr = WatchManager::new();
        let id1 = mgr.create_watch("A", "acct", "/a", true, 30);
        let id2 = mgr.create_watch("B", "acct", "/b", true, 30);
        let meta = test_meta(MetadataTag::File, "f", "/f");
        mgr.record_changes(&id1, vec![WatchManager::metadata_to_change(&id1, &meta)]);
        mgr.record_changes(&id2, vec![
            WatchManager::metadata_to_change(&id2, &meta),
            WatchManager::metadata_to_change(&id2, &meta),
        ]);
        assert_eq!(mgr.total_pending_changes(), 3);
    }

    #[test]
    fn max_changes_limit() {
        let mut mgr = WatchManager::new();
        mgr.set_max_changes(5);
        let id = mgr.create_watch("W1", "acct", "/remote", true, 30);
        for i in 0..20 {
            let meta = test_meta(MetadataTag::File, &format!("file_{i}.txt"), &format!("/file_{i}.txt"));
            mgr.record_changes(&id, vec![WatchManager::metadata_to_change(&id, &meta)]);
        }
        assert_eq!(mgr.get_changes(&id).len(), 5);
    }

    #[test]
    fn update_last_poll() {
        let mut mgr = WatchManager::new();
        let id = mgr.create_watch("W1", "acct", "/r", true, 30);
        assert!(mgr.get_watch(&id).unwrap().last_poll.is_none());
        mgr.update_last_poll(&id);
        assert!(mgr.get_watch(&id).unwrap().last_poll.is_some());
    }

    #[test]
    fn default_impl() {
        let mgr = WatchManager::default();
        assert_eq!(mgr.list_watches().len(), 0);
    }
}
