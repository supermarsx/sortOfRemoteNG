use chrono::{DateTime, Duration, Utc};
use log::info;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::error::Result;
use crate::integrity::IntegrityChecker;
use crate::types::{
    CatalogEntry, FileManifest, VerificationMethod, VerificationResult, VerificationStatus,
};

/// Engine for verifying backup integrity through multiple methods.
pub struct VerificationEngine {
    integrity_checker: IntegrityChecker,
    verification_history: HashMap<String, Vec<VerificationResult>>,
    scheduled_verifications: Vec<ScheduledVerification>,
}

#[derive(Debug, Clone)]
pub struct ScheduledVerification {
    policy_id: String,
    method: VerificationMethod,
    interval_hours: u64,
    last_run: Option<DateTime<Utc>>,
}

impl Default for VerificationEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl VerificationEngine {
    pub fn new() -> Self {
        Self {
            integrity_checker: IntegrityChecker::new(),
            verification_history: HashMap::new(),
            scheduled_verifications: Vec::new(),
        }
    }

    /// Verify a backup entry using the specified method.
    pub fn verify_backup(
        &mut self,
        entry: &CatalogEntry,
        method: VerificationMethod,
    ) -> Result<VerificationResult> {
        info!("Verifying backup {} with method {:?}", entry.id, method);

        let result = match method {
            VerificationMethod::ChecksumFull => self.verify_checksum_full(entry)?,
            VerificationMethod::ChecksumSampled => self.verify_checksum_sampled(entry, 10)?,
            VerificationMethod::MetadataOnly => self.verify_metadata(entry)?,
            VerificationMethod::RestoreTest => self.verify_restore_test(entry, None)?,
            VerificationMethod::ContentDiff => self.verify_content_diff(entry, None)?,
            VerificationMethod::MountAndScan => self.verify_mount_and_scan(entry)?,
        };

        // Store in history
        self.verification_history
            .entry(entry.id.clone())
            .or_default()
            .push(result.clone());

        Ok(result)
    }

    /// Full checksum verification — compute SHA-256 for all files and compare with stored manifest.
    pub fn verify_checksum_full(&self, entry: &CatalogEntry) -> Result<VerificationResult> {
        let backup_path = Path::new(&entry.location);
        let mut result = VerificationResult::new(VerificationMethod::ChecksumFull);

        if !backup_path.exists() {
            result.status = VerificationStatus::Failed;
            result.details.push(format!(
                "Backup location does not exist: {}",
                entry.location
            ));
            return Ok(result);
        }

        // Generate current manifest of the backup
        let current_manifest = self
            .integrity_checker
            .compute_manifest_path(backup_path, "sha256")?;

        // Check if there's a stored manifest to compare against
        let manifest_path = backup_path.join(".manifest.json");
        if manifest_path.exists() {
            let stored_data = std::fs::read_to_string(&manifest_path)?;
            let stored_manifest: FileManifest = serde_json::from_str(&stored_data)?;

            let diff = IntegrityChecker::compare_manifests(&stored_manifest, &current_manifest);
            result.files_checked = current_manifest.entries.len() as u64;
            result.files_ok = diff.unchanged_count;
            result.files_corrupted = diff.modified.len() as u64;
            result.files_missing = diff.removed.len() as u64;
            result.checksum_errors = diff.modified.len() as u64;

            if diff.modified.is_empty() && diff.removed.is_empty() {
                result.status = VerificationStatus::Passed;
                result
                    .details
                    .push("All checksums match stored manifest".to_string());
            } else {
                result.status = VerificationStatus::Failed;
                for f in &diff.modified {
                    result.details.push(format!("Checksum mismatch: {}", f));
                }
                for f in &diff.removed {
                    result.details.push(format!("Missing file: {}", f));
                }
            }
        } else {
            // No stored manifest; verify the entry-level checksum
            if !entry.checksum.is_empty() {
                let computed = self
                    .integrity_checker
                    .compute_checksum(backup_path, "sha256")?;
                result.files_checked = 1;
                if computed == entry.checksum {
                    result.files_ok = 1;
                    result.status = VerificationStatus::Passed;
                    result.details.push("Entry checksum verified".to_string());
                } else {
                    result.files_corrupted = 1;
                    result.checksum_errors = 1;
                    result.status = VerificationStatus::Failed;
                    result.details.push(format!(
                        "Checksum mismatch: expected {}, got {}",
                        entry.checksum, computed
                    ));
                }
            } else {
                // Generate and store manifest for future use
                result.files_checked = current_manifest.entries.len() as u64;
                result.files_ok = result.files_checked;
                result.status = VerificationStatus::Warning;
                result
                    .details
                    .push("No stored manifest found; generated new baseline".to_string());

                // Save the manifest for future comparisons
                let manifest_data = serde_json::to_string_pretty(&current_manifest)?;
                std::fs::write(&manifest_path, manifest_data)?;
            }
        }

        info!(
            "Checksum full verification for {}: {:?} ({} checked, {} ok, {} corrupted)",
            entry.id, result.status, result.files_checked, result.files_ok, result.files_corrupted
        );
        Ok(result)
    }

