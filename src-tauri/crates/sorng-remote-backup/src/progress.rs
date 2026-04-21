//! Progress tracking — normalization, aggregation, ETA calculation.

use crate::types::BackupProgress;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Aggregated progress state for a running job (or multiple sub-jobs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressTracker {
    /// Per-job progress entries
    entries: HashMap<String, BackupProgress>,
    /// History of data points for ETA smoothing
    history: Vec<ProgressSample>,
    /// Maximum history entries to keep
    max_history: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProgressSample {
    timestamp: DateTime<Utc>,
    bytes_transferred: u64,
}

impl ProgressTracker {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            history: Vec::new(),
            max_history: 120, // 2 minutes at 1 sample/sec
        }
    }

    /// Update progress for a given job.
    pub fn update(&mut self, progress: BackupProgress) {
        let sample = ProgressSample {
            timestamp: Utc::now(),
            bytes_transferred: progress.bytes_transferred,
        };
        self.history.push(sample);
        if self.history.len() > self.max_history {
            self.history.remove(0);
        }
        self.entries.insert(progress.job_id.clone(), progress);
    }

    /// Get the latest progress for a specific job.
    pub fn get(&self, job_id: &str) -> Option<&BackupProgress> {
        self.entries.get(job_id)
    }

    /// Remove tracking for a completed/cancelled job.
    pub fn remove(&mut self, job_id: &str) {
        self.entries.remove(job_id);
    }

    /// Get all active progress entries.
    pub fn all(&self) -> Vec<&BackupProgress> {
        self.entries.values().collect()
    }

    /// Calculate smoothed ETA based on history (rolling average speed).
    pub fn smoothed_eta(&self, bytes_remaining: u64) -> Option<u64> {
        if self.history.len() < 2 {
            return None;
        }
        let first = &self.history[0];
        let last = self.history.last()?;
        let elapsed_secs = (last.timestamp - first.timestamp).num_seconds() as f64;
        if elapsed_secs <= 0.0 {
            return None;
        }
        let bytes_diff = last
            .bytes_transferred
            .saturating_sub(first.bytes_transferred);
        if bytes_diff == 0 {
            return None;
        }
        let speed = bytes_diff as f64 / elapsed_secs;
        if speed <= 0.0 {
            return None;
        }
        Some((bytes_remaining as f64 / speed) as u64)
    }

    /// Calculate average speed in bytes/sec based on history.
    pub fn average_speed(&self) -> f64 {
        if self.history.len() < 2 {
            return 0.0;
        }
        let first = &self.history[0];
        let last = self.history.last().expect("history checked non-empty above");
        let elapsed = (last.timestamp - first.timestamp).num_seconds() as f64;
        if elapsed <= 0.0 {
            return 0.0;
        }
        let bytes = last
            .bytes_transferred
            .saturating_sub(first.bytes_transferred);
        bytes as f64 / elapsed
    }

    /// Get aggregate statistics across all jobs.
    pub fn aggregate(&self) -> AggregateProgress {
        let mut total_bytes = 0u64;
        let mut total_bytes_total = 0u64;
        let mut total_files = 0u64;
        let mut has_total = false;
        let mut total_speed = 0.0f64;

        for p in self.entries.values() {
            total_bytes += p.bytes_transferred;
            total_files += p.files_transferred;
            total_speed += p.speed_bps;
            if let Some(bt) = p.bytes_total {
                total_bytes_total += bt;
                has_total = true;
            }
        }

        let percent = if has_total && total_bytes_total > 0 {
            Some(total_bytes as f64 / total_bytes_total as f64 * 100.0)
        } else {
            None
        };

        AggregateProgress {
            active_jobs: self.entries.len(),
            total_bytes_transferred: total_bytes,
            total_bytes_remaining: if has_total {
                Some(total_bytes_total.saturating_sub(total_bytes))
            } else {
                None
            },
            total_files_transferred: total_files,
            combined_speed_bps: total_speed,
            percent_complete: percent,
        }
    }

    /// Clear all tracking data.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.history.clear();
    }
}

impl Default for ProgressTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Summary progress across all active jobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregateProgress {
    pub active_jobs: usize,
    pub total_bytes_transferred: u64,
    pub total_bytes_remaining: Option<u64>,
    pub total_files_transferred: u64,
    pub combined_speed_bps: f64,
    pub percent_complete: Option<f64>,
}

/// Format bytes into a human-readable string.
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let mut size = bytes as f64;
    let mut idx = 0;
    while size >= 1024.0 && idx < UNITS.len() - 1 {
        size /= 1024.0;
        idx += 1;
    }
    if idx == 0 {
        format!("{size} B")
    } else {
        format!("{size:.2} {}", UNITS[idx])
    }
}

/// Format a speed in bytes/sec to human-readable.
pub fn format_speed(bps: f64) -> String {
    if bps <= 0.0 {
        return "0 B/s".to_string();
    }
    format!("{}/s", format_bytes(bps as u64))
}

/// Format seconds into HH:MM:SS.
pub fn format_eta(seconds: u64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    if h > 0 {
        format!("{h}h{m:02}m{s:02}s")
    } else if m > 0 {
        format!("{m}m{s:02}s")
    } else {
        format!("{s}s")
    }
}
