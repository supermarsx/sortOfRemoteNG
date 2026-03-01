//! Sync engine for the Bitwarden integration.
//!
//! Manages vault data synchronization between the local cache
//! and the Bitwarden server via the CLI or API.

use crate::bitwarden::api::VaultApiClient;
use crate::bitwarden::cli::BitwardenCli;
use crate::bitwarden::types::*;
use chrono::{DateTime, Utc};
use log::{info, warn};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Sync source strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncSource {
    /// Use the `bw` CLI for sync.
    Cli,
    /// Use the `bw serve` API for sync.
    Api,
}

/// Sync result with summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub source: String,
    pub items_count: usize,
    pub folders_count: usize,
    pub collections_count: usize,
    pub organizations_count: usize,
    pub sync_time: DateTime<Utc>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

impl Default for SyncResult {
    fn default() -> Self {
        Self {
            success: false,
            source: "none".into(),
            items_count: 0,
            folders_count: 0,
            collections_count: 0,
            organizations_count: 0,
            sync_time: Utc::now(),
            duration_ms: 0,
            error: None,
        }
    }
}

use serde::{Deserialize, Serialize};

/// Sync engine that manages vault data caching and refresh.
pub struct SyncEngine {
    cache: Arc<Mutex<VaultCache>>,
    preferred_source: SyncSource,
    auto_sync_interval: Option<std::time::Duration>,
    last_sync: Option<DateTime<Utc>>,
}

impl SyncEngine {
    /// Create a new sync engine.
    pub fn new(preferred_source: SyncSource) -> Self {
        Self {
            cache: Arc::new(Mutex::new(VaultCache::new())),
            preferred_source,
            auto_sync_interval: None,
            last_sync: None,
        }
    }

    /// Create with auto-sync interval.
    pub fn with_auto_sync(mut self, interval_secs: u64) -> Self {
        if interval_secs > 0 {
            self.auto_sync_interval = Some(std::time::Duration::from_secs(interval_secs));
        }
        self
    }

    /// Get a reference to the cache.
    pub fn cache(&self) -> Arc<Mutex<VaultCache>> {
        self.cache.clone()
    }

    /// Get the last sync time.
    pub fn last_sync(&self) -> Option<DateTime<Utc>> {
        self.last_sync
    }

    /// Check if a sync is needed based on the auto-sync interval.
    pub fn needs_sync(&self) -> bool {
        match (self.auto_sync_interval, self.last_sync) {
            (Some(interval), Some(last)) => {
                let elapsed = Utc::now() - last;
                elapsed.to_std().unwrap_or_default() > interval
            }
            (Some(_), None) => true, // Never synced
            _ => false, // No auto-sync configured
        }
    }

    /// Perform a full sync using the CLI.
    pub async fn sync_via_cli(&mut self, cli: &BitwardenCli) -> Result<SyncResult, BitwardenError> {
        let start = std::time::Instant::now();
        info!("Starting vault sync via CLI");

        // Trigger server sync first
        cli.sync().await?;

        // Then pull all data
        let items = cli.list_items().await?;
        let folders = cli.list_folders().await?;
        let collections = cli.list_collections().await?;
        let organizations = cli.list_organizations().await?;

        let now = Utc::now();
        let duration = start.elapsed();

        // Update cache
        {
            let mut cache = self.cache.lock().await;
            cache.items = items;
            cache.folders = folders;
            cache.collections = collections;
            cache.organizations = organizations;
            cache.last_sync = Some(now);
            cache.rebuild_uri_index();
        }

        self.last_sync = Some(now);

        let cache = self.cache.lock().await;
        let result = SyncResult {
            success: true,
            source: "cli".into(),
            items_count: cache.items.len(),
            folders_count: cache.folders.len(),
            collections_count: cache.collections.len(),
            organizations_count: cache.organizations.len(),
            sync_time: now,
            duration_ms: duration.as_millis() as u64,
            error: None,
        };

        info!(
            "Sync complete: {} items, {} folders, {} collections in {}ms",
            result.items_count, result.folders_count, result.collections_count, result.duration_ms
        );

        Ok(result)
    }

