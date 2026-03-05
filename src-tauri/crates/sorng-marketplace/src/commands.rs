//! Tauri command handlers for the marketplace.
//!
//! Each command follows the `mkt_*` naming convention and delegates
//! to [`MarketplaceService`].

use tauri::State;

use crate::service::MarketplaceServiceState;
use crate::types::*;

/// Helper to map MarketplaceError → String for Tauri command results.
fn err_str(e: crate::error::MarketplaceError) -> String {
    e.to_string()
}

// ─── Search / Browse ────────────────────────────────────────────────

#[tauri::command]
pub async fn mkt_search(
    state: State<'_, MarketplaceServiceState>,
    query: SearchQuery,
) -> Result<SearchResults, String> {
    let svc = state.lock().await;
    Ok(svc.search(&query))
}

#[tauri::command]
pub async fn mkt_get_listing(
    state: State<'_, MarketplaceServiceState>,
    listing_id: String,
) -> Result<MarketplaceListing, String> {
    let svc = state.lock().await;
    svc.get_listing(&listing_id).map_err(err_str)
}

#[tauri::command]
pub async fn mkt_get_categories(
    state: State<'_, MarketplaceServiceState>,
) -> Result<Vec<ExtensionCategory>, String> {
    let svc = state.lock().await;
    Ok(svc.get_categories())
}

#[tauri::command]
pub async fn mkt_get_featured(
    state: State<'_, MarketplaceServiceState>,
) -> Result<Vec<MarketplaceListing>, String> {
    let svc = state.lock().await;
    Ok(svc.get_featured())
}

#[tauri::command]
pub async fn mkt_get_popular(
    state: State<'_, MarketplaceServiceState>,
    limit: Option<u32>,
) -> Result<Vec<MarketplaceListing>, String> {
    let svc = state.lock().await;
    Ok(svc.get_popular(limit.unwrap_or(20) as usize))
}

// ─── Installation ───────────────────────────────────────────────────

#[tauri::command]
pub async fn mkt_install(
    state: State<'_, MarketplaceServiceState>,
    listing_id: String,
) -> Result<InstallResult, String> {
    let mut svc = state.lock().await;
    svc.install(&listing_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn mkt_uninstall(
    state: State<'_, MarketplaceServiceState>,
    listing_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.uninstall(&listing_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn mkt_update(
    state: State<'_, MarketplaceServiceState>,
    listing_id: String,
) -> Result<InstallResult, String> {
    let mut svc = state.lock().await;
    svc.update(&listing_id).await.map_err(err_str)
}

#[tauri::command]
pub async fn mkt_get_installed(
    state: State<'_, MarketplaceServiceState>,
) -> Result<Vec<InstalledExtension>, String> {
    let svc = state.lock().await;
    Ok(svc.get_installed())
}

#[tauri::command]
pub async fn mkt_check_updates(
    state: State<'_, MarketplaceServiceState>,
) -> Result<Vec<(MarketplaceListing, InstalledExtension)>, String> {
    let svc = state.lock().await;
    Ok(svc.check_updates())
}

// ─── Repository management ──────────────────────────────────────────

#[tauri::command]
pub async fn mkt_refresh_repositories(
    state: State<'_, MarketplaceServiceState>,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.refresh_repositories().await.map_err(err_str)
}

#[tauri::command]
pub async fn mkt_add_repository(
    state: State<'_, MarketplaceServiceState>,
    repo: RepositoryConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_repository(repo);
    Ok(())
}

#[tauri::command]
pub async fn mkt_remove_repository(
    state: State<'_, MarketplaceServiceState>,
    url: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_repository(&url).map_err(err_str)
}

#[tauri::command]
pub async fn mkt_list_repositories(
    state: State<'_, MarketplaceServiceState>,
) -> Result<Vec<RepositoryConfig>, String> {
    let svc = state.lock().await;
    Ok(svc.list_repositories())
}

// ─── Reviews / Ratings ──────────────────────────────────────────────

#[tauri::command]
pub async fn mkt_get_reviews(
    state: State<'_, MarketplaceServiceState>,
    listing_id: String,
) -> Result<Vec<MarketplaceReview>, String> {
    let svc = state.lock().await;
    Ok(svc.get_reviews(&listing_id))
}

#[tauri::command]
pub async fn mkt_add_review(
    state: State<'_, MarketplaceServiceState>,
    review: MarketplaceReview,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_review(review).map_err(err_str)
}

// ─── Stats / Config ─────────────────────────────────────────────────

#[tauri::command]
pub async fn mkt_get_stats(
    state: State<'_, MarketplaceServiceState>,
) -> Result<MarketplaceStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_stats())
}

#[tauri::command]
pub async fn mkt_get_config(
    state: State<'_, MarketplaceServiceState>,
) -> Result<MarketplaceConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn mkt_update_config(
    state: State<'_, MarketplaceServiceState>,
    config: MarketplaceConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

#[tauri::command]
pub async fn mkt_validate_manifest(
    state: State<'_, MarketplaceServiceState>,
    manifest_json: String,
) -> Result<MarketplaceListing, String> {
    let svc = state.lock().await;
    svc.validate_manifest(&manifest_json).map_err(err_str)
}
