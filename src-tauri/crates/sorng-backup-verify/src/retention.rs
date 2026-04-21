use chrono::{DateTime, Datelike, Duration, Utc};
use log::info;
use std::collections::HashMap;

use crate::error::{BackupVerifyError, Result};
use crate::types::{BackupPolicy, CatalogEntry, PruneList};

// ─── Retention action types ─────────────────────────────────────────────────

/// Summary of actions taken by a retention enforcement pass.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RetentionActions {
    pub policy_id: String,
    pub executed_at: DateTime<Utc>,
    pub entries_kept: u32,
    pub entries_pruned: u32,
    pub daily_kept: u32,
    pub weekly_kept: u32,
    pub monthly_kept: u32,
    pub yearly_kept: u32,
    pub details: Vec<String>,
}

/// Result of a purge operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PurgeResult {
    pub purged_count: u32,
    pub bytes_reclaimed: u64,
    pub purged_ids: Vec<String>,
    pub errors: Vec<String>,
    pub executed_at: DateTime<Utc>,
}

/// Storage reclamation report.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StorageReport {
    pub total_bytes: u64,
    pub reclaimable_bytes: u64,
    pub entry_count: u64,
    pub reclaimable_count: u64,
    pub by_policy: HashMap<String, u64>,
    pub generated_at: DateTime<Utc>,
}

/// Immutability lock on a backup entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImmutabilityLock {
    pub entry_id: String,
    pub locked_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub reason: String,
}

/// Retention forecast entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RetentionForecastEntry {
    pub entry_id: String,
    pub policy_id: String,
    pub expires_at: DateTime<Utc>,
    pub gfs_tier: String,
}

// ─── RetentionEngine ────────────────────────────────────────────────────────

/// Engine for GFS rotation, immutability enforcement, and storage reclamation.
pub struct RetentionEngine {
    immutability_locks: HashMap<String, ImmutabilityLock>,
    purge_history: Vec<PurgeResult>,
}

impl RetentionEngine {
    pub fn new() -> Self {
        Self {
            immutability_locks: HashMap::new(),
            purge_history: Vec::new(),
        }
    }

    // ── GFS rotation ───────────────────────────────────────────────────────

    /// Apply grandfather-father-son rotation logic to a set of catalog entries
    /// for a single policy. Returns the keep/prune decision for each entry.
    pub fn apply_gfs_rotation(
        &self,
        policy: &BackupPolicy,
        entries: &[&CatalogEntry],
    ) -> RetentionActions {
        let retention = &policy.retention;
        let now = Utc::now();
        let mut actions = RetentionActions {
            policy_id: policy.id.clone(),
            executed_at: now,
            entries_kept: 0,
            entries_pruned: 0,
            daily_kept: 0,
            weekly_kept: 0,
            monthly_kept: 0,
            yearly_kept: 0,
            details: Vec::new(),
        };

        if !retention.gfs_enabled {
            // Without GFS, keep everything within min/max bounds
            for entry in entries {
                let age_days = (now - entry.timestamp).num_days();
                if age_days <= retention.max_retention_days as i64 {
                    actions.entries_kept += 1;
                } else {
                    actions.entries_pruned += 1;
                    actions.details.push(format!(
                        "Pruned {} (age {} days > max {})",
                        entry.id, age_days, retention.max_retention_days
                    ));
                }
            }
            return actions;
        }

        // Sort entries by timestamp descending (newest first)
        let mut sorted: Vec<&&CatalogEntry> = entries.iter().collect();
        sorted.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        // Track which slots we've filled
        let mut daily_slots = 0u32;
        let mut weekly_slots = 0u32;
        let mut monthly_slots = 0u32;
        let mut yearly_slots = 0u32;

        // Track the year-week/month/year already claimed to avoid duplicates
        let mut claimed_weeks: Vec<(i32, u32)> = Vec::new();
        let mut claimed_months: Vec<(i32, u32)> = Vec::new();
        let mut claimed_years: Vec<i32> = Vec::new();

        let mut kept_ids: Vec<String> = Vec::new();

        for entry in &sorted {
            let age_days = (now - entry.timestamp).num_days();

            // Never prune entries within immutability window
            if self.is_immutable(&entry.id) {
                kept_ids.push(entry.id.clone());
                actions.entries_kept += 1;
                continue;
            }

            // Enforce minimum retention
            if age_days < retention.min_retention_days as i64 {
                kept_ids.push(entry.id.clone());
                actions.entries_kept += 1;
                actions.daily_kept += 1;
                daily_slots += 1;
                continue;
            }

            // Exceed max → always prune
            if age_days > retention.max_retention_days as i64 {
                actions.entries_pruned += 1;
                actions
                    .details
                    .push(format!("Prune {}: exceeds max retention", entry.id));
                continue;
            }

            let ts = entry.timestamp;
            let iso_week = ts.iso_week().week();
            let year = ts.year();
            let month = ts.month();

            let mut keep = false;
            let mut tier = String::new();

            // Daily tier
            if daily_slots < retention.daily_count && age_days <= 7 {
                daily_slots += 1;
                actions.daily_kept += 1;
                keep = true;
                tier = "daily".into();
            }

            // Weekly tier
            if !keep
                && weekly_slots < retention.weekly_count
                && age_days <= 35
                && !claimed_weeks.contains(&(year, iso_week))
            {
                weekly_slots += 1;
                actions.weekly_kept += 1;
                claimed_weeks.push((year, iso_week));
                keep = true;
                tier = "weekly".into();
            }

            // Monthly tier
            if !keep
                && monthly_slots < retention.monthly_count
                && age_days <= 366
                && !claimed_months.contains(&(year, month))
            {
                monthly_slots += 1;
                actions.monthly_kept += 1;
                claimed_months.push((year, month));
                keep = true;
                tier = "monthly".into();
            }

            // Yearly tier
            if !keep && yearly_slots < retention.yearly_count && !claimed_years.contains(&year) {
                yearly_slots += 1;
                actions.yearly_kept += 1;
                claimed_years.push(year);
                keep = true;
                tier = "yearly".into();
            }

            if keep {
                kept_ids.push(entry.id.clone());
                actions.entries_kept += 1;
                actions
                    .details
                    .push(format!("Keep {} (tier={})", entry.id, tier));
            } else {
                actions.entries_pruned += 1;
                actions
                    .details
                    .push(format!("Prune {}: no GFS slot", entry.id));
            }
        }

        info!(
            "GFS rotation for policy {}: kept={}, pruned={} (D:{}/W:{}/M:{}/Y:{})",
            policy.id,
            actions.entries_kept,
            actions.entries_pruned,
            actions.daily_kept,
            actions.weekly_kept,
            actions.monthly_kept,
            actions.yearly_kept,
        );

        actions
    }

