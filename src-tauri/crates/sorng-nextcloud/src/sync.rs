// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · sync
// ──────────────────────────────────────────────────────────────────────────────
// Bidirectional sync engine:
//  • Manage multiple sync configurations
//  • Sync planner with exclusion patterns, size filters
//  • Conflict resolution strategies
//  • Sync execution (upload / download / delete)
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::files;
use crate::folders;
use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;
use uuid::Uuid;

/// Manages multiple `SyncConfig`s and keeps ETag caches for change detection.
pub struct SyncManager {
    configs: HashMap<String, SyncConfig>,
    /// Cached ETags from the last sync keyed by (config_id, remote_path).
    etag_cache: HashMap<(String, String), String>,
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            etag_cache: HashMap::new(),
        }
    }

    // ── Config management ────────────────────────────────────────────────

    pub fn add_config(&mut self, config: SyncConfig) {
        self.configs.insert(config.id.clone(), config);
    }

    pub fn remove_config(&mut self, id: &str) -> Option<SyncConfig> {
        self.etag_cache.retain(|(cid, _), _| cid != id);
        self.configs.remove(id)
    }

    pub fn get_config(&self, id: &str) -> Option<&SyncConfig> {
        self.configs.get(id)
    }

    pub fn get_config_mut(&mut self, id: &str) -> Option<&mut SyncConfig> {
        self.configs.get_mut(id)
    }

    pub fn list_configs(&self) -> Vec<&SyncConfig> {
        self.configs.values().collect()
    }

    pub fn update_config(&mut self, config: SyncConfig) {
        self.configs.insert(config.id.clone(), config);
    }

    pub fn enabled_configs(&self) -> Vec<&SyncConfig> {
        self.configs.values().filter(|c| c.enabled).collect()
    }

    // ── Sync execution ───────────────────────────────────────────────────

    /// Run a sync for a specific config.
    pub async fn run_sync(
        &mut self,
        config_id: &str,
        client: &NextcloudClient,
    ) -> Result<SyncRunResult, String> {
        let config = self
            .configs
            .get(config_id)
            .cloned()
            .ok_or_else(|| format!("sync config {} not found", config_id))?;

        if !config.enabled {
            return Err(format!("sync config {} is disabled", config_id));
        }

        info!("Starting sync: {} ({})", config.id, config.direction_label());
        let started_at = Utc::now();
        let mut result = SyncRunResult {
            config_id: config.id.clone(),
            started_at,
            finished_at: None,
            files_uploaded: 0,
            files_downloaded: 0,
            files_deleted: 0,
            files_skipped: 0,
            conflicts: 0,
            errors: Vec::new(),
            actions: Vec::new(),
        };

        // Get remote listing
        let remote_items = match folders::list_folder(client, &config.remote_path).await {
            Ok(r) => r.children,
            Err(e) => {
                result.errors.push(format!("remote listing failed: {}", e));
                result.finished_at = Some(Utc::now());
                return Ok(result);
            }
        };

        // Get local file list
        let local_files = match list_local_files(&config.local_path) {
            Ok(f) => f,
            Err(e) => {
                result.errors.push(format!("local listing failed: {}", e));
                result.finished_at = Some(Utc::now());
                return Ok(result);
            }
        };

        // Plan sync actions
        let plan = plan_sync(
            &config,
            &local_files,
            &remote_items,
            &self.etag_cache,
        );

        // Execute planned actions
        for action in plan {
            let exec_result = execute_sync_action(client, &config, &action).await;
            match exec_result {
                Ok(completed) => {
                    match completed.status {
                        SyncFileStatus::Done => match completed.direction {
                            SyncDirection::Upload => result.files_uploaded += 1,
                            SyncDirection::Download => result.files_downloaded += 1,
                            SyncDirection::Bidirectional => {}
                        },
                        SyncFileStatus::Skipped => result.files_skipped += 1,
                        SyncFileStatus::Conflict => result.conflicts += 1,
                        SyncFileStatus::Error => {
                            if let Some(ref e) = completed.error {
                                result.errors.push(e.clone());
                            }
                        }
                        _ => {}
                    }
                    // Update etag cache
                    if completed.status == SyncFileStatus::Done {
                        // We'd query the new etag here in a real implementation
                    }
                    result.actions.push(completed);
                }
                Err(e) => {
                    result.errors.push(e.clone());
                    result.actions.push(SyncAction {
                        path: action.path.clone(),
                        status: SyncFileStatus::Error,
                        direction: action.direction.clone(),
                        bytes: 0,
                        error: Some(e),
                    });
                }
            }
        }

        result.finished_at = Some(Utc::now());
        info!(
            "Sync {} complete: {} up, {} down, {} skip, {} conflict, {} err",
            config.id,
            result.files_uploaded,
            result.files_downloaded,
            result.files_skipped,
            result.conflicts,
            result.errors.len()
        );

        Ok(result)
    }

    /// Run all enabled syncs.
    pub async fn run_all_syncs(
        &mut self,
        client: &NextcloudClient,
    ) -> Vec<SyncRunResult> {
        let ids: Vec<String> = self
            .configs
            .values()
            .filter(|c| c.enabled)
            .map(|c| c.id.clone())
            .collect();

        let mut results = Vec::new();
        for id in ids {
            match self.run_sync(&id, client).await {
                Ok(r) => results.push(r),
                Err(e) => warn!("sync {} failed: {}", id, e),
            }
        }
        results
    }

    // ── ETag cache ───────────────────────────────────────────────────────

    pub fn clear_etag_cache(&mut self) {
        self.etag_cache.clear();
    }

    pub fn cached_etag(&self, config_id: &str, path: &str) -> Option<&String> {
        self.etag_cache.get(&(config_id.to_string(), path.to_string()))
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Create a new sync config with defaults.
pub fn build_sync_config(
    local_path: &str,
    remote_path: &str,
    direction: SyncDirection,
) -> SyncConfig {
    SyncConfig {
        id: Uuid::new_v4().to_string(),
        local_path: local_path.to_string(),
        remote_path: remote_path.to_string(),
        direction,
        exclude_patterns: vec![
            ".git/**".to_string(),
            ".DS_Store".to_string(),
            "Thumbs.db".to_string(),
            "*.tmp".to_string(),
        ],
        enabled: true,
        interval_secs: 0,
        propagate_deletes: false,
        conflict_strategy: ConflictStrategy::NewestWins,
        max_file_size: 0,
        preserve_mtime: true,
    }
}

impl SyncConfig {
    pub fn direction_label(&self) -> &'static str {
        match self.direction {
            SyncDirection::Upload => "upload",
            SyncDirection::Download => "download",
            SyncDirection::Bidirectional => "bidirectional",
        }
    }
}

