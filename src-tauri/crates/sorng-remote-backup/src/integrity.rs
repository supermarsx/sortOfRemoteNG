//! File integrity verification — checksum generation, manifest creation, verification.

use crate::error::BackupError;
use crate::types::{
    ChecksumAlgorithm, IntegrityCheckResult, IntegrityError, IntegrityErrorType,
};
use chrono::Utc;
use log::{debug, info, warn};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;
use tokio::io::AsyncReadExt;

/// A checksum manifest mapping file paths to their checksums.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChecksumManifest {
    pub algorithm: ChecksumAlgorithm,
    pub created_at: chrono::DateTime<Utc>,
    pub base_path: String,
    pub entries: HashMap<String, String>,
}

/// Generate a checksum for a single file.
pub async fn checksum_file(
    path: &Path,
    algorithm: &ChecksumAlgorithm,
) -> Result<String, BackupError> {
    let mut file = fs::File::open(path)
        .await
        .map_err(|e| BackupError::IoError(format!("cannot open {}: {e}", path.display())))?;

    let hash = match algorithm {
        ChecksumAlgorithm::Sha256 => {
            let mut hasher = Sha256::new();
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = file
                    .read(&mut buf)
                    .await
                    .map_err(|e| BackupError::IoError(format!("read error: {e}")))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
            }
            format!("{:x}", hasher.finalize())
        }
        // For other algorithms we delegate to external commands
        _ => {
            let cmd = match algorithm {
                ChecksumAlgorithm::Md5 => "md5sum",
                ChecksumAlgorithm::Sha1 => "sha1sum",
                ChecksumAlgorithm::Sha512 => "sha512sum",
                ChecksumAlgorithm::Blake2b => "b2sum",
                ChecksumAlgorithm::Xxhash => "xxhsum",
                ChecksumAlgorithm::Sha256 => unreachable!(),
            };
            let output = tokio::process::Command::new(cmd)
                .arg(path.as_os_str())
                .output()
                .await
                .map_err(|e| {
                    BackupError::ProcessError(format!("failed to run {cmd}: {e}"))
                })?;
            if !output.status.success() {
                return Err(BackupError::IntegrityError(format!(
                    "{cmd} failed for {}",
                    path.display()
                )));
            }
            String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string()
        }
    };

    Ok(hash)
}

/// Generate a manifest for all files under a directory.
pub async fn generate_manifest(
    base_path: &Path,
    algorithm: &ChecksumAlgorithm,
    exclude: &[String],
) -> Result<ChecksumManifest, BackupError> {
    info!("Generating checksum manifest for {}", base_path.display());
    let mut entries = HashMap::new();
    let mut stack = vec![base_path.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut read_dir = fs::read_dir(&dir)
            .await
            .map_err(|e| BackupError::IoError(format!("cannot read dir {}: {e}", dir.display())))?;

        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let path = entry.path();
            let relative = path
                .strip_prefix(base_path)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();

            // Check excludes
            if exclude.iter().any(|ex| relative.contains(ex)) {
                continue;
            }

            let metadata = entry
                .metadata()
                .await
                .map_err(|e| BackupError::IoError(format!("metadata error: {e}")))?;

            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file() {
                debug!("Checksumming: {relative}");
                match checksum_file(&path, algorithm).await {
                    Ok(hash) => {
                        entries.insert(relative, hash);
                    }
                    Err(e) => {
                        warn!("Failed to checksum {}: {e}", path.display());
                    }
                }
            }
        }
    }

    Ok(ChecksumManifest {
        algorithm: algorithm.clone(),
        created_at: Utc::now(),
        base_path: base_path.to_string_lossy().to_string(),
        entries,
    })
}

/// Verify files against a manifest.
pub async fn verify_manifest(
    manifest: &ChecksumManifest,
    base_path: &Path,
    job_id: &str,
) -> Result<IntegrityCheckResult, BackupError> {
    info!("Verifying {} files against manifest", manifest.entries.len());
    let start = std::time::Instant::now();

    let mut verified_ok: u64 = 0;
    let mut mismatched: u64 = 0;
    let mut missing: u64 = 0;
    let mut errors = Vec::new();

    for (relative, expected_hash) in &manifest.entries {
        let full_path = base_path.join(relative);

        if !full_path.exists() {
            missing += 1;
            errors.push(IntegrityError {
                path: relative.clone(),
                error_type: IntegrityErrorType::FileMissing,
                expected: Some(expected_hash.clone()),
                actual: None,
            });
            continue;
        }

        match checksum_file(&full_path, &manifest.algorithm).await {
            Ok(actual_hash) => {
                if actual_hash == *expected_hash {
                    verified_ok += 1;
                } else {
                    mismatched += 1;
                    errors.push(IntegrityError {
                        path: relative.clone(),
                        error_type: IntegrityErrorType::ChecksumMismatch,
                        expected: Some(expected_hash.clone()),
                        actual: Some(actual_hash),
                    });
                }
            }
            Err(e) => {
                let err_type = if e.to_string().contains("permission") {
                    IntegrityErrorType::PermissionDenied
                } else {
                    IntegrityErrorType::ReadError
                };
                errors.push(IntegrityError {
                    path: relative.clone(),
                    error_type: err_type,
                    expected: Some(expected_hash.clone()),
                    actual: None,
                });
            }
        }
    }

    let duration = start.elapsed().as_secs_f64();

    Ok(IntegrityCheckResult {
        job_id: job_id.to_string(),
        checked_at: Utc::now(),
        total_files: manifest.entries.len() as u64,
        verified_ok,
        mismatched,
        missing,
        errors,
        algorithm: manifest.algorithm.clone(),
        duration_secs: duration,
    })
}

/// Save a manifest to a JSON file.
pub async fn save_manifest(
    manifest: &ChecksumManifest,
    path: &Path,
) -> Result<(), BackupError> {
    let json = serde_json::to_string_pretty(manifest)?;
    fs::write(path, json)
        .await
        .map_err(|e| BackupError::IoError(format!("failed to write manifest: {e}")))?;
    Ok(())
}

/// Load a manifest from a JSON file.
pub async fn load_manifest(path: &Path) -> Result<ChecksumManifest, BackupError> {
    let json = fs::read_to_string(path)
        .await
        .map_err(|e| BackupError::IoError(format!("failed to read manifest: {e}")))?;
    let manifest: ChecksumManifest = serde_json::from_str(&json)?;
    Ok(manifest)
}