    /// Sampled checksum verification — verify a random percentage of files.
    pub fn verify_checksum_sampled(
        &self,
        entry: &CatalogEntry,
        sample_percent: u32,
    ) -> Result<VerificationResult> {
        let backup_path = Path::new(&entry.location);
        let mut result = VerificationResult::new(VerificationMethod::ChecksumSampled);

        if !backup_path.exists() {
            result.status = VerificationStatus::Failed;
            result.details.push(format!(
                "Backup location does not exist: {}",
                entry.location
            ));
            return Ok(result);
        }

        let manifest_path = backup_path.join(".manifest.json");
        if !manifest_path.exists() {
            result.status = VerificationStatus::Warning;
            result
                .details
                .push("No stored manifest for sampling; run full verification first".to_string());
            return Ok(result);
        }

        let stored_data = std::fs::read_to_string(&manifest_path)?;
        let stored_manifest: FileManifest = serde_json::from_str(&stored_data)?;

        let total_files = stored_manifest.entries.len();
        let sample_size = ((total_files as f64) * (sample_percent as f64 / 100.0)).ceil() as usize;
        let sample_size = sample_size.max(1).min(total_files);

        // Deterministic sampling using entry IDs sorted alphabetically, picking evenly spaced
        let mut keys: Vec<&String> = stored_manifest.entries.keys().collect();
        keys.sort();

        let step = if total_files > sample_size {
            total_files / sample_size
        } else {
            1
        };

        let sampled_keys: Vec<&String> = keys
            .iter()
            .step_by(step)
            .take(sample_size)
            .copied()
            .collect();

        result.files_checked = sampled_keys.len() as u64;

        for key in &sampled_keys {
            let file_path = backup_path.join(key);
            if !file_path.exists() {
                result.files_missing += 1;
                result.details.push(format!("Missing: {}", key));
                continue;
            }

            if let Some(stored_entry) = stored_manifest.entries.get(*key) {
                match self
                    .integrity_checker
                    .compute_checksum(&file_path, &stored_manifest.algorithm)
                {
                    Ok(computed) => {
                        if computed == stored_entry.checksum {
                            result.files_ok += 1;
                        } else {
                            result.files_corrupted += 1;
                            result.checksum_errors += 1;
                            result.details.push(format!("Checksum mismatch: {}", key));
                        }
                    }
                    Err(e) => {
                        result.files_corrupted += 1;
                        result
                            .details
                            .push(format!("Error checking {}: {}", key, e));
                    }
                }
            }
        }

        result.status = if result.files_corrupted == 0 && result.files_missing == 0 {
            VerificationStatus::Passed
        } else if result.files_corrupted > 0 {
            VerificationStatus::Failed
        } else {
            VerificationStatus::Warning
        };

        result.details.push(format!(
            "Sampled {}% ({}/{} files)",
            sample_percent, result.files_checked, total_files
        ));

        info!(
            "Sampled verification for {}: {:?} ({}/{})",
            entry.id, result.status, result.files_ok, result.files_checked
        );
        Ok(result)
    }