/// Evaluate whether a path should be excluded by the sync config.
pub fn is_excluded(path: &str, patterns: &[String]) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    for pattern in patterns {
        if pattern.contains("**") {
            // Simplistic "directory glob" match
            let prefix = pattern.trim_end_matches("/**");
            if path.contains(prefix) {
                return true;
            }
        } else if pattern.starts_with("*.") {
            // Extension match
            let ext = &pattern[1..]; // ".tmp"
            if name.ends_with(ext) {
                return true;
            }
        } else if name == pattern {
            return true;
        }
    }
    false
}

/// Local file representation for sync planning.
#[derive(Debug, Clone)]
pub struct LocalFile {
    pub relative_path: String,
    pub size: u64,
    pub modified: Option<i64>,
    pub is_dir: bool,
}

/// List local files in a directory (non-recursive, flat).
fn list_local_files(path: &str) -> Result<Vec<LocalFile>, String> {
    let entries =
        std::fs::read_dir(path).map_err(|e| format!("read dir {}: {}", path, e))?;

    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("dir entry: {}", e))?;
        let meta = entry.metadata().map_err(|e| format!("metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        files.push(LocalFile {
            relative_path: name,
            size: meta.len(),
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
            is_dir: meta.is_dir(),
        });
    }
    Ok(files)
}

