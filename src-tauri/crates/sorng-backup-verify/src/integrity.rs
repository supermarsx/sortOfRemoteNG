use chrono::Utc;
use log::{info, warn};
use sha2::{Digest, Sha256, Sha512};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use crate::error::{BackupVerifyError, Result};
use crate::types::{FileEntry, FileManifest, ManifestDiff};

// ─── IntegrityChecker ───────────────────────────────────────────────────────

/// File-integrity engine using SHA-256, SHA-512, and CRC32.
///
/// Walks directories to build file manifests, compares manifests to detect
/// additions / removals / modifications, and provides single-file hash helpers.
pub struct IntegrityChecker {
    buffer_size: usize,
}

impl IntegrityChecker {
    pub fn new() -> Self {
        Self {
            buffer_size: 64 * 1024, // 64 KiB read buffer
        }
    }

    /// Create a checker with a custom read-buffer size.
    pub fn with_buffer_size(buffer_size: usize) -> Self {
        Self {
            buffer_size: buffer_size.max(4096),
        }
    }

    // ── Manifest generation ────────────────────────────────────────────────

    /// Walk `root` and build a `FileManifest` keyed by relative path.
    /// `algorithm` should be `"sha256"`, `"sha512"`, or `"crc32"`.
    pub fn generate_manifest(&self, root: &Path) -> Result<FileManifest> {
        self.compute_manifest_path(root, "sha256")
    }

    /// Walk `root` with a specific hash algorithm and build a manifest.
    pub fn compute_manifest_path(&self, root: &Path, algorithm: &str) -> Result<FileManifest> {
        if !root.exists() {
            return Err(BackupVerifyError::integrity_error(format!(
                "Path does not exist: {:?}",
                root
            )));
        }

        let mut manifest = FileManifest::new(algorithm);
        self.walk_and_hash(root, root, algorithm, &mut manifest)?;

        info!(
            "Generated {} manifest for {:?} — {} entries",
            algorithm,
            root,
            manifest.entries.len()
        );
        Ok(manifest)
    }

    /// Recursively walk a directory, hashing every regular file.
    fn walk_and_hash(
        &self,
        root: &Path,
        dir: &Path,
        algorithm: &str,
        manifest: &mut FileManifest,
    ) -> Result<()> {
        let entries = std::fs::read_dir(dir).map_err(|e| {
            BackupVerifyError::integrity_error(format!("Cannot read dir {:?}: {}", dir, e))
        })?;

        for entry in entries {
            let entry = entry.map_err(|e| {
                BackupVerifyError::integrity_error(format!("Dir entry error in {:?}: {}", dir, e))
            })?;
            let path = entry.path();

            if path.is_dir() {
                self.walk_and_hash(root, &path, algorithm, manifest)?;
            } else if path.is_file() {
                let relative = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");

                let checksum = self.compute_checksum(&path, algorithm)?;
                let meta = std::fs::metadata(&path)?;
                let mtime = meta
                    .modified()
                    .map(|t| t.into())
                    .unwrap_or_else(|_| Utc::now());

                manifest.entries.insert(
                    relative,
                    FileEntry {
                        checksum,
                        size: meta.len(),
                        mtime,
                    },
                );
            }
        }
        Ok(())
    }

    // ── Manifest verification ──────────────────────────────────────────────

    /// Verify that a previously generated manifest still matches the files
    /// on disk at `root`.  Returns a diff describing any changes.
    pub fn verify_manifest(&self, manifest: &FileManifest, root: &Path) -> Result<ManifestDiff> {
        let current = self.compute_manifest_path(root, &manifest.algorithm)?;
        Ok(Self::compare_manifests(manifest, &current))
    }

    /// Compare two manifests and produce a diff.
    pub fn compare_manifests(old: &FileManifest, new: &FileManifest) -> ManifestDiff {
        let mut diff = ManifestDiff::new();

        // Check files in old manifest
        for (key, old_entry) in &old.entries {
            match new.entries.get(key) {
                Some(new_entry) => {
                    if old_entry.checksum != new_entry.checksum {
                        diff.modified.push(key.clone());
                    } else {
                        diff.unchanged_count += 1;
                    }
                }
                None => {
                    diff.removed.push(key.clone());
                }
            }
        }

        // Check for newly added files
        for key in new.entries.keys() {
            if !old.entries.contains_key(key) {
                diff.added.push(key.clone());
            }
        }

        diff
    }

    // ── Single-file hash helpers ───────────────────────────────────────────

    /// Compute a hash for a single file using the given algorithm.
    pub fn compute_checksum(&self, path: &Path, algorithm: &str) -> Result<String> {
        match algorithm {
            "sha256" => self.compute_sha256(path),
            "sha512" => self.compute_sha512(path),
            "crc32" => Ok(format!("{:08x}", self.compute_crc32(path)?)),
            _ => Err(BackupVerifyError::integrity_error(format!(
                "Unsupported algorithm: {}",
                algorithm
            ))),
        }
    }

