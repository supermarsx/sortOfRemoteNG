//! # Audit Trail
//!
//! Provides structured audit logging for all SSH agent operations. Persists
//! entries to disk, supports rotation, filtering, and export.

use crate::types::*;
use log::{debug, info};
use std::collections::VecDeque;
use std::path::PathBuf;

/// Maximum audit entries kept in memory (ring buffer).
const DEFAULT_MAX_IN_MEMORY: usize = 10_000;

/// Audit logger for SSH agent operations.
pub struct AuditLogger {
    /// In-memory ring buffer of recent entries.
    entries: VecDeque<AuditEntry>,
    /// Maximum entries to keep in memory.
    max_in_memory: usize,
    /// Whether audit logging is enabled.
    enabled: bool,
    /// Optional file path for persistent audit log.
    log_file: Option<PathBuf>,
    /// Total number of entries logged since start.
    total_logged: u64,
}

impl AuditLogger {
    /// Create a new audit logger.
    pub fn new(enabled: bool, max_in_memory: usize, log_file: Option<PathBuf>) -> Self {
        Self {
            entries: VecDeque::with_capacity(max_in_memory.min(1000)),
            max_in_memory,
            enabled,
            log_file,
            total_logged: 0,
        }
    }

    /// Create with default settings.
    pub fn default_logger() -> Self {
        Self::new(true, DEFAULT_MAX_IN_MEMORY, None)
    }

    /// Whether logging is enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Enable or disable logging.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// Log an audit event from an AgentEvent.
    pub fn log_event(&mut self, event: &AgentEvent) {
        if !self.enabled {
            return;
        }

        let (action, details) = event_to_audit(event);
        let entry = AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now(),
            action,
            key_fingerprint: extract_fingerprint(event),
            client_info: None,
            success: !matches!(event, AgentEvent::Error { .. }),
            details,
        };

        self.append(entry);
    }

    /// Log a custom audit entry.
    pub fn log_custom(
        &mut self,
        action: &str,
        key_fingerprint: Option<String>,
        success: bool,
        details: &str,
    ) {
        if !self.enabled {
            return;
        }

        let entry = AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now(),
            action: action.to_string(),
            key_fingerprint,
            client_info: None,
            success,
            details: details.to_string(),
        };

        self.append(entry);
    }

    /// Append an entry to the ring buffer and optionally persist.
    fn append(&mut self, entry: AuditEntry) {
        debug!("Audit: {} — {}", entry.action, entry.details);

        // Persist to file if configured
        if let Some(ref path) = self.log_file {
            if let Ok(line) = serde_json::to_string(&entry) {
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                {
                    let _ = writeln!(f, "{}", line);
                }
            }
        }

        // Add to ring buffer
        if self.entries.len() >= self.max_in_memory {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
        self.total_logged += 1;
    }

    /// Get all entries in the ring buffer.
    pub fn entries(&self) -> Vec<&AuditEntry> {
        self.entries.iter().collect()
    }

    /// Get the most recent N entries.
    pub fn recent(&self, count: usize) -> Vec<&AuditEntry> {
        self.entries.iter().rev().take(count).collect()
    }

    /// Filter entries by action.
    pub fn filter_by_action(&self, action: &str) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.action == action)
            .collect()
    }

    /// Filter entries by key fingerprint.
    pub fn filter_by_key(&self, fingerprint: &str) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .filter(|e| {
                e.key_fingerprint
                    .as_deref()
                    .map(|fp| fp == fingerprint)
                    .unwrap_or(false)
            })
            .collect()
    }

    /// Filter entries by time range.
    pub fn filter_by_time(
        &self,
        after: chrono::DateTime<chrono::Utc>,
        before: chrono::DateTime<chrono::Utc>,
    ) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.timestamp >= after && e.timestamp <= before)
            .collect()
    }

    /// Clear all in-memory entries.
    pub fn clear(&mut self) {
        self.entries.clear();
        info!("Audit log cleared");
    }

    /// Total entries logged since agent start.
    pub fn total_logged(&self) -> u64 {
        self.total_logged
    }

    /// Number of entries currently in memory.
    pub fn in_memory_count(&self) -> usize {
        self.entries.len()
    }

    /// Export all entries as JSON.
    pub fn export_json(&self) -> Result<String, String> {
        let entries: Vec<&AuditEntry> = self.entries.iter().collect();
        serde_json::to_string_pretty(&entries)
            .map_err(|e| format!("Failed to serialize audit log: {}", e))
    }

    /// Set the persistent log file.
    pub fn set_log_file(&mut self, path: Option<PathBuf>) {
        self.log_file = path;
    }

    /// Rotate the log file (rename current → .old, start fresh).
    pub fn rotate_log(&mut self) -> Result<(), String> {
        if let Some(ref path) = self.log_file {
            let old_path = path.with_extension("log.old");
            if path.exists() {
                std::fs::rename(path, &old_path)
                    .map_err(|e| format!("Failed to rotate log: {}", e))?;
            }
            info!("Audit log rotated");
        }
        Ok(())
    }
}

