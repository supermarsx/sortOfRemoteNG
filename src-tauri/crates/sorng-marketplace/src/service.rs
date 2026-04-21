//! Service façade for the marketplace.
//!
//! Wraps all subsystems behind a single `Arc<Mutex<..>>` state
//! compatible with Tauri's managed-state model.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use chrono::Utc;

use crate::error::MarketplaceError;
use crate::installer;
use crate::ratings::RatingManager;
use crate::registry::MarketplaceRegistry;
use crate::repository;
use crate::resolver;
use crate::types::*;

/// Type alias for the Tauri managed state.
pub type MarketplaceServiceState = Arc<Mutex<MarketplaceService>>;

/// Top-level façade aggregating all marketplace subsystems.
pub struct MarketplaceService {
    pub registry: MarketplaceRegistry,
    pub ratings: RatingManager,
    pub config: MarketplaceConfig,
}

impl MarketplaceService {
    /// Create a new `MarketplaceService` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> MarketplaceServiceState {
        let service = Self {
            registry: MarketplaceRegistry::new(),
            ratings: RatingManager::new(),
            config: MarketplaceConfig::default(),
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with a custom config.
    pub fn with_config(config: MarketplaceConfig) -> MarketplaceServiceState {
        let service = Self {
            registry: MarketplaceRegistry::new(),
            ratings: RatingManager::new(),
            config,
        };
        Arc::new(Mutex::new(service))
    }

    // ── Search / Browse ─────────────────────────────────────────

    pub fn search(&self, query: &SearchQuery) -> SearchResults {
        self.registry.search(query)
    }

    pub fn get_listing(&self, id: &str) -> Result<MarketplaceListing, MarketplaceError> {
        self.registry.get_listing(id).cloned()
    }

    pub fn get_categories(&self) -> Vec<ExtensionCategory> {
        ExtensionCategory::all()
    }

    pub fn get_featured(&self) -> Vec<MarketplaceListing> {
        self.registry
            .listings
            .values()
            .filter(|l| l.featured)
            .cloned()
            .collect()
    }

    pub fn get_popular(&self, limit: usize) -> Vec<MarketplaceListing> {
        let mut listings: Vec<MarketplaceListing> =
            self.registry.listings.values().cloned().collect();
        listings.sort_by(|a, b| b.downloads.cmp(&a.downloads));
        listings.truncate(limit);
        listings
    }

    // ── Installation ────────────────────────────────────────────

    pub async fn install(&mut self, listing_id: &str) -> Result<InstallResult, MarketplaceError> {
        let listing = self.registry.get_listing(listing_id)?.clone();

        // Resolve deps first.
        let dep_ids = resolver::resolve_dependencies(&listing, &self.registry.listings)?;
        let conflicts = resolver::check_conflicts(&dep_ids, &self.registry.installed);
        if !conflicts.is_empty() {
            return Err(MarketplaceError::ConflictError(conflicts.join("; ")));
        }

        // Install dependencies.
        for dep_id in &dep_ids {
            if self.registry.is_installed(dep_id) {
                continue;
            }
            let dep_listing = self.registry.get_listing(dep_id)?.clone();
            let res =
                installer::install_from_listing(&dep_listing, &self.config.cache_directory).await?;
            if res.success {
                self.registry.mark_installed(InstalledExtension {
                    listing_id: dep_id.clone(),
                    version: dep_listing.version.clone(),
                    installed_at: Utc::now(),
                    auto_update: self.config.auto_update_extensions,
                    path: res.installed_path.clone().unwrap_or_default(),
                });
            }
        }

        // Install the target.
        let result =
            installer::install_from_listing(&listing, &self.config.cache_directory).await?;
        if result.success {
            self.registry.mark_installed(InstalledExtension {
                listing_id: listing.id.clone(),
                version: listing.version.clone(),
                installed_at: Utc::now(),
                auto_update: self.config.auto_update_extensions,
                path: result.installed_path.clone().unwrap_or_default(),
            });
        }

        Ok(result)
    }

    pub async fn uninstall(&mut self, listing_id: &str) -> Result<(), MarketplaceError> {
        let ext = self
            .registry
            .installed
            .get(listing_id)
            .ok_or_else(|| MarketplaceError::ListingNotFound(listing_id.to_string()))?
            .clone();
        installer::uninstall_extension(&ext).await?;
        self.registry.mark_uninstalled(listing_id)?;
        Ok(())
    }

    pub async fn update(&mut self, listing_id: &str) -> Result<InstallResult, MarketplaceError> {
        let ext = self
            .registry
            .installed
            .get(listing_id)
            .ok_or_else(|| MarketplaceError::ListingNotFound(listing_id.to_string()))?
            .clone();
        let new_listing = self.registry.get_listing(listing_id)?.clone();
        let result =
            installer::update_extension(&ext, &new_listing, &self.config.cache_directory).await?;
        if result.success {
            self.registry.mark_installed(InstalledExtension {
                listing_id: new_listing.id.clone(),
                version: new_listing.version.clone(),
                installed_at: Utc::now(),
                auto_update: ext.auto_update,
                path: result.installed_path.clone().unwrap_or_default(),
            });
        }
        Ok(result)
    }

    pub fn get_installed(&self) -> Vec<InstalledExtension> {
        self.registry.get_installed().into_iter().cloned().collect()
    }

    pub fn check_updates(&self) -> Vec<(MarketplaceListing, InstalledExtension)> {
        self.registry
            .get_updates_available()
            .into_iter()
            .map(|(l, i)| (l.clone(), i.clone()))
            .collect()
    }

    // ── Repository management ───────────────────────────────────

    pub async fn refresh_repositories(&mut self) -> Result<u64, MarketplaceError> {
        let indexes = repository::refresh_all_repositories(&self.config.repositories).await?;
        let mut added: u64 = 0;
        for idx in indexes {
            for listing in idx.listings {
                // Upsert: remove then add.
                let _ = self.registry.remove_listing(&listing.id);
                self.registry.add_listing(listing)?;
                added += 1;
            }
        }
        Ok(added)
    }

    pub fn add_repository(&mut self, repo: RepositoryConfig) {
        self.config.repositories.push(repo);
    }

    pub fn remove_repository(&mut self, url: &str) -> Result<(), MarketplaceError> {
        let before = self.config.repositories.len();
        self.config.repositories.retain(|r| r.url != url);
        if self.config.repositories.len() == before {
            return Err(MarketplaceError::RepositoryNotFound(url.to_string()));
        }
        Ok(())
    }

    pub fn list_repositories(&self) -> Vec<RepositoryConfig> {
        self.config.repositories.clone()
    }

    // ── Reviews / Ratings ───────────────────────────────────────

    pub fn get_reviews(&self, listing_id: &str) -> Vec<MarketplaceReview> {
        self.ratings
            .get_reviews_for_listing(listing_id)
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn add_review(&mut self, review: MarketplaceReview) -> Result<(), MarketplaceError> {
        self.ratings.add_review(review)
    }

    // ── Stats / Config ──────────────────────────────────────────

    pub fn get_stats(&self) -> MarketplaceStats {
        let mut by_category: HashMap<String, u64> = HashMap::new();
        for listing in self.registry.listings.values() {
            *by_category
                .entry(listing.category.label().to_string())
                .or_insert(0) += 1;
        }
        MarketplaceStats {
            total_listings: self.registry.listings.len() as u64,
            total_repositories: self.config.repositories.len() as u64,
            installed_count: self.registry.installed.len() as u64,
            update_available_count: self.registry.get_updates_available().len() as u64,
            by_category,
        }
    }

    pub fn get_config(&self) -> MarketplaceConfig {
        self.config.clone()
    }

    pub fn update_config(&mut self, config: MarketplaceConfig) {
        self.config = config;
    }

    pub fn validate_manifest(
        &self,
        manifest_json: &str,
    ) -> Result<MarketplaceListing, MarketplaceError> {
        repository::validate_manifest(manifest_json)
    }
}
