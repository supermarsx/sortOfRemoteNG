use crate::error::{BackupVerifyError, Result};
use crate::types::{BackupMethod, CatalogEntry, CatalogFilter, VerificationResult};
use chrono::{DateTime, Utc};
use log::{info, warn};
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Persistent backup catalog managing all backup entries.
pub struct BackupCatalog {
    entries: HashMap<String, CatalogEntry>,
    persistence_path: PathBuf,
}

impl BackupCatalog {
    /// Create a new catalog with the given persistence path.
    pub fn new(persistence_path: PathBuf) -> Self {
        Self {
            entries: HashMap::new(),
            persistence_path,
        }
    }

    /// Load catalog from the persistence file.
    pub fn load(persistence_path: PathBuf) -> Result<Self> {
        if persistence_path.exists() {
            let data = std::fs::read_to_string(&persistence_path)?;
            let entries: HashMap<String, CatalogEntry> = serde_json::from_str(&data)?;
            info!(
                "Loaded {} catalog entries from {:?}",
                entries.len(),
                persistence_path
            );
            Ok(Self {
                entries,
                persistence_path,
            })
        } else {
            info!(
                "No existing catalog at {:?}, creating new",
                persistence_path
            );
            Ok(Self::new(persistence_path))
        }
    }

    /// Persist the catalog to disk.
    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.persistence_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(&self.entries)?;
        std::fs::write(&self.persistence_path, data)?;
        info!(
            "Saved {} catalog entries to {:?}",
            self.entries.len(),
            self.persistence_path
        );
        Ok(())
    }

    /// Add a new entry to the catalog.
    pub fn add_entry(&mut self, entry: CatalogEntry) -> Result<String> {
        let id = entry.id.clone();
        if self.entries.contains_key(&id) {
            return Err(BackupVerifyError::catalog_error(format!(
                "Catalog entry '{}' already exists",
                id
            )));
        }
        info!(
            "Adding catalog entry: {} (policy={}, target={})",
            id, entry.policy_id, entry.target_id
        );
        self.entries.insert(id.clone(), entry);
        self.save()?;
        Ok(id)
    }

    /// Update an existing catalog entry.
    pub fn update_entry(&mut self, entry: CatalogEntry) -> Result<()> {
        let id = entry.id.clone();
        if !self.entries.contains_key(&id) {
            return Err(BackupVerifyError::catalog_error(format!(
                "Catalog entry '{}' not found",
                id
            )));
        }
        self.entries.insert(id.clone(), entry);
        self.save()?;
        info!("Updated catalog entry: {}", id);
        Ok(())
    }

    /// Delete a catalog entry by ID.
    pub fn delete_entry(&mut self, entry_id: &str) -> Result<CatalogEntry> {
        let entry = self.entries.remove(entry_id).ok_or_else(|| {
            BackupVerifyError::catalog_error(format!("Catalog entry '{}' not found", entry_id))
        })?;
        self.save()?;
        info!("Deleted catalog entry: {}", entry_id);
        Ok(entry)
    }

    /// Get a catalog entry by ID.
    pub fn get_entry(&self, entry_id: &str) -> Result<&CatalogEntry> {
        self.entries.get(entry_id).ok_or_else(|| {
            BackupVerifyError::catalog_error(format!("Catalog entry '{}' not found", entry_id))
        })
    }

    /// Search entries using a filter.
    pub fn search_entries(&self, filter: &CatalogFilter) -> Vec<&CatalogEntry> {
        self.entries
            .values()
            .filter(|e| {
                if let Some(ref pid) = filter.policy_id {
                    if &e.policy_id != pid {
                        return false;
                    }
                }
                if let Some(ref tid) = filter.target_id {
                    if &e.target_id != tid {
                        return false;
                    }
                }
                if let Some(ref bt) = filter.backup_type {
                    if &e.backup_type != bt {
                        return false;
                    }
                }
                if let Some(from) = filter.from_date {
                    if e.timestamp < from {
                        return false;
                    }
                }
                if let Some(to) = filter.to_date {
                    if e.timestamp > to {
                        return false;
                    }
                }
                if filter.verified_only && !e.verified {
                    return false;
                }
                if !filter.tags.is_empty() && !filter.tags.iter().any(|t| e.tags.contains(t)) {
                    return false;
                }
                if let Some(min) = filter.min_size_bytes {
                    if e.size_bytes < min {
                        return false;
                    }
                }
                if let Some(max) = filter.max_size_bytes {
                    if e.size_bytes > max {
                        return false;
                    }
                }
                true
            })
            .collect()
    }

    /// List entries for a given policy, target, and optional date range.
    pub fn list_entries(
        &self,
        policy_id: Option<&str>,
        target_id: Option<&str>,
        from_date: Option<DateTime<Utc>>,
        to_date: Option<DateTime<Utc>>,
    ) -> Vec<&CatalogEntry> {
        let filter = CatalogFilter {
            policy_id: policy_id.map(String::from),
            target_id: target_id.map(String::from),
            from_date,
            to_date,
            ..Default::default()
        };
        self.search_entries(&filter)
    }

    /// Get the most recent backup for a given policy.
    pub fn get_latest_backup(&self, policy_id: &str) -> Option<&CatalogEntry> {
        self.entries
            .values()
            .filter(|e| e.policy_id == policy_id)
            .max_by_key(|e| e.timestamp)
    }

    /// Trace the incremental chain back to the last full backup.
    pub fn get_backup_chain(&self, entry_id: &str) -> Result<Vec<&CatalogEntry>> {
        let entry = self.get_entry(entry_id)?;
        let mut chain = vec![entry];

        if entry.backup_type == BackupMethod::Full {
            return Ok(chain);
        }

        // Collect all entries for this policy/target sorted by timestamp descending
        let mut candidates: Vec<&CatalogEntry> = self
            .entries
            .values()
            .filter(|e| e.policy_id == entry.policy_id && e.target_id == entry.target_id)
            .filter(|e| e.timestamp < entry.timestamp)
            .collect();
        candidates.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        for candidate in candidates {
            chain.push(candidate);
            if candidate.backup_type == BackupMethod::Full {
                break;
            }
        }

        chain.reverse();
        Ok(chain)
    }

    /// Export the catalog in JSON or CSV format.
    pub fn export_catalog(&self, format: &str) -> Result<String> {
        match format.to_lowercase().as_str() {
            "json" => {
                let data = serde_json::to_string_pretty(&self.entries)?;
                Ok(data)
            }
            "csv" => {
                let mut csv = String::from("id,job_id,policy_id,target_id,backup_type,timestamp,size_bytes,file_count,location,checksum,retention_until,verified\n");
                let mut entries: Vec<&CatalogEntry> = self.entries.values().collect();
                entries.sort_by_key(|e| e.timestamp);
                for e in entries {
                    csv.push_str(&format!(
                        "{},{},{},{},{:?},{},{},{},{},{},{},{}\n",
                        e.id,
                        e.job_id,
                        e.policy_id,
                        e.target_id,
                        e.backup_type,
                        e.timestamp.to_rfc3339(),
                        e.size_bytes,
                        e.file_count,
                        e.location,
                        e.checksum,
                        e.retention_until.to_rfc3339(),
                        e.verified
                    ));
                }
                Ok(csv)
            }
            _ => Err(BackupVerifyError::catalog_error(format!(
                "Unsupported export format: {}",
                format
            ))),
        }
    }

    /// Import catalog entries from JSON data (merges with existing).
    pub fn import_catalog(&mut self, data: &str) -> Result<u64> {
        let imported: HashMap<String, CatalogEntry> = serde_json::from_str(data)?;
        let count = imported.len() as u64;
        for (id, entry) in imported {
            if let Entry::Vacant(e) = self.entries.entry(id.clone()) {
                e.insert(entry);
            } else {
                warn!("Skipping duplicate catalog entry: {}", id);
            }
        }
        self.save()?;
        info!("Imported {} catalog entries", count);
        Ok(count)
    }

    /// Calculate storage usage per target and per policy.
    pub fn calculate_storage_usage(&self) -> StorageUsage {
        let mut by_target: HashMap<String, u64> = HashMap::new();
        let mut by_policy: HashMap<String, u64> = HashMap::new();
        let mut total: u64 = 0;

        for entry in self.entries.values() {
            *by_target.entry(entry.target_id.clone()).or_insert(0) += entry.size_bytes;
            *by_policy.entry(entry.policy_id.clone()).or_insert(0) += entry.size_bytes;
            total += entry.size_bytes;
        }

        StorageUsage {
            total_bytes: total,
            by_target,
            by_policy,
            entry_count: self.entries.len() as u64,
        }
    }

    /// Remove entries whose retention_until has passed.
    pub fn prune_expired_entries(&mut self) -> Result<Vec<CatalogEntry>> {
        let now = Utc::now();
        let expired_ids: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, e)| e.retention_until < now)
            .map(|(id, _)| id.clone())
            .collect();

        let mut pruned = Vec::new();
        for id in &expired_ids {
            if let Some(entry) = self.entries.remove(id) {
                info!(
                    "Pruning expired catalog entry: {} (expired at {})",
                    id, entry.retention_until
                );
                pruned.push(entry);
            }
        }

        if !pruned.is_empty() {
            self.save()?;
        }
        info!("Pruned {} expired catalog entries", pruned.len());
        Ok(pruned)
    }

    /// Rebuild catalog from a storage directory by scanning for backup metadata files.
    pub fn rebuild_catalog_from_storage(&mut self, storage_path: &Path) -> Result<u64> {
        if !storage_path.exists() {
            return Err(BackupVerifyError::storage_error(format!(
                "Storage path does not exist: {:?}",
                storage_path
            )));
        }

        let mut count: u64 = 0;
        let walker = walkdir(storage_path)?;

        for meta_path in walker {
            if meta_path.extension().and_then(|e| e.to_str()) == Some("catalog") {
                match std::fs::read_to_string(&meta_path) {
                    Ok(data) => match serde_json::from_str::<CatalogEntry>(&data) {
                        Ok(entry) => {
                            let id = entry.id.clone();
                            if let std::collections::hash_map::Entry::Vacant(e) =
                                self.entries.entry(id)
                            {
                                e.insert(entry);
                                count += 1;
                            }
                        }
                        Err(e) => {
                            warn!("Failed to parse catalog file {:?}: {}", meta_path, e);
                        }
                    },
                    Err(e) => {
                        warn!("Failed to read catalog file {:?}: {}", meta_path, e);
                    }
                }
            }
        }

        if count > 0 {
            self.save()?;
        }
        info!(
            "Rebuilt catalog: found {} new entries from {:?}",
            count, storage_path
        );
        Ok(count)
    }

    /// Get the total number of entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the catalog is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Get all entries as a vector.
    pub fn all_entries(&self) -> Vec<&CatalogEntry> {
        self.entries.values().collect()
    }

    /// Mark an entry as verified with the given result.
    pub fn mark_verified(&mut self, entry_id: &str, result: VerificationResult) -> Result<()> {
        let entry = self.entries.get_mut(entry_id).ok_or_else(|| {
            BackupVerifyError::catalog_error(format!("Catalog entry '{}' not found", entry_id))
        })?;
        entry.verified = result.status == crate::types::VerificationStatus::Passed;
        entry.verification_result = Some(result);
        self.save()?;
        Ok(())
    }
}