    // ── Retention enforcement ──────────────────────────────────────────────

    /// Enforce retention across all entries for a given policy.
    /// Returns a `PurgeResult` describing what was (or would be) removed.
    pub fn enforce_retention(
        &mut self,
        policy: &BackupPolicy,
        entries: &[&CatalogEntry],
    ) -> Result<PurgeResult> {
        let actions = self.apply_gfs_rotation(policy, entries);

        let mut result = PurgeResult {
            purged_count: actions.entries_pruned,
            bytes_reclaimed: 0,
            purged_ids: Vec::new(),
            errors: Vec::new(),
            executed_at: Utc::now(),
        };

        // Determine which IDs are pruned (not mentioned in kept)
        let kept_ids_set: std::collections::HashSet<&str> = actions
            .details
            .iter()
            .filter(|d| d.starts_with("Keep"))
            .filter_map(|d| d.split_whitespace().nth(1))
            .collect();

        for entry in entries {
            if !kept_ids_set.contains(entry.id.as_str()) && !self.is_immutable(&entry.id) {
                result.purged_ids.push(entry.id.clone());
                result.bytes_reclaimed += entry.size_bytes;
            }
        }

        result.purged_count = result.purged_ids.len() as u32;

        info!(
            "Retention enforcement for policy {}: purge {} entries, reclaim {} bytes",
            policy.id, result.purged_count, result.bytes_reclaimed
        );

        self.purge_history.push(result.clone());
        Ok(result)
    }

    // ── Storage reclamation ────────────────────────────────────────────────

    /// Calculate how much storage could be reclaimed across all policies.
    pub fn calculate_storage_reclamation(
        &self,
        policies: &[&BackupPolicy],
        entries_by_policy: &HashMap<String, Vec<&CatalogEntry>>,
    ) -> StorageReport {
        let mut report = StorageReport {
            total_bytes: 0,
            reclaimable_bytes: 0,
            entry_count: 0,
            reclaimable_count: 0,
            by_policy: HashMap::new(),
            generated_at: Utc::now(),
        };

        for policy in policies {
            if let Some(entries) = entries_by_policy.get(&policy.id) {
                let actions = self.apply_gfs_rotation(policy, entries);
                let reclaimable: u64 = entries
                    .iter()
                    .filter(|e| {
                        !actions
                            .details
                            .iter()
                            .any(|d| d.contains(&e.id) && d.starts_with("Keep"))
                    })
                    .map(|e| e.size_bytes)
                    .sum();

                let total: u64 = entries.iter().map(|e| e.size_bytes).sum();
                report.total_bytes += total;
                report.entry_count += entries.len() as u64;
                report.reclaimable_bytes += reclaimable;
                report.reclaimable_count += actions.entries_pruned as u64;
                report.by_policy.insert(policy.id.clone(), reclaimable);
            }
        }

        report
    }

    // ── Immutability ───────────────────────────────────────────────────────

    /// Set an immutability lock on a backup entry.
    pub fn set_immutability_lock(
        &mut self,
        entry_id: &str,
        duration_days: u32,
        reason: &str,
    ) -> ImmutabilityLock {
        let now = Utc::now();
        let lock = ImmutabilityLock {
            entry_id: entry_id.to_string(),
            locked_at: now,
            expires_at: now + Duration::days(duration_days as i64),
            reason: reason.to_string(),
        };
        info!(
            "Immutability lock on '{}' until {} (reason: {})",
            entry_id, lock.expires_at, reason
        );
        self.immutability_locks
            .insert(entry_id.to_string(), lock.clone());
        lock
    }

