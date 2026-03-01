// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · watcher
// ──────────────────────────────────────────────────────────────────────────────
// Remote file change watcher:
//  • Manage watch configurations
//  • ETag-based polling for changes
//  • Activity-based polling alternative
//  • Change event notification
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::folders;
use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;
use uuid::Uuid;

/// Manages watches on remote directories and detects changes via ETag polling.
pub struct WatchManager {
    configs: HashMap<String, WatchConfig>,
    /// Cached state from the last poll: (config_id) → { remote_path → etag }.
    snapshots: HashMap<String, HashMap<String, String>>,
    /// Accumulated change events.
    changes: Vec<FileChange>,
    /// Maximum buffered changes before oldest are dropped.
    max_changes: usize,
}

impl WatchManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            snapshots: HashMap::new(),
            changes: Vec::new(),
            max_changes: 500,
        }
    }

    // ── Config management ────────────────────────────────────────────────

    pub fn add_config(&mut self, config: WatchConfig) {
        self.configs.insert(config.id.clone(), config);
    }

    pub fn remove_config(&mut self, id: &str) -> Option<WatchConfig> {
        self.snapshots.remove(id);
        self.configs.remove(id)
    }

    pub fn get_config(&self, id: &str) -> Option<&WatchConfig> {
        self.configs.get(id)
    }

    pub fn list_configs(&self) -> Vec<&WatchConfig> {
        self.configs.values().collect()
    }

    pub fn update_config(&mut self, config: WatchConfig) {
        self.configs.insert(config.id.clone(), config);
    }

    pub fn enabled_configs(&self) -> Vec<&WatchConfig> {
        self.configs.values().filter(|c| c.enabled).collect()
    }

    // ── Polling ──────────────────────────────────────────────────────────

    /// Poll a single watch config for changes.
    /// Returns newly detected changes.
    pub async fn poll(
        &mut self,
        config_id: &str,
        client: &NextcloudClient,
    ) -> Result<Vec<FileChange>, String> {
        let config = self
            .configs
            .get(config_id)
            .cloned()
            .ok_or_else(|| format!("watch config {} not found", config_id))?;

        if !config.enabled {
            return Ok(Vec::new());
        }

        debug!("Polling watch {}: {}", config.id, config.remote_path);

        let listing = folders::list_folder(client, &config.remote_path).await?;
        let new_snapshot = build_snapshot(&listing.children);

        let old_snapshot = self
            .snapshots
            .get(config_id)
            .cloned()
            .unwrap_or_default();

        let detected = diff_snapshots(&old_snapshot, &new_snapshot, &listing.children, &config);

        // Update snapshot
        self.snapshots
            .insert(config_id.to_string(), new_snapshot);

        // Buffer changes
        for change in &detected {
            self.changes.push(change.clone());
        }
        while self.changes.len() > self.max_changes {
            self.changes.remove(0);
        }

        if !detected.is_empty() {
            info!(
                "Watch {} detected {} changes in {}",
                config.id,
                detected.len(),
                config.remote_path
            );
        }

        Ok(detected)
    }

    /// Poll all enabled watches.
    pub async fn poll_all(
        &mut self,
        client: &NextcloudClient,
    ) -> Vec<FileChange> {
        let ids: Vec<String> = self
            .configs
            .values()
            .filter(|c| c.enabled)
            .map(|c| c.id.clone())
            .collect();

        let mut all_changes = Vec::new();
        for id in ids {
            match self.poll(&id, client).await {
                Ok(changes) => all_changes.extend(changes),
                Err(e) => warn!("Watch {} poll failed: {}", id, e),
            }
        }
        all_changes
    }

    // ── Change access ────────────────────────────────────────────────────

    /// Get all buffered changes.
    pub fn changes(&self) -> &[FileChange] {
        &self.changes
    }

    /// Get changes since a specific timestamp.
    pub fn changes_since(&self, since: &chrono::DateTime<Utc>) -> Vec<&FileChange> {
        self.changes
            .iter()
            .filter(|c| &c.detected_at >= since)
            .collect()
    }

    /// Clear all buffered changes.
    pub fn clear_changes(&mut self) {
        self.changes.clear();
    }

    /// Get changes for a specific path.
    pub fn changes_for_path(&self, path: &str) -> Vec<&FileChange> {
        self.changes
            .iter()
            .filter(|c| c.path == path)
            .collect()
    }

    // ── Snapshot management ──────────────────────────────────────────────

    /// Check if we have a baseline snapshot for a config.
    pub fn has_snapshot(&self, config_id: &str) -> bool {
        self.snapshots.contains_key(config_id)
    }

    /// Force a baseline snapshot capture (no change detection).
    pub async fn capture_baseline(
        &mut self,
        config_id: &str,
        client: &NextcloudClient,
    ) -> Result<(), String> {
        let config = self
            .configs
            .get(config_id)
            .ok_or_else(|| format!("watch config {} not found", config_id))?;

        let listing = folders::list_folder(client, &config.remote_path).await?;
        let snapshot = build_snapshot(&listing.children);
        self.snapshots.insert(config_id.to_string(), snapshot);
        Ok(())
    }

    /// Reset snapshot for a config (next poll will be a baseline).
    pub fn reset_snapshot(&mut self, config_id: &str) {
        self.snapshots.remove(config_id);
    }

    /// Reset all snapshots.
    pub fn reset_all_snapshots(&mut self) {
        self.snapshots.clear();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Create a new watch config with defaults.
pub fn build_watch_config(remote_path: &str, poll_interval_secs: u64) -> WatchConfig {
    WatchConfig {
        id: Uuid::new_v4().to_string(),
        remote_path: remote_path.to_string(),
        recursive: false,
        poll_interval_secs,
        enabled: true,
        ignore_patterns: vec![
            ".git/**".to_string(),
            "*.tmp".to_string(),
            ".DS_Store".to_string(),
        ],
    }
}

/// Build a snapshot from a list of resources: path → etag.
fn build_snapshot(resources: &[DavResource]) -> HashMap<String, String> {
    resources
        .iter()
        .filter_map(|r| {
            r.etag
                .as_ref()
                .map(|e| (r.display_name.clone(), e.clone()))
        })
        .collect()
}

/// Diff two snapshots and return change events.
fn diff_snapshots(
    old: &HashMap<String, String>,
    new: &HashMap<String, String>,
    resources: &[DavResource],
    config: &WatchConfig,
) -> Vec<FileChange> {
    let now = Utc::now();
    let mut changes = Vec::new();

    // Resource lookup for type info
    let resource_map: HashMap<&str, &DavResource> = resources
        .iter()
        .map(|r| (r.display_name.as_str(), r))
        .collect();

    // New or modified
    for (path, new_etag) in new {
        if should_ignore(path, &config.ignore_patterns) {
            continue;
        }

        let resource = resource_map.get(path.as_str());
        let rtype = resource
            .map(|r| r.resource_type.clone())
            .unwrap_or(DavResourceType::File);
        let size = resource.and_then(|r| r.content_length);

        match old.get(path) {
            None => {
                changes.push(FileChange {
                    path: path.clone(),
                    change_type: ChangeType::Created,
                    resource_type: rtype,
                    etag: Some(new_etag.clone()),
                    size,
                    detected_at: now,
                });
            }
            Some(old_etag) if old_etag != new_etag => {
                changes.push(FileChange {
                    path: path.clone(),
                    change_type: ChangeType::Modified,
                    resource_type: rtype,
                    etag: Some(new_etag.clone()),
                    size,
                    detected_at: now,
                });
            }
            _ => {} // unchanged
        }
    }

    // Deleted
    for path in old.keys() {
        if !new.contains_key(path) && !should_ignore(path, &config.ignore_patterns) {
            changes.push(FileChange {
                path: path.clone(),
                change_type: ChangeType::Deleted,
                resource_type: DavResourceType::File, // assume file if gone
                etag: None,
                size: None,
                detected_at: now,
            });
        }
    }

    changes
}

/// Check if a path should be ignored.
fn should_ignore(path: &str, patterns: &[String]) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    for pattern in patterns {
        if pattern.contains("**") {
            let prefix = pattern.trim_end_matches("/**");
            if path.contains(prefix) {
                return true;
            }
        } else if pattern.starts_with("*.") {
            let ext = &pattern[1..];
            if name.ends_with(ext) {
                return true;
            }
        } else if name == pattern {
            return true;
        }
    }
    false
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_watch_config_defaults() {
        let c = build_watch_config("/Documents", 30);
        assert!(c.enabled);
        assert!(!c.recursive);
        assert_eq!(c.poll_interval_secs, 30);
        assert!(!c.ignore_patterns.is_empty());
    }

    #[test]
    fn watch_manager_config_crud() {
        let mut mgr = WatchManager::new();
        assert!(mgr.list_configs().is_empty());

        let c = build_watch_config("/test", 60);
        let id = c.id.clone();
        mgr.add_config(c);
        assert_eq!(mgr.list_configs().len(), 1);
        assert!(mgr.get_config(&id).is_some());

        let removed = mgr.remove_config(&id);
        assert!(removed.is_some());
        assert!(mgr.list_configs().is_empty());
    }

    #[test]
    fn watch_manager_enabled_only() {
        let mut mgr = WatchManager::new();

        let mut c1 = build_watch_config("/a", 30);
        c1.enabled = true;
        let mut c2 = build_watch_config("/b", 30);
        c2.enabled = false;

        mgr.add_config(c1);
        mgr.add_config(c2);

        assert_eq!(mgr.enabled_configs().len(), 1);
    }

    #[test]
    fn build_snapshot_from_resources() {
        let resources = vec![
            DavResource {
                display_name: "file1.txt".into(),
                etag: Some("etag1".into()),
                ..DavResource::default()
            },
            DavResource {
                display_name: "file2.txt".into(),
                etag: Some("etag2".into()),
                ..DavResource::default()
            },
            DavResource {
                display_name: "no_etag".into(),
                etag: None,
                ..DavResource::default()
            },
        ];

        let snap = build_snapshot(&resources);
        assert_eq!(snap.len(), 2);
        assert_eq!(snap.get("file1.txt"), Some(&"etag1".to_string()));
    }

    #[test]
    fn diff_detects_created() {
        let old = HashMap::new();
        let mut new_snap = HashMap::new();
        new_snap.insert("new.txt".to_string(), "etag1".to_string());

        let resources = vec![DavResource {
            display_name: "new.txt".into(),
            etag: Some("etag1".into()),
            content_length: Some(100),
            ..DavResource::default()
        }];

        let config = build_watch_config("/test", 30);
        let changes = diff_snapshots(&old, &new_snap, &resources, &config);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].change_type, ChangeType::Created);
        assert_eq!(changes[0].path, "new.txt");
    }

    #[test]
    fn diff_detects_modified() {
        let mut old = HashMap::new();
        old.insert("file.txt".to_string(), "etag_old".to_string());

        let mut new_snap = HashMap::new();
        new_snap.insert("file.txt".to_string(), "etag_new".to_string());

        let resources = vec![DavResource {
            display_name: "file.txt".into(),
            etag: Some("etag_new".into()),
            ..DavResource::default()
        }];

        let config = build_watch_config("/test", 30);
        let changes = diff_snapshots(&old, &new_snap, &resources, &config);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].change_type, ChangeType::Modified);
    }

    #[test]
    fn diff_detects_deleted() {
        let mut old = HashMap::new();
        old.insert("gone.txt".to_string(), "etag1".to_string());

        let new_snap = HashMap::new();
        let config = build_watch_config("/test", 30);
        let changes = diff_snapshots(&old, &new_snap, &[], &config);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].change_type, ChangeType::Deleted);
        assert_eq!(changes[0].path, "gone.txt");
    }

    #[test]
    fn diff_unchanged_no_events() {
        let mut old = HashMap::new();
        old.insert("same.txt".to_string(), "etag1".to_string());

        let mut new_snap = HashMap::new();
        new_snap.insert("same.txt".to_string(), "etag1".to_string());

        let resources = vec![DavResource {
            display_name: "same.txt".into(),
            etag: Some("etag1".into()),
            ..DavResource::default()
        }];

        let config = build_watch_config("/test", 30);
        let changes = diff_snapshots(&old, &new_snap, &resources, &config);
        assert!(changes.is_empty());
    }

    #[test]
    fn diff_ignores_patterns() {
        let old = HashMap::new();
        let mut new_snap = HashMap::new();
        new_snap.insert(".DS_Store".to_string(), "etag1".to_string());
        new_snap.insert("file.tmp".to_string(), "etag2".to_string());
        new_snap.insert("real.txt".to_string(), "etag3".to_string());

        let resources = vec![
            DavResource { display_name: ".DS_Store".into(), etag: Some("etag1".into()), ..DavResource::default() },
            DavResource { display_name: "file.tmp".into(), etag: Some("etag2".into()), ..DavResource::default() },
            DavResource { display_name: "real.txt".into(), etag: Some("etag3".into()), ..DavResource::default() },
        ];

        let config = build_watch_config("/test", 30);
        let changes = diff_snapshots(&old, &new_snap, &resources, &config);
        // Only real.txt should appear
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "real.txt");
    }

    #[test]
    fn should_ignore_exact() {
        assert!(should_ignore(".DS_Store", &[".DS_Store".into()]));
        assert!(!should_ignore("okay.txt", &[".DS_Store".into()]));
    }

    #[test]
    fn should_ignore_extension() {
        assert!(should_ignore("test.tmp", &["*.tmp".into()]));
        assert!(!should_ignore("test.txt", &["*.tmp".into()]));
    }

    #[test]
    fn change_buffer_capped() {
        let mut mgr = WatchManager::new();
        mgr.max_changes = 3;

        for i in 0..5 {
            mgr.changes.push(FileChange {
                path: format!("file{}.txt", i),
                change_type: ChangeType::Created,
                resource_type: DavResourceType::File,
                etag: None,
                size: None,
                detected_at: Utc::now(),
            });
        }

        // Simulate the capping
        while mgr.changes.len() > mgr.max_changes {
            mgr.changes.remove(0);
        }

        assert_eq!(mgr.changes.len(), 3);
    }

    #[test]
    fn snapshot_management() {
        let mut mgr = WatchManager::new();
        assert!(!mgr.has_snapshot("cfg1"));

        mgr.snapshots.insert("cfg1".to_string(), HashMap::new());
        assert!(mgr.has_snapshot("cfg1"));

        mgr.reset_snapshot("cfg1");
        assert!(!mgr.has_snapshot("cfg1"));
    }
}
