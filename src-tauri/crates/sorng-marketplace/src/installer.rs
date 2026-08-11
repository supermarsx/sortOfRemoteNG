//! Extension download, verification, installation, and removal.

use chrono::Utc;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Future;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::error::MarketplaceError;
use crate::types::*;

const DEFAULT_MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy)]
pub(crate) struct DownloadPolicy {
    pub(crate) max_bytes: u64,
    pub(crate) connect_timeout: Duration,
    pub(crate) request_timeout: Duration,
}

impl Default for DownloadPolicy {
    fn default() -> Self {
        Self {
            max_bytes: DEFAULT_MAX_ARTIFACT_BYTES,
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArtifactDigest {
    size: u64,
    sha256: String,
}

/// Download, extract, and install an extension from its
/// `repository_url` into `dest_dir`.
pub async fn install_from_listing(
    listing: &MarketplaceListing,
    dest_dir: &str,
) -> Result<InstallResult, MarketplaceError> {
    let result =
        install_from_listing_guarded(listing, dest_dir, DownloadPolicy::default(), || async {
            Ok(())
        })
        .await?;
    finalize_guarded_install(listing, &result).await;
    Ok(result)
}

pub(crate) async fn install_from_listing_guarded<F, Fut>(
    listing: &MarketplaceListing,
    dest_dir: &str,
    policy: DownloadPolicy,
    before_commit: F,
) -> Result<InstallResult, MarketplaceError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<(), MarketplaceError>>,
{
    let paths = resolve_install_paths(listing, dest_dir).await?;
    info!(
        "Installing {} v{} to {}",
        listing.id,
        listing.version,
        paths.canonical.display()
    );

    let transaction_id = Uuid::new_v4();
    let staging = paths.root.join(format!(
        ".{}.sorng-install-{}.staging",
        listing.id, transaction_id
    ));
    fs::create_dir(&staging)
        .await
        .map_err(|error| update_io_error("create install staging directory", &staging, error))?;

    let prepared = async {
        write_update_owner(&staging, listing, transaction_id).await?;
        let digest =
            download_artifact_to_file(listing, &staging.join("extension.tar.gz"), policy).await?;
        write_local_manifest(&staging, listing).await?;
        verify_materialized(&staging, listing, &digest, policy.max_bytes).await?;
        Ok::<ArtifactDigest, MarketplaceError>(digest)
    }
    .await;
    if let Err(error) = prepared {
        return Err(cleanup_after_failure(error, &staging).await);
    }

    if let Err(error) = before_commit().await {
        return Err(cleanup_after_failure(error, &staging).await);
    }
    match path_exists(&paths.canonical).await {
        Ok(false) => {}
        Ok(true) => {
            let error = MarketplaceError::InstallError(format!(
                "extension path already exists at {}",
                paths.canonical.display()
            ));
            return Err(cleanup_after_failure(error, &staging).await);
        }
        Err(error) => return Err(cleanup_after_failure(error, &staging).await),
    }
    if let Err(error) = fs::rename(&staging, &paths.canonical).await {
        let error = update_io_error(
            "move staged install into canonical path",
            &paths.canonical,
            error,
        );
        return Err(cleanup_after_failure(error, &staging).await);
    }

    info!("Successfully installed {}", listing.id);
    Ok(successful_update_result(listing, &paths.canonical))
}

pub(crate) async fn finalize_guarded_install(listing: &MarketplaceListing, result: &InstallResult) {
    let Some(path) = result.installed_path.as_deref().map(Path::new) else {
        return;
    };
    if let Err(error) = remove_update_owner_if_present(path).await {
        warn!(
            "Extension {} v{} installed, but its ownership marker could not be removed: {}",
            listing.id, listing.version, error
        );
    }
}

/// Remove an installed extension from disk.
pub async fn uninstall_extension(installed: &InstalledExtension) -> Result<(), MarketplaceError> {
    let path = Path::new(&installed.path);
    if path.exists() {
        info!(
            "Uninstalling extension {} at {}",
            installed.listing_id, installed.path
        );
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

    update_extension_inner(
        installed,
        new_listing,
        dest_dir,
        UpdateOptions::default(),
        || async { Ok(()) },
    )
    .await
}

pub(crate) async fn update_extension_guarded<F, Fut>(
    installed: &InstalledExtension,
    new_listing: &MarketplaceListing,
    dest_dir: &str,
    policy: DownloadPolicy,
    before_commit: F,
) -> Result<InstallResult, MarketplaceError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<(), MarketplaceError>>,
{
    update_extension_inner(
        installed,
        new_listing,
        dest_dir,
        UpdateOptions {
            policy,
            defer_finalize: true,
            ..UpdateOptions::default()
        },
        before_commit,
    )
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpdatePhase {
    Download,
    Materialize,
    FirstRename,
    SecondRename,
    Cleanup,
    PostCommitCleanup,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UpdateFault {
    Download,
    Materialize,
    FirstRename,
    SecondRename,
    Cleanup,
    PostCommitCleanup,
}

#[cfg(test)]
impl From<UpdateFault> for UpdatePhase {
    fn from(value: UpdateFault) -> Self {
        match value {
            UpdateFault::Download => Self::Download,
            UpdateFault::Materialize => Self::Materialize,
            UpdateFault::FirstRename => Self::FirstRename,
            UpdateFault::SecondRename => Self::SecondRename,
            UpdateFault::Cleanup => Self::Cleanup,
            UpdateFault::PostCommitCleanup => Self::PostCommitCleanup,
        }
    }
}

#[derive(Default)]
struct UpdateOptions {
    payload_override: Option<Vec<u8>>,
    fail_at: Option<UpdatePhase>,
    policy: DownloadPolicy,
    defer_finalize: bool,
}

impl UpdateOptions {
    fn fail_if(&self, phase: UpdatePhase) -> Result<(), MarketplaceError> {
        if self.fail_at == Some(phase) {
            return Err(MarketplaceError::InstallError(format!(
                "injected update failure at {phase:?}"
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) async fn update_extension_with_fault(
    installed: &InstalledExtension,
    new_listing: &MarketplaceListing,
    dest_dir: &str,
    payload: &[u8],
    fault: Option<UpdateFault>,
) -> Result<InstallResult, MarketplaceError> {
    update_extension_inner(
        installed,
        new_listing,
        dest_dir,
        UpdateOptions {
            payload_override: Some(payload.to_vec()),
            fail_at: fault.map(Into::into),
            policy: DownloadPolicy::default(),
            defer_finalize: false,
        },
        || async { Ok(()) },
    )
    .await
}

#[derive(Debug)]
struct ManagedUpdatePaths {
    root: PathBuf,
    canonical: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResidueKind {
    Staging,
    Backup,
    Obsolete,
}

#[derive(Debug)]
struct UpdateResidue {
    transaction_id: Uuid,
    kind: ResidueKind,
    path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveryOutcome {
    Continue,
    AlreadyCommitted,
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateOwner {
    extension_id: String,
    transaction_id: String,
}

const UPDATE_OWNER_FILE: &str = ".sorng-update-owner.json";

async fn update_extension_inner<F, Fut>(
    installed: &InstalledExtension,
    new_listing: &MarketplaceListing,
    dest_dir: &str,
    options: UpdateOptions,
    before_commit: F,
) -> Result<InstallResult, MarketplaceError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<(), MarketplaceError>>,
{
    let paths = resolve_managed_paths(installed, new_listing, dest_dir).await?;
    if recover_interrupted_update(installed, new_listing, &paths).await?
        == RecoveryOutcome::AlreadyCommitted
    {
        info!(
            "Recovered committed update of {} to v{}",
            new_listing.id, new_listing.version
        );
        return Ok(successful_update_result(new_listing, &paths.canonical));
    }
    validate_owned_tree(&paths.canonical)?;
    verify_manifest(&paths.canonical, &installed.listing_id, &installed.version).await?;
    ensure_update_owner_absent(&paths.canonical).await?;

    options.fail_if(UpdatePhase::Download)?;
    let transaction_id = Uuid::new_v4();
    let stem = format!(".{}.sorng-update-{}", new_listing.id, transaction_id);
    let staging = paths.root.join(format!("{stem}.staging"));
    let backup = paths.root.join(format!("{stem}.backup"));
    let obsolete = paths.root.join(format!("{stem}.obsolete"));

    fs::create_dir(&staging)
        .await
        .map_err(|error| update_io_error("create staging directory", &staging, error))?;
    let digest = match materialize_staging(
        &staging,
        new_listing,
        transaction_id,
        options.payload_override.as_deref(),
        &options,
    )
    .await
    {
        Ok(digest) => digest,
        Err(error) => return Err(cleanup_after_failure(error, &staging).await),
    };

    if let Err(error) = before_commit().await {
        return Err(cleanup_after_failure(error, &staging).await);
    }

    if let Err(error) = options.fail_if(UpdatePhase::FirstRename) {
        return Err(cleanup_after_failure(error, &staging).await);
    }
    if let Err(error) = fs::rename(&paths.canonical, &backup).await {
        let error = update_io_error("move current extension to backup", &backup, error);
        return Err(cleanup_after_failure(error, &staging).await);
    }
    if let Err(error) = write_update_owner(&backup, new_listing, transaction_id).await {
        return Err(rollback_after_swap_failure(
            error,
            installed,
            &paths.canonical,
            &backup,
            &staging,
            transaction_id,
        )
        .await);
    }

    if let Err(error) = options.fail_if(UpdatePhase::SecondRename) {
        return Err(rollback_after_swap_failure(
            error,
            installed,
            &paths.canonical,
            &backup,
            &staging,
            transaction_id,
        )
        .await);
    }
    if let Err(error) = fs::rename(&staging, &paths.canonical).await {
        let error = update_io_error(
            "move staged extension into canonical path",
            &paths.canonical,
            error,
        );
        return Err(rollback_after_swap_failure(
            error,
            installed,
            &paths.canonical,
            &backup,
            &staging,
            transaction_id,
        )
        .await);
    }

    if let Err(error) = verify_materialized(
        &paths.canonical,
        new_listing,
        &digest,
        options.policy.max_bytes,
    )
    .await
    {
        return Err(rollback_after_swap_failure(
            error,
            installed,
            &paths.canonical,
            &backup,
            &staging,
            transaction_id,
        )
        .await);
    }

    if let Err(error) = options.fail_if(UpdatePhase::Cleanup) {
        return Err(rollback_after_swap_failure(
            error,
            installed,
            &paths.canonical,
            &backup,
            &staging,
            transaction_id,
        )
        .await);
    }

    if let Err(error) =
        verify_manifest(&paths.canonical, &new_listing.id, &new_listing.version).await
    {
        return Err(rollback_after_swap_failure(
            error,
            installed,
            &paths.canonical,
            &backup,
            &staging,
            transaction_id,
        )
        .await);
    }

    // The same-filesystem rename is the durable commit point. Every fallible
    // validation and cleanup step that can still report update failure has
    // completed; after this succeeds the old tree is obsolete, never rollback.
    if let Err(error) = fs::rename(&backup, &obsolete).await {
        let error = update_io_error("commit extension backup as obsolete", &obsolete, error);
        return Err(rollback_after_swap_failure(
            error,
            installed,
            &paths.canonical,
            &backup,
            &staging,
            transaction_id,
        )
        .await);
    }

    if options.defer_finalize {
        info!(
            "Durably staged registry-guarded update of {} to v{}",
            new_listing.id, new_listing.version
        );
        return Ok(successful_update_result(new_listing, &paths.canonical));
    }

    if let Err(error) = remove_update_owner_if_present(&paths.canonical).await {
        warn!(
            "Extension {} v{} committed, but its update ownership marker could not be removed: {}",
            new_listing.id, new_listing.version, error
        );
    }

    let obsolete_cleanup = match options.fail_if(UpdatePhase::PostCommitCleanup) {
        Err(error) => Err(error),
        Ok(()) => safe_remove_owned_tree(&obsolete).await,
    };
    if let Err(error) = obsolete_cleanup {
        warn!(
            "Extension {} v{} committed, but obsolete update residue {} could not be cleaned: {}",
            new_listing.id,
            new_listing.version,
            obsolete.display(),
            error
        );
    }

    info!(
        "Successfully updated {} to v{}",
        new_listing.id, new_listing.version
    );
    Ok(successful_update_result(new_listing, &paths.canonical))
}

fn successful_update_result(listing: &MarketplaceListing, canonical: &Path) -> InstallResult {
    InstallResult {
        listing_id: listing.id.clone(),
        version: listing.version.clone(),
        success: true,
        installed_path: Some(canonical.to_string_lossy().into_owned()),
        error: None,
    }
}

pub(crate) async fn finalize_guarded_update(
    installed: &InstalledExtension,
    listing: &MarketplaceListing,
    dest_dir: &str,
) {
    let (paths, obsolete) = match locate_guarded_update(installed, listing, dest_dir).await {
        Ok(located) => located,
        Err(error) => {
            warn!(
                "Committed update for {} retained transaction markers: {}",
                listing.id, error
            );
            return;
        }
    };
    if let Err(error) = remove_update_owner_if_present(&paths.canonical).await {
        warn!(
            "Committed update for {} retained its canonical owner marker: {}",
            listing.id, error
        );
    }
    if let Err(error) = safe_remove_owned_tree(&obsolete).await {
        warn!(
            "Committed update for {} retained obsolete tree {}: {}",
            listing.id,
            obsolete.display(),
            error
        );
    }
}

async fn locate_guarded_update(
    installed: &InstalledExtension,
    listing: &MarketplaceListing,
    dest_dir: &str,
) -> Result<(ManagedUpdatePaths, PathBuf), MarketplaceError> {
    let paths = resolve_managed_paths(installed, listing, dest_dir).await?;
    validate_owned_tree(&paths.canonical)?;
    verify_manifest(&paths.canonical, &listing.id, &listing.version).await?;
    let owner = verify_update_owner(&paths.canonical, &listing.id, None).await?;
    let transaction = Uuid::parse_str(&owner.transaction_id).map_err(|_| {
        MarketplaceError::InstallError("invalid guarded update transaction id".into())
    })?;
    let mut matching: Vec<UpdateResidue> = find_update_residues(&paths.root, &listing.id)
        .await?
        .into_iter()
        .filter(|residue| {
            residue.transaction_id == transaction && residue.kind == ResidueKind::Obsolete
        })
        .collect();
    if matching.len() != 1 {
        return Err(MarketplaceError::InstallError(format!(
            "guarded update for {} has {} matching obsolete trees; preserved",
            listing.id,
            matching.len()
        )));
    }
    let obsolete = matching.pop().expect("exactly one guarded obsolete tree");
    validate_owned_tree(&obsolete.path)?;
    verify_update_owner(&obsolete.path, &listing.id, Some(transaction)).await?;
    verify_manifest(&obsolete.path, &installed.listing_id, &installed.version).await?;
    Ok((paths, obsolete.path))
}

async fn resolve_install_paths(
    listing: &MarketplaceListing,
    dest_dir: &str,
) -> Result<ManagedUpdatePaths, MarketplaceError> {
    validate_extension_id(&listing.id)?;
    let configured_root = Path::new(dest_dir);
    fs::create_dir_all(configured_root).await.map_err(|error| {
        update_io_error("create managed extension root", configured_root, error)
    })?;
    let root_metadata = fs::symlink_metadata(configured_root)
        .await
        .map_err(|error| {
            update_io_error("inspect managed extension root", configured_root, error)
        })?;
    if !root_metadata.is_dir() || is_symlink_or_reparse(&root_metadata) {
        return Err(MarketplaceError::InstallError(format!(
            "managed extension root is not a real directory: {}",
            configured_root.display()
        )));
    }
    let root = fs::canonicalize(configured_root).await.map_err(|error| {
        update_io_error(
            "canonicalize managed extension root",
            configured_root,
            error,
        )
    })?;
    let canonical = root.join(&listing.id);
    if !canonical.starts_with(&root) || canonical.parent() != Some(root.as_path()) {
        return Err(MarketplaceError::InstallError(
            "extension path escaped the managed root".to_string(),
        ));
    }
    Ok(ManagedUpdatePaths { root, canonical })
}

async fn resolve_managed_paths(
    installed: &InstalledExtension,
    new_listing: &MarketplaceListing,
    dest_dir: &str,
) -> Result<ManagedUpdatePaths, MarketplaceError> {
    if installed.listing_id != new_listing.id {
        return Err(MarketplaceError::InstallError(format!(
            "update listing id {} does not match installed id {}",
            new_listing.id, installed.listing_id
        )));
    }
    validate_extension_id(&new_listing.id)?;

    let configured_root = Path::new(dest_dir);
    let root_metadata = fs::symlink_metadata(configured_root)
        .await
        .map_err(|error| {
            update_io_error("inspect managed extension root", configured_root, error)
        })?;
    if !root_metadata.is_dir() || is_symlink_or_reparse(&root_metadata) {
        return Err(MarketplaceError::InstallError(format!(
            "managed extension root is not a real directory: {}",
            configured_root.display()
        )));
    }
    let root = fs::canonicalize(configured_root).await.map_err(|error| {
        update_io_error(
            "canonicalize managed extension root",
            configured_root,
            error,
        )
    })?;
    let canonical = root.join(&new_listing.id);
    if !canonical.starts_with(&root) || canonical.parent() != Some(root.as_path()) {
        return Err(MarketplaceError::InstallError(
            "extension path escaped the managed root".to_string(),
        ));
    }

    let configured_canonical = configured_root.join(&new_listing.id);
    let installed_path = Path::new(&installed.path);
    match fs::symlink_metadata(installed_path).await {
        Ok(metadata) => {
            if is_symlink_or_reparse(&metadata) {
                return Err(MarketplaceError::InstallError(format!(
                    "installed extension path is a link or reparse point: {}",
                    installed_path.display()
                )));
            }
            let actual = fs::canonicalize(installed_path).await.map_err(|error| {
                update_io_error("canonicalize installed extension", installed_path, error)
            })?;
            if actual != canonical {
                return Err(MarketplaceError::InstallError(format!(
                    "installed extension path {} is outside its managed canonical path {}",
                    actual.display(),
                    canonical.display()
                )));
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            if installed_path != configured_canonical && installed_path != canonical {
                return Err(MarketplaceError::InstallError(format!(
                    "missing installed path {} does not match managed canonical path {}",
                    installed_path.display(),
                    canonical.display()
                )));
            }
        }
        Err(error) => {
            return Err(update_io_error(
                "inspect installed extension path",
                installed_path,
                error,
            ));
        }
    }

    Ok(ManagedUpdatePaths { root, canonical })
}

fn validate_extension_id(extension_id: &str) -> Result<(), MarketplaceError> {
    let mut components = Path::new(extension_id).components();
    if extension_id.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err(MarketplaceError::InstallError(format!(
            "unsafe extension id for managed installation: {extension_id:?}"
        )));
    }
    Ok(())
}

fn build_artifact_client(policy: DownloadPolicy) -> Result<reqwest::Client, MarketplaceError> {
    reqwest::Client::builder()
        .user_agent("sorng-marketplace/0.1")
        .connect_timeout(policy.connect_timeout)
        .timeout(policy.request_timeout)
        .build()
        .map_err(|error| MarketplaceError::NetworkError(error.to_string()))
}

async fn download_artifact_to_file(
    listing: &MarketplaceListing,
    artifact_path: &Path,
    policy: DownloadPolicy,
) -> Result<ArtifactDigest, MarketplaceError> {
    if let Some(expected_size) = listing.size_bytes {
        if expected_size > policy.max_bytes {
            return Err(MarketplaceError::VerificationError(format!(
                "declared marketplace artifact size {expected_size} exceeds {} byte limit",
                policy.max_bytes
            )));
        }
    }

    let client = build_artifact_client(policy)?;
    let mut response = client
        .get(&listing.repository_url)
        .send()
        .await
        .map_err(|error| MarketplaceError::NetworkError(error.to_string()))?;
    if !response.status().is_success() {
        return Err(MarketplaceError::NetworkError(format!(
            "HTTP {} from download URL",
            response.status()
        )));
    }

    if let Some(content_length) = response.content_length() {
        if content_length > policy.max_bytes {
            return Err(MarketplaceError::VerificationError(format!(
                "marketplace artifact Content-Length {content_length} exceeds {} byte limit",
                policy.max_bytes
            )));
        }
        if let Some(expected_size) = listing.size_bytes {
            if content_length != expected_size {
                return Err(MarketplaceError::VerificationError(format!(
                    "marketplace artifact Content-Length {content_length} does not match expected size {expected_size}"
                )));
            }
        }
    }

    let mut file = fs::File::create(artifact_path)
        .await
        .map_err(|error| update_io_error("create staged artifact", artifact_path, error))?;
    let mut size = 0_u64;
    let mut hasher = Sha256::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| MarketplaceError::NetworkError(error.to_string()))?
    {
        let next_size = size
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| MarketplaceError::VerificationError("artifact size overflow".into()))?;
        if next_size > policy.max_bytes {
            return Err(MarketplaceError::VerificationError(format!(
                "streamed marketplace artifact exceeds {} byte limit",
                policy.max_bytes
            )));
        }
        if let Some(expected_size) = listing.size_bytes {
            if next_size > expected_size {
                return Err(MarketplaceError::VerificationError(format!(
                    "streamed marketplace artifact exceeds expected size {expected_size}"
                )));
            }
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| update_io_error("write staged artifact", artifact_path, error))?;
        hasher.update(&chunk);
        size = next_size;
    }
    file.flush()
        .await
        .map_err(|error| update_io_error("flush staged artifact", artifact_path, error))?;
    file.sync_all()
        .await
        .map_err(|error| update_io_error("sync staged artifact", artifact_path, error))?;

    let digest = ArtifactDigest {
        size,
        sha256: format!("{:x}", hasher.finalize()),
    };
    validate_artifact_digest(listing, &digest)?;
    Ok(digest)
}

fn validate_artifact_digest(
    listing: &MarketplaceListing,
    digest: &ArtifactDigest,
) -> Result<(), MarketplaceError> {
    if let Some(expected_size) = listing.size_bytes {
        if digest.size != expected_size {
            return Err(MarketplaceError::VerificationError(format!(
                "marketplace artifact size {} does not match expected size {expected_size}",
                digest.size
            )));
        }
    }
    if let Some(expected_checksum) = &listing.checksum {
        if !digest.sha256.eq_ignore_ascii_case(expected_checksum) {
            return Err(MarketplaceError::VerificationError(format!(
                "checksum mismatch for {}",
                listing.id
            )));
        }
        info!("Checksum verified for {}", listing.id);
    } else {
        warn!(
            "No checksum provided for extension {} — integrity not verified",
            listing.id
        );
    }
    Ok(())
}

async fn write_local_manifest(
    staging: &Path,
    listing: &MarketplaceListing,
) -> Result<(), MarketplaceError> {
    let manifest = serde_json::json!({
        "id": listing.id,
        "version": listing.version,
        "installed_at": Utc::now().to_rfc3339(),
    });
    write_synced(
        &staging.join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest)?,
    )
    .await
}

async fn write_payload_to_file(
    listing: &MarketplaceListing,
    bytes: &[u8],
    artifact_path: &Path,
    policy: DownloadPolicy,
) -> Result<ArtifactDigest, MarketplaceError> {
    let size = bytes.len() as u64;
    if size > policy.max_bytes {
        return Err(MarketplaceError::VerificationError(format!(
            "marketplace artifact size {size} exceeds {} byte limit",
            policy.max_bytes
        )));
    }
    write_synced(artifact_path, bytes).await?;
    let digest = ArtifactDigest {
        size,
        sha256: format!("{:x}", Sha256::digest(bytes)),
    };
    validate_artifact_digest(listing, &digest)?;
    Ok(digest)
}

async fn materialize_staging(
    staging: &Path,
    listing: &MarketplaceListing,
    transaction_id: Uuid,
    payload_override: Option<&[u8]>,
    options: &UpdateOptions,
) -> Result<ArtifactDigest, MarketplaceError> {
    write_update_owner(staging, listing, transaction_id).await?;
    let artifact_path = staging.join("extension.tar.gz");
    let digest = match payload_override {
        Some(bytes) => {
            write_payload_to_file(listing, bytes, &artifact_path, options.policy).await?
        }
        None => download_artifact_to_file(listing, &artifact_path, options.policy).await?,
    };
    options.fail_if(UpdatePhase::Materialize)?;
    write_local_manifest(staging, listing).await?;
    verify_materialized(staging, listing, &digest, options.policy.max_bytes).await?;
    Ok(digest)
}

async fn write_update_owner(
    path: &Path,
    listing: &MarketplaceListing,
    transaction_id: Uuid,
) -> Result<(), MarketplaceError> {
    let owner = UpdateOwner {
        extension_id: listing.id.clone(),
        transaction_id: transaction_id.to_string(),
    };
    write_synced(
        &path.join(UPDATE_OWNER_FILE),
        &serde_json::to_vec_pretty(&owner)?,
    )
    .await
}

async fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), MarketplaceError> {
    let mut file = fs::File::create(path)
        .await
        .map_err(|error| update_io_error("create staged file", path, error))?;
    file.write_all(bytes)
        .await
        .map_err(|error| update_io_error("write staged file", path, error))?;
    file.flush()
        .await
        .map_err(|error| update_io_error("flush staged file", path, error))?;
    file.sync_all()
        .await
        .map_err(|error| update_io_error("sync staged file", path, error))?;
    Ok(())
}

async fn verify_materialized(
    path: &Path,
    listing: &MarketplaceListing,
    expected_digest: &ArtifactDigest,
    max_bytes: u64,
) -> Result<(), MarketplaceError> {
    validate_owned_tree(path)?;
    verify_manifest(path, &listing.id, &listing.version).await?;
    verify_update_owner(path, &listing.id, None).await?;
    let actual = hash_artifact_file(&path.join("extension.tar.gz"), max_bytes).await?;
    if &actual != expected_digest {
        return Err(MarketplaceError::VerificationError(format!(
            "materialized artefact mismatch for {}",
            listing.id
        )));
    }
    Ok(())
}

async fn hash_artifact_file(
    artifact_path: &Path,
    max_bytes: u64,
) -> Result<ArtifactDigest, MarketplaceError> {
    let mut file = fs::File::open(artifact_path)
        .await
        .map_err(|error| update_io_error("open materialized artifact", artifact_path, error))?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut size = 0_u64;
    let mut hasher = Sha256::new();
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| update_io_error("read materialized artifact", artifact_path, error))?;
        if read == 0 {
            break;
        }
        size = size
            .checked_add(read as u64)
            .ok_or_else(|| MarketplaceError::VerificationError("artifact size overflow".into()))?;
        if size > max_bytes {
            return Err(MarketplaceError::VerificationError(format!(
                "materialized marketplace artifact exceeds {max_bytes} byte limit"
            )));
        }
        hasher.update(&buffer[..read]);
    }
    Ok(ArtifactDigest {
        size,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

async fn verify_manifest(
    path: &Path,
    expected_id: &str,
    expected_version: &str,
) -> Result<(), MarketplaceError> {
    let manifest_path = path.join("manifest.json");
    let bytes = fs::read(&manifest_path)
        .await
        .map_err(|error| update_io_error("read extension manifest", &manifest_path, error))?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes)?;
    if manifest.get("id").and_then(|value| value.as_str()) != Some(expected_id)
        || manifest.get("version").and_then(|value| value.as_str()) != Some(expected_version)
    {
        return Err(MarketplaceError::ManifestValidationError(format!(
            "manifest at {} does not match expected {} v{}",
            manifest_path.display(),
            expected_id,
            expected_version
        )));
    }
    Ok(())
}

async fn verify_manifest_id(path: &Path, expected_id: &str) -> Result<(), MarketplaceError> {
    let manifest_path = path.join("manifest.json");
    let bytes = fs::read(&manifest_path)
        .await
        .map_err(|error| update_io_error("read extension manifest", &manifest_path, error))?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes)?;
    if manifest.get("id").and_then(|value| value.as_str()) != Some(expected_id) {
        return Err(MarketplaceError::ManifestValidationError(format!(
            "manifest at {} does not match expected extension {}",
            manifest_path.display(),
            expected_id
        )));
    }
    Ok(())
}

async fn manifest_matches(
    path: &Path,
    expected_id: &str,
    expected_version: &str,
) -> Result<bool, MarketplaceError> {
    let manifest_path = path.join("manifest.json");
    let bytes = fs::read(&manifest_path)
        .await
        .map_err(|error| update_io_error("read extension manifest", &manifest_path, error))?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes)?;
    Ok(
        manifest.get("id").and_then(|value| value.as_str()) == Some(expected_id)
            && manifest.get("version").and_then(|value| value.as_str()) == Some(expected_version),
    )
}

async fn verify_update_owner(
    path: &Path,
    expected_id: &str,
    expected_transaction: Option<Uuid>,
) -> Result<UpdateOwner, MarketplaceError> {
    let owner_path = path.join(UPDATE_OWNER_FILE);
    let bytes = fs::read(&owner_path)
        .await
        .map_err(|error| update_io_error("read update ownership marker", &owner_path, error))?;
    let owner: UpdateOwner = serde_json::from_slice(&bytes)?;
    let owner_transaction = Uuid::parse_str(&owner.transaction_id).map_err(|_| {
        MarketplaceError::InstallError(format!(
            "invalid update ownership marker at {}",
            owner_path.display()
        ))
    })?;
    let transaction_matches = expected_transaction
        .map(|transaction| transaction == owner_transaction)
        .unwrap_or(true);
    if owner.extension_id != expected_id || !transaction_matches {
        return Err(MarketplaceError::InstallError(format!(
            "invalid update ownership marker at {}",
            owner_path.display()
        )));
    }
    Ok(owner)
}

async fn ensure_update_owner_absent(path: &Path) -> Result<(), MarketplaceError> {
    let owner_path = path.join(UPDATE_OWNER_FILE);
    match fs::symlink_metadata(&owner_path).await {
        Ok(_) => Err(MarketplaceError::InstallError(format!(
            "reserved update ownership marker already exists at {}",
            owner_path.display()
        ))),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(update_io_error(
            "inspect reserved update ownership marker",
            &owner_path,
            error,
        )),
    }
}

async fn remove_update_owner_if_present(path: &Path) -> Result<(), MarketplaceError> {
    let owner_path = path.join(UPDATE_OWNER_FILE);
    match fs::remove_file(&owner_path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(update_io_error(
            "remove update ownership marker",
            &owner_path,
            error,
        )),
    }
}

async fn cleanup_after_failure(error: MarketplaceError, staging: &Path) -> MarketplaceError {
    match safe_remove_owned_tree(staging).await {
        Ok(()) => error,
        Err(cleanup) => combine_errors(error, "staging cleanup", cleanup),
    }
}

async fn rollback_after_swap_failure(
    error: MarketplaceError,
    installed: &InstalledExtension,
    canonical: &Path,
    backup: &Path,
    staging: &Path,
    transaction_id: Uuid,
) -> MarketplaceError {
    match restore_backup(installed, canonical, backup, Some(staging), transaction_id).await {
        Ok(()) => error,
        Err(rollback) => combine_errors(error, "rollback", rollback),
    }
}

async fn restore_backup(
    installed: &InstalledExtension,
    canonical: &Path,
    backup: &Path,
    staging: Option<&Path>,
    transaction_id: Uuid,
) -> Result<(), MarketplaceError> {
    validate_owned_tree(backup)?;
    verify_manifest(backup, &installed.listing_id, &installed.version).await?;

    if path_exists(canonical).await? {
        validate_owned_tree(canonical)?;
        verify_update_owner(canonical, &installed.listing_id, Some(transaction_id)).await?;
        safe_remove_owned_tree(canonical).await?;
    }
    fs::rename(backup, canonical)
        .await
        .map_err(|error| update_io_error("restore extension backup", canonical, error))?;
    remove_update_owner_if_present(canonical).await?;
    if let Some(staging) = staging {
        if path_exists(staging).await? {
            safe_remove_owned_tree(staging).await?;
        }
    }
    verify_manifest(canonical, &installed.listing_id, &installed.version).await?;
    Ok(())
}

async fn recover_interrupted_update(
    installed: &InstalledExtension,
    new_listing: &MarketplaceListing,
    paths: &ManagedUpdatePaths,
) -> Result<RecoveryOutcome, MarketplaceError> {
    let residues = find_update_residues(&paths.root, &new_listing.id).await?;
    let mut grouped: HashMap<Uuid, Vec<UpdateResidue>> = HashMap::new();
    for residue in residues {
        grouped
            .entry(residue.transaction_id)
            .or_default()
            .push(residue);
    }

    let backup_transactions: Vec<Uuid> = grouped
        .iter()
        .filter(|(_, residues)| {
            residues
                .iter()
                .any(|residue| residue.kind == ResidueKind::Backup)
        })
        .map(|(transaction, _)| *transaction)
        .collect();
    if backup_transactions.len() > 1 {
        return Err(MarketplaceError::InstallError(format!(
            "multiple interrupted updates exist for {}; backups preserved for explicit recovery",
            new_listing.id
        )));
    }

    // Validate every automatically removable residue before mutating anything.
    // Backups are validated separately because a crash can happen between the
    // first rename and writing their owner marker; in that window the matching
    // staging owner is the transaction provenance.
    for (transaction, residues) in &grouped {
        for residue in residues {
            match residue.kind {
                ResidueKind::Staging => {
                    validate_owned_tree(&residue.path)?;
                    verify_update_owner(&residue.path, &new_listing.id, Some(*transaction)).await?;
                }
                ResidueKind::Obsolete => {
                    validate_owned_tree(&residue.path)?;
                    verify_update_owner(&residue.path, &new_listing.id, Some(*transaction)).await?;
                    verify_manifest_id(&residue.path, &new_listing.id).await?;
                }
                ResidueKind::Backup => {
                    validate_owned_tree(&residue.path)?;
                    verify_manifest(&residue.path, &installed.listing_id, &installed.version)
                        .await?;
                }
            }
        }
    }

    if let Some(transaction) = backup_transactions.first() {
        let residues = grouped
            .get(transaction)
            .expect("transaction came from grouped residues");
        let backup = residues
            .iter()
            .find(|residue| residue.kind == ResidueKind::Backup)
            .ok_or_else(|| MarketplaceError::Internal("backup residue disappeared".to_string()))?;
        let staging = residues
            .iter()
            .find(|residue| residue.kind == ResidueKind::Staging)
            .map(|residue| residue.path.as_path());

        verify_backup_provenance(
            &backup.path,
            staging,
            &paths.canonical,
            &new_listing.id,
            *transaction,
        )
        .await?;
        restore_backup(
            installed,
            &paths.canonical,
            &backup.path,
            staging,
            *transaction,
        )
        .await?;
        grouped.remove(transaction);
    }

    if !path_exists(&paths.canonical).await? {
        return Err(MarketplaceError::InstallError(format!(
            "installed extension {} is missing and no valid backup can restore it",
            installed.listing_id
        )));
    }
    validate_owned_tree(&paths.canonical)?;
    let canonical_matches_installed =
        manifest_matches(&paths.canonical, &installed.listing_id, &installed.version).await?;
    let canonical_matches_new =
        manifest_matches(&paths.canonical, &new_listing.id, &new_listing.version).await?;

    let obsolete: Vec<&UpdateResidue> = grouped
        .values()
        .flat_map(|residues| residues.iter())
        .filter(|residue| residue.kind == ResidueKind::Obsolete)
        .collect();

    if !canonical_matches_installed {
        if canonical_matches_new && installed.version != new_listing.version && obsolete.len() == 1
        {
            // The filesystem crossed the durable backup->obsolete commit point,
            // but the process stopped before MarketplaceService advanced the
            // registry. Never roll this state back: validate the obsolete tree
            // as the registered old version, clean transaction residues on a
            // best-effort basis, and report success so the registry catches up.
            verify_manifest(&obsolete[0].path, &installed.listing_id, &installed.version).await?;
            cleanup_recovered_canonical_owner(&paths.canonical, &new_listing.id).await?;
            for residues in grouped.values() {
                for residue in residues {
                    cleanup_committed_residue(residue, &new_listing.id).await?;
                }
            }
            return Ok(RecoveryOutcome::AlreadyCommitted);
        }

        return Err(MarketplaceError::InstallError(format!(
            "canonical extension {} does not match registered version {}; update residues preserved",
            installed.listing_id, installed.version
        )));
    }

    cleanup_recovered_canonical_owner(&paths.canonical, &new_listing.id).await?;

    for (transaction, residues) in grouped {
        for residue in residues {
            match residue.kind {
                ResidueKind::Staging => {
                    verify_update_owner(&residue.path, &new_listing.id, Some(transaction)).await?;
                    safe_remove_owned_tree(&residue.path).await?;
                }
                ResidueKind::Backup => {
                    return Err(MarketplaceError::InstallError(format!(
                        "unrecovered backup remains at {}",
                        residue.path.display()
                    )));
                }
                ResidueKind::Obsolete => {
                    verify_update_owner(&residue.path, &new_listing.id, Some(transaction)).await?;
                    if let Err(error) = safe_remove_owned_tree(&residue.path).await {
                        warn!(
                            "Could not clean obsolete extension update residue {} for {}: {}",
                            residue.path.display(),
                            new_listing.id,
                            error
                        );
                    }
                }
            }
        }
    }
    Ok(RecoveryOutcome::Continue)
}

async fn verify_backup_provenance(
    backup: &Path,
    staging: Option<&Path>,
    canonical: &Path,
    extension_id: &str,
    transaction: Uuid,
) -> Result<(), MarketplaceError> {
    if verify_update_owner(backup, extension_id, Some(transaction))
        .await
        .is_ok()
    {
        return Ok(());
    }
    if let Some(staging) = staging {
        if verify_update_owner(staging, extension_id, Some(transaction))
            .await
            .is_ok()
        {
            return Ok(());
        }
    }
    if path_exists(canonical).await? {
        validate_owned_tree(canonical)?;
        if verify_update_owner(canonical, extension_id, Some(transaction))
            .await
            .is_ok()
        {
            return Ok(());
        }
    }
    Err(MarketplaceError::InstallError(format!(
        "backup at {} has no valid ownership provenance; preserved for explicit recovery",
        backup.display()
    )))
}

async fn cleanup_recovered_canonical_owner(
    canonical: &Path,
    extension_id: &str,
) -> Result<(), MarketplaceError> {
    let owner_path = canonical.join(UPDATE_OWNER_FILE);
    match fs::symlink_metadata(&owner_path).await {
        Ok(_) => {
            verify_update_owner(canonical, extension_id, None).await?;
            remove_update_owner_if_present(canonical).await
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(update_io_error(
            "inspect recovered update ownership marker",
            &owner_path,
            error,
        )),
    }
}

async fn cleanup_committed_residue(
    residue: &UpdateResidue,
    extension_id: &str,
) -> Result<(), MarketplaceError> {
    match residue.kind {
        ResidueKind::Staging | ResidueKind::Obsolete => {
            verify_update_owner(&residue.path, extension_id, Some(residue.transaction_id)).await?;
        }
        ResidueKind::Backup => {
            return Err(MarketplaceError::InstallError(format!(
                "refusing to clean rollback backup as committed residue at {}",
                residue.path.display()
            )));
        }
    }
    if let Err(error) = safe_remove_owned_tree(&residue.path).await {
        warn!(
            "Committed update for {} retained validated {:?} residue {}: {}",
            extension_id,
            residue.kind,
            residue.path.display(),
            error
        );
    }
    Ok(())
}

async fn find_update_residues(
    root: &Path,
    extension_id: &str,
) -> Result<Vec<UpdateResidue>, MarketplaceError> {
    let prefix = format!(".{extension_id}.sorng-update-");
    let mut entries = fs::read_dir(root)
        .await
        .map_err(|error| update_io_error("scan managed extension root", root, error))?;
    let mut residues = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| update_io_error("read managed extension entry", root, error))?
    {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(rest) = name.strip_prefix(&prefix) else {
            continue;
        };
        let (transaction, kind) = if let Some(transaction) = rest.strip_suffix(".staging") {
            (transaction, ResidueKind::Staging)
        } else if let Some(transaction) = rest.strip_suffix(".backup") {
            (transaction, ResidueKind::Backup)
        } else if let Some(transaction) = rest.strip_suffix(".obsolete") {
            (transaction, ResidueKind::Obsolete)
        } else {
            continue;
        };
        let Ok(transaction_id) = Uuid::parse_str(transaction) else {
            continue;
        };
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .await
            .map_err(|error| update_io_error("inspect update residue", &path, error))?;
        if !metadata.is_dir() || is_symlink_or_reparse(&metadata) {
            return Err(MarketplaceError::InstallError(format!(
                "unsafe update residue at {}",
                path.display()
            )));
        }
        residues.push(UpdateResidue {
            transaction_id,
            kind,
            path,
        });
    }
    Ok(residues)
}

fn validate_owned_tree(root: &Path) -> Result<(), MarketplaceError> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| update_io_error("inspect extension tree", &path, error))?;
        if is_symlink_or_reparse(&metadata) {
            return Err(MarketplaceError::InstallError(format!(
                "refusing to traverse link or reparse point at {}",
                path.display()
            )));
        }
        if metadata.is_dir() {
            for entry in std::fs::read_dir(&path)
                .map_err(|error| update_io_error("read extension tree", &path, error))?
            {
                let entry = entry
                    .map_err(|error| update_io_error("read extension tree entry", &path, error))?;
                pending.push(entry.path());
            }
        }
    }
    Ok(())
}

async fn safe_remove_owned_tree(path: &Path) -> Result<(), MarketplaceError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) => {
            if !metadata.is_dir() || is_symlink_or_reparse(&metadata) {
                return Err(MarketplaceError::InstallError(format!(
                    "refusing to remove unsafe update path {}",
                    path.display()
                )));
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(update_io_error("inspect update cleanup path", path, error)),
    }
    validate_owned_tree(path)?;
    fs::remove_dir_all(path)
        .await
        .map_err(|error| update_io_error("remove owned update tree", path, error))
}

async fn path_exists(path: &Path) -> Result<bool, MarketplaceError> {
    match fs::symlink_metadata(path).await {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(update_io_error("inspect update path", path, error)),
    }
}

fn is_symlink_or_reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

fn update_io_error(action: &str, path: &Path, error: std::io::Error) -> MarketplaceError {
    MarketplaceError::InstallError(format!("{action} at {}: {error}", path.display()))
}

fn combine_errors(
    primary: MarketplaceError,
    context: &str,
    secondary: MarketplaceError,
) -> MarketplaceError {
    MarketplaceError::InstallError(format!("{primary}; {context} also failed: {secondary}"))
}

/// Verify a downloaded byte slice against an expected SHA-256 hex digest.
pub fn verify_download(data: &[u8], expected_sha256: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let hex = format!("{:x}", digest);
    hex.eq_ignore_ascii_case(expected_sha256)
}
