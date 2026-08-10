//! Service façade for the marketplace.
//!
//! Wraps all subsystems behind a single `Arc<Mutex<..>>` state
//! compatible with Tauri's managed-state model.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tokio::sync::{Mutex, MutexGuard};

use chrono::Utc;

use crate::error::MarketplaceError;
use crate::installer;
use crate::ratings::RatingManager;
use crate::registry::MarketplaceRegistry;
use crate::repository;
use crate::resolver;
use crate::types::*;

/// Tauri-managed marketplace state. The mutation gate serializes write
/// operations without blocking readers on the service mutex during I/O.
pub type MarketplaceServiceState = Arc<MarketplaceSharedState>;

pub struct MarketplaceSharedState {
    service: Mutex<MarketplaceService>,
    mutation_gate: Mutex<()>,
}

impl MarketplaceSharedState {
    fn new(service: MarketplaceService) -> Self {
        Self {
            service: Mutex::new(service),
            mutation_gate: Mutex::new(()),
        }
    }

    pub async fn lock(&self) -> MutexGuard<'_, MarketplaceService> {
        self.service.lock().await
    }
}

/// Top-level façade aggregating all marketplace subsystems.
pub struct MarketplaceService {
    pub registry: MarketplaceRegistry,
    pub ratings: RatingManager,
    pub config: MarketplaceConfig,
    config_generation: u64,
}

impl MarketplaceService {
    /// Create a new `MarketplaceService` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> MarketplaceServiceState {
        let service = Self {
            registry: MarketplaceRegistry::new(),
            ratings: RatingManager::new(),
            config: MarketplaceConfig::default(),
            config_generation: 0,
        };
        Arc::new(MarketplaceSharedState::new(service))
    }

    /// Create with a custom config.
    pub fn with_config(config: MarketplaceConfig) -> MarketplaceServiceState {
        let service = Self {
            registry: MarketplaceRegistry::new(),
            ratings: RatingManager::new(),
            config,
            config_generation: 0,
        };
        Arc::new(MarketplaceSharedState::new(service))
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
        listings.sort_by_key(|listing| std::cmp::Reverse(listing.downloads));
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
        self.update_with_installer(listing_id, |installed, listing, dest_dir| async move {
            installer::update_extension(&installed, &listing, &dest_dir).await
        })
        .await
    }

    async fn update_with_installer<F, Fut>(
        &mut self,
        listing_id: &str,
        updater: F,
    ) -> Result<InstallResult, MarketplaceError>
    where
        F: FnOnce(InstalledExtension, MarketplaceListing, String) -> Fut,
        Fut: Future<Output = Result<InstallResult, MarketplaceError>>,
    {
        let ext = self
            .registry
            .installed
            .get(listing_id)
            .ok_or_else(|| MarketplaceError::ListingNotFound(listing_id.to_string()))?
            .clone();
        let new_listing = self.registry.get_listing(listing_id)?.clone();
        let result = updater(
            ext.clone(),
            new_listing.clone(),
            self.config.cache_directory.clone(),
        )
        .await?;
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
        self.config_generation = self.config_generation.wrapping_add(1);
    }

    pub fn remove_repository(&mut self, url: &str) -> Result<(), MarketplaceError> {
        let before = self.config.repositories.len();
        self.config.repositories.retain(|r| r.url != url);
        if self.config.repositories.len() == before {
            return Err(MarketplaceError::RepositoryNotFound(url.to_string()));
        }
        self.config_generation = self.config_generation.wrapping_add(1);
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
        self.config_generation = self.config_generation.wrapping_add(1);
    }

    pub fn validate_manifest(
        &self,
        manifest_json: &str,
    ) -> Result<MarketplaceListing, MarketplaceError> {
        repository::validate_manifest(manifest_json)
    }
}

#[derive(Debug, Clone, Copy)]
struct StateStamp {
    registry_generation: u64,
    config_generation: u64,
}

fn state_stamp(service: &MarketplaceService) -> StateStamp {
    StateStamp {
        registry_generation: service.registry.generation(),
        config_generation: service.config_generation,
    }
}

fn ensure_state_stamp(
    service: &MarketplaceService,
    expected: StateStamp,
) -> Result<(), MarketplaceError> {
    if service.registry.generation() != expected.registry_generation
        || service.config_generation != expected.config_generation
    {
        return Err(MarketplaceError::ConflictError(
            "marketplace state changed while an artifact was staged; refusing stale commit"
                .to_string(),
        ));
    }
    Ok(())
}

pub async fn install_shared(
    state: &MarketplaceSharedState,
    listing_id: &str,
) -> Result<InstallResult, MarketplaceError> {
    install_shared_with_policy(state, listing_id, installer::DownloadPolicy::default()).await
}

