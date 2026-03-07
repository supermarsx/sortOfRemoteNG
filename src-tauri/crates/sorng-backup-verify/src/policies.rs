use std::collections::HashMap;
use chrono::{DateTime, Utc, Duration, Datelike, Timelike};
use log::{info, warn};
use uuid::Uuid;
use regex::Regex;

use crate::error::{BackupVerifyError, Result};
use crate::types::{
    BackupPolicy, BackupMethod, BackupSchedule, BackupTarget, RetentionPolicy,
    CompressionConfig, EncryptionConfig, PolicyStatus, PolicyHealth, BackupJobState,
};

/// Manages backup policies — create, update, validate, and query.
pub struct PolicyManager {
    policies: HashMap<String, BackupPolicy>,
}

impl PolicyManager {
    pub fn new() -> Self {
        Self {
            policies: HashMap::new(),
        }
    }

    /// Create a new backup policy.
    pub fn create_policy(&mut self, policy: BackupPolicy) -> Result<String> {
        let id = policy.id.clone();
        if self.policies.contains_key(&id) {
            return Err(BackupVerifyError::catalog_error(
                format!("Policy '{}' already exists", id),
            ));
        }
        self.validate_policy(&policy)?;
        info!("Creating backup policy: {} ({})", policy.name, id);
        self.policies.insert(id.clone(), policy);
        Ok(id)
    }

    /// Update an existing policy.
    pub fn update_policy(&mut self, policy: BackupPolicy) -> Result<()> {
        let id = policy.id.clone();
        if !self.policies.contains_key(&id) {
            return Err(BackupVerifyError::policy_not_found(&id));
        }
        self.validate_policy(&policy)?;
        info!("Updating backup policy: {} ({})", policy.name, id);
        self.policies.insert(id, policy);
        Ok(())
    }

    /// Delete a policy by ID.
    pub fn delete_policy(&mut self, policy_id: &str) -> Result<BackupPolicy> {
        self.policies.remove(policy_id).ok_or_else(|| {
            BackupVerifyError::policy_not_found(policy_id)
        })
    }

    /// Get a policy by ID.
    pub fn get_policy(&self, policy_id: &str) -> Result<&BackupPolicy> {
        self.policies.get(policy_id).ok_or_else(|| {
            BackupVerifyError::policy_not_found(policy_id)
        })
    }

    /// Get a mutable reference to a policy.
    pub fn get_policy_mut(&mut self, policy_id: &str) -> Result<&mut BackupPolicy> {
        self.policies.get_mut(policy_id).ok_or_else(|| {
            BackupVerifyError::policy_not_found(policy_id)
        })
    }

    /// List all policies.
    pub fn list_policies(&self) -> Vec<&BackupPolicy> {
        self.policies.values().collect()
    }

    /// Enable a policy.
    pub fn enable_policy(&mut self, policy_id: &str) -> Result<()> {
        let policy = self.get_policy_mut(policy_id)?;
        policy.enabled = true;
        policy.updated_at = Utc::now();
        info!("Enabled policy: {}", policy_id);
        Ok(())
    }

    /// Disable a policy.
    pub fn disable_policy(&mut self, policy_id: &str) -> Result<()> {
        let policy = self.get_policy_mut(policy_id)?;
        policy.enabled = false;
        policy.updated_at = Utc::now();
        info!("Disabled policy: {}", policy_id);
        Ok(())
    }

    /// Validate a backup policy for consistency.
    pub fn validate_policy(&self, policy: &BackupPolicy) -> Result<()> {
        if policy.name.trim().is_empty() {
            return Err(BackupVerifyError::catalog_error("Policy name cannot be empty"));
        }
        if policy.targets.is_empty() {
            return Err(BackupVerifyError::catalog_error("Policy must have at least one target"));
        }

        // Validate the cron expression has 5 fields
        let cron_parts: Vec<&str> = policy.schedule.cron_expression.split_whitespace().collect();
        if cron_parts.len() != 5 {
            return Err(BackupVerifyError::catalog_error(
                format!("Invalid cron expression '{}': expected 5 fields", policy.schedule.cron_expression),
            ));
        }

        // Validate retention makes sense
        if policy.retention.min_retention_days > policy.retention.max_retention_days {
            return Err(BackupVerifyError::catalog_error(
                "min_retention_days cannot exceed max_retention_days",
            ));
        }

        // Validate compression level
        if policy.compression.level > 22 {
            return Err(BackupVerifyError::catalog_error(
                "Compression level must be 0–22",
            ));
        }

        // Validate max_parallel
        if policy.max_parallel == 0 {
            return Err(BackupVerifyError::catalog_error(
                "max_parallel must be at least 1",
            ));
        }

        // Validate priority 1-10
        if policy.priority == 0 || policy.priority > 10 {
            return Err(BackupVerifyError::catalog_error(
                "Priority must be between 1 and 10",
            ));
        }

        // Validate blackout periods
        for bp in &policy.schedule.blackout_periods {
            for d in &bp.days_of_week {
                if *d > 6 {
                    return Err(BackupVerifyError::catalog_error(
                        format!("Invalid day_of_week {} in blackout period", d),
                    ));
                }
            }
        }

        Ok(())
    }