/// Storage usage statistics.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StorageUsage {
    pub total_bytes: u64,
    pub by_target: HashMap<String, u64>,
    pub by_policy: HashMap<String, u64>,
    pub entry_count: u64,
}

/// Walk a directory and return paths to all regular files.
fn walkdir(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    walk_recursive(root, &mut files)?;
    Ok(files)
}

fn walk_recursive(dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            walk_recursive(&path, files)?;
        } else {
            files.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::BackupMethod;
    use chrono::Duration;

    fn make_entry(
        id: &str,
        policy_id: &str,
        target_id: &str,
        method: BackupMethod,
    ) -> CatalogEntry {
        CatalogEntry {
            id: id.to_string(),
            job_id: format!("job-{}", id),
            policy_id: policy_id.to_string(),
            target_id: target_id.to_string(),
            backup_type: method,
            timestamp: Utc::now(),
            size_bytes: 1024,
            file_count: 10,
            location: format!("/backups/{}", id),
            checksum: "abc123".to_string(),
            retention_until: Utc::now() + Duration::days(30),
            verified: false,
            verification_result: None,
            tags: vec!["test".to_string()],
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_add_and_get_entry() {
        let tmp = std::env::temp_dir().join(format!("catalog_test_{}.json", Uuid::new_v4()));
        let mut catalog = BackupCatalog::new(tmp.clone());
        let entry = make_entry("e1", "p1", "t1", BackupMethod::Full);
        catalog.add_entry(entry).unwrap();
        assert_eq!(catalog.len(), 1);
        let got = catalog.get_entry("e1").unwrap();
        assert_eq!(got.policy_id, "p1");
        std::fs::remove_file(tmp).ok();
    }

    #[test]
    fn test_search_entries() {
        let tmp = std::env::temp_dir().join(format!("catalog_test_{}.json", Uuid::new_v4()));
        let mut catalog = BackupCatalog::new(tmp.clone());
        catalog
            .add_entry(make_entry("e1", "p1", "t1", BackupMethod::Full))
            .unwrap();
        catalog
            .add_entry(make_entry("e2", "p1", "t2", BackupMethod::Incremental))
            .unwrap();
        catalog
            .add_entry(make_entry("e3", "p2", "t1", BackupMethod::Full))
            .unwrap();

        let filter = CatalogFilter {
            policy_id: Some("p1".to_string()),
            ..Default::default()
        };
        let results = catalog.search_entries(&filter);
        assert_eq!(results.len(), 2);
        std::fs::remove_file(tmp).ok();
    }

    #[test]
    fn test_export_csv() {
        let tmp = std::env::temp_dir().join(format!("catalog_test_{}.json", Uuid::new_v4()));
        let mut catalog = BackupCatalog::new(tmp.clone());
        catalog
            .add_entry(make_entry("e1", "p1", "t1", BackupMethod::Full))
            .unwrap();
        let csv = catalog.export_catalog("csv").unwrap();
        assert!(csv.contains("e1"));
        assert!(csv.contains("p1"));
        std::fs::remove_file(tmp).ok();
    }
}