async fn install_shared_with_policy(
    state: &MarketplaceSharedState,
    listing_id: &str,
    policy: installer::DownloadPolicy,
) -> Result<InstallResult, MarketplaceError> {
    let _mutation = state.mutation_gate.lock().await;
    let (plan, mut stamp, cache_directory, auto_update) = {
        let service = state.lock().await;
        let listing = service.registry.get_listing(listing_id)?.clone();
        let dep_ids = resolver::resolve_dependencies(&listing, &service.registry.listings)?;
        let conflicts = resolver::check_conflicts(&dep_ids, &service.registry.installed);
        if !conflicts.is_empty() {
            return Err(MarketplaceError::ConflictError(conflicts.join("; ")));
        }
        let mut plan = Vec::new();
        for dep_id in dep_ids {
            if !service.registry.is_installed(&dep_id) {
                plan.push(service.registry.get_listing(&dep_id)?.clone());
            }
        }
        plan.push(listing);
        (
            plan,
            state_stamp(&service),
            service.config.cache_directory.clone(),
            service.config.auto_update_extensions,
        )
    };

    let mut target_result = None;
    for listing in plan {
        let expected = stamp;
        let result =
            installer::install_from_listing_guarded(&listing, &cache_directory, policy, || async {
                let service = state.lock().await;
                ensure_state_stamp(&service, expected)
            })
            .await?;

        {
            let mut service = state.lock().await;
            service.registry.mark_installed(InstalledExtension {
                listing_id: listing.id.clone(),
                version: listing.version.clone(),
                installed_at: Utc::now(),
                auto_update,
                path: result.installed_path.clone().unwrap_or_default(),
            });
            stamp = state_stamp(&service);
        }
        installer::finalize_guarded_install(&listing, &result).await;
        if listing.id == listing_id {
            target_result = Some(result);
        }
    }

    target_result.ok_or_else(|| {
        MarketplaceError::Internal(format!("install plan did not include target {listing_id}"))
    })
}

pub async fn update_shared(
    state: &MarketplaceSharedState,
    listing_id: &str,
) -> Result<InstallResult, MarketplaceError> {
    update_shared_with_policy(state, listing_id, installer::DownloadPolicy::default()).await
}

async fn update_shared_with_policy(
    state: &MarketplaceSharedState,
    listing_id: &str,
    policy: installer::DownloadPolicy,
) -> Result<InstallResult, MarketplaceError> {
    let _mutation = state.mutation_gate.lock().await;
    let (installed, listing, cache_directory, stamp) = {
        let service = state.lock().await;
        (
            service
                .registry
                .installed
                .get(listing_id)
                .ok_or_else(|| MarketplaceError::ListingNotFound(listing_id.to_string()))?
                .clone(),
            service.registry.get_listing(listing_id)?.clone(),
            service.config.cache_directory.clone(),
            state_stamp(&service),
        )
    };

    let expected = stamp;
    let result = installer::update_extension_guarded(
        &installed,
        &listing,
        &cache_directory,
        policy,
        || async {
            let service = state.lock().await;
            ensure_state_stamp(&service, expected)
        },
    )
    .await?;

    {
        let mut service = state.lock().await;
        service.registry.mark_installed(InstalledExtension {
            listing_id: listing.id.clone(),
            version: listing.version.clone(),
            installed_at: Utc::now(),
            auto_update: installed.auto_update,
            path: result.installed_path.clone().unwrap_or_default(),
        });
    }
    installer::finalize_guarded_update(&installed, &listing, &cache_directory).await;
    Ok(result)
}

pub async fn uninstall_shared(
    state: &MarketplaceSharedState,
    listing_id: &str,
) -> Result<(), MarketplaceError> {
    let _mutation = state.mutation_gate.lock().await;
    let (installed, stamp) = {
        let service = state.lock().await;
        (
            service
                .registry
                .installed
                .get(listing_id)
                .ok_or_else(|| MarketplaceError::ListingNotFound(listing_id.to_string()))?
                .clone(),
            state_stamp(&service),
        )
    };
    {
        let service = state.lock().await;
        ensure_state_stamp(&service, stamp)?;
    }
    installer::uninstall_extension(&installed).await?;
    let mut service = state.lock().await;
    service.registry.mark_uninstalled(listing_id)
}

pub async fn refresh_repositories_shared(
    state: &MarketplaceSharedState,
) -> Result<u64, MarketplaceError> {
    let _mutation = state.mutation_gate.lock().await;
    let (repositories, stamp) = {
        let service = state.lock().await;
        (service.config.repositories.clone(), state_stamp(&service))
    };
    let indexes = repository::refresh_all_repositories(&repositories).await?;
    let mut service = state.lock().await;
    ensure_state_stamp(&service, stamp)?;
    let mut added = 0_u64;
    for index in indexes {
        for listing in index.listings {
            let _ = service.registry.remove_listing(&listing.id);
            service.registry.add_listing(listing)?;
            added += 1;
        }
    }
    Ok(added)
}

pub async fn with_mutation_gate<T, F>(
    state: &MarketplaceSharedState,
    mutate: F,
) -> Result<T, MarketplaceError>
where
    F: FnOnce(&mut MarketplaceService) -> Result<T, MarketplaceError>,
{
    let _mutation = state.mutation_gate.lock().await;
    let mut service = state.lock().await;
    mutate(&mut service)
}