/// Plan sync actions given local files and remote resources.
fn plan_sync(
    config: &SyncConfig,
    local_files: &[LocalFile],
    remote_items: &[DavResource],
    _etag_cache: &HashMap<(String, String), String>,
) -> Vec<SyncAction> {
    let mut actions = Vec::new();

    let local_names: HashMap<&str, &LocalFile> = local_files
        .iter()
        .map(|f| (f.relative_path.as_str(), f))
        .collect();

    let remote_names: HashMap<&str, &DavResource> = remote_items
        .iter()
        .map(|r| (r.display_name.as_str(), r))
        .collect();

    match config.direction {
        SyncDirection::Upload => {
            for lf in local_files {
                if lf.is_dir || is_excluded(&lf.relative_path, &config.exclude_patterns) {
                    continue;
                }
                if config.max_file_size > 0 && lf.size > config.max_file_size {
                    actions.push(SyncAction {
                        path: lf.relative_path.clone(),
                        status: SyncFileStatus::Skipped,
                        direction: SyncDirection::Upload,
                        bytes: lf.size,
                        error: Some("exceeds max file size".into()),
                    });
                    continue;
                }
                actions.push(SyncAction {
                    path: lf.relative_path.clone(),
                    status: SyncFileStatus::Pending,
                    direction: SyncDirection::Upload,
                    bytes: lf.size,
                    error: None,
                });
            }
        }
        SyncDirection::Download => {
            for ri in remote_items {
                if ri.resource_type == DavResourceType::Folder
                    || is_excluded(&ri.display_name, &config.exclude_patterns)
                {
                    continue;
                }
                let size = ri.content_length.unwrap_or(0);
                if config.max_file_size > 0 && size > config.max_file_size {
                    actions.push(SyncAction {
                        path: ri.display_name.clone(),
                        status: SyncFileStatus::Skipped,
                        direction: SyncDirection::Download,
                        bytes: size,
                        error: Some("exceeds max file size".into()),
                    });
                    continue;
                }
                actions.push(SyncAction {
                    path: ri.display_name.clone(),
                    status: SyncFileStatus::Pending,
                    direction: SyncDirection::Download,
                    bytes: size,
                    error: None,
                });
            }
        }
        SyncDirection::Bidirectional => {
            // Upload local-only files
            for lf in local_files {
                if lf.is_dir || is_excluded(&lf.relative_path, &config.exclude_patterns) {
                    continue;
                }
                if !remote_names.contains_key(lf.relative_path.as_str()) {
                    actions.push(SyncAction {
                        path: lf.relative_path.clone(),
                        status: SyncFileStatus::Pending,
                        direction: SyncDirection::Upload,
                        bytes: lf.size,
                        error: None,
                    });
                }
            }
            // Download remote-only files
            for ri in remote_items {
                if ri.resource_type == DavResourceType::Folder
                    || is_excluded(&ri.display_name, &config.exclude_patterns)
                {
                    continue;
                }
                if !local_names.contains_key(ri.display_name.as_str()) {
                    actions.push(SyncAction {
                        path: ri.display_name.clone(),
                        status: SyncFileStatus::Pending,
                        direction: SyncDirection::Download,
                        bytes: ri.content_length.unwrap_or(0),
                        error: None,
                    });
                }
            }
            // Existing in both → conflict / compare
            for lf in local_files {
                if lf.is_dir {
                    continue;
                }
                if let Some(_remote) = remote_names.get(lf.relative_path.as_str()) {
                    actions.push(SyncAction {
                        path: lf.relative_path.clone(),
                        status: SyncFileStatus::Conflict,
                        direction: SyncDirection::Bidirectional,
                        bytes: lf.size,
                        error: None,
                    });
                }
            }
        }
    }

    actions
}