    /// Perform a full sync using the Vault Management API.
    pub async fn sync_via_api(&mut self, api: &VaultApiClient) -> Result<SyncResult, BitwardenError> {
        let start = std::time::Instant::now();
        info!("Starting vault sync via API");

        // Trigger sync
        api.sync().await?;

        // Pull all data
        let items = api.list_items().await?;
        let folders = api.list_folders().await?;

        let now = Utc::now();
        let duration = start.elapsed();

        // Update cache
        {
            let mut cache = self.cache.lock().await;
            cache.items = items;
            cache.folders = folders;
            cache.last_sync = Some(now);
            cache.rebuild_uri_index();
        }

        self.last_sync = Some(now);

        let cache = self.cache.lock().await;
        let result = SyncResult {
            success: true,
            source: "api".into(),
            items_count: cache.items.len(),
            folders_count: cache.folders.len(),
            collections_count: cache.collections.len(),
            organizations_count: cache.organizations.len(),
            sync_time: now,
            duration_ms: duration.as_millis() as u64,
            error: None,
        };

        info!(
            "API sync complete: {} items, {} folders in {}ms",
            result.items_count, result.folders_count, result.duration_ms
        );

        Ok(result)
    }

    /// Sync using the preferred source.
    pub async fn sync(
        &mut self,
        cli: Option<&BitwardenCli>,
        api: Option<&VaultApiClient>,
    ) -> Result<SyncResult, BitwardenError> {
        match self.preferred_source {
            SyncSource::Cli => {
                if let Some(cli) = cli {
                    return self.sync_via_cli(cli).await;
                }
                if let Some(api) = api {
                    warn!("CLI not available for sync, falling back to API");
                    return self.sync_via_api(api).await;
                }
                Err(BitwardenError::sync_failed("No sync source available"))
            }
            SyncSource::Api => {
                if let Some(api) = api {
                    return self.sync_via_api(api).await;
                }
                if let Some(cli) = cli {
                    warn!("API not available for sync, falling back to CLI");
                    return self.sync_via_cli(cli).await;
                }
                Err(BitwardenError::sync_failed("No sync source available"))
            }
        }
    }

    /// Get cached items (does not trigger sync).
    pub async fn get_cached_items(&self) -> Vec<VaultItem> {
        self.cache.lock().await.items.clone()
    }

    /// Get cached folders.
    pub async fn get_cached_folders(&self) -> Vec<Folder> {
        self.cache.lock().await.folders.clone()
    }

    /// Get cached collections.
    pub async fn get_cached_collections(&self) -> Vec<Collection> {
        self.cache.lock().await.collections.clone()
    }

    /// Get cached organizations.
    pub async fn get_cached_organizations(&self) -> Vec<Organization> {
        self.cache.lock().await.organizations.clone()
    }

    /// Get vault statistics from cache.
    pub async fn get_stats(&self) -> VaultStats {
        self.cache.lock().await.stats()
    }