#[cfg(test)]
mod update_transaction_tests {
    use super::*;
    use crate::installer::UpdateFault;
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    const EXTENSION_ID: &str = "atomic-extension";
    const OLD_VERSION: &str = "1.0.0";
    const NEW_VERSION: &str = "2.0.0";
    const OLD_ARTEFACT: &[u8] = b"old extension archive bytes";
    const NEW_ARTEFACT: &[u8] = b"new extension archive bytes";

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("sorng-marketplace-update-test-{}", Uuid::new_v4()));
            std::fs::create_dir(&path).expect("create test root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct UpdateFixture {
        root: TestRoot,
        canonical: PathBuf,
        service: MarketplaceService,
        old_snapshot: BTreeMap<String, Vec<u8>>,
    }

    fn listing(version: &str) -> MarketplaceListing {
        MarketplaceListing {
            id: EXTENSION_ID.to_string(),
            name: EXTENSION_ID.to_string(),
            display_name: "Atomic extension".to_string(),
            description: "transaction test extension".to_string(),
            long_description: None,
            author: MarketplaceAuthor {
                name: "Tests".to_string(),
                email: None,
                url: None,
                github_username: None,
                verified: true,
            },
            version: version.to_string(),
            repository_url: "https://invalid.example/extension.tar.gz".to_string(),
            homepage_url: None,
            license: None,
            tags: vec![],
            category: ExtensionCategory::Utility,
            downloads: 0,
            rating: 0.0,
            rating_count: 0,
            verified: true,
            featured: false,
            icon_url: None,
            screenshots: vec![],
            manifest_url: String::new(),
            published_at: Utc::now(),
            updated_at: Utc::now(),
            compatible_versions: vec![],
            dependencies: vec![],
            permissions_required: vec![],
            size_bytes: Some(NEW_ARTEFACT.len() as u64),
            checksum: None,
        }
    }

    fn write_installed_tree(canonical: &Path) {
        std::fs::create_dir(canonical).expect("create canonical extension");
        std::fs::write(canonical.join("extension.tar.gz"), OLD_ARTEFACT)
            .expect("write old artefact");
        std::fs::write(canonical.join("runtime-state.bin"), b"old runtime state")
            .expect("write old runtime state");
        std::fs::write(
            canonical.join("manifest.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "id": EXTENSION_ID,
                "version": OLD_VERSION,
                "installed_at": "2026-01-01T00:00:00Z"
            }))
            .expect("serialize old manifest"),
        )
        .expect("write old manifest");
    }

    fn snapshot_tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut snapshot = BTreeMap::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(path) = pending.pop() {
            for entry in std::fs::read_dir(&path).expect("read snapshot tree") {
                let entry = entry.expect("read snapshot entry");
                let path = entry.path();
                let metadata = std::fs::symlink_metadata(&path).expect("snapshot metadata");
                if metadata.is_dir() {
                    pending.push(path);
                } else {
                    let relative = path
                        .strip_prefix(root)
                        .expect("snapshot path beneath root")
                        .to_string_lossy()
                        .replace('\\', "/");
                    snapshot.insert(relative, std::fs::read(path).expect("snapshot file"));
                }
            }
        }
        snapshot
    }

    fn update_residues(root: &Path) -> Vec<String> {
        std::fs::read_dir(root)
            .expect("read managed root")
            .map(|entry| {
                entry
                    .expect("managed root entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.contains(".sorng-update-"))
            .collect()
    }

    fn assert_no_update_residues(root: &Path) {
        let residues = update_residues(root);
        assert!(residues.is_empty(), "unexpected residues: {residues:?}");
    }

    fn fixture() -> UpdateFixture {
        let root = TestRoot::new();
        let canonical = root.path().join(EXTENSION_ID);
        write_installed_tree(&canonical);
        let old_snapshot = snapshot_tree(&canonical);

        let mut registry = MarketplaceRegistry::new();
        registry
            .add_listing(listing(NEW_VERSION))
            .expect("add update listing");
        registry.mark_installed(InstalledExtension {
            listing_id: EXTENSION_ID.to_string(),
            version: OLD_VERSION.to_string(),
            installed_at: Utc::now(),
            auto_update: true,
            path: canonical.to_string_lossy().into_owned(),
        });
        let service = MarketplaceService {
            registry,
            ratings: RatingManager::new(),
            config: MarketplaceConfig {
                cache_directory: root.path().to_string_lossy().into_owned(),
                ..MarketplaceConfig::default()
            },
            config_generation: 0,
        };

        UpdateFixture {
            root,
            canonical,
            service,
            old_snapshot,
        }
    }

    async fn assert_fault_rolls_back(fault: UpdateFault) {
        let mut fixture = fixture();
        let original_registry = fixture
            .service
            .registry
            .installed
            .get(EXTENSION_ID)
            .expect("installed registry entry")
            .clone();

        let error = fixture
            .service
            .update_with_installer(
                EXTENSION_ID,
                move |installed, listing, dest_dir| async move {
                    installer::update_extension_with_fault(
                        &installed,
                        &listing,
                        &dest_dir,
                        NEW_ARTEFACT,
                        Some(fault),
                    )
                    .await
                },
            )
            .await
            .expect_err("injected update must fail");

        assert!(error.to_string().contains("injected update failure"));
        assert_eq!(snapshot_tree(&fixture.canonical), fixture.old_snapshot);
        let registry_entry = fixture
            .service
            .registry
            .installed
            .get(EXTENSION_ID)
            .expect("registry entry remains installed");
        assert_eq!(registry_entry.version, original_registry.version);
        assert_eq!(registry_entry.path, original_registry.path);
        assert_eq!(registry_entry.installed_at, original_registry.installed_at);
        assert_no_update_residues(fixture.root.path());
    }

    #[tokio::test]
    async fn download_failure_preserves_old_install_and_registry() {
        assert_fault_rolls_back(UpdateFault::Download).await;
    }

    #[tokio::test]
    async fn materialize_write_failure_preserves_old_install_and_registry() {
        assert_fault_rolls_back(UpdateFault::Materialize).await;
    }

    #[tokio::test]
    async fn first_rename_failure_preserves_old_install_and_registry() {
        assert_fault_rolls_back(UpdateFault::FirstRename).await;
    }

    #[tokio::test]
    async fn second_rename_failure_restores_old_install_and_registry() {
        assert_fault_rolls_back(UpdateFault::SecondRename).await;
    }

    #[tokio::test]
    async fn cleanup_failure_restores_old_install_and_registry() {
        assert_fault_rolls_back(UpdateFault::Cleanup).await;
    }

    #[tokio::test]
    async fn successful_update_commits_new_bytes_registry_and_no_residues() {
        let mut fixture = fixture();

        let result = fixture
            .service
            .update_with_installer(EXTENSION_ID, |installed, listing, dest_dir| async move {
                installer::update_extension_with_fault(
                    &installed,
                    &listing,
                    &dest_dir,
                    NEW_ARTEFACT,
                    None,
                )
                .await
            })
            .await
            .expect("atomic update succeeds");

        assert!(result.success);
        assert_eq!(
            std::fs::read(fixture.canonical.join("extension.tar.gz")).expect("read new artefact"),
            NEW_ARTEFACT
        );
        assert!(!fixture.canonical.join("runtime-state.bin").exists());
        assert!(!fixture.canonical.join(".sorng-update-owner.json").exists());
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(fixture.canonical.join("manifest.json")).expect("read new manifest"),
        )
        .expect("parse new manifest");
        assert_eq!(manifest["id"], EXTENSION_ID);
        assert_eq!(manifest["version"], NEW_VERSION);
        let registry_entry = fixture
            .service
            .registry
            .installed
            .get(EXTENSION_ID)
            .expect("updated registry entry");
        assert_eq!(registry_entry.version, NEW_VERSION);
        assert_eq!(registry_entry.path, result.installed_path.unwrap());
        assert_no_update_residues(fixture.root.path());
    }

    #[tokio::test]
    async fn post_commit_cleanup_failure_keeps_new_registry_and_recovers_later() {
        let mut fixture = fixture();

        let result = fixture
            .service
            .update_with_installer(EXTENSION_ID, |installed, listing, dest_dir| async move {
                installer::update_extension_with_fault(
                    &installed,
                    &listing,
                    &dest_dir,
                    NEW_ARTEFACT,
                    Some(UpdateFault::PostCommitCleanup),
                )
                .await
            })
            .await
            .expect("post-commit cleanup failure must not fail the committed update");

        assert!(result.success);
        let committed_snapshot = snapshot_tree(&fixture.canonical);
        let committed_registry = fixture
            .service
            .registry
            .installed
            .get(EXTENSION_ID)
            .expect("registry advanced after durable replacement")
            .clone();
        assert_eq!(committed_registry.version, NEW_VERSION);
        let residues = update_residues(fixture.root.path());
        assert_eq!(residues.len(), 1);
        assert!(residues[0].ends_with(".obsolete"));

        let error = fixture
            .service
            .update_with_installer(EXTENSION_ID, |installed, listing, dest_dir| async move {
                installer::update_extension_with_fault(
                    &installed,
                    &listing,
                    &dest_dir,
                    NEW_ARTEFACT,
                    Some(UpdateFault::Download),
                )
                .await
            })
            .await
            .expect_err("download injection runs after obsolete recovery");

        assert!(error.to_string().contains("injected update failure"));
        assert_eq!(snapshot_tree(&fixture.canonical), committed_snapshot);
        let registry_entry = fixture
            .service
            .registry
            .installed
            .get(EXTENSION_ID)
            .expect("registry remains committed after later failure");
        assert_eq!(registry_entry.version, committed_registry.version);
        assert_eq!(registry_entry.path, committed_registry.path);
        assert_eq!(registry_entry.installed_at, committed_registry.installed_at);
        assert_no_update_residues(fixture.root.path());
    }

    #[tokio::test]
    async fn committed_filesystem_repairs_registry_after_commit_boundary_crash() {
        let mut fixture = fixture();
        let installed = fixture
            .service
            .registry
            .installed
            .get(EXTENSION_ID)
            .expect("old registry entry")
            .clone();
        let new_listing = fixture
            .service
            .registry
            .get_listing(EXTENSION_ID)
            .expect("new listing")
            .clone();

        installer::update_extension_with_fault(
            &installed,
            &new_listing,
            fixture.root.path().to_str().expect("UTF-8 test directory"),
            NEW_ARTEFACT,
            Some(UpdateFault::PostCommitCleanup),
        )
        .await
        .expect("filesystem replacement crossed the durable commit point");

        assert_eq!(
            fixture
                .service
                .registry
                .installed
                .get(EXTENSION_ID)
                .expect("registry still reflects pre-crash state")
                .version,
            OLD_VERSION
        );
        let committed_snapshot = snapshot_tree(&fixture.canonical);
        let residues = update_residues(fixture.root.path());
        assert_eq!(residues.len(), 1);
        assert!(residues[0].ends_with(".obsolete"));

        let result = fixture
            .service
            .update_with_installer(EXTENSION_ID, |installed, listing, dest_dir| async move {
                installer::update_extension_with_fault(
                    &installed,
                    &listing,
                    &dest_dir,
                    NEW_ARTEFACT,
                    Some(UpdateFault::Download),
                )
                .await
            })
            .await
            .expect("recovery reports the already committed replacement");

        assert!(result.success);
        assert_eq!(result.version, NEW_VERSION);
        assert_eq!(snapshot_tree(&fixture.canonical), committed_snapshot);
        assert_eq!(
            fixture
                .service
                .registry
                .installed
                .get(EXTENSION_ID)
                .expect("registry repaired after committed recovery")
                .version,
            NEW_VERSION
        );
        assert_no_update_residues(fixture.root.path());
    }

    #[tokio::test]
    async fn interrupted_first_swap_is_recovered_before_download() {
        let mut fixture = fixture();
        let transaction = Uuid::new_v4();
        let stem = format!(".{EXTENSION_ID}.sorng-update-{transaction}");
        let backup = fixture.root.path().join(format!("{stem}.backup"));
        let staging = fixture.root.path().join(format!("{stem}.staging"));
        std::fs::rename(&fixture.canonical, &backup).expect("simulate first swap rename");
        std::fs::create_dir(&staging).expect("create interrupted staging");
        std::fs::write(
            staging.join(".sorng-update-owner.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "extension_id": EXTENSION_ID,
                "transaction_id": transaction.to_string()
            }))
            .expect("serialize staging owner"),
        )
        .expect("write staging owner");
        std::fs::write(staging.join("extension.tar.gz"), NEW_ARTEFACT)
            .expect("write interrupted artefact");

        let error = fixture
            .service
            .update_with_installer(EXTENSION_ID, |installed, listing, dest_dir| async move {
                installer::update_extension_with_fault(
                    &installed,
                    &listing,
                    &dest_dir,
                    NEW_ARTEFACT,
                    Some(UpdateFault::Download),
                )
                .await
            })
            .await
            .expect_err("injected download failure follows recovery");

        assert!(error.to_string().contains("injected update failure"));
        assert_eq!(snapshot_tree(&fixture.canonical), fixture.old_snapshot);
        assert_eq!(
            fixture
                .service
                .registry
                .installed
                .get(EXTENSION_ID)
                .expect("registry remains old after recovery")
                .version,
            OLD_VERSION
        );
        assert_no_update_residues(fixture.root.path());
    }

    #[tokio::test]
    async fn uuid_shaped_unowned_residues_fail_closed_and_are_preserved() {
        for kind in ["staging", "obsolete"] {
            let mut fixture = fixture();
            let residue = fixture.root.path().join(format!(
                ".{EXTENSION_ID}.sorng-update-{}.{kind}",
                Uuid::new_v4()
            ));
            std::fs::create_dir(&residue).expect("create unowned residue");
            std::fs::write(residue.join("extension.tar.gz"), b"unowned bytes")
                .expect("write unowned residue artefact");
            std::fs::write(
                residue.join("manifest.json"),
                std::fs::read(fixture.canonical.join("manifest.json")).expect("read old manifest"),
            )
            .expect("write unowned residue manifest");
            let original_registry = fixture
                .service
                .registry
                .installed
                .get(EXTENSION_ID)
                .expect("old registry entry")
                .clone();

            let error = fixture
                .service
                .update_with_installer(EXTENSION_ID, |installed, listing, dest_dir| async move {
                    installer::update_extension_with_fault(
                        &installed,
                        &listing,
                        &dest_dir,
                        NEW_ARTEFACT,
                        Some(UpdateFault::Download),
                    )
                    .await
                })
                .await
                .expect_err("unowned reserved-looking residue must fail closed");

            assert!(error.to_string().contains("update ownership marker"));
            assert!(residue.exists(), "unowned {kind} residue must be preserved");
            assert_eq!(snapshot_tree(&fixture.canonical), fixture.old_snapshot);
            let registry_entry = fixture
                .service
                .registry
                .installed
                .get(EXTENSION_ID)
                .expect("registry remains old");
            assert_eq!(registry_entry.version, original_registry.version);
            assert_eq!(registry_entry.path, original_registry.path);
            assert_eq!(registry_entry.installed_at, original_registry.installed_at);
        }
    }

    #[tokio::test]
    async fn multiple_backups_fail_closed_without_mutation() {
        let mut fixture = fixture();
        for _ in 0..2 {
            let transaction = Uuid::new_v4();
            let backup = fixture
                .root
                .path()
                .join(format!(".{EXTENSION_ID}.sorng-update-{transaction}.backup"));
            std::fs::create_dir(&backup).expect("create preserved backup");
            std::fs::write(backup.join("extension.tar.gz"), OLD_ARTEFACT)
                .expect("write backup artefact");
            std::fs::write(
                backup.join("manifest.json"),
                std::fs::read(fixture.canonical.join("manifest.json"))
                    .expect("read canonical manifest"),
            )
            .expect("write backup manifest");
        }
        let before = snapshot_tree(&fixture.canonical);

        let error = fixture
            .service
            .update_with_installer(EXTENSION_ID, |installed, listing, dest_dir| async move {
                installer::update_extension_with_fault(
                    &installed,
                    &listing,
                    &dest_dir,
                    NEW_ARTEFACT,
                    None,
                )
                .await
            })
            .await
            .expect_err("ambiguous recovery must fail closed");

        assert!(error.to_string().contains("multiple interrupted updates"));
        assert_eq!(snapshot_tree(&fixture.canonical), before);
        assert_eq!(
            fixture
                .service
                .registry
                .installed
                .get(EXTENSION_ID)
                .expect("registry remains installed")
                .version,
            OLD_VERSION
        );
        let backups = std::fs::read_dir(fixture.root.path())
            .expect("read backups")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".backup"))
            .count();
        assert_eq!(backups, 2, "ambiguous backups must be preserved");
    }
}