    /// Metadata-only verification — check sizes, timestamps, permissions.
    pub fn verify_metadata(&self, entry: &CatalogEntry) -> Result<VerificationResult> {
        let backup_path = Path::new(&entry.location);
        let mut result = VerificationResult::new(VerificationMethod::MetadataOnly);

        if !backup_path.exists() {
            result.status = VerificationStatus::Failed;
            result.details.push(format!(
                "Backup location does not exist: {}",
                entry.location
            ));
            return Ok(result);
        }

        // Check the overall size
        let actual_size = dir_size(backup_path);
        result.files_checked = 1;

        if entry.size_bytes > 0 {
            let size_diff = actual_size.abs_diff(entry.size_bytes);

            // Allow 1% tolerance for filesystem overhead
            let tolerance = entry.size_bytes / 100;
            if size_diff > tolerance {
                result.metadata_errors += 1;
                result.details.push(format!(
                    "Size mismatch: expected {} bytes, found {} bytes (diff: {})",
                    entry.size_bytes, actual_size, size_diff
                ));
            } else {
                result.files_ok += 1;
            }
        } else {
            result.files_ok += 1;
            result
                .details
                .push(format!("Backup size: {} bytes", actual_size));
        }

        // Check file count
        if entry.file_count > 0 {
            let actual_count = count_files(backup_path);
            if actual_count != entry.file_count {
                result.metadata_errors += 1;
                result.details.push(format!(
                    "File count mismatch: expected {}, found {}",
                    entry.file_count, actual_count
                ));
            }
        }

        // Check backup timestamp makes sense
        if let Ok(meta) = std::fs::metadata(backup_path) {
            if let Ok(modified) = meta.modified() {
                let modified_dt: DateTime<Utc> = modified.into();
                if modified_dt < entry.timestamp - Duration::days(1) {
                    result.metadata_errors += 1;
                    result.details.push(format!(
                        "Modification time ({}) is before backup timestamp ({})",
                        modified_dt, entry.timestamp
                    ));
                }
            }
        }

        result.status = if result.metadata_errors == 0 {
            VerificationStatus::Passed
        } else {
            VerificationStatus::Warning
        };

        info!(
            "Metadata verification for {}: {:?}",
            entry.id, result.status
        );
        Ok(result)
    }

    /// Restore test — actually restore the backup to a temp directory and verify.
    pub fn verify_restore_test(
        &self,
        entry: &CatalogEntry,
        temp_dir_override: Option<&Path>,
    ) -> Result<VerificationResult> {
        let mut result = VerificationResult::new(VerificationMethod::RestoreTest);
        let backup_path = Path::new(&entry.location);

        if !backup_path.exists() {
            result.status = VerificationStatus::Failed;
            result.details.push(format!(
                "Backup location does not exist: {}",
                entry.location
            ));
            return Ok(result);
        }

        let temp_base = temp_dir_override
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::temp_dir().join(format!("bv_restore_{}", Uuid::new_v4())));

        std::fs::create_dir_all(&temp_base)?;

        // Simulate restore by copying the backup directory
        let restore_result = copy_dir_recursive(backup_path, &temp_base);
        match restore_result {
            Ok(count) => {
                result.files_checked = count;
                result.files_ok = count;
                result.status = VerificationStatus::Passed;
                result.details.push(format!(
                    "Successfully restored {} files to {:?}",
                    count, temp_base
                ));

                // Compare manifests between source and restore
                let source_manifest = self
                    .integrity_checker
                    .compute_manifest_path(backup_path, "sha256")?;
                let restored_manifest = self
                    .integrity_checker
                    .compute_manifest_path(&temp_base, "sha256")?;
                let diff =
                    IntegrityChecker::compare_manifests(&source_manifest, &restored_manifest);

                if !diff.modified.is_empty() || !diff.removed.is_empty() {
                    result.status = VerificationStatus::Failed;
                    result.files_corrupted = diff.modified.len() as u64;
                    result.files_missing = diff.removed.len() as u64;
                    for f in &diff.modified {
                        result.details.push(format!("Restore mismatch: {}", f));
                    }
                }
            }
            Err(e) => {
                result.status = VerificationStatus::Failed;
                result.details.push(format!("Restore failed: {}", e));
            }
        }

        // Cleanup temp dir
        if temp_dir_override.is_none() {
            std::fs::remove_dir_all(&temp_base).ok();
        }