    /// Search cached items.
    pub async fn search(&self, query: &str) -> Vec<VaultItem> {
        let cache = self.cache.lock().await;
        crate::bitwarden::vault::search_items(&cache.items, query)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Find credentials matching a URI from cache.
    pub async fn find_credentials(&self, uri: &str) -> Vec<CredentialMatch> {
        let cache = self.cache.lock().await;
        crate::bitwarden::vault::match_credentials(&cache.items, uri)
    }

    /// Clear the cache.
    pub async fn clear_cache(&mut self) {
        let mut cache = self.cache.lock().await;
        *cache = VaultCache::new();
        self.last_sync = None;
    }

    /// Update a single item in the cache.
    pub async fn update_cached_item(&self, item: VaultItem) {
        let mut cache = self.cache.lock().await;
        if let Some(id) = &item.id {
            if let Some(pos) = cache.items.iter().position(|i| i.id.as_ref() == Some(id)) {
                cache.items[pos] = item;
            } else {
                cache.items.push(item);
            }
            cache.rebuild_uri_index();
        }
    }

    /// Remove an item from the cache.
    pub async fn remove_cached_item(&self, id: &str) {
        let mut cache = self.cache.lock().await;
        cache.items.retain(|item| item.id.as_deref() != Some(id));
        cache.rebuild_uri_index();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_engine_new() {
        let engine = SyncEngine::new(SyncSource::Cli);
        assert_eq!(engine.preferred_source, SyncSource::Cli);
        assert!(engine.last_sync.is_none());
        assert!(engine.auto_sync_interval.is_none());
    }

    #[test]
    fn sync_engine_with_auto_sync() {
        let engine = SyncEngine::new(SyncSource::Api)
            .with_auto_sync(300);
        assert!(engine.auto_sync_interval.is_some());
        assert_eq!(engine.auto_sync_interval.unwrap().as_secs(), 300);
    }

    #[test]
    fn sync_engine_needs_sync_never_synced() {
        let engine = SyncEngine::new(SyncSource::Cli)
            .with_auto_sync(300);
        assert!(engine.needs_sync());
    }

    #[test]
    fn sync_engine_no_auto_sync() {
        let engine = SyncEngine::new(SyncSource::Cli);
        assert!(!engine.needs_sync());
    }

    #[tokio::test]
    async fn sync_engine_cache_operations() {
        let engine = SyncEngine::new(SyncSource::Cli);

        // Initially empty
        let items = engine.get_cached_items().await;
        assert!(items.is_empty());

        // Update cache
        let mut item = VaultItem::new_login("Test", "u", "p");
        item.id = Some("id-1".into());
        engine.update_cached_item(item.clone()).await;

        let items = engine.get_cached_items().await;
        assert_eq!(items.len(), 1);

        // Update existing
        let mut updated = item.clone();
        updated.name = "Updated".into();
        engine.update_cached_item(updated).await;
        let items = engine.get_cached_items().await;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Updated");

        // Remove
        engine.remove_cached_item("id-1").await;
        let items = engine.get_cached_items().await;
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn sync_engine_clear_cache() {
        let mut engine = SyncEngine::new(SyncSource::Cli);

        let mut item = VaultItem::new_login("Test", "u", "p");
        item.id = Some("id-1".into());
        engine.update_cached_item(item).await;

        engine.clear_cache().await;
        assert!(engine.get_cached_items().await.is_empty());
        assert!(engine.last_sync.is_none());
    }

    #[tokio::test]
    async fn sync_engine_search() {
        let engine = SyncEngine::new(SyncSource::Cli);

        let mut item1 = VaultItem::new_login("GitHub", "user1", "pass1");
        item1.id = Some("id-1".into());
        engine.update_cached_item(item1).await;

        let mut item2 = VaultItem::new_login("GitLab", "user2", "pass2");
        item2.id = Some("id-2".into());
        engine.update_cached_item(item2).await;

        let results = engine.search("github").await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "GitHub");
    }

    #[tokio::test]
    async fn sync_engine_find_credentials() {
        let engine = SyncEngine::new(SyncSource::Cli);

        let mut item = VaultItem::new_login_with_uri("GH", "user", "pass", "https://github.com");
        item.id = Some("id-1".into());
        engine.update_cached_item(item).await;

        // Need to rebuild URI index manually for cache
        {
            let mut cache = engine.cache.lock().await;
            cache.rebuild_uri_index();
        }

        let matches = engine.find_credentials("https://github.com").await;
        assert_eq!(matches.len(), 1);
    }

    #[tokio::test]
    async fn sync_engine_stats() {
        let engine = SyncEngine::new(SyncSource::Cli);

        let mut item1 = VaultItem::new_login("Login1", "u", "p");
        item1.id = Some("id-1".into());
        engine.update_cached_item(item1).await;

        let mut item2 = VaultItem::new_secure_note("Note1", "text");
        item2.id = Some("id-2".into());
        engine.update_cached_item(item2).await;

        let stats = engine.get_stats().await;
        assert_eq!(stats.total_items, 2);
        assert_eq!(stats.login_count, 1);
        assert_eq!(stats.note_count, 1);
    }

    #[test]
    fn sync_result_default() {
        let result = SyncResult::default();
        assert!(!result.success);
        assert_eq!(result.items_count, 0);
    }

    #[tokio::test]
    async fn sync_no_source_available() {
        let mut engine = SyncEngine::new(SyncSource::Cli);
        let result = engine.sync(None, None).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind, BitwardenErrorKind::SyncFailed);
    }
}