    /// Clone a policy with a new ID and name.
    pub fn clone_policy(&mut self, source_id: &str, new_name: &str) -> Result<String> {
        let source = self.get_policy(source_id)?.clone();
        let new_id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let mut cloned = source;
        cloned.id = new_id.clone();
        cloned.name = new_name.to_string();
        cloned.created_at = now;
        cloned.updated_at = now;
        info!("Cloning policy '{}' as '{}' ({})", source_id, new_name, new_id);
        self.policies.insert(new_id.clone(), cloned);
        Ok(new_id)
    }

    /// Get the status of a policy including last run info and health.
    pub fn get_policy_status(
        &self,
        policy_id: &str,
        job_history: &[(BackupJobState, DateTime<Utc>, u64)],
    ) -> Result<PolicyStatus> {
        let policy = self.get_policy(policy_id)?;

        let total_jobs = job_history.len() as u64;
        let successful_jobs = job_history.iter()
            .filter(|(s, _, _)| *s == BackupJobState::Completed)
            .count() as u64;
        let failed_jobs = job_history.iter()
            .filter(|(s, _, _)| *s == BackupJobState::Failed)
            .count() as u64;
        let total_size: u64 = job_history.iter().map(|(_, _, sz)| sz).sum();

        let last_run = job_history.iter().map(|(_, t, _)| *t).max();
        let last_status = job_history.last().map(|(s, _, _)| s.clone());
        let next_run = if policy.enabled {
            calculate_next_run(&policy.schedule).ok()
        } else {
            None
        };

        // Determine health
        let health = if total_jobs == 0 {
            PolicyHealth::Unknown
        } else {
            let recent: Vec<_> = job_history.iter()
                .filter(|(_, t, _)| *t > Utc::now() - Duration::days(7))
                .collect();
            let recent_failures = recent.iter()
                .filter(|(s, _, _)| *s == BackupJobState::Failed)
                .count();
            if recent_failures == 0 {
                PolicyHealth::Healthy
            } else if recent_failures <= 2 {
                PolicyHealth::Warning
            } else {
                PolicyHealth::Critical
            }
        };

        Ok(PolicyStatus {
            policy_id: policy_id.to_string(),
            last_run,
            last_status,
            next_run,
            total_jobs,
            successful_jobs,
            failed_jobs,
            total_size_bytes: total_size,
            health,
        })
    }

    /// Estimate the backup size for a policy based on target paths.
    pub fn estimate_backup_size(&self, policy_id: &str) -> Result<u64> {
        let policy = self.get_policy(policy_id)?;
        let mut total_size: u64 = 0;

        for target in &policy.targets {
            for path in &target.paths {
                let p = std::path::Path::new(path);
                if p.exists() {
                    if p.is_file() {
                        if let Ok(meta) = p.metadata() {
                            total_size += meta.len();
                        }
                    } else if p.is_dir() {
                        total_size += estimate_dir_size(p);
                    }
                }
            }
        }

        Ok(total_size)
    }

    /// Get the total number of policies.
    pub fn len(&self) -> usize {
        self.policies.len()
    }

    /// Check if there are no policies.
    pub fn is_empty(&self) -> bool {
        self.policies.is_empty()
    }

    /// Count enabled policies.
    pub fn active_count(&self) -> usize {
        self.policies.values().filter(|p| p.enabled).count()
    }
}

/// Calculate the next run time from a cron expression.
/// Supports standard 5-field cron: minute hour day_of_month month day_of_week
pub fn calculate_next_run(schedule: &BackupSchedule) -> Result<DateTime<Utc>> {
    let parts: Vec<&str> = schedule.cron_expression.split_whitespace().collect();
    if parts.len() != 5 {
        return Err(BackupVerifyError::scheduler_error(
            format!("Invalid cron: '{}'", schedule.cron_expression),
        ));
    }

    let now = Utc::now();
    let minute = parse_cron_field(parts[0], 0, 59)?;
    let hour = parse_cron_field(parts[1], 0, 23)?;

    // Find the next time that matches the cron minute and hour fields.
    // This is a simplified parser that handles *, specific values, and ranges.
    let mut candidate = now + Duration::minutes(1);
    // Zero out seconds
    candidate = candidate.with_second(0).unwrap_or(candidate);

    for _ in 0..525960 {
        let m = candidate.minute();
        let h = candidate.hour();

        if minute.contains(&m) && hour.contains(&h) {
            // Check blackout
            if !is_in_blackout_at(schedule, candidate) {
                return Ok(candidate);
            }
        }
        candidate = candidate + Duration::minutes(1);
    }

    Err(BackupVerifyError::scheduler_error(
        "Could not find next run time within one year",
    ))
}