#[cfg(test)]
mod bounded_download_tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::{oneshot, Notify};
    use tokio::task::JoinHandle;
    use uuid::Uuid;

    const LISTING_ID: &str = "bounded-extension";

    struct DownloadRoot(PathBuf);

    impl DownloadRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "sorng-marketplace-download-test-{}",
                Uuid::new_v4()
            ));
            std::fs::create_dir(&path).expect("create download test root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for DownloadRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    enum ServerResponse {
        DeclaredLength(u64),
        Chunked(Vec<Vec<u8>>),
        StallAfterPartial {
            declared_length: u64,
            partial: Vec<u8>,
            delay: Duration,
        },
        DelayedFixed {
            body: Vec<u8>,
            delay: Duration,
        },
        GatedFixed {
            body: Vec<u8>,
            release: Arc<Notify>,
        },
    }

    struct LocalServer {
        url: String,
        accepted: oneshot::Receiver<()>,
        _task: JoinHandle<()>,
    }

    async fn local_server(response: ServerResponse) -> LocalServer {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local HTTP server");
        let address = listener.local_addr().expect("local HTTP address");
        let (accepted_tx, accepted) = oneshot::channel();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept HTTP client");
            let mut request = [0_u8; 2048];
            let _ = socket.read(&mut request).await;
            let _ = accepted_tx.send(());
            match response {
                ServerResponse::DeclaredLength(length) => {
                    socket
                        .write_all(
                            format!(
                                "HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
                            )
                            .as_bytes(),
                        )
                        .await
                        .expect("write declared response");
                }
                ServerResponse::Chunked(chunks) => {
                    socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                        )
                        .await
                        .expect("write chunked headers");
                    for chunk in chunks {
                        socket
                            .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                            .await
                            .expect("write chunk length");
                        socket.write_all(&chunk).await.expect("write chunk");
                        socket.write_all(b"\r\n").await.expect("finish chunk");
                    }
                    socket
                        .write_all(b"0\r\n\r\n")
                        .await
                        .expect("finish chunked response");
                }
                ServerResponse::StallAfterPartial {
                    declared_length,
                    partial,
                    delay,
                } => {
                    socket
                        .write_all(
                            format!(
                                "HTTP/1.1 200 OK\r\nContent-Length: {declared_length}\r\nConnection: close\r\n\r\n"
                            )
                            .as_bytes(),
                        )
                        .await
                        .expect("write stalled headers");
                    socket
                        .write_all(&partial)
                        .await
                        .expect("write partial response");
                    socket.flush().await.expect("flush partial response");
                    tokio::time::sleep(delay).await;
                }
                ServerResponse::DelayedFixed { body, delay } => {
                    tokio::time::sleep(delay).await;
                    write_fixed_response(&mut socket, &body).await;
                }
                ServerResponse::GatedFixed { body, release } => {
                    release.notified().await;
                    write_fixed_response(&mut socket, &body).await;
                }
            }
        });
        LocalServer {
            url: format!("http://{address}/extension.tar.gz"),
            accepted,
            _task: task,
        }
    }

    async fn write_fixed_response(socket: &mut tokio::net::TcpStream, body: &[u8]) {
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .as_bytes(),
            )
            .await
            .expect("write fixed headers");
        socket.write_all(body).await.expect("write fixed body");
    }

    fn listing(url: String) -> MarketplaceListing {
        MarketplaceListing {
            id: LISTING_ID.to_string(),
            name: LISTING_ID.to_string(),
            display_name: "Bounded extension".to_string(),
            description: "bounded download test".to_string(),
            long_description: None,
            author: MarketplaceAuthor {
                name: "Tests".to_string(),
                email: None,
                url: None,
                github_username: None,
                verified: true,
            },
            version: "1.0.0".to_string(),
            repository_url: url,
            homepage_url: None,
            license: None,
            tags: vec![],
            category: ExtensionCategory::Utility,
            downloads: 0,
            rating: 0.0,
            rating_count: 0,
            verified: true,
            featured: false,
            icon_url: None,
            screenshots: vec![],
            manifest_url: String::new(),
            published_at: Utc::now(),
            updated_at: Utc::now(),
            compatible_versions: vec![],
            dependencies: vec![],
            permissions_required: vec![],
            size_bytes: None,
            checksum: None,
        }
    }

    fn state(root: &DownloadRoot, listing: MarketplaceListing) -> MarketplaceServiceState {
        let mut registry = MarketplaceRegistry::new();
        registry.add_listing(listing).expect("add test listing");
        Arc::new(MarketplaceSharedState::new(MarketplaceService {
            registry,
            ratings: RatingManager::new(),
            config: MarketplaceConfig {
                cache_directory: root.path().to_string_lossy().into_owned(),
                ..MarketplaceConfig::default()
            },
            config_generation: 0,
        }))
    }

    fn update_state(root: &DownloadRoot, listing: MarketplaceListing) -> MarketplaceServiceState {
        let canonical = root.path().join(LISTING_ID);
        std::fs::create_dir(&canonical).expect("create old extension");
        std::fs::write(canonical.join("extension.tar.gz"), b"old payload")
            .expect("write old artifact");
        std::fs::write(
            canonical.join("manifest.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "id": LISTING_ID,
                "version": "0.9.0",
                "installed_at": "2026-01-01T00:00:00Z"
            }))
            .expect("serialize old manifest"),
        )
        .expect("write old manifest");
        let mut registry = MarketplaceRegistry::new();
        registry.add_listing(listing).expect("add update listing");
        registry.mark_installed(InstalledExtension {
            listing_id: LISTING_ID.to_string(),
            version: "0.9.0".to_string(),
            installed_at: Utc::now(),
            auto_update: false,
            path: canonical.to_string_lossy().into_owned(),
        });
        Arc::new(MarketplaceSharedState::new(MarketplaceService {
            registry,
            ratings: RatingManager::new(),
            config: MarketplaceConfig {
                cache_directory: root.path().to_string_lossy().into_owned(),
                ..MarketplaceConfig::default()
            },
            config_generation: 0,
        }))
    }

    fn policy(max_bytes: u64, request_timeout: Duration) -> installer::DownloadPolicy {
        installer::DownloadPolicy {
            max_bytes,
            connect_timeout: Duration::from_millis(100),
            request_timeout,
        }
    }

    fn assert_no_partial_stage(root: &Path) {
        let entries: Vec<String> = std::fs::read_dir(root)
            .expect("read download root")
            .map(|entry| {
                entry
                    .expect("read download entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert!(
            entries.is_empty(),
            "partial install state remains: {entries:?}"
        );
    }

    fn assert_no_staging_residue(root: &Path) {
        let residues: Vec<String> = std::fs::read_dir(root)
            .expect("read download root")
            .map(|entry| {
                entry
                    .expect("read download entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.contains(".sorng-install-") || name.contains(".sorng-update-"))
            .collect();
        assert!(residues.is_empty(), "staging residues remain: {residues:?}");
    }

    #[tokio::test]
    async fn oversized_content_length_is_rejected_before_body_and_stage_is_removed() {
        let server = local_server(ServerResponse::DeclaredLength(9)).await;
        let root = DownloadRoot::new();
        let state = state(&root, listing(server.url.clone()));

        let error = install_shared_with_policy(
            state.as_ref(),
            LISTING_ID,
            policy(8, Duration::from_secs(1)),
        )
        .await
        .expect_err("oversized declared body must fail");

        assert!(error.to_string().contains("Content-Length 9"));
        assert_no_partial_stage(root.path());
    }

    #[tokio::test]
    async fn oversized_chunked_body_hits_streaming_cap_and_stage_is_removed() {
        let server = local_server(ServerResponse::Chunked(vec![
            b"12345".to_vec(),
            b"67890".to_vec(),
        ]))
        .await;
        let root = DownloadRoot::new();
        let state = state(&root, listing(server.url.clone()));

        let error = install_shared_with_policy(
            state.as_ref(),
            LISTING_ID,
            policy(8, Duration::from_secs(1)),
        )
        .await
        .expect_err("oversized chunked body must fail");

        assert!(error.to_string().contains("streamed marketplace artifact"));
        assert_no_partial_stage(root.path());
    }

    #[tokio::test]
    async fn stalled_body_times_out_and_partial_file_is_removed() {
        let server = local_server(ServerResponse::StallAfterPartial {
            declared_length: 8,
            partial: b"1234".to_vec(),
            delay: Duration::from_millis(500),
        })
        .await;
        let root = DownloadRoot::new();
        let state = state(&root, listing(server.url.clone()));

        let started = Instant::now();
        let error = install_shared_with_policy(
            state.as_ref(),
            LISTING_ID,
            policy(32, Duration::from_millis(80)),
        )
        .await
        .expect_err("stalled response must time out");

        assert!(
            matches!(&error, MarketplaceError::NetworkError(_)),
            "stalled response should surface as a network timeout: {error:?}"
        );
        assert!(
            started.elapsed() < Duration::from_millis(300),
            "client did not enforce its request timeout"
        );
        assert_no_partial_stage(root.path());
    }

    #[tokio::test]
    async fn read_status_remains_responsive_during_stalled_transfer() {
        let server = local_server(ServerResponse::StallAfterPartial {
            declared_length: 8,
            partial: b"1".to_vec(),
            delay: Duration::from_millis(500),
        })
        .await;
        let root = DownloadRoot::new();
        let state = update_state(&root, listing(server.url.clone()));
        let operation_state = Arc::clone(&state);
        let operation = tokio::spawn(async move {
            update_shared_with_policy(
                operation_state.as_ref(),
                LISTING_ID,
                policy(32, Duration::from_millis(300)),
            )
            .await
        });
        server.accepted.await.expect("download request accepted");

        let installed = tokio::time::timeout(Duration::from_millis(100), async {
            let service = state.lock().await;
            service.get_installed()
        })
        .await
        .expect("read-only status must not wait for transfer");
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].version, "0.9.0");
        operation
            .await
            .expect("join stalled operation")
            .expect_err("stalled operation times out");
        assert_no_staging_residue(root.path());
    }

    #[tokio::test]
    async fn guarded_update_commits_registry_and_cleans_transaction_markers() {
        let server = local_server(ServerResponse::DelayedFixed {
            body: b"new payload".to_vec(),
            delay: Duration::ZERO,
        })
        .await;
        let root = DownloadRoot::new();
        let state = update_state(&root, listing(server.url.clone()));

        let result = update_shared_with_policy(
            state.as_ref(),
            LISTING_ID,
            policy(32, Duration::from_secs(1)),
        )
        .await
        .expect("guarded update succeeds");

        assert!(result.success);
        assert_eq!(
            std::fs::read(root.path().join(LISTING_ID).join("extension.tar.gz"))
                .expect("read updated artifact"),
            b"new payload"
        );
        let service = state.lock().await;
        assert_eq!(
            service
                .registry
                .installed
                .get(LISTING_ID)
                .expect("updated registry entry")
                .version,
            "1.0.0"
        );
        drop(service);
        assert_no_staging_residue(root.path());
        assert!(!root
            .path()
            .join(LISTING_ID)
            .join(".sorng-update-owner.json")
            .exists());
    }

    #[tokio::test]
    async fn conflicting_mutation_waits_for_full_install_transaction() {
        let release = Arc::new(Notify::new());
        let server = local_server(ServerResponse::GatedFixed {
            body: b"payload".to_vec(),
            release: Arc::clone(&release),
        })
        .await;
        let root = DownloadRoot::new();
        let state = state(&root, listing(server.url.clone()));
        let operation_state = Arc::clone(&state);
        let operation = tokio::spawn(async move {
            install_shared_with_policy(
                operation_state.as_ref(),
                LISTING_ID,
                policy(32, Duration::from_secs(1)),
            )
            .await
        });
        server.accepted.await.expect("download request accepted");

        let mutation_state = Arc::clone(&state);
        let mut mutation = tokio::spawn(async move {
            with_mutation_gate(mutation_state.as_ref(), |service| {
                assert!(
                    service.registry.is_installed(LISTING_ID),
                    "mutation gate opened before the install registry commit"
                );
                service.add_repository(RepositoryConfig {
                    url: "https://example.invalid/index.json".to_string(),
                    repo_type: RepoType::Custom,
                    branch: None,
                    index_path: None,
                    auth_token: None,
                    refresh_interval_hours: 24,
                });
                Ok(())
            })
            .await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut mutation)
                .await
                .is_err(),
            "conflicting mutation must wait on the marketplace mutation gate"
        );

        release.notify_one();
        operation
            .await
            .expect("join install operation")
            .expect("install succeeds after body release");
        mutation
            .await
            .expect("join serialized mutation")
            .expect("serialized mutation succeeds");
        let service = state.lock().await;
        assert_eq!(service.config.repositories.len(), 1);
    }

    #[tokio::test]
    async fn generation_change_during_transfer_rejects_commit_and_cleans_stage() {
        let server = local_server(ServerResponse::DelayedFixed {
            body: b"payload".to_vec(),
            delay: Duration::from_millis(100),
        })
        .await;
        let root = DownloadRoot::new();
        let state = state(&root, listing(server.url.clone()));
        let operation_state = Arc::clone(&state);
        let operation = tokio::spawn(async move {
            install_shared_with_policy(
                operation_state.as_ref(),
                LISTING_ID,
                policy(32, Duration::from_secs(1)),
            )
            .await
        });
        server.accepted.await.expect("download request accepted");

        {
            let mut service = state.lock().await;
            let current = service
                .registry
                .remove_listing(LISTING_ID)
                .expect("remove listing to advance generation");
            service
                .registry
                .add_listing(current)
                .expect("restore listing after generation change");
        }

        let error = operation
            .await
            .expect("join stale install")
            .expect_err("stale generation must reject commit");
        assert!(error.to_string().contains("refusing stale commit"));
        assert_no_partial_stage(root.path());
        let service = state.lock().await;
        assert!(service.get_installed().is_empty());
    }
}
