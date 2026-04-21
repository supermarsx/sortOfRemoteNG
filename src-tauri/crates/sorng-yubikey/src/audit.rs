//! # YubiKey Audit Logger
//!
//! Ring-buffer audit logger for all YubiKey operations. Follows the
//! same pattern as `sorng-gpg-agent`'s audit module — in-memory ring
//! buffer with optional file persistence.

use crate::types::*;
use log::info;
use std::collections::VecDeque;
use std::path::PathBuf;

/// Maximum audit entries kept in memory.
const DEFAULT_MAX_IN_MEMORY: usize = 10_000;

/// Audit logger for YubiKey operations.
pub struct YubiKeyAuditLogger {
    /// In-memory ring buffer of entries.
    entries: VecDeque<YubiKeyAuditEntry>,
    /// Maximum entries in memory.
    max_in_memory: usize,
    /// Whether logging is enabled.
    enabled: bool,
    /// Optional file for persistent audit log.
    log_file: Option<PathBuf>,
    /// Total entries logged since start.
    total_logged: u64,
}

impl YubiKeyAuditLogger {
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

    /// Log a YubiKey audit event.
    pub fn log_event(
        &mut self,
        action: YubiKeyAuditAction,
        serial: Option<u32>,
        details: &str,
        success: bool,
        error: Option<String>,
    ) {
        if !self.enabled {
            return;
        }

        let entry = YubiKeyAuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            action,
            serial,
            details: details.to_string(),
            success,
            error,
        };

        self.append(entry);
    }

    /// Append an entry to the ring buffer.
    fn append(&mut self, entry: YubiKeyAuditEntry) {
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
    pub fn get_entries(&self, limit: usize) -> Vec<YubiKeyAuditEntry> {
        let start = if self.entries.len() > limit {
            self.entries.len() - limit
        } else {
            0
        };
        self.entries.iter().skip(start).cloned().collect()
    }

    /// Filter entries by action.
    pub fn filter_by_action(&self, action: &YubiKeyAuditAction) -> Vec<YubiKeyAuditEntry> {
        self.entries
            .iter()
            .filter(|e| &e.action == action)
            .cloned()
            .collect()
    }

    /// Filter entries by serial number.
    pub fn filter_by_serial(&self, serial: u32) -> Vec<YubiKeyAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.serial == Some(serial))
            .cloned()
            .collect()
    }

    /// Export all entries as JSON.
    pub fn export_json(&self) -> Result<String, String> {
        let entries: Vec<&YubiKeyAuditEntry> = self.entries.iter().collect();
        serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
    }

    /// Clear all entries.
    pub fn clear(&mut self) {
        self.entries.clear();
        info!("YubiKey audit log cleared");
    }

    /// Rotate: clear in-memory buffer (file is append-only).
    pub fn rotate(&mut self) {
        let count = self.entries.len();
        self.entries.clear();
        info!("YubiKey audit log rotated ({} entries cleared)", count);
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
        let logger = YubiKeyAuditLogger::default_logger();
        assert!(logger.is_enabled());
        assert_eq!(logger.entry_count(), 0);
        assert_eq!(logger.total_logged(), 0);
    }

    #[test]
    fn test_log_event() {
        let mut logger = YubiKeyAuditLogger::default_logger();
        logger.log_event(
            YubiKeyAuditAction::DeviceDetected,
            Some(12345678),
            "YubiKey detected",
            true,
            None,
        );
        assert_eq!(logger.entry_count(), 1);
        assert_eq!(logger.total_logged(), 1);

        let entries = logger.get_entries(10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, YubiKeyAuditAction::DeviceDetected);
        assert_eq!(entries[0].serial, Some(12345678));
        assert!(entries[0].success);
    }

    #[test]
    fn test_ring_buffer_limit() {
        let mut logger = YubiKeyAuditLogger::new(true, 3, None);
        for i in 0..5 {
            logger.log_event(
                YubiKeyAuditAction::OathCalculate,
                Some(i),
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
        assert_eq!(entries[0].serial, Some(2));
        assert_eq!(entries[2].serial, Some(4));
    }

    #[test]
    fn test_filter_by_action() {
        let mut logger = YubiKeyAuditLogger::default_logger();
        logger.log_event(YubiKeyAuditAction::PivSign, None, "sign1", true, None);
        logger.log_event(YubiKeyAuditAction::OathCalculate, None, "calc1", true, None);
        logger.log_event(YubiKeyAuditAction::PivSign, None, "sign2", true, None);

        let sign_entries = logger.filter_by_action(&YubiKeyAuditAction::PivSign);
        assert_eq!(sign_entries.len(), 2);

        let calc_entries = logger.filter_by_action(&YubiKeyAuditAction::OathCalculate);
        assert_eq!(calc_entries.len(), 1);
    }

    #[test]
    fn test_filter_by_serial() {
        let mut logger = YubiKeyAuditLogger::default_logger();
        logger.log_event(
            YubiKeyAuditAction::DeviceDetected,
            Some(111),
            "dev 111",
            true,
            None,
        );
        logger.log_event(
            YubiKeyAuditAction::DeviceDetected,
            Some(222),
            "dev 222",
            true,
            None,
        );
        logger.log_event(
            YubiKeyAuditAction::PivSign,
            Some(111),
            "sign on 111",
            true,
            None,
        );

        let entries_111 = logger.filter_by_serial(111);
        assert_eq!(entries_111.len(), 2);

        let entries_222 = logger.filter_by_serial(222);
        assert_eq!(entries_222.len(), 1);
    }

    #[test]
    fn test_export_json() {
        let mut logger = YubiKeyAuditLogger::default_logger();
        logger.log_event(
            YubiKeyAuditAction::ConfigUpdate,
            None,
            "test export",
            true,
            None,
        );

        let json = logger.export_json().unwrap();
        assert!(json.contains("ConfigUpdate"));
        assert!(json.contains("test export"));
    }

    #[test]
    fn test_clear() {
        let mut logger = YubiKeyAuditLogger::default_logger();
        logger.log_event(YubiKeyAuditAction::FactoryReset, None, "reset", true, None);
        assert_eq!(logger.entry_count(), 1);

        logger.clear();
        assert_eq!(logger.entry_count(), 0);
        // total_logged is not reset
        assert_eq!(logger.total_logged(), 1);
    }

    #[test]
    fn test_disabled_logger() {
        let mut logger = YubiKeyAuditLogger::new(false, 100, None);
        logger.log_event(
            YubiKeyAuditAction::DeviceDetected,
            None,
            "should not appear",
            true,
            None,
        );
        assert_eq!(logger.entry_count(), 0);
        assert_eq!(logger.total_logged(), 0);
    }
}