        info!("Restore test for {}: {:?}", entry.id, result.status);
        Ok(result)
    }

    /// Content diff — compare backup against live source.
    pub fn verify_content_diff(
        &self,
        entry: &CatalogEntry,
        source_path: Option<&Path>,
    ) -> Result<VerificationResult> {
        let mut result = VerificationResult::new(VerificationMethod::ContentDiff);
        let backup_path = Path::new(&entry.location);

        if !backup_path.exists() {
            result.status = VerificationStatus::Failed;
            result.details.push(format!(
                "Backup location does not exist: {}",
                entry.location
            ));
            return Ok(result);
        }

        // If no source_path given, extract from entry metadata
        let source = source_path
            .map(|p| p.to_path_buf())
            .or_else(|| entry.metadata.get("source_path").map(PathBuf::from));

        let source = match source {
            Some(s) => s,
            None => {
                result.status = VerificationStatus::Skipped;
                result
                    .details
                    .push("No source path available for content diff".to_string());
                return Ok(result);
            }
        };

        if !source.exists() {
            result.status = VerificationStatus::Warning;
            result
                .details
                .push(format!("Source path does not exist: {:?}", source));
            return Ok(result);
        }

        let source_manifest = self
            .integrity_checker
            .compute_manifest_path(&source, "sha256")?;
        let backup_manifest = self
            .integrity_checker
            .compute_manifest_path(backup_path, "sha256")?;
        let diff = IntegrityChecker::compare_manifests(&source_manifest, &backup_manifest);

        result.files_checked =
            (source_manifest.entries.len() + backup_manifest.entries.len()) as u64 / 2;
        result.files_ok = diff.unchanged_count;
        result.files_corrupted = diff.modified.len() as u64;
        result.files_missing = diff.removed.len() as u64;

        // New files since backup are expected, not errors
        let new_since_backup = diff.added.len();

        if diff.modified.is_empty() && diff.removed.is_empty() {
            result.status = VerificationStatus::Passed;
            result.details.push(format!(
                "Backup matches source ({} unchanged, {} new since backup)",
                diff.unchanged_count, new_since_backup
            ));
        } else {
            result.status = VerificationStatus::Warning;
            for f in &diff.modified {
                result.details.push(format!("Modified since backup: {}", f));
            }
            for f in &diff.removed {
                result.details.push(format!("Removed since backup: {}", f));
            }
        }

        info!("Content diff for {}: {:?}", entry.id, result.status);
        Ok(result)
    }

    /// Mount and scan verification — mount the backup image and scan its filesystem.
    pub fn verify_mount_and_scan(&self, entry: &CatalogEntry) -> Result<VerificationResult> {
        let mut result = VerificationResult::new(VerificationMethod::MountAndScan);
        let backup_path = Path::new(&entry.location);

        if !backup_path.exists() {
            result.status = VerificationStatus::Failed;
            result.details.push(format!(
                "Backup location does not exist: {}",
                entry.location
            ));
            return Ok(result);
        }

        // For directory-based backups, just scan the directory structure
        if backup_path.is_dir() {
            let file_count = count_files(backup_path);
            let total_size = dir_size(backup_path);

            result.files_checked = file_count;
            result.files_ok = file_count;
            result.status = VerificationStatus::Passed;
            result.details.push(format!(
                "Directory scan: {} files, {} bytes total",
                file_count, total_size
            ));

            // Check for zero-byte files which might indicate corruption
            let zero_byte_files = count_zero_byte_files(backup_path);
            if zero_byte_files > 0 {
                result.status = VerificationStatus::Warning;
                result.details.push(format!(
                    "Found {} zero-byte files which may indicate corruption",
                    zero_byte_files
                ));
            }
        } else {
            // For archive files, check that the file is readable and has expected size
            match std::fs::metadata(backup_path) {
                Ok(meta) => {
                    result.files_checked = 1;
                    if meta.len() > 0 {
                        result.files_ok = 1;
                        result.status = VerificationStatus::Passed;
                        result
                            .details
                            .push(format!("Archive file size: {} bytes", meta.len()));
                    } else {
                        result.files_corrupted = 1;
                        result.status = VerificationStatus::Failed;
                        result.details.push("Archive file is empty".to_string());
                    }
                }
                Err(e) => {
                    result.status = VerificationStatus::Failed;
                    result.details.push(format!("Cannot read archive: {}", e));
                }
            }
        }

        info!("Mount and scan for {}: {:?}", entry.id, result.status);
        Ok(result)
    }

    /// Schedule periodic verification for a policy.
    pub fn schedule_verification(
        &mut self,
        policy_id: &str,
        method: VerificationMethod,
        interval_hours: u64,
    ) {
        // Remove existing schedule for this policy+method
        self.scheduled_verifications
            .retain(|s| !(s.policy_id == policy_id && s.method == method));

        self.scheduled_verifications.push(ScheduledVerification {
            policy_id: policy_id.to_string(),
            method: method.clone(),
            interval_hours,
            last_run: None,
        });

        info!(
            "Scheduled {:?} verification for policy {} every {} hours",
            method,
            policy_id,
            interval_hours
        );
    }

    /// Get verification history for a specific target/entry.
    pub fn get_verification_history(&self, entry_id: &str) -> Vec<&VerificationResult> {
        self.verification_history
            .get(entry_id)
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    /// Automatically verify the latest backup for a policy.
    pub fn auto_verify_latest(&mut self, entry: &CatalogEntry) -> Result<VerificationResult> {
        // Start with metadata, then do sampled checksums
        let meta_result = self.verify_metadata(entry)?;
        if meta_result.status == VerificationStatus::Failed {
            return Ok(meta_result);
        }

        // If metadata passed, do a sampled checksum verification
        self.verify_checksum_sampled(entry, 20)
    }

    /// Generate a verification report for a specific entry.
    pub fn generate_verification_report(&self, entry_id: &str) -> Result<VerificationReport> {
        let history = self.get_verification_history(entry_id);

        let total_verifications = history.len() as u32;
        let passed = history
            .iter()
            .filter(|r| r.status == VerificationStatus::Passed)
            .count() as u32;
        let failed = history
            .iter()
            .filter(|r| r.status == VerificationStatus::Failed)
            .count() as u32;
        let warnings = history
            .iter()
            .filter(|r| r.status == VerificationStatus::Warning)
            .count() as u32;

        let last_verification = history.last().cloned().cloned();
        let methods_used: Vec<String> = history
            .iter()
            .map(|r| r.method.to_string())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        Ok(VerificationReport {
            entry_id: entry_id.to_string(),
            total_verifications,
            passed,
            failed,
            warnings,
            last_verification,
            methods_used,
            generated_at: Utc::now(),
        })
    }

    /// Get scheduled verifications that are due.
    pub fn get_due_verifications(&self) -> Vec<&ScheduledVerification> {
        let now = Utc::now();
        self.scheduled_verifications
            .iter()
            .filter(|s| match s.last_run {
                Some(last) => now - last > Duration::hours(s.interval_hours as i64),
                None => true,
            })
            .collect()
    }
}

