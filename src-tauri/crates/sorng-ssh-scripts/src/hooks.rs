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

    // OS detection (inferred from output patterns)
    pub os_type: Option<String>,
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
            os_type: None,
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

        // Attempt OS detection from output patterns (once)
        if self.os_type.is_none() {
            self.os_type = detect_os_from_output(&self.output_buffer);
        }
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

/// Infer OS type from terminal output patterns.
pub(crate) fn detect_os_from_output(output: &str) -> Option<String> {
    // Check last ~4KB for OS indicators
    let tail = if output.len() > 4096 {
        &output[output.len() - 4096..]
    } else {
        output
    };

    let lower = tail.to_lowercase();

    // uname output or /etc/os-release fragments
    if lower.contains("darwin") || lower.contains("macos") || lower.contains("mac os x") {
        return Some("macos".into());
    }
    if lower.contains("freebsd") {
        return Some("freebsd".into());
    }
    if lower.contains("openbsd") {
        return Some("openbsd".into());
    }
    if lower.contains("ubuntu") {
        return Some("linux-ubuntu".into());
    }
    if lower.contains("debian") {
        return Some("linux-debian".into());
    }
    if lower.contains("centos") || lower.contains("red hat") || lower.contains("rhel") {
        return Some("linux-redhat".into());
    }
    if lower.contains("alpine") {
        return Some("linux-alpine".into());
    }
    if lower.contains("arch linux") {
        return Some("linux-arch".into());
    }
    if lower.contains("suse") || lower.contains("sles") {
        return Some("linux-suse".into());
    }
    // Generic Linux detection (prompt patterns, common commands output)
    if lower.contains("linux") || lower.contains("/bin/bash") || lower.contains("/bin/sh") {
        return Some("linux".into());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── detect_os_from_output ────────────────────────────────

    #[test]
    fn detect_macos_from_uname() {
        assert_eq!(detect_os_from_output("Darwin Kernel Version 23.1.0"), Some("macos".into()));
    }

    #[test]
    fn detect_macos_from_name() {
        assert_eq!(detect_os_from_output("macOS Sonoma 14.2"), Some("macos".into()));
    }

    #[test]
    fn detect_ubuntu() {
        assert_eq!(detect_os_from_output("PRETTY_NAME=\"Ubuntu 22.04\""), Some("linux-ubuntu".into()));
    }

    #[test]
    fn detect_debian() {
        assert_eq!(detect_os_from_output("Debian GNU/Linux 12"), Some("linux-debian".into()));
    }

    #[test]
    fn detect_centos() {
        assert_eq!(detect_os_from_output("CentOS Stream release 9"), Some("linux-redhat".into()));
    }

    #[test]
    fn detect_redhat() {
        assert_eq!(detect_os_from_output("Red Hat Enterprise Linux 9.2"), Some("linux-redhat".into()));
    }

    #[test]
    fn detect_alpine() {
        assert_eq!(detect_os_from_output("welcome to Alpine Linux 3.19"), Some("linux-alpine".into()));
    }

    #[test]
    fn detect_arch() {
        assert_eq!(detect_os_from_output("Arch Linux (linux 6.7.0-arch1-1)"), Some("linux-arch".into()));
    }

    #[test]
    fn detect_suse() {
        assert_eq!(detect_os_from_output("SLES 15 SP5"), Some("linux-suse".into()));
    }

    #[test]
    fn detect_freebsd() {
        assert_eq!(detect_os_from_output("FreeBSD 14.0-RELEASE"), Some("freebsd".into()));
    }

    #[test]
    fn detect_openbsd() {
        assert_eq!(detect_os_from_output("OpenBSD 7.4"), Some("openbsd".into()));
    }

    #[test]
    fn detect_generic_linux() {
        assert_eq!(detect_os_from_output("Linux server01 6.1.0-17-amd64"), Some("linux".into()));
    }

    #[test]
    fn detect_linux_from_shell_path() {
        assert_eq!(detect_os_from_output("user@host:~$ /bin/bash"), Some("linux".into()));
    }

    #[test]
    fn detect_none_for_empty() {
        assert_eq!(detect_os_from_output(""), None);
    }

    #[test]
    fn detect_none_for_nondescript_output() {
        assert_eq!(detect_os_from_output("hello world\n$ ls\nfoo.txt"), None);
    }

    #[test]
    fn detect_uses_tail_only() {
        // Build a 5KB string with "ubuntu" only in the first 512 bytes
        let mut big = String::new();
        big.push_str("Ubuntu 22.04\n");
        for _ in 0..500 {
            big.push_str("no os info here at all\n");
        }
        // 500 * 23 = 11500 chars — "ubuntu" is well outside the last 4KB
        assert_eq!(detect_os_from_output(&big), None);
    }

    #[test]
    fn detect_case_insensitive() {
        assert_eq!(detect_os_from_output("DARWIN kernel"), Some("macos".into()));
        assert_eq!(detect_os_from_output("FREEBSD"), Some("freebsd".into()));
    }

    // ── SessionHookState ─────────────────────────────────────

    #[test]
    fn append_output_triggers_os_detection() {
        let mut state = SessionHookState::new("s1".into(), None, None, None);
        assert!(state.os_type.is_none());
        state.append_output("Welcome to Ubuntu 22.04\n");
        assert_eq!(state.os_type, Some("linux-ubuntu".into()));
    }

    #[test]
    fn append_output_detects_only_once() {
        let mut state = SessionHookState::new("s1".into(), None, None, None);
        state.append_output("FreeBSD 14.0\n");
        assert_eq!(state.os_type, Some("freebsd".into()));
        // Appending macOS output should NOT override
        state.append_output("Darwin Kernel Version 23\n");
        assert_eq!(state.os_type, Some("freebsd".into()));
    }

    #[test]
    fn output_buffer_trimmed_at_128kb() {
        let mut state = SessionHookState::new("s1".into(), None, None, None);
        let chunk = "x".repeat(1024);
        for _ in 0..200 {
            state.append_output(&chunk);
        }
        // Buffer should be capped at ~64KB after trim
        assert!(state.output_buffer.len() <= 128 * 1024);
    }

    #[test]
    fn check_output_match_basic() {
        let mut state = SessionHookState::new("s1".into(), None, None, None);
        state.append_output("error: disk full\n");
        assert!(state.check_output_match("script1", "error:.*disk", 0, 0));
        // Buffer cleared after match
        assert!(!state.check_output_match("script1", "error:.*disk", 0, 0));
    }

    #[test]
    fn check_output_match_max_triggers() {
        let mut state = SessionHookState::new("s1".into(), None, None, None);
        state.append_output("error!\n");
        assert!(state.check_output_match("s1", "error", 2, 0));
        state.append_output("error!\n");
        assert!(state.check_output_match("s1", "error", 2, 0));
        state.append_output("error!\n");
        // Third trigger should be blocked
        assert!(!state.check_output_match("s1", "error", 2, 0));
    }

    #[test]
    fn map_event_to_triggers_coverage() {
        let ev = |t: SshLifecycleEventType| SshLifecycleEvent {
            session_id: "s1".into(),
            connection_id: None,
            host: None,
            username: None,
            event_type: t,
            timestamp: Utc::now(),
            metadata: HashMap::new(),
        };
        assert_eq!(map_event_to_triggers(&ev(SshLifecycleEventType::Connected)), vec!["login"]);
        assert_eq!(map_event_to_triggers(&ev(SshLifecycleEventType::Disconnected)), vec!["logout"]);
        assert_eq!(map_event_to_triggers(&ev(SshLifecycleEventType::Reconnected)), vec!["reconnect"]);
        assert_eq!(map_event_to_triggers(&ev(SshLifecycleEventType::Idle)), vec!["idle"]);
        assert_eq!(map_event_to_triggers(&ev(SshLifecycleEventType::Resize)), vec!["resize"]);
        assert_eq!(
            map_event_to_triggers(&ev(SshLifecycleEventType::PortForwardEstablished)),
            vec!["portForwardChange"]
        );
    }
}
