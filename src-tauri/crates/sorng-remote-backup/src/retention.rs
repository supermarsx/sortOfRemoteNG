//! Retention policy evaluation — determine which backups / snapshots to keep or remove.

use crate::error::BackupError;
use crate::types::RetentionPolicy;
use chrono::{DateTime, Duration, Utc};
use log::{debug, info};
use serde::{Deserialize, Serialize};

/// A backup record for retention evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionEntry {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub size_bytes: u64,
    pub tags: Vec<String>,
}

/// Result of a retention evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionResult {
    pub keep: Vec<String>,
    pub remove: Vec<String>,
    pub bytes_to_free: u64,
    pub entries_to_remove: u64,
}

/// Evaluate a retention policy against a set of backup entries.
///
/// Entries should be sorted newest-first.
pub fn evaluate(
    entries: &[RetentionEntry],
    policy: &RetentionPolicy,
) -> Result<RetentionResult, BackupError> {
    if entries.is_empty() {
        return Ok(RetentionResult {
            keep: Vec::new(),
            remove: Vec::new(),
            bytes_to_free: 0,
            entries_to_remove: 0,
        });
    }

    let mut sorted = entries.to_vec();
    sorted.sort_by(|a, b| b.timestamp.cmp(&a.timestamp)); // newest first

    let now = Utc::now();
    let mut keep_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // keep_last N
    if let Some(n) = policy.keep_last {
        for entry in sorted.iter().take(n as usize) {
            keep_ids.insert(entry.id.clone());
        }
    }

    // keep_within duration
    if let Some(within) = &policy.keep_within {
        if let Some(dur) = parse_duration_str(within) {
            let cutoff = now - dur;
            for entry in &sorted {
                if entry.timestamp >= cutoff {
                    keep_ids.insert(entry.id.clone());
                }
            }
        }
    }

    // keep_daily
    if let Some(n) = policy.keep_daily {
        keep_by_period(
            &sorted,
            n,
            |dt| dt.format("%Y-%m-%d").to_string(),
            &mut keep_ids,
        );
    }

    // keep_weekly
    if let Some(n) = policy.keep_weekly {
        keep_by_period(
            &sorted,
            n,
            |dt| dt.format("%G-W%V").to_string(),
            &mut keep_ids,
        );
    }

    // keep_monthly
    if let Some(n) = policy.keep_monthly {
        keep_by_period(
            &sorted,
            n,
            |dt| dt.format("%Y-%m").to_string(),
            &mut keep_ids,
        );
    }

    // keep_yearly
    if let Some(n) = policy.keep_yearly {
        keep_by_period(&sorted, n, |dt| dt.format("%Y").to_string(), &mut keep_ids);
    }

    // If no policy criteria were set, keep everything
    if policy.keep_last.is_none()
        && policy.keep_daily.is_none()
        && policy.keep_weekly.is_none()
        && policy.keep_monthly.is_none()
        && policy.keep_yearly.is_none()
        && policy.keep_within.is_none()
        && policy.max_total_size.is_none()
    {
        for entry in &sorted {
            keep_ids.insert(entry.id.clone());
        }
    }

    // max_total_size — remove oldest kept entries until under budget
    if let Some(max_size) = policy.max_total_size {
        let mut total_size: u64 = sorted
            .iter()
            .filter(|e| keep_ids.contains(&e.id))
            .map(|e| e.size_bytes)
            .sum();

        // Remove from oldest first
        let oldest_kept: Vec<_> = sorted
            .iter()
            .rev()
            .filter(|e| keep_ids.contains(&e.id))
            .collect();

        for entry in oldest_kept {
            if total_size <= max_size {
                break;
            }
            keep_ids.remove(&entry.id);
            total_size -= entry.size_bytes;
            debug!("Removing {} to stay under size budget", entry.id);
        }
    }

    // Build result
    let mut keep = Vec::new();
    let mut remove = Vec::new();
    let mut bytes_to_free: u64 = 0;

    for entry in &sorted {
        if keep_ids.contains(&entry.id) {
            keep.push(entry.id.clone());
        } else {
            remove.push(entry.id.clone());
            bytes_to_free += entry.size_bytes;
        }
    }

    info!(
        "Retention: keeping {}, removing {} (freeing {} bytes)",
        keep.len(),
        remove.len(),
        bytes_to_free
    );

    Ok(RetentionResult {
        keep,
        entries_to_remove: remove.len() as u64,
        remove,
        bytes_to_free,
    })
}

/// Keep up to `n` entries per time period (newest in each period wins).
fn keep_by_period(
    sorted: &[RetentionEntry],
    n: u32,
    period_key: impl Fn(&DateTime<Utc>) -> String,
    keep_ids: &mut std::collections::HashSet<String>,
) {
    let mut seen_periods: Vec<String> = Vec::new();
    for entry in sorted {
        let key = period_key(&entry.timestamp);
        if !seen_periods.contains(&key) {
            seen_periods.push(key);
            keep_ids.insert(entry.id.clone());
            if seen_periods.len() >= n as usize {
                break;
            }
        }
    }
}

/// Parse a human-readable duration string like "30d", "6m", "1y", "2w".
fn parse_duration_str(s: &str) -> Option<Duration> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: i64 = num_str.parse().ok()?;

    match unit {
        "s" => Some(Duration::seconds(num)),
        "m" => Some(Duration::minutes(num)),
        "h" => Some(Duration::hours(num)),
        "d" => Some(Duration::days(num)),
        "w" => Some(Duration::weeks(num)),
        "M" => Some(Duration::days(num * 30)),
        "y" => Some(Duration::days(num * 365)),
        _ => {
            // Maybe the whole string is a number of days?
            let full: i64 = s.parse().ok()?;
            Some(Duration::days(full))
        }
    }
}
