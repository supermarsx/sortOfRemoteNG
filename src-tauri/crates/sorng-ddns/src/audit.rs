//! # DDNS Audit Logger
//!
//! Ring-buffer audit trail for all DDNS operations with query,
//! filtering, export, and rotation support.

use crate::types::*;
use chrono::Utc;
use uuid::Uuid;

/// Ring-buffer audit logger for DDNS operations.
#[derive(Debug, Clone)]
pub struct DdnsAuditLogger {
    /// Stored audit entries.
    entries: Vec<DdnsAuditEntry>,
    /// Maximum number of entries to retain.
    max_entries: usize,
}

impl DdnsAuditLogger {
    /// Create a new logger with default capacity.
    pub fn default_logger() -> Self {
        Self {
            entries: Vec::new(),
            max_entries: 5000,
        }
    }

    /// Create a new logger with a specified capacity.
    pub fn with_capacity(max_entries: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_entries,
        }
    }

    /// Log a DDNS audit event.
    pub fn log_event(
        &mut self,
        action: DdnsAuditAction,
        profile_id: Option<&str>,
        profile_name: Option<&str>,
        provider: Option<&DdnsProvider>,
        details: &str,
        success: bool,
        error: Option<&str>,
    ) {
        let entry = DdnsAuditEntry {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            action,
            profile_id: profile_id.map(|s| s.to_string()),
            profile_name: profile_name.map(|s| s.to_string()),
            provider: provider.cloned(),
            details: details.to_string(),
            success,
            error: error.map(|s| s.to_string()),
        };

        self.entries.push(entry);

        // Rotate if over max
        if self.entries.len() > self.max_entries {
            let drain_count = self.entries.len() - self.max_entries;
            self.entries.drain(0..drain_count);
        }
    }

    /// Get all audit entries (newest first).
    pub fn get_entries(&self) -> Vec<DdnsAuditEntry> {
        let mut entries = self.entries.clone();
        entries.reverse();
        entries
    }

    /// Get entries filtered by profile ID.
    pub fn get_entries_for_profile(&self, profile_id: &str) -> Vec<DdnsAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.profile_id.as_deref() == Some(profile_id))
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Get entries filtered by action type.
    pub fn get_entries_by_action(&self, action: &DdnsAuditAction) -> Vec<DdnsAuditEntry> {
        self.entries
            .iter()
            .filter(|e| &e.action == action)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Get entries within a time window.
    pub fn get_entries_since(&self, since_rfc3339: &str) -> Vec<DdnsAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.timestamp.as_str() >= since_rfc3339)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Get only failure entries.
    pub fn get_failures(&self) -> Vec<DdnsAuditEntry> {
        self.entries
            .iter()
            .filter(|e| !e.success)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Export all entries as JSON string.
    pub fn export_json(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&self.entries)
            .map_err(|e| format!("Failed to serialize audit log: {}", e))
    }

    /// Clear all entries.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Total number of entries.
    pub fn count(&self) -> usize {
        self.entries.len()
    }

    /// Set the maximum number of entries.
    pub fn set_max_entries(&mut self, max: usize) {
        self.max_entries = max;
        if self.entries.len() > max {
            let drain_count = self.entries.len() - max;
            self.entries.drain(0..drain_count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_and_retrieve() {
        let mut logger = DdnsAuditLogger::default_logger();
        logger.log_event(
            DdnsAuditAction::ProfileCreated,
            Some("prof-1"),
            Some("My Profile"),
            Some(&DdnsProvider::Cloudflare),
            "Created Cloudflare profile",
            true,
            None,
        );
        assert_eq!(logger.count(), 1);
        let entries = logger.get_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, DdnsAuditAction::ProfileCreated);
        assert!(entries[0].success);
    }

    #[test]
    fn test_ring_buffer_rotation() {
        let mut logger = DdnsAuditLogger::with_capacity(3);
        for i in 0..5 {
            logger.log_event(
                DdnsAuditAction::UpdateSuccess,
                Some(&format!("prof-{}", i)),
                None,
                None,
                &format!("Update {}", i),
                true,
                None,
            );
        }
        assert_eq!(logger.count(), 3);
        let entries = logger.get_entries();
        // Most recent 3
        assert!(entries[0].details.contains("Update 4"));
        assert!(entries[2].details.contains("Update 2"));
    }

    #[test]
    fn test_filter_by_profile() {
        let mut logger = DdnsAuditLogger::default_logger();
        logger.log_event(DdnsAuditAction::UpdateSuccess, Some("a"), None, None, "A1", true, None);
        logger.log_event(DdnsAuditAction::UpdateFailed, Some("b"), None, None, "B1", false, Some("err"));
        logger.log_event(DdnsAuditAction::UpdateSuccess, Some("a"), None, None, "A2", true, None);
        let a_entries = logger.get_entries_for_profile("a");
        assert_eq!(a_entries.len(), 2);
    }

    #[test]
    fn test_filter_failures() {
        let mut logger = DdnsAuditLogger::default_logger();
        logger.log_event(DdnsAuditAction::UpdateSuccess, None, None, None, "ok", true, None);
        logger.log_event(DdnsAuditAction::UpdateFailed, None, None, None, "fail", false, Some("err"));
        logger.log_event(DdnsAuditAction::UpdateAuthError, None, None, None, "auth", false, Some("bad key"));
        let failures = logger.get_failures();
        assert_eq!(failures.len(), 2);
    }

    #[test]
    fn test_export_and_clear() {
        let mut logger = DdnsAuditLogger::default_logger();
        logger.log_event(DdnsAuditAction::ConfigUpdated, None, None, None, "config changed", true, None);
        let json = logger.export_json().unwrap();
        assert!(json.contains("ConfigUpdated"));
        logger.clear();
        assert_eq!(logger.count(), 0);
    }
}