/// Check if a given time falls within any blackout period.
pub fn is_in_blackout(schedule: &BackupSchedule) -> bool {
    is_in_blackout_at(schedule, Utc::now())
}

fn is_in_blackout_at(schedule: &BackupSchedule, at: DateTime<Utc>) -> bool {
    let day_of_week = at.weekday().num_days_from_monday() as u8;
    // Sunday = 6 in our representation (Mon=0..Sun=6)
    let time_str = format!("{:02}:{:02}", at.hour(), at.minute());

    for bp in &schedule.blackout_periods {
        if !bp.days_of_week.is_empty() && !bp.days_of_week.contains(&day_of_week) {
            continue;
        }
        if time_str >= bp.start_time && time_str <= bp.end_time {
            return true;
        }
    }
    false
}

/// Parse a single cron field into a set of matching values.
fn parse_cron_field(field: &str, min: u32, max: u32) -> Result<Vec<u32>> {
    if field == "*" {
        return Ok((min..=max).collect());
    }

    let mut values = Vec::new();
    for part in field.split(',') {
        if let Some((range_start, range_end)) = part.split_once('-') {
            let s: u32 = range_start.parse().map_err(|_| {
                BackupVerifyError::scheduler_error(format!("Invalid cron value: {}", range_start))
            })?;
            let e: u32 = range_end.parse().map_err(|_| {
                BackupVerifyError::scheduler_error(format!("Invalid cron value: {}", range_end))
            })?;
            for v in s..=e {
                if v >= min && v <= max {
                    values.push(v);
                }
            }
        } else if let Some((val, step)) = part.split_once('/') {
            let start = if val == "*" {
                min
            } else {
                val.parse().map_err(|_| {
                    BackupVerifyError::scheduler_error(format!("Invalid cron value: {}", val))
                })?
            };
            let step: u32 = step.parse().map_err(|_| {
                BackupVerifyError::scheduler_error(format!("Invalid cron step: {}", step))
            })?;
            if step == 0 {
                return Err(BackupVerifyError::scheduler_error("Cron step cannot be 0"));
            }
            let mut v = start;
            while v <= max {
                values.push(v);
                v += step;
            }
        } else {
            let v: u32 = part.parse().map_err(|_| {
                BackupVerifyError::scheduler_error(format!("Invalid cron value: {}", part))
            })?;
            if v >= min && v <= max {
                values.push(v);
            }
        }
    }
    Ok(values)
}

/// Recursively estimate the size of a directory.
fn estimate_dir_size(path: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Ok(meta) = p.metadata() {
                    total += meta.len();
                }
            } else if p.is_dir() {
                total += estimate_dir_size(&p);
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_policy(id: &str, name: &str) -> BackupPolicy {
        let mut policy = BackupPolicy::new(id.to_string(), name.to_string());
        policy.targets.push(BackupTarget {
            id: "t1".to_string(),
            name: "Test Target".to_string(),
            target_type: TargetType::FileSystem,
            host: "localhost".to_string(),
            paths: vec!["/tmp".to_string()],
            credentials: None,
            ssh_config: None,
            tags: Vec::new(),
        });
        policy
    }

    #[test]
    fn test_create_and_get_policy() {
        let mut mgr = PolicyManager::new();
        let policy = make_policy("p1", "Daily Backup");
        mgr.create_policy(policy).unwrap();
        assert_eq!(mgr.len(), 1);
        let got = mgr.get_policy("p1").unwrap();
        assert_eq!(got.name, "Daily Backup");
    }

    #[test]
    fn test_validate_empty_name() {
        let mgr = PolicyManager::new();
        let mut policy = make_policy("p1", "");
        policy.name = "".to_string();
        assert!(mgr.validate_policy(&policy).is_err());
    }

    #[test]
    fn test_clone_policy() {
        let mut mgr = PolicyManager::new();
        mgr.create_policy(make_policy("p1", "Original")).unwrap();
        let new_id = mgr.clone_policy("p1", "Cloned").unwrap();
        assert_eq!(mgr.len(), 2);
        let cloned = mgr.get_policy(&new_id).unwrap();
        assert_eq!(cloned.name, "Cloned");
    }

    #[test]
    fn test_parse_cron_field() {
        assert_eq!(parse_cron_field("*", 0, 59).unwrap().len(), 60);
        assert_eq!(parse_cron_field("0", 0, 59).unwrap(), vec![0]);
        assert_eq!(parse_cron_field("1-5", 0, 59).unwrap(), vec![1, 2, 3, 4, 5]);
        assert_eq!(parse_cron_field("*/15", 0, 59).unwrap(), vec![0, 15, 30, 45]);
    }
}
