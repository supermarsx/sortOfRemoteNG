//! # Audit Log
//!
//! Append-only audit trail for credential lifecycle events, with bounded
//! size and export support.

use crate::error::CredentialError;
use crate::types::{AuditAction, CredentialAuditEntry};
use log::info;

/// Bounded audit log for credential lifecycle events.
#[derive(Debug)]
pub struct AuditLog {
    /// All recorded entries (newest last).
    pub entries: Vec<CredentialAuditEntry>,
    /// Maximum number of entries to retain before the oldest are dropped.
    pub max_size: usize,
}

impl AuditLog {
    /// Create a new audit log with the given maximum capacity.
    pub fn new(max_size: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_size,
        }
    }

    /// Append an entry, evicting the oldest if at capacity.
    pub fn log_action(&mut self, entry: CredentialAuditEntry) {
        info!(
            "Audit: {} credential {} — {}",
            entry.action, entry.credential_id, entry.details
        );
        self.entries.push(entry);
        if self.entries.len() > self.max_size {
            let overflow = self.entries.len() - self.max_size;
            self.entries.drain(..overflow);
        }
    }

    /// Get all entries for a specific credential.
    pub fn get_entries_for_credential(&self, credential_id: &str) -> Vec<&CredentialAuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.credential_id == credential_id)
            .collect()
    }

    /// Return the `count` most recent entries.
    pub fn get_recent(&self, count: usize) -> Vec<&CredentialAuditEntry> {
        let start = self.entries.len().saturating_sub(count);
        self.entries[start..].iter().collect()
    }

    /// Return all entries with the specified action.
    pub fn get_by_action(&self, action: AuditAction) -> Vec<&CredentialAuditEntry> {
        self.entries.iter().filter(|e| e.action == action).collect()
    }

    /// Drop all entries.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Serialize the full log as pretty-printed JSON.
    pub fn export_json(&self) -> Result<String, CredentialError> {
        serde_json::to_string_pretty(&self.entries).map_err(CredentialError::from)
    }
}

impl Default for AuditLog {
    fn default() -> Self {
        Self::new(10_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AuditAction;
    use chrono::Utc;

    fn make_entry(id: &str, cred: &str, action: AuditAction) -> CredentialAuditEntry {
        CredentialAuditEntry {
            id: id.to_string(),
            credential_id: cred.to_string(),
            action,
            timestamp: Utc::now(),
            details: "test".to_string(),
            user: "admin".to_string(),
        }
    }

    #[test]
    fn log_and_retrieve() {
        let mut log = AuditLog::new(100);
        log.log_action(make_entry("a1", "c1", AuditAction::Created));
        log.log_action(make_entry("a2", "c1", AuditAction::Rotated));
        log.log_action(make_entry("a3", "c2", AuditAction::Created));

        assert_eq!(log.get_entries_for_credential("c1").len(), 2);
        assert_eq!(log.get_entries_for_credential("c2").len(), 1);
    }

    #[test]
    fn recent_entries() {
        let mut log = AuditLog::new(100);
        for i in 0..5 {
            log.log_action(make_entry(&format!("a{i}"), "c1", AuditAction::Created));
        }
        assert_eq!(log.get_recent(3).len(), 3);
        assert_eq!(log.get_recent(100).len(), 5);
    }

    #[test]
    fn by_action() {
        let mut log = AuditLog::new(100);
        log.log_action(make_entry("a1", "c1", AuditAction::Created));
        log.log_action(make_entry("a2", "c1", AuditAction::Rotated));
        log.log_action(make_entry("a3", "c2", AuditAction::Rotated));
        assert_eq!(log.get_by_action(AuditAction::Rotated).len(), 2);
        assert_eq!(log.get_by_action(AuditAction::Deleted).len(), 0);
    }

    #[test]
    fn max_size_eviction() {
        let mut log = AuditLog::new(3);
        for i in 0..5 {
            log.log_action(make_entry(&format!("a{i}"), "c1", AuditAction::Created));
        }
        assert_eq!(log.entries.len(), 3);
        // Oldest entries should have been evicted
        assert_eq!(log.entries[0].id, "a2");
    }

    #[test]
    fn clear_empties_log() {
        let mut log = AuditLog::new(100);
        log.log_action(make_entry("a1", "c1", AuditAction::Created));
        log.clear();
        assert!(log.entries.is_empty());
    }

    #[test]
    fn export_json() {
        let mut log = AuditLog::new(100);
        log.log_action(make_entry("a1", "c1", AuditAction::Created));
        let json = log.export_json().unwrap();
        assert!(json.contains("a1"));
    }
}
