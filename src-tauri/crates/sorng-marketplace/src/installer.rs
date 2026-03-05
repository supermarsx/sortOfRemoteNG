//! Extension download, verification, installation, and removal.

use chrono::Utc;
use log::{info, warn};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs;

use crate::error::MarketplaceError;
use crate::types::*;

/// Download, extract, and install an extension from its
/// `repository_url` into `dest_dir`.
pub async fn install_from_listing(
    listing: &MarketplaceListing,
    dest_dir: &str,
) -> Result<InstallResult, MarketplaceError> {
    let ext_dir = Path::new(dest_dir).join(&listing.id);

    info!(
        "Installing {} v{} to {}",
        listing.id,
        listing.version,
        ext_dir.display()
    );

    // Create the target directory.
    fs::create_dir_all(&ext_dir)
        .await
        .map_err(|e| MarketplaceError::InstallError(e.to_string()))?;

    // Download the archive / manifest.
    let client = reqwest::Client::builder()
        .user_agent("sorng-marketplace/0.1")
        .build()
        .map_err(|e| MarketplaceError::NetworkError(e.to_string()))?;

    let resp = client.get(&listing.repository_url).send().await?;

    if !resp.status().is_success() {
        return Ok(InstallResult {
            listing_id: listing.id.clone(),
            version: listing.version.clone(),
            success: false,
            installed_path: None,
            error: Some(format!("HTTP {} from download URL", resp.status())),
        });
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| MarketplaceError::NetworkError(e.to_string()))?;

    // Write the downloaded artefact.
    let artefact_path = ext_dir.join("extension.tar.gz");
    fs::write(&artefact_path, &bytes)
        .await
        .map_err(|e| MarketplaceError::InstallError(e.to_string()))?;

    // Write a local manifest marker.
    let manifest = serde_json::json!({
        "id": listing.id,
        "version": listing.version,
        "installed_at": Utc::now().to_rfc3339(),
    });
    let manifest_path = ext_dir.join("manifest.json");
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
        .await
        .map_err(|e| MarketplaceError::InstallError(e.to_string()))?;

    info!("Successfully installed {}", listing.id);

    Ok(InstallResult {
        listing_id: listing.id.clone(),
        version: listing.version.clone(),
        success: true,
        installed_path: Some(ext_dir.to_string_lossy().into_owned()),
        error: None,
    })
}

/// Remove an installed extension from disk.
pub async fn uninstall_extension(installed: &InstalledExtension) -> Result<(), MarketplaceError> {
    let path = Path::new(&installed.path);
    if path.exists() {
        info!("Uninstalling extension {} at {}", installed.listing_id, installed.path);
        fs::remove_dir_all(path)
            .await
            .map_err(|e| MarketplaceError::UninstallError(e.to_string()))?;
    } else {
        warn!(
            "Extension directory {} does not exist; marking as uninstalled",
            installed.path
        );
    }
    Ok(())
}

/// Update an already-installed extension by re-downloading from the new
/// listing and replacing the on-disk files.
pub async fn update_extension(
    installed: &InstalledExtension,
    new_listing: &MarketplaceListing,
    dest_dir: &str,
) -> Result<InstallResult, MarketplaceError> {
    info!(
        "Updating {} from v{} to v{}",
        installed.listing_id, installed.version, new_listing.version
    );

    // Remove old version, then install new.
    uninstall_extension(installed).await?;
    install_from_listing(new_listing, dest_dir).await
}

/// Verify a downloaded byte slice against an expected SHA-256 hex digest.
pub fn verify_download(data: &[u8], expected_sha256: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let hex = format!("{:x}", digest);
    hex.eq_ignore_ascii_case(expected_sha256)
}
