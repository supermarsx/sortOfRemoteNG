//! # GPG Audit Logger
//!
//! Ring-buffer audit logger for all GPG operations. Follows the same
//! pattern as `sorng-ssh-agent`'s audit module — in-memory ring buffer
//! with optional file persistence.

use crate::types::*;
use log::info;
use std::collections::VecDeque;
use std::path::PathBuf;

/// Maximum audit entries kept in memory.
const DEFAULT_MAX_IN_MEMORY: usize = 10_000;

/// Audit logger for GPG operations.
pub struct GpgAuditLogger {
    /// In-memory ring buffer of entries.
    entries: VecDeque<GpgAuditEntry>,
    /// Maximum entries in memory.
    max_in_memory: usize,
    /// Whether logging is enabled.
    enabled: bool,
    /// Optional file for persistent audit log.
    log_file: Option<PathBuf>,
    /// Total entries logged since start.
    total_logged: u64,
}

impl GpgAuditLogger {
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

    /// Log a GPG audit event.
    pub fn log_event(
        &mut self,
        action: GpgAuditAction,
        key_id: Option<String>,
        uid: Option<String>,
        details: &str,
        success: bool,
        error: Option<String>,
    ) {
        if !self.enabled {
            return;
        }

        let entry = GpgAuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            action,
            key_id,
            uid,
            details: details.to_string(),
            success,
            error,
        };

        self.append(entry);
    }

    /// Append an entry to the ring buffer.
    fn append(&mut self, entry: GpgAuditEntry) {
        // Persist to file if configured
        if let Some(ref path) = self.log_file {
            if let Ok(json) = serde_json::to_string(&entry) {
                let _ = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .and_then(|mut f| {
                        use std::io::Write;
                        writeln!(f, "{}", json)
                    });
            }
        }

        // Add to ring buffer
        if self.entries.len() >= self.max_in_memory {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
        self.total_logged += 1;
    }

    /// Get recent entries (up to `limit`).
    pub fn get_entries(&self, limit: usize) -> Vec<GpgAuditEntry> {
        let start = if self.entries.len() > limit {
            self.entries.len() - limit
        } else {
            0
        };
        self.entries.iter().skip(start).cloned().collect()
    }

    /// Filter entries by action.
    pub fn filter_by_action(&self, action: &GpgAuditAction) -> Vec<GpgAuditEntry> {
        self.entries
            .iter()
            .filter(|e| &e.action == action)
            .cloned()
            .collect()
    }

    /// Filter entries by key ID.
    pub fn filter_by_key(&self, key_id: &str) -> Vec<GpgAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.key_id.as_deref() == Some(key_id))
            .cloned()
            .collect()
    }

    /// Export all entries as JSON.
    pub fn export_json(&self) -> Result<String, String> {
        let entries: Vec<&GpgAuditEntry> = self.entries.iter().collect();
        serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
    }

    /// Clear all entries.
    pub fn clear(&mut self) {
        self.entries.clear();
        info!("GPG audit log cleared");
    }

    /// Rotate: clear in-memory buffer (file is append-only).
    pub fn rotate(&mut self) {
        let count = self.entries.len();
        self.entries.clear();
        info!("GPG audit log rotated ({} entries cleared)", count);
    }

    /// Total entries logged since start.
    pub fn total_logged(&self) -> u64 {
        self.total_logged
    }

    /// Current number of entries in memory.
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_logger_default() {
        let logger = GpgAuditLogger::default_logger();
        assert!(logger.is_enabled());
        assert_eq!(logger.entry_count(), 0);
        assert_eq!(logger.total_logged(), 0);
    }

    #[test]
    fn test_log_event() {
        let mut logger = GpgAuditLogger::default_logger();
        logger.log_event(
            GpgAuditAction::Sign,
            Some("AABB1122".to_string()),
            None,
            "Signed test data",
            true,
            None,
        );
        assert_eq!(logger.entry_count(), 1);
        assert_eq!(logger.total_logged(), 1);

        let entries = logger.get_entries(10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, GpgAuditAction::Sign);
        assert!(entries[0].success);
    }

    #[test]
    fn test_ring_buffer_limit() {
        let mut logger = GpgAuditLogger::new(true, 3, None);
        for i in 0..5 {
            logger.log_event(
                GpgAuditAction::Encrypt,
                Some(format!("key_{}", i)),
                None,
                &format!("event {}", i),
                true,
                None,
            );
        }
        assert_eq!(logger.entry_count(), 3);
        assert_eq!(logger.total_logged(), 5);

        let entries = logger.get_entries(10);
        assert_eq!(entries.len(), 3);
        // Should have the last 3
        assert_eq!(entries[0].key_id.as_deref(), Some("key_2"));
        assert_eq!(entries[2].key_id.as_deref(), Some("key_4"));
    }

    #[test]
    fn test_filter_by_action() {
        let mut logger = GpgAuditLogger::default_logger();
        logger.log_event(GpgAuditAction::Sign, None, None, "sign1", true, None);
        logger.log_event(GpgAuditAction::Encrypt, None, None, "encrypt1", true, None);
        logger.log_event(GpgAuditAction::Sign, None, None, "sign2", true, None);

        let sign_entries = logger.filter_by_action(&GpgAuditAction::Sign);
        assert_eq!(sign_entries.len(), 2);

        let enc_entries = logger.filter_by_action(&GpgAuditAction::Encrypt);
        assert_eq!(enc_entries.len(), 1);
    }

    #[test]
    fn test_filter_by_key() {
        let mut logger = GpgAuditLogger::default_logger();
        logger.log_event(
            GpgAuditAction::Sign,
            Some("KEY_A".to_string()),
            None,
            "a",
            true,
            None,
        );
        logger.log_event(
            GpgAuditAction::Sign,
            Some("KEY_B".to_string()),
            None,
            "b",
            true,
            None,
        );
        logger.log_event(
            GpgAuditAction::Encrypt,
            Some("KEY_A".to_string()),
            None,
            "c",
            true,
            None,
        );

        let a_entries = logger.filter_by_key("KEY_A");
        assert_eq!(a_entries.len(), 2);
    }

    #[test]
    fn test_export_json() {
        let mut logger = GpgAuditLogger::default_logger();
        logger.log_event(GpgAuditAction::KeyGenerate, None, None, "test", true, None);

        let json = logger.export_json().unwrap();
        assert!(json.contains("KeyGenerate"));
        assert!(json.contains("test"));
    }

    #[test]
    fn test_clear() {
        let mut logger = GpgAuditLogger::default_logger();
        logger.log_event(GpgAuditAction::Sign, None, None, "x", true, None);
        assert_eq!(logger.entry_count(), 1);

        logger.clear();
        assert_eq!(logger.entry_count(), 0);
        assert_eq!(logger.total_logged(), 1); // total not reset
    }

    #[test]
    fn test_disabled_logging() {
        let mut logger = GpgAuditLogger::new(false, 100, None);
        logger.log_event(GpgAuditAction::Sign, None, None, "skip", true, None);
        assert_eq!(logger.entry_count(), 0);

        logger.set_enabled(true);
        logger.log_event(GpgAuditAction::Sign, None, None, "not skip", true, None);
        assert_eq!(logger.entry_count(), 1);
    }

    #[test]
    fn test_get_entries_limit() {
        let mut logger = GpgAuditLogger::default_logger();
        for _ in 0..10 {
            logger.log_event(GpgAuditAction::Verify, None, None, "x", true, None);
        }

        let limited = logger.get_entries(3);
        assert_eq!(limited.len(), 3);

        let all = logger.get_entries(100);
        assert_eq!(all.len(), 10);
    }
}