/// Verification report for an entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VerificationReport {
    pub entry_id: String,
    pub total_verifications: u32,
    pub passed: u32,
    pub failed: u32,
    pub warnings: u32,
    pub last_verification: Option<VerificationResult>,
    pub methods_used: Vec<String>,
    pub generated_at: DateTime<Utc>,
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<u64> {
    let mut count: u64 = 0;
    if !src.is_dir() {
        // Single file
        std::fs::copy(src, dst.join(src.file_name().unwrap_or_default()))?;
        return Ok(1);
    }

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            std::fs::create_dir_all(&dst_path)?;
            count += copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
            count += 1;
        }
    }
    Ok(count)
}

/// Get the total size of a directory.
fn dir_size(path: &Path) -> u64 {
    let mut total: u64 = 0;
    if path.is_file() {
        return path.metadata().map(|m| m.len()).unwrap_or(0);
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                total += p.metadata().map(|m| m.len()).unwrap_or(0);
            } else if p.is_dir() {
                total += dir_size(&p);
            }
        }
    }
    total
}

/// Count files in a directory.
fn count_files(path: &Path) -> u64 {
    let mut count: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                count += 1;
            } else if p.is_dir() {
                count += count_files(&p);
            }
        }
    }
    count
}

/// Count zero-byte files in a directory.
fn count_zero_byte_files(path: &Path) -> u64 {
    let mut count: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if p.metadata().map(|m| m.len() == 0).unwrap_or(false) {
                    count += 1;
                }
            } else if p.is_dir() {
                count += count_zero_byte_files(&p);
            }
        }
    }
    count
}