/// Convert an AgentEvent into an audit action + details string.
fn event_to_audit(event: &AgentEvent) -> (String, String) {
    match event {
        AgentEvent::Started => ("agent_started".to_string(), "SSH agent started".to_string()),
        AgentEvent::Stopped => ("agent_stopped".to_string(), "SSH agent stopped".to_string()),
        AgentEvent::Locked => ("agent_locked".to_string(), "Agent locked".to_string()),
        AgentEvent::Unlocked => ("agent_unlocked".to_string(), "Agent unlocked".to_string()),
        AgentEvent::KeyAdded { key_id, fingerprint } => (
            "key_added".to_string(),
            format!("Key {} added ({})", key_id, fingerprint),
        ),
        AgentEvent::KeyRemoved { key_id, fingerprint } => (
            "key_removed".to_string(),
            format!("Key {} removed ({})", key_id, fingerprint),
        ),
        AgentEvent::AllKeysRemoved => (
            "all_keys_removed".to_string(),
            "All keys removed".to_string(),
        ),
        AgentEvent::SignRequest { key_fingerprint, data_hash } => (
            "sign_request".to_string(),
            format!("Sign request for {} (data: {})", key_fingerprint, data_hash),
        ),
        AgentEvent::SignCompleted { key_fingerprint, success } => (
            "sign_completed".to_string(),
            format!(
                "Sign {} for {}",
                if *success { "succeeded" } else { "failed" },
                key_fingerprint
            ),
        ),
        AgentEvent::ForwardingStarted { session_id, remote_host } => (
            "forwarding_started".to_string(),
            format!("Forwarding started: {} → {}", session_id, remote_host),
        ),
        AgentEvent::ForwardingStopped { session_id } => (
            "forwarding_stopped".to_string(),
            format!("Forwarding stopped: {}", session_id),
        ),
        AgentEvent::ConstraintTriggered { key_id, constraint } => (
            "constraint_triggered".to_string(),
            format!("Constraint on {}: {}", key_id, constraint),
        ),
        AgentEvent::ConfirmationRequested(req) => (
            "confirmation_requested".to_string(),
            format!(
                "Confirmation required for {} (key: {})",
                req.id, req.key_fingerprint
            ),
        ),
        AgentEvent::ConfirmationResponse { request_id, approved } => (
            "confirmation_response".to_string(),
            format!(
                "Confirmation {}: {}",
                request_id,
                if *approved { "approved" } else { "denied" }
            ),
        ),
        AgentEvent::SystemAgentEvent { event } => (
            "system_agent_event".to_string(),
            format!("System agent: {}", event),
        ),
        AgentEvent::Pkcs11Event { provider, event } => (
            "pkcs11_event".to_string(),
            format!("PKCS#11 {} : {}", provider, event),
        ),
        AgentEvent::Error { message } => (
            "error".to_string(),
            format!("Error: {}", message),
        ),
    }
}

/// Extract a key fingerprint from an event (if any).
fn extract_fingerprint(event: &AgentEvent) -> Option<String> {
    match event {
        AgentEvent::KeyAdded { fingerprint, .. } => Some(fingerprint.clone()),
        AgentEvent::KeyRemoved { fingerprint, .. } => Some(fingerprint.clone()),
        AgentEvent::SignRequest { key_fingerprint, .. } => Some(key_fingerprint.clone()),
        AgentEvent::SignCompleted { key_fingerprint, .. } => Some(key_fingerprint.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_and_retrieve() {
        let mut logger = AuditLogger::default_logger();
        logger.log_event(&AgentEvent::Started);
        logger.log_event(&AgentEvent::KeyAdded {
            key_id: "k1".to_string(),
            fingerprint: "SHA256:abc".to_string(),
        });
        assert_eq!(logger.in_memory_count(), 2);
        assert_eq!(logger.total_logged(), 2);
    }

    #[test]
    fn test_recent() {
        let mut logger = AuditLogger::default_logger();
        for i in 0..5 {
            logger.log_custom(&format!("action_{}", i), None, true, "");
        }
        let recent = logger.recent(3);
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].action, "action_4");
    }

    #[test]
    fn test_filter_by_action() {
        let mut logger = AuditLogger::default_logger();
        logger.log_event(&AgentEvent::Started);
        logger.log_event(&AgentEvent::Locked);
        logger.log_event(&AgentEvent::Started);
        let starts = logger.filter_by_action("agent_started");
        assert_eq!(starts.len(), 2);
    }

    #[test]
    fn test_ring_buffer() {
        let mut logger = AuditLogger::new(true, 3, None);
        for i in 0..5 {
            logger.log_custom(&format!("a{}", i), None, true, "");
        }
        assert_eq!(logger.in_memory_count(), 3);
        assert_eq!(logger.entries()[0].action, "a2");
    }

    #[test]
    fn test_disabled() {
        let mut logger = AuditLogger::new(false, 100, None);
        logger.log_event(&AgentEvent::Started);
        assert_eq!(logger.in_memory_count(), 0);
    }

    #[test]
    fn test_clear() {
        let mut logger = AuditLogger::default_logger();
        logger.log_event(&AgentEvent::Started);
        logger.clear();
        assert_eq!(logger.in_memory_count(), 0);
    }

    #[test]
    fn test_export_json() {
        let mut logger = AuditLogger::default_logger();
        logger.log_event(&AgentEvent::Started);
        let json = logger.export_json().unwrap();
        assert!(json.contains("agent_started"));
    }
}
