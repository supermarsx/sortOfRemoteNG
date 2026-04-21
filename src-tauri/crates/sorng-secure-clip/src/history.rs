use chrono::Utc;

use crate::types::*;

/// In-memory history of clipboard copy/clear events.
/// Values are **never stored** — only metadata.
pub struct ClipHistory {
    entries: Vec<ClipHistoryEntry>,
    max_entries: usize,
}

impl ClipHistory {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_entries,
        }
    }

    /// Record a copy event (creates a history entry without clear info).
    pub fn record_copy(&mut self, entry: &ClipEntry) {
        let hist = ClipHistoryEntry {
            id: entry.id.clone(),
            kind: entry.kind,
            label: entry.label.clone(),
            connection_id: entry.connection_id.clone(),
            field: entry.field.clone(),
            copied_at: entry.copied_at,
            cleared_at: None,
            clear_reason: None,
            paste_count: 0,
            max_pastes: entry.max_pastes,
        };
        self.entries.insert(0, hist);
        self.entries.truncate(self.max_entries);
    }

    /// Record that an entry was cleared. Updates the matching history entry.
    pub fn record_clear(&mut self, entry: &ClipEntry, reason: ClearReason) {
        if let Some(hist) = self.entries.iter_mut().find(|h| h.id == entry.id) {
            hist.cleared_at = Some(Utc::now());
            hist.clear_reason = Some(reason);
            hist.paste_count = entry.paste_count;
        }
    }

    /// Record a replacement: the old entry was cleared because a new one was copied.
    pub fn record_replaced(&mut self, old_entry: &ClipEntry) {
        self.record_clear(old_entry, ClearReason::Replaced);
    }

    /// All history entries (most recent first).
    pub fn list(&self) -> &[ClipHistoryEntry] {
        &self.entries
    }

    /// History for a specific connection.
    pub fn for_connection(&self, connection_id: &str) -> Vec<&ClipHistoryEntry> {
        self.entries
            .iter()
            .filter(|h| h.connection_id.as_deref() == Some(connection_id))
            .collect()
    }

    /// History for a specific secret kind.
    pub fn for_kind(&self, kind: SecretKind) -> Vec<&ClipHistoryEntry> {
        self.entries.iter().filter(|h| h.kind == kind).collect()
    }

    /// Clear all history.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Number of history entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Is history empty?
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Update max entries (trims excess).
    pub fn set_max_entries(&mut self, max: usize) {
        self.max_entries = max;
        self.entries.truncate(max);
    }
}
