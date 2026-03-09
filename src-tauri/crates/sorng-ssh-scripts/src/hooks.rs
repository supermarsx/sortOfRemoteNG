// ── sorng-ssh-scripts/src/hooks.rs ───────────────────────────────────────────
//! SSH lifecycle event hooks — maps SSH events to script triggers.

use chrono::{DateTime, Utc};
use regex::Regex;
use std::collections::HashMap;

use crate::types::*;

/// Tracks per-session state needed for event-based triggers.
#[derive(Debug)]
pub struct SessionHookState {
    pub session_id: String,
    pub connection_id: Option<String>,
    pub host: Option<String>,
    pub username: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub idle_notified: bool,

    // OutputMatch state
    pub output_buffer: String,
    pub output_match_cooldowns: HashMap<String, DateTime<Utc>>,
    pub output_match_counts: HashMap<String, u64>,

    // FileWatch state
    pub file_watch_mtimes: HashMap<String, String>,
    pub file_watch_exists: HashMap<String, bool>,

    // EnvChange state
    pub env_snapshots: HashMap<String, String>,

    // MetricThreshold state
    pub metric_cooldowns: HashMap<String, DateTime<Utc>>,

    // Idle tracking
    pub idle_threshold_ms: Option<u64>,
}

impl SessionHookState {
    pub fn new(
        session_id: String,
        connection_id: Option<String>,
        host: Option<String>,
        username: Option<String>,
    ) -> Self {
        let now = Utc::now();
        SessionHookState {
            session_id,
            connection_id,
            host,
            username,
            connected_at: now,
            last_activity: now,
            idle_notified: false,
            output_buffer: String::new(),
            output_match_cooldowns: HashMap::new(),
            output_match_counts: HashMap::new(),
            file_watch_mtimes: HashMap::new(),
            file_watch_exists: HashMap::new(),
            env_snapshots: HashMap::new(),
            metric_cooldowns: HashMap::new(),
            idle_threshold_ms: None,
        }
    }

    /// Record activity (resets idle timer).
    pub fn touch(&mut self) {
        self.last_activity = Utc::now();
        self.idle_notified = false;
    }

    /// Append output from the terminal.
    pub fn append_output(&mut self, data: &str) {
        self.output_buffer.push_str(data);
        // Limit buffer to 128KB
        if self.output_buffer.len() > 128 * 1024 {
            let excess = self.output_buffer.len() - 64 * 1024;
            self.output_buffer = self.output_buffer[excess..].to_string();
        }
        self.touch();
    }

    /// Check output buffer against a pattern, respecting cooldown and max triggers.
    pub fn check_output_match(
        &mut self,
        script_id: &str,
        pattern: &str,
        max_triggers: u64,
        cooldown_ms: u64,
    ) -> bool {
        // Max triggers check
        if max_triggers > 0 {
            let count = self
                .output_match_counts
                .get(script_id)
                .copied()
                .unwrap_or(0);
            if count >= max_triggers {
                return false;
            }
        }

        // Cooldown check
        if cooldown_ms > 0 {
            if let Some(last) = self.output_match_cooldowns.get(script_id) {
                let elapsed = Utc::now().signed_duration_since(*last).num_milliseconds() as u64;
                if elapsed < cooldown_ms {
                    return false;
                }
            }
        }

        // Pattern match
        if let Ok(re) = Regex::new(pattern) {
            if re.is_match(&self.output_buffer) {
                // Record trigger
                *self
                    .output_match_counts
                    .entry(script_id.to_string())
                    .or_insert(0) += 1;
                self.output_match_cooldowns
                    .insert(script_id.to_string(), Utc::now());
                // Clear matched portion to avoid re-matching
                self.output_buffer.clear();
                return true;
            }
        }

        false
    }

    /// Check if session is idle beyond threshold.
    pub fn check_idle(&mut self, threshold_ms: u64) -> bool {
        let elapsed = Utc::now()
            .signed_duration_since(self.last_activity)
            .num_milliseconds() as u64;
        if elapsed >= threshold_ms && !self.idle_notified {
            self.idle_notified = true;
            return true;
        }
        false
    }

