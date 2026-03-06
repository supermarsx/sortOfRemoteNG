//! # DDNS Update Scheduler
//!
//! Manages scheduled update intervals, retry back-off, and jitter
//! for all active DDNS profiles.

use crate::types::*;
use chrono::{Duration, Utc};
use log::{info, warn};

/// The DDNS scheduler tracks when profiles should be updated next.
#[derive(Debug, Clone)]
pub struct DdnsScheduler {
    /// Whether the scheduler is running.
    pub running: bool,
    /// Schedule entries (one per enabled profile).
    pub entries: Vec<SchedulerEntry>,
    /// Global tick interval in seconds (how often we check for due updates).
    pub tick_interval_secs: u64,
    /// Total updates performed.
    pub total_updates: u64,
}

impl DdnsScheduler {
    /// Create a new scheduler.
    pub fn new() -> Self {
        Self {
            running: false,
            entries: Vec::new(),
            tick_interval_secs: 30,
            total_updates: 0,
        }
    }

    /// Start the scheduler.
    pub fn start(&mut self) {
        self.running = true;
        info!("DDNS scheduler started");
    }

    /// Stop the scheduler.
    pub fn stop(&mut self) {
        self.running = false;
        info!("DDNS scheduler stopped");
    }

    /// Add or update a schedule entry for a profile.
    pub fn upsert_entry(&mut self, profile_id: &str, interval_secs: u64) {
        let now = Utc::now();
        let next_run = (now + Duration::seconds(interval_secs as i64)).to_rfc3339();

        if let Some(entry) = self.entries.iter_mut().find(|e| e.profile_id == profile_id) {
            entry.interval_secs = interval_secs;
            entry.next_run = next_run;
            entry.paused = false;
        } else {
            self.entries.push(SchedulerEntry {
                profile_id: profile_id.to_string(),
                next_run,
                interval_secs,
                paused: false,
                run_count: 0,
                back_off_count: 0,
            });
        }
    }

    /// Remove a schedule entry.
    pub fn remove_entry(&mut self, profile_id: &str) {
        self.entries.retain(|e| e.profile_id != profile_id);
    }

    /// Pause a schedule entry.
    pub fn pause_entry(&mut self, profile_id: &str) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.profile_id == profile_id) {
            entry.paused = true;
        }
    }

    /// Resume a schedule entry.
    pub fn resume_entry(&mut self, profile_id: &str) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.profile_id == profile_id) {
            entry.paused = false;
        }
    }

    /// Get IDs of profiles that are due for an update.
    pub fn get_due_profiles(&self) -> Vec<String> {
        if !self.running {
            return Vec::new();
        }

        let now = Utc::now().to_rfc3339();
        self.entries
            .iter()
            .filter(|e| !e.paused && e.next_run <= now)
            .map(|e| e.profile_id.clone())
            .collect()
    }

    /// Mark a profile's update as completed, scheduling the next run.
    pub fn mark_completed(&mut self, profile_id: &str, success: bool, config: &DdnsConfig) {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.profile_id == profile_id) {
            entry.run_count += 1;
            self.total_updates += 1;

            if success {
                entry.back_off_count = 0;
                let jitter = if config.jitter_enabled {
                    use rand::Rng;
                    let mut rng = rand::thread_rng();
                    rng.gen_range(0..=config.jitter_max_secs) as i64
                } else {
                    0
                };
                let next = Utc::now()
                    + Duration::seconds(entry.interval_secs as i64)
                    + Duration::seconds(jitter);
                entry.next_run = next.to_rfc3339();
            } else {
                entry.back_off_count += 1;
                let delay = std::cmp::min(
                    config.retry_delay_secs * 2u64.pow(entry.back_off_count.saturating_sub(1)),
                    config.max_retry_delay_secs,
                );
                let next = Utc::now() + Duration::seconds(delay as i64);
                entry.next_run = next.to_rfc3339();
                warn!(
                    "DDNS: Profile {} back-off #{}: next retry in {}s",
                    profile_id, entry.back_off_count, delay
                );
            }
        }
    }

    /// Get the status of the scheduler.
    pub fn get_status(&self) -> SchedulerStatus {
        let next_update = self
            .entries
            .iter()
            .filter(|e| !e.paused)
            .map(|e| e.next_run.clone())
            .min();

        SchedulerStatus {
            running: self.running,
            entries: self.entries.clone(),
            tick_interval_secs: self.tick_interval_secs,
            total_updates: self.total_updates,
            next_update,
        }
    }

    /// Clear all entries.
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scheduler_lifecycle() {
        let mut sched = DdnsScheduler::new();
        assert!(!sched.running);

        sched.start();
        assert!(sched.running);

        sched.upsert_entry("prof-1", 300);
        assert_eq!(sched.entries.len(), 1);

        sched.stop();
        assert!(!sched.running);
        assert!(sched.get_due_profiles().is_empty()); // stopped → no due
    }

    #[test]
    fn test_upsert_and_remove() {
        let mut sched = DdnsScheduler::new();
        sched.upsert_entry("a", 60);
        sched.upsert_entry("b", 120);
        assert_eq!(sched.entries.len(), 2);

        sched.upsert_entry("a", 90); // update interval
        assert_eq!(sched.entries.len(), 2);
        assert_eq!(sched.entries[0].interval_secs, 90);

        sched.remove_entry("a");
        assert_eq!(sched.entries.len(), 1);
        assert_eq!(sched.entries[0].profile_id, "b");
    }

    #[test]
    fn test_pause_resume() {
        let mut sched = DdnsScheduler::new();
        sched.start();
        sched.upsert_entry("x", 1); // 1 second interval → immediately due

        sched.pause_entry("x");
        // Even if time is past, paused entries aren't due
        // We can't easily test due_profiles because the next_run is in the future
        assert!(sched.entries[0].paused);

        sched.resume_entry("x");
        assert!(!sched.entries[0].paused);
    }

    #[test]
    fn test_status() {
        let mut sched = DdnsScheduler::new();
        sched.start();
        sched.upsert_entry("p1", 300);
        sched.upsert_entry("p2", 600);

        let status = sched.get_status();
        assert!(status.running);
        assert_eq!(status.entries.len(), 2);
        assert!(status.next_update.is_some());
    }
}