    /// Compute the SHA-256 hex digest of a file.
    pub fn compute_sha256(&self, path: &Path) -> Result<String> {
        let mut file = std::fs::File::open(path).map_err(|e| {
            BackupVerifyError::integrity_error(format!("Cannot open {:?}: {}", path, e))
        })?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; self.buffer_size];
        loop {
            let n = file.read(&mut buf).map_err(|e| {
                BackupVerifyError::integrity_error(format!("Read error {:?}: {}", path, e))
            })?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Compute the SHA-512 hex digest of a file.
    pub fn compute_sha512(&self, path: &Path) -> Result<String> {
        let mut file = std::fs::File::open(path).map_err(|e| {
            BackupVerifyError::integrity_error(format!("Cannot open {:?}: {}", path, e))
        })?;
        let mut hasher = Sha512::new();
        let mut buf = vec![0u8; self.buffer_size];
        loop {
            let n = file.read(&mut buf).map_err(|e| {
                BackupVerifyError::integrity_error(format!("Read error {:?}: {}", path, e))
            })?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Compute the CRC-32 of a file.
    pub fn compute_crc32(&self, path: &Path) -> Result<u32> {
        let mut file = std::fs::File::open(path).map_err(|e| {
            BackupVerifyError::integrity_error(format!("Cannot open {:?}: {}", path, e))
        })?;
        let mut hasher = crc32fast::Hasher::new();
        let mut buf = vec![0u8; self.buffer_size];
        loop {
            let n = file.read(&mut buf).map_err(|e| {
                BackupVerifyError::integrity_error(format!("Read error {:?}: {}", path, e))
            })?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hasher.finalize())
    }

    /// Verify a single file's integrity against an expected hex hash (SHA-256).
    pub fn verify_file_integrity(&self, path: &Path, expected_hash: &str) -> Result<bool> {
        if !path.exists() {
            return Err(BackupVerifyError::integrity_error(format!(
                "File does not exist: {:?}",
                path
            )));
        }

        // Detect algorithm from hash length
        let algorithm = match expected_hash.len() {
            64 => "sha256",
            128 => "sha512",
            8 => "crc32",
            _ => "sha256",
        };

        let computed = self.compute_checksum(path, algorithm)?;
        Ok(computed == expected_hash)
    }

    // ── Batch helpers ──────────────────────────────────────────────────────

    /// Verify a set of files given a map of relative-path → expected-hash.
    /// Returns (passed, failed_paths).
    pub fn verify_batch(
        &self,
        root: &Path,
        expected: &HashMap<String, String>,
        algorithm: &str,
    ) -> Result<(u64, Vec<String>)> {
        let mut ok: u64 = 0;
        let mut failures = Vec::new();

        for (rel, hash) in expected {
            let full = root.join(rel);
            match self.compute_checksum(&full, algorithm) {
                Ok(computed) => {
                    if computed == *hash {
                        ok += 1;
                    } else {
                        failures.push(rel.clone());
                    }
                }
                Err(e) => {
                    warn!("Batch verify error for {}: {}", rel, e);
                    failures.push(rel.clone());
                }
            }
        }

        info!(
            "Batch verify on {:?}: {} ok, {} failed",
            root,
            ok,
            failures.len()
        );
        Ok((ok, failures))
    }

    /// Compute SHA-256 hashes for every regular file under `root`, returning
    /// a flat map of relative-path → hex digest.
    pub fn hash_directory(&self, root: &Path) -> Result<HashMap<String, String>> {
        let manifest = self.compute_manifest_path(root, "sha256")?;
        Ok(manifest
            .entries
            .into_iter()
            .map(|(k, v)| (k, v.checksum))
            .collect())
    }

    /// Persist a manifest as JSON next to the backup.
    pub fn save_manifest(&self, manifest: &FileManifest, dest: &Path) -> Result<()> {
        let data = serde_json::to_string_pretty(manifest)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(dest, data)?;
        info!("Saved manifest to {:?}", dest);
        Ok(())
    }

    /// Load a previously saved manifest from JSON.
    pub fn load_manifest(&self, path: &Path) -> Result<FileManifest> {
        let data = std::fs::read_to_string(path)?;
        let manifest: FileManifest = serde_json::from_str(&data)?;
        Ok(manifest)
    }
}

impl Default for IntegrityChecker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_compare_manifests_identical() {
        let mut m = FileManifest::new("sha256");
        m.entries.insert(
            "a.txt".into(),
            FileEntry {
                checksum: "abc123".into(),
                size: 100,
                mtime: Utc::now(),
            },
        );
        let diff = IntegrityChecker::compare_manifests(&m, &m);
        assert_eq!(diff.unchanged_count, 1);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn test_compare_manifests_changes() {
        let mut old = FileManifest::new("sha256");
        old.entries.insert(
            "a.txt".into(),
            FileEntry {
                checksum: "aaa".into(),
                size: 10,
                mtime: Utc::now(),
            },
        );
        old.entries.insert(
            "b.txt".into(),
            FileEntry {
                checksum: "bbb".into(),
                size: 20,
                mtime: Utc::now(),
            },
        );

        let mut new = FileManifest::new("sha256");
        new.entries.insert(
            "a.txt".into(),
            FileEntry {
                checksum: "aaa_changed".into(),
                size: 10,
                mtime: Utc::now(),
            },
        );
        new.entries.insert(
            "c.txt".into(),
            FileEntry {
                checksum: "ccc".into(),
                size: 30,
                mtime: Utc::now(),
            },
        );

        let diff = IntegrityChecker::compare_manifests(&old, &new);
        assert_eq!(diff.modified.len(), 1);
        assert_eq!(diff.removed.len(), 1);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.unchanged_count, 0);
    }

    #[test]
    fn test_default_buffer_size() {
        let checker = IntegrityChecker::new();
        assert_eq!(checker.buffer_size, 64 * 1024);
    }
}