    /// Check whether an entry is currently immutable.
    pub fn is_immutable(&self, entry_id: &str) -> bool {
        self.immutability_locks
            .get(entry_id)
            .map(|l| l.expires_at > Utc::now())
            .unwrap_or(false)
    }

    /// Check all immutability locks, returning active ones.
    pub fn check_immutability_locks(&self) -> Vec<&ImmutabilityLock> {
        let now = Utc::now();
        self.immutability_locks
            .values()
            .filter(|l| l.expires_at > now)
            .collect()
    }

    /// Remove an expired or manually released lock.
    pub fn remove_immutability_lock(&mut self, entry_id: &str) -> Result<()> {
        if self.is_immutable(entry_id) {
            return Err(BackupVerifyError::storage_error(format!(
                "Cannot remove active immutability lock for '{}'",
                entry_id
            )));
        }
        self.immutability_locks.remove(entry_id);
        Ok(())
    }

    // ── Forecasting ────────────────────────────────────────────────────────

    /// Produce a forecast of when each entry will expire.
    pub fn get_retention_forecast(&self, entries: &[&CatalogEntry]) -> Vec<RetentionForecastEntry> {
        entries
            .iter()
            .map(|e| {
                let tier = self.classify_gfs_tier(e);
                RetentionForecastEntry {
                    entry_id: e.id.clone(),
                    policy_id: e.policy_id.clone(),
                    expires_at: e.retention_until,
                    gfs_tier: tier,
                }
            })
            .collect()
    }

    /// Classify which GFS tier an entry belongs to based on its age.
    fn classify_gfs_tier(&self, entry: &CatalogEntry) -> String {
        let age_days = (Utc::now() - entry.timestamp).num_days();
        if age_days <= 7 {
            "daily".into()
        } else if age_days <= 35 {
            "weekly".into()
        } else if age_days <= 366 {
            "monthly".into()
        } else {
            "yearly".into()
        }
    }

    // ── History ────────────────────────────────────────────────────────────

    /// Get purge history.
    pub fn get_purge_history(&self) -> &[PurgeResult] {
        &self.purge_history
    }

    /// Build a `PruneList` from rotation actions for a policy.
    pub fn build_prune_list(&self, policy: &BackupPolicy, entries: &[&CatalogEntry]) -> PruneList {
        let actions = self.apply_gfs_rotation(policy, entries);
        let mut prune = PruneList::new();

        for detail in &actions.details {
            if detail.starts_with("Prune") {
                if let Some(id) = detail
                    .split_whitespace()
                    .nth(1)
                    .map(|s| s.trim_end_matches(':'))
                {
                    prune.entries_to_remove.push(id.to_string());
                    if let Some(entry) = entries.iter().find(|e| e.id == id) {
                        prune.storage_savings_bytes += entry.size_bytes;
                        prune.reason.insert(id.to_string(), detail.clone());
                    }
                }
            } else if detail.starts_with("Keep") {
                if let Some(id) = detail.split_whitespace().nth(1) {
                    prune.entries_to_keep.push(id.to_string());
                }
            }
        }

        prune
    }
}

impl Default for RetentionEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_entry(id: &str, days_old: i64, size: u64) -> CatalogEntry {
        let mut e = CatalogEntry::new(
            id.into(),
            "j1".into(),
            "p1".into(),
            "t1".into(),
            BackupMethod::Full,
            "/backups/test".into(),
            Utc::now() + Duration::days(365),
        );
        e.timestamp = Utc::now() - Duration::days(days_old);
        e.size_bytes = size;
        e
    }

    #[test]
    fn test_immutability_lock() {
        let mut engine = RetentionEngine::new();
        engine.set_immutability_lock("e1", 30, "compliance");
        assert!(engine.is_immutable("e1"));
        assert!(!engine.is_immutable("e2"));
    }

    #[test]
    fn test_gfs_keeps_within_min_retention() {
        let engine = RetentionEngine::new();
        let policy = BackupPolicy::new("p1".into(), "Test".into());
        let e1 = make_entry("e1", 1, 1000);
        let e2 = make_entry("e2", 2, 2000);
        let entries: Vec<&CatalogEntry> = vec![&e1, &e2];
        let actions = engine.apply_gfs_rotation(&policy, &entries);
        // Both within min_retention (30 days default) and daily window
        assert_eq!(actions.entries_kept, 2);
    }

    #[test]
    fn test_classify_tier() {
        let engine = RetentionEngine::new();
        let recent = make_entry("r", 3, 100);
        assert_eq!(engine.classify_gfs_tier(&recent), "daily");
        let weekly = make_entry("w", 14, 100);
        assert_eq!(engine.classify_gfs_tier(&weekly), "weekly");
        let monthly = make_entry("m", 60, 100);
        assert_eq!(engine.classify_gfs_tier(&monthly), "monthly");
        let yearly = make_entry("y", 400, 100);
        assert_eq!(engine.classify_gfs_tier(&yearly), "yearly");
    }
}