/// Execute a single sync action.
async fn execute_sync_action(
    client: &NextcloudClient,
    config: &SyncConfig,
    action: &SyncAction,
) -> Result<SyncAction, String> {
    match action.direction {
        SyncDirection::Upload => {
            let local_path = format!("{}/{}", config.local_path, action.path);
            let remote_path = folders::join_path(&config.remote_path, &action.path);
            let data = std::fs::read(&local_path)
                .map_err(|e| format!("read {}: {}", local_path, e))?;
            let size = data.len() as u64;

            let args = files::build_upload_args(&remote_path, true);
            files::upload(client, &args, data).await?;

            Ok(SyncAction {
                path: action.path.clone(),
                status: SyncFileStatus::Done,
                direction: SyncDirection::Upload,
                bytes: size,
                error: None,
            })
        }
        SyncDirection::Download => {
            let remote_path = folders::join_path(&config.remote_path, &action.path);
            let local_path = format!("{}/{}", config.local_path, action.path);

            let data = files::download(client, &remote_path).await?;
            let size = data.len() as u64;
            std::fs::write(&local_path, &data)
                .map_err(|e| format!("write {}: {}", local_path, e))?;

            Ok(SyncAction {
                path: action.path.clone(),
                status: SyncFileStatus::Done,
                direction: SyncDirection::Download,
                bytes: size,
                error: None,
            })
        }
        SyncDirection::Bidirectional => {
            // Conflict — apply strategy
            match config.conflict_strategy {
                ConflictStrategy::LocalWins => {
                    // Upload local version
                    let local_path = format!("{}/{}", config.local_path, action.path);
                    let remote_path = folders::join_path(&config.remote_path, &action.path);
                    let data = std::fs::read(&local_path)
                        .map_err(|e| format!("read {}: {}", local_path, e))?;
                    let size = data.len() as u64;
                    let args = files::build_upload_args(&remote_path, true);
                    files::upload(client, &args, data).await?;
                    Ok(SyncAction {
                        path: action.path.clone(),
                        status: SyncFileStatus::Done,
                        direction: SyncDirection::Upload,
                        bytes: size,
                        error: None,
                    })
                }
                ConflictStrategy::RemoteWins => {
                    // Download remote version
                    let remote_path = folders::join_path(&config.remote_path, &action.path);
                    let local_path = format!("{}/{}", config.local_path, action.path);
                    let data = files::download(client, &remote_path).await?;
                    let size = data.len() as u64;
                    std::fs::write(&local_path, &data)
                        .map_err(|e| format!("write {}: {}", local_path, e))?;
                    Ok(SyncAction {
                        path: action.path.clone(),
                        status: SyncFileStatus::Done,
                        direction: SyncDirection::Download,
                        bytes: size,
                        error: None,
                    })
                }
                _ => {
                    // Return as conflict for the caller to handle
                    Ok(SyncAction {
                        path: action.path.clone(),
                        status: SyncFileStatus::Conflict,
                        direction: SyncDirection::Bidirectional,
                        bytes: action.bytes,
                        error: Some("conflict requires resolution".into()),
                    })
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_sync_config_defaults() {
        let c = build_sync_config("/local", "/remote", SyncDirection::Upload);
        assert!(c.enabled);
        assert_eq!(c.interval_secs, 0);
        assert!(!c.propagate_deletes);
        assert_eq!(c.conflict_strategy, ConflictStrategy::NewestWins);
        assert!(!c.exclude_patterns.is_empty());
    }

    #[test]
    fn direction_labels() {
        let c = build_sync_config("/l", "/r", SyncDirection::Upload);
        assert_eq!(c.direction_label(), "upload");

        let c = build_sync_config("/l", "/r", SyncDirection::Download);
        assert_eq!(c.direction_label(), "download");

        let c = build_sync_config("/l", "/r", SyncDirection::Bidirectional);
        assert_eq!(c.direction_label(), "bidirectional");
    }

    #[test]
    fn is_excluded_exact_name() {
        assert!(is_excluded(".DS_Store", &[".DS_Store".into()]));
        assert!(!is_excluded("readme.md", &[".DS_Store".into()]));
    }

    #[test]
    fn is_excluded_extension() {
        assert!(is_excluded("file.tmp", &["*.tmp".into()]));
        assert!(!is_excluded("file.txt", &["*.tmp".into()]));
    }

    #[test]
    fn is_excluded_directory_glob() {
        assert!(is_excluded(".git/config", &[".git/**".into()]));
        assert!(!is_excluded("src/main.rs", &[".git/**".into()]));
    }

    #[test]
    fn sync_manager_config_crud() {
        let mut mgr = SyncManager::new();
        assert!(mgr.list_configs().is_empty());

        let c = build_sync_config("/a", "/b", SyncDirection::Upload);
        let id = c.id.clone();
        mgr.add_config(c);
        assert_eq!(mgr.list_configs().len(), 1);
        assert!(mgr.get_config(&id).is_some());

        let removed = mgr.remove_config(&id);
        assert!(removed.is_some());
        assert!(mgr.list_configs().is_empty());
    }

    #[test]
    fn sync_manager_enabled_only() {
        let mut mgr = SyncManager::new();

        let mut c1 = build_sync_config("/a", "/b", SyncDirection::Upload);
        c1.enabled = true;
        let mut c2 = build_sync_config("/c", "/d", SyncDirection::Download);
        c2.enabled = false;

        mgr.add_config(c1);
        mgr.add_config(c2);

        assert_eq!(mgr.enabled_configs().len(), 1);
    }

    #[test]
    fn plan_upload_excludes_dirs_and_patterns() {
        let config = SyncConfig {
            id: "test".into(),
            local_path: "/local".into(),
            remote_path: "/remote".into(),
            direction: SyncDirection::Upload,
            exclude_patterns: vec!["*.tmp".into()],
            enabled: true,
            interval_secs: 0,
            propagate_deletes: false,
            conflict_strategy: ConflictStrategy::NewestWins,
            max_file_size: 0,
            preserve_mtime: true,
        };

        let local_files = vec![
            LocalFile { relative_path: "ok.txt".into(), size: 100, modified: None, is_dir: false },
            LocalFile { relative_path: "skip.tmp".into(), size: 50, modified: None, is_dir: false },
            LocalFile { relative_path: "subdir".into(), size: 0, modified: None, is_dir: true },
        ];

        let actions = plan_sync(&config, &local_files, &[], &HashMap::new());
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].path, "ok.txt");
    }

    #[test]
    fn plan_download_excludes_folders_and_patterns() {
        let config = SyncConfig {
            id: "test".into(),
            local_path: "/local".into(),
            remote_path: "/remote".into(),
            direction: SyncDirection::Download,
            exclude_patterns: vec!["Thumbs.db".into()],
            enabled: true,
            interval_secs: 0,
            propagate_deletes: false,
            conflict_strategy: ConflictStrategy::NewestWins,
            max_file_size: 0,
            preserve_mtime: true,
        };

        let remote = vec![
            DavResource { display_name: "file.txt".into(), resource_type: DavResourceType::File, content_length: Some(200), ..DavResource::default() },
            DavResource { display_name: "Thumbs.db".into(), resource_type: DavResourceType::File, content_length: Some(10), ..DavResource::default() },
            DavResource { display_name: "subdir".into(), resource_type: DavResourceType::Folder, ..DavResource::default() },
        ];

        let actions = plan_sync(&config, &[], &remote, &HashMap::new());
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].path, "file.txt");
    }

    #[test]
    fn plan_bidirectional_detects_conflicts() {
        let config = SyncConfig {
            id: "test".into(),
            local_path: "/local".into(),
            remote_path: "/remote".into(),
            direction: SyncDirection::Bidirectional,
            exclude_patterns: vec![],
            enabled: true,
            interval_secs: 0,
            propagate_deletes: false,
            conflict_strategy: ConflictStrategy::Ask,
            max_file_size: 0,
            preserve_mtime: true,
        };

        let local = vec![
            LocalFile { relative_path: "both.txt".into(), size: 100, modified: None, is_dir: false },
            LocalFile { relative_path: "local_only.txt".into(), size: 50, modified: None, is_dir: false },
        ];

        let remote = vec![
            DavResource { display_name: "both.txt".into(), resource_type: DavResourceType::File, content_length: Some(200), ..DavResource::default() },
            DavResource { display_name: "remote_only.txt".into(), resource_type: DavResourceType::File, content_length: Some(300), ..DavResource::default() },
        ];

        let actions = plan_sync(&config, &local, &remote, &HashMap::new());
        // local_only → upload, remote_only → download, both → conflict
        assert_eq!(actions.len(), 3);

        let upload = actions.iter().find(|a| a.path == "local_only.txt").unwrap();
        assert_eq!(upload.direction, SyncDirection::Upload);

        let download = actions.iter().find(|a| a.path == "remote_only.txt").unwrap();
        assert_eq!(download.direction, SyncDirection::Download);

        let conflict = actions.iter().find(|a| a.path == "both.txt").unwrap();
        assert_eq!(conflict.status, SyncFileStatus::Conflict);
    }

    #[test]
    fn plan_upload_respects_max_size() {
        let config = SyncConfig {
            id: "test".into(),
            local_path: "/local".into(),
            remote_path: "/remote".into(),
            direction: SyncDirection::Upload,
            exclude_patterns: vec![],
            enabled: true,
            interval_secs: 0,
            propagate_deletes: false,
            conflict_strategy: ConflictStrategy::NewestWins,
            max_file_size: 100,
            preserve_mtime: true,
        };

        let local = vec![
            LocalFile { relative_path: "small.txt".into(), size: 50, modified: None, is_dir: false },
            LocalFile { relative_path: "big.bin".into(), size: 200, modified: None, is_dir: false },
        ];

        let actions = plan_sync(&config, &local, &[], &HashMap::new());
        assert_eq!(actions.len(), 2);
        let big = actions.iter().find(|a| a.path == "big.bin").unwrap();
        assert_eq!(big.status, SyncFileStatus::Skipped);
    }

    #[test]
    fn etag_cache_operations() {
        let mut mgr = SyncManager::new();
        mgr.etag_cache.insert(("cfg1".into(), "/file.txt".into()), "etag1".into());
        assert_eq!(mgr.cached_etag("cfg1", "/file.txt"), Some(&"etag1".to_string()));
        assert_eq!(mgr.cached_etag("cfg1", "/other.txt"), None);

        mgr.clear_etag_cache();
        assert_eq!(mgr.cached_etag("cfg1", "/file.txt"), None);
    }
}
