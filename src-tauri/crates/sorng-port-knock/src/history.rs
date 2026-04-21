use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::PortKnockError;
use crate::types::{
    HistoryFilter, HostStats, KnockHistoryEntry, KnockMethod, KnockStatistics, KnockStatus,
    MethodStats,
};

/// Knock attempt history and logging.
pub struct KnockHistory {
    entries: Vec<KnockHistoryEntry>,
    max_entries: usize,
}

impl KnockHistory {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_entries,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        host: String,
        profile_id: Option<String>,
        profile_name: Option<String>,
        method: KnockMethod,
        status: KnockStatus,
        target_port: u16,
        port_opened: bool,
        elapsed_ms: u64,
        steps_completed: u32,
        steps_total: u32,
        error: Option<String>,
    ) -> KnockHistoryEntry {
        let entry = KnockHistoryEntry {
            id: Uuid::new_v4().to_string(),
            host,
            profile_id,
            profile_name,
            method,
            status,
            target_port,
            port_opened,
            elapsed_ms,
            steps_completed,
            steps_total,
            error,
            timestamp: Utc::now(),
        };

        if self.entries.len() >= self.max_entries {
            self.entries.remove(0);
        }

        self.entries.push(entry.clone());
        entry
    }

    pub fn get_entry(&self, id: &str) -> Option<&KnockHistoryEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn list_entries(&self) -> &[KnockHistoryEntry] {
        &self.entries
    }

    pub fn filter_entries(&self, filter: &HistoryFilter) -> Vec<&KnockHistoryEntry> {
        let mut results: Vec<&KnockHistoryEntry> = self
            .entries
            .iter()
            .filter(|e| {
                if let Some(ref host) = filter.host {
                    if e.host != *host {
                        return false;
                    }
                }
                if let Some(ref pid) = filter.profile_id {
                    if e.profile_id.as_deref() != Some(pid.as_str()) {
                        return false;
                    }
                }
                if let Some(ref status) = filter.status {
                    if e.status != *status {
                        return false;
                    }
                }
                if let Some(ref method) = filter.method {
                    if std::mem::discriminant(&e.method) != std::mem::discriminant(method) {
                        return false;
                    }
                }
                if let Some(ref from) = filter.from_date {
                    if e.timestamp < *from {
                        return false;
                    }
                }
                if let Some(ref to) = filter.to_date {
                    if e.timestamp > *to {
                        return false;
                    }
                }
                true
            })
            .collect();

        // Most recent first for offset/limit
        results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if let Some(offset) = filter.offset {
            results = results.into_iter().skip(offset as usize).collect();
        }
        if let Some(limit) = filter.limit {
            results.truncate(limit as usize);
        }

        results
    }

    pub fn get_entries_for_host(&self, host: &str) -> Vec<&KnockHistoryEntry> {
        self.entries.iter().filter(|e| e.host == host).collect()
    }

    pub fn get_recent_entries(&self, count: usize) -> Vec<&KnockHistoryEntry> {
        self.entries.iter().rev().take(count).collect()
    }

    pub fn get_statistics(&self) -> KnockStatistics {
        let total = self.entries.len() as u64;
        let successful = self
            .entries
            .iter()
            .filter(|e| e.status == KnockStatus::Success)
            .count() as u64;
        let failed = self
            .entries
            .iter()
            .filter(|e| e.status == KnockStatus::Failed)
            .count() as u64;
        let timeout = self
            .entries
            .iter()
            .filter(|e| e.status == KnockStatus::Timeout)
            .count() as u64;

        let (avg, min, max) = if self.entries.is_empty() {
            (0.0, 0, 0)
        } else {
            let sum: u64 = self.entries.iter().map(|e| e.elapsed_ms).sum();
            let mn = self.entries.iter().map(|e| e.elapsed_ms).min().unwrap_or(0);
            let mx = self.entries.iter().map(|e| e.elapsed_ms).max().unwrap_or(0);
            (sum as f64 / total as f64, mn, mx)
        };

        // Count per-profile usage
        let most_used_profile = {
            let mut counts = std::collections::HashMap::<&str, u64>::new();
            for e in &self.entries {
                if let Some(ref name) = e.profile_name {
                    *counts.entry(name.as_str()).or_default() += 1;
                }
            }
            counts
                .into_iter()
                .max_by_key(|&(_, c)| c)
                .map(|(n, _)| n.to_string())
        };

        // Count per-host usage
        let most_targeted_host = {
            let mut counts = std::collections::HashMap::<&str, u64>::new();
            for e in &self.entries {
                *counts.entry(e.host.as_str()).or_default() += 1;
            }
            counts
                .into_iter()
                .max_by_key(|&(_, c)| c)
                .map(|(h, _)| h.to_string())
        };

        // By-method breakdown
        let by_method = self.compute_method_stats();

        // By-host breakdown
        let by_host = self.compute_all_host_stats();

        KnockStatistics {
            total_attempts: total,
            successful_attempts: successful,
            failed_attempts: failed,
            timeout_attempts: timeout,
            avg_elapsed_ms: avg,
            min_elapsed_ms: min,
            max_elapsed_ms: max,
            most_used_profile,
            most_targeted_host,
            by_method,
            by_host,
        }
    }

    pub fn get_host_statistics(&self, host: &str) -> Option<HostStats> {
        let host_entries: Vec<&KnockHistoryEntry> =
            self.entries.iter().filter(|e| e.host == host).collect();
        if host_entries.is_empty() {
            return None;
        }
        let count = host_entries.len() as u64;
        let successes = host_entries
            .iter()
            .filter(|e| e.status == KnockStatus::Success)
            .count() as f64;
        let avg_elapsed =
            host_entries.iter().map(|e| e.elapsed_ms).sum::<u64>() as f64 / count as f64;

        Some(HostStats {
            host: host.to_string(),
            count,
            success_rate: successes / count as f64,
            avg_elapsed_ms: avg_elapsed,
        })
    }

    pub fn clear_history(&mut self) -> usize {
        let count = self.entries.len();
        self.entries.clear();
        count
    }

    pub fn clear_older_than(&mut self, before: DateTime<Utc>) -> usize {
        let original = self.entries.len();
        self.entries.retain(|e| e.timestamp >= before);
        original - self.entries.len()
    }

    pub fn export_json(&self) -> Result<String, PortKnockError> {
        serde_json::to_string_pretty(&self.entries)
            .map_err(|e| PortKnockError::ExportError(e.to_string()))
    }

    pub fn export_csv(&self) -> Result<String, PortKnockError> {
        let mut csv = String::from(
            "id,host,profile_id,profile_name,method,status,target_port,port_opened,elapsed_ms,steps_completed,steps_total,error,timestamp\n",
        );
        for e in &self.entries {
            csv.push_str(&format!(
                "{},{},{},{},{:?},{:?},{},{},{},{},{},{},{}\n",
                e.id,
                e.host,
                e.profile_id.as_deref().unwrap_or(""),
                e.profile_name.as_deref().unwrap_or(""),
                e.method,
                e.status,
                e.target_port,
                e.port_opened,
                e.elapsed_ms,
                e.steps_completed,
                e.steps_total,
                e.error.as_deref().unwrap_or(""),
                e.timestamp.to_rfc3339(),
            ));
        }
        Ok(csv)
    }

    pub fn import_json(&mut self, data: &str) -> Result<usize, PortKnockError> {
        let imported: Vec<KnockHistoryEntry> =
            serde_json::from_str(data).map_err(|e| PortKnockError::ImportError(e.to_string()))?;
        let count = imported.len();
        for entry in imported {
            if self.entries.len() >= self.max_entries {
                self.entries.remove(0);
            }
            self.entries.push(entry);
        }
        Ok(count)
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    // ── helpers ──────────────────────────────────────────────────

    fn compute_method_stats(&self) -> Vec<MethodStats> {
        let mut buckets: std::collections::HashMap<
            std::mem::Discriminant<KnockMethod>,
            (KnockMethod, u64, u64),
        > = std::collections::HashMap::new();

        for e in &self.entries {
            let disc = std::mem::discriminant(&e.method);
            let entry = buckets
                .entry(disc)
                .or_insert_with(|| (e.method.clone(), 0, 0));
            entry.1 += 1;
            if e.status == KnockStatus::Success {
                entry.2 += 1;
            }
        }

        buckets
            .into_values()
            .map(|(method, count, successes)| MethodStats {
                method,
                count,
                success_rate: if count > 0 {
                    successes as f64 / count as f64
                } else {
                    0.0
                },
            })
            .collect()
    }

    fn compute_all_host_stats(&self) -> Vec<HostStats> {
        let mut hosts: std::collections::HashMap<&str, (u64, u64, u64)> =
            std::collections::HashMap::new();

        for e in &self.entries {
            let entry = hosts.entry(e.host.as_str()).or_insert((0, 0, 0));
            entry.0 += 1;
            if e.status == KnockStatus::Success {
                entry.1 += 1;
            }
            entry.2 += e.elapsed_ms;
        }

        hosts
            .into_iter()
            .map(|(host, (count, successes, total_ms))| HostStats {
                host: host.to_string(),
                count,
                success_rate: if count > 0 {
                    successes as f64 / count as f64
                } else {
                    0.0
                },
                avg_elapsed_ms: if count > 0 {
                    total_ms as f64 / count as f64
                } else {
                    0.0
                },
            })
            .collect()
    }
}
