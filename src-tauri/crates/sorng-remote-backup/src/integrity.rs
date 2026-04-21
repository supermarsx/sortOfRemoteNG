//! File integrity verification — checksum generation, manifest creation, verification.

use crate::error::BackupError;
use crate::types::{ChecksumAlgorithm, IntegrityCheckResult, IntegrityError, IntegrityErrorType};
use blake2::Blake2b512;
use chrono::Utc;
use log::{debug, info, warn};
use md5::Md5;
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;
use tokio::io::AsyncReadExt;
use xxhash_rust::xxh64::Xxh64;

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
    let mut buf = vec![0u8; 64 * 1024];

    match algorithm {
        ChecksumAlgorithm::Md5 => hash_stream::<Md5, _>(&mut file, &mut buf).await,
        ChecksumAlgorithm::Sha1 => hash_stream::<Sha1, _>(&mut file, &mut buf).await,
        ChecksumAlgorithm::Sha256 => hash_stream::<Sha256, _>(&mut file, &mut buf).await,
        ChecksumAlgorithm::Sha512 => hash_stream::<Sha512, _>(&mut file, &mut buf).await,
        ChecksumAlgorithm::Blake2b => hash_stream::<Blake2b512, _>(&mut file, &mut buf).await,
        ChecksumAlgorithm::Xxhash => hash_stream_xxh64(&mut file, &mut buf).await,
    }
}

/// Stream `reader` through a RustCrypto `Digest` and return the lowercase-hex digest.
async fn hash_stream<D, R>(reader: &mut R, buf: &mut [u8]) -> Result<String, BackupError>
where
    D: Digest,
    R: AsyncReadExt + Unpin,
{
    let mut hasher = D::new();
    loop {
        let n = reader
            .read(buf)
            .await
            .map_err(|e| BackupError::IoError(format!("read error: {e}")))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Stream `reader` through XXH64 (seed 0) and return the 16-char lowercase-hex digest,
/// matching the default `xxhsum` CLI output.
async fn hash_stream_xxh64<R>(reader: &mut R, buf: &mut [u8]) -> Result<String, BackupError>
where
    R: AsyncReadExt + Unpin,
{
    let mut hasher = Xxh64::new(0);
    loop {
        let n = reader
            .read(buf)
            .await
            .map_err(|e| BackupError::IoError(format!("read error: {e}")))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:016x}", hasher.digest()))
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
    info!(
        "Verifying {} files against manifest",
        manifest.entries.len()
    );
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
pub async fn save_manifest(manifest: &ChecksumManifest, path: &Path) -> Result<(), BackupError> {
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

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    // Digests of a known input, verified against the CLI tools the previous
    // subprocess implementation shelled out to. The expected values below are
    // what `md5sum`, `sha1sum`, `sha256sum`, `sha512sum`, `b2sum` (default
    // BLAKE2b-512) and `xxhsum` (default XXH64, seed 0) produce for the
    // 43-byte input "The quick brown fox jumps over the lazy dog".
    const FOX: &[u8] = b"The quick brown fox jumps over the lazy dog";

    async fn checksum_bytes(data: &[u8], algo: ChecksumAlgorithm) -> String {
        let mut tmp = NamedTempFile::new().expect("temp file");
        tmp.write_all(data).expect("write");
        tmp.flush().expect("flush");
        checksum_file(tmp.path(), &algo).await.expect("checksum")
    }

    #[tokio::test]
    async fn md5_matches_md5sum() {
        assert_eq!(
            checksum_bytes(FOX, ChecksumAlgorithm::Md5).await,
            "9e107d9d372bb6826bd81d3542a419d6"
        );
    }

    #[tokio::test]
    async fn sha1_matches_sha1sum() {
        assert_eq!(
            checksum_bytes(FOX, ChecksumAlgorithm::Sha1).await,
            "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12"
        );
    }

    #[tokio::test]
    async fn sha256_matches_sha256sum() {
        assert_eq!(
            checksum_bytes(FOX, ChecksumAlgorithm::Sha256).await,
            "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
        );
    }

    #[tokio::test]
    async fn sha512_matches_sha512sum() {
        assert_eq!(
            checksum_bytes(FOX, ChecksumAlgorithm::Sha512).await,
            "07e547d9586f6a73f73fbac0435ed76951218fb7d0c8d788a309d785436bbb642e93a252a954f23912547d1e8a3b5ed6e1bfd7097821233fa0538f3db854fee6"
        );
    }

    #[tokio::test]
    async fn blake2b_matches_b2sum() {
        assert_eq!(
            checksum_bytes(FOX, ChecksumAlgorithm::Blake2b).await,
            "a8add4bdddfd93e4877d2746e62817b116364a1fa7bc148d95090bc7333b3673f82401cf7aa2e4cb1ecd90296e3f14cb5413f8ed77be73045b13914cdcd6a918"
        );
    }

    #[tokio::test]
    async fn xxh64_matches_xxhsum() {
        // xxhsum default is XXH64 seed 0, printed as 16 lowercase hex chars.
        assert_eq!(
            checksum_bytes(FOX, ChecksumAlgorithm::Xxhash).await,
            "0b242d361fda71bc"
        );
    }

    #[tokio::test]
    async fn streams_larger_than_buffer() {
        // Exercise the read loop with an input bigger than the 64 KiB buffer,
        // confirming the streaming path produces the same digest as a single
        // update would.
        let data = vec![0xABu8; 200 * 1024];
        let mut expected = Sha256::new();
        expected.update(&data);
        let expected_hex = format!("{:x}", expected.finalize());
        assert_eq!(
            checksum_bytes(&data, ChecksumAlgorithm::Sha256).await,
            expected_hex
        );
    }
}