    /// Check file mtime change (returns true if changed).
    pub fn check_file_mtime(
        &mut self,
        path: &str,
        current_mtime: &str,
        watch_type: &FileWatchType,
    ) -> bool {
        match watch_type {
            FileWatchType::Modified => {
                let changed = self
                    .file_watch_mtimes
                    .get(path)
                    .map(|prev| prev != current_mtime)
                    .unwrap_or(false); // first poll is baseline
                self.file_watch_mtimes
                    .insert(path.to_string(), current_mtime.to_string());
                changed
            }
            FileWatchType::Created => {
                let existed = self.file_watch_exists.get(path).copied().unwrap_or(false);
                let exists_now = !current_mtime.is_empty();
                self.file_watch_exists.insert(path.to_string(), exists_now);
                !existed && exists_now
            }
            FileWatchType::Deleted => {
                let existed = self.file_watch_exists.get(path).copied().unwrap_or(true);
                let exists_now = !current_mtime.is_empty();
                self.file_watch_exists.insert(path.to_string(), exists_now);
                existed && !exists_now
            }
            FileWatchType::Any => {
                let prev = self.file_watch_mtimes.get(path).cloned();
                let prev_exists = self.file_watch_exists.get(path).copied();
                self.file_watch_mtimes
                    .insert(path.to_string(), current_mtime.to_string());
                let exists_now = !current_mtime.is_empty();
                self.file_watch_exists.insert(path.to_string(), exists_now);

                match (prev, prev_exists) {
                    (None, _) => false, // first poll is baseline
                    (Some(p), _) => p != current_mtime,
                }
            }
        }
    }

    /// Check env variable change.
    pub fn check_env_change(
        &mut self,
        variable: &str,
        current_value: &str,
        expected: Option<&str>,
    ) -> bool {
        let prev = self.env_snapshots.get(variable).cloned();
        self.env_snapshots
            .insert(variable.to_string(), current_value.to_string());

        match prev {
            None => false, // first poll is baseline
            Some(ref p) if p == current_value => false,
            Some(_) => {
                // Value changed
                if let Some(exp) = expected {
                    current_value == exp
                } else {
                    true // any change triggers
                }
            }
        }
    }

    /// Check metric threshold with cooldown.
    pub fn check_metric_threshold(
        &mut self,
        script_id: &str,
        value: f64,
        threshold: f64,
        direction: &str,
        cooldown_ms: u64,
    ) -> bool {
        // Cooldown
        if cooldown_ms > 0 {
            if let Some(last) = self.metric_cooldowns.get(script_id) {
                let elapsed = Utc::now().signed_duration_since(*last).num_milliseconds() as u64;
                if elapsed < cooldown_ms {
                    return false;
                }
            }
        }

        let triggered = match direction {
            "above" => value >= threshold,
            "below" => value <= threshold,
            _ => false,
        };

        if triggered {
            self.metric_cooldowns
                .insert(script_id.to_string(), Utc::now());
        }

        triggered
    }
}

/// Maps an SSH lifecycle event to the trigger types it should fire.
pub fn map_event_to_triggers(event: &SshLifecycleEvent) -> Vec<&'static str> {
    match event.event_type {
        SshLifecycleEventType::Connected => vec!["login"],
        SshLifecycleEventType::Disconnected => vec!["logout"],
        SshLifecycleEventType::Reconnected => vec!["reconnect"],
        SshLifecycleEventType::ConnectionError => vec!["connectionError"],
        SshLifecycleEventType::KeepaliveFailed => vec!["keepaliveFailed"],
        SshLifecycleEventType::Idle => vec!["idle"],
        SshLifecycleEventType::Resize => vec!["resize"],
        SshLifecycleEventType::PortForwardEstablished => vec!["portForwardChange"],
        SshLifecycleEventType::PortForwardClosed => vec!["portForwardChange"],
        SshLifecycleEventType::HostKeyChanged => vec!["hostKeyChanged"],
        SshLifecycleEventType::OutputMatch => vec!["outputMatch"],
    }
}
