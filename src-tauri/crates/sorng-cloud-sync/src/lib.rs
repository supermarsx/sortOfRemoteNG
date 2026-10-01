//! Opaque application snapshots; provider modules never interpret/decrypt app data.
pub mod dav;
pub mod oauth;
pub mod sftp;
pub mod types;

use base64::Engine;
use types::{Blob, SyncError, Target, TransportOptions, Written};

fn validate(target: &Target, options: &TransportOptions) -> Result<(), SyncError> {
    options.validate()?;
    if target.id.trim().is_empty() || target.id.len() > 256 {
        return Err(SyncError::Invalid("Invalid sync target identifier.".into()));
    }
    Ok(())
}

pub async fn read(target: Target, options: TransportOptions) -> Result<Blob, SyncError> {
    validate(&target, &options)?;
    match target.provider.as_str() {
        "nextcloud" | "webdav" => dav::read(&target, &options).await,
        "googleDrive" | "oneDrive" => oauth::read(&target, &options).await,
        "sftp" => sftp::read(&target, &options).await,
        _ => Err(SyncError::Invalid(
            "Select a supported cloud sync provider.".into(),
        )),
    }
}

pub async fn write(
    target: Target,
    data: String,
    expected_revision: Option<String>,
    options: TransportOptions,
) -> Result<Written, SyncError> {
    validate(&target, &options)?;
    if data.len() > options.max_bytes.div_ceil(3) * 4 {
        return Err(SyncError::Invalid(
            "Sync upload exceeds the configured size limit.".into(),
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| SyncError::Invalid("Invalid sync payload encoding.".into()))?;
    if bytes.is_empty() || bytes.len() > options.max_bytes {
        return Err(SyncError::Invalid("Invalid sync payload size.".into()));
    }
    let revision = expected_revision.as_deref();
    match target.provider.as_str() {
        "nextcloud" | "webdav" => dav::write(&target, &bytes, revision, &options).await,
        "googleDrive" | "oneDrive" => oauth::write(&target, &bytes, revision, &options).await,
        "sftp" => sftp::write(&target, &bytes, revision, &options).await,
        _ => Err(SyncError::Invalid(
            "Select a supported cloud sync provider.".into(),
        )),
    }
}

pub async fn test(target: Target, options: TransportOptions) -> Result<(), SyncError> {
    validate(&target, &options)?;
    match target.provider.as_str() {
        "nextcloud" | "webdav" => dav::test(&target, &options).await,
        "googleDrive" | "oneDrive" => oauth::test(&target, &options).await,
        "sftp" => sftp::test(&target, &options).await,
        _ => Err(SyncError::Invalid(
            "Select a supported cloud sync provider.".into(),
        )),
    }
}
