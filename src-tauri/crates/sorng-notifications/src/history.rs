//! # Notification History
//!
//! In-memory storage of notification records with FIFO eviction, querying by
//! rule/channel/status, and aggregate statistics.

use crate::types::{NotificationRecord, NotificationStats};
use std::collections::HashMap;

/// Stores sent notification records with a configurable maximum size.
pub struct NotificationHistory {
    /// The notification records, ordered newest-first.
    records: Vec<NotificationRecord>,
    /// Maximum number of records to retain. Oldest entries are evicted first.
    max_size: usize,
}

impl NotificationHistory {
    /// Create a new history store with the given capacity.
    pub fn new(max_size: usize) -> Self {
        Self {
            records: Vec::with_capacity(max_size.min(10_000)),
            max_size,
        }
    }

    /// Add a notification record. If the history is at capacity the oldest
    /// record is evicted.
    pub fn add(&mut self, record: NotificationRecord) {
        if self.records.len() >= self.max_size {
            // Remove the oldest (last) entry.
            self.records.pop();
        }
        // Insert newest at the front.
        self.records.insert(0, record);
    }

    /// Look up a record by its unique ID.
    pub fn get_by_id(&self, id: &str) -> Option<&NotificationRecord> {
        self.records.iter().find(|r| r.id == id)
    }

    /// Return all records produced by a specific rule.
    pub fn get_by_rule(&self, rule_id: &str) -> Vec<&NotificationRecord> {
        self.records
            .iter()
            .filter(|r| r.rule_id == rule_id)
            .collect()
    }

    /// Return the most recent `count` records.
    pub fn get_recent(&self, count: usize) -> Vec<&NotificationRecord> {
        self.records.iter().take(count).collect()
    }

    /// Return all records delivered through a specific channel.
    pub fn get_by_channel(&self, channel: &str) -> Vec<&NotificationRecord> {
        self.records
            .iter()
            .filter(|r| r.channel == channel)
            .collect()
    }

    /// Return all records that failed to deliver.
    pub fn get_failed(&self) -> Vec<&NotificationRecord> {
        self.records.iter().filter(|r| !r.delivered).collect()
    }

    /// Clear all history records.
    pub fn clear(&mut self) {
        self.records.clear();
    }

    /// Return the total number of stored records.
    pub fn count(&self) -> usize {
        self.records.len()
    }

    /// Compute aggregate statistics over the current history.
    pub fn stats(&self) -> NotificationStats {
        let total_sent = self.records.len();
        let total_delivered = self.records.iter().filter(|r| r.delivered).count();
        let total_failed = total_sent - total_delivered;

        let mut by_channel: HashMap<String, usize> = HashMap::new();
        let mut by_priority: HashMap<String, usize> = HashMap::new();
        let mut by_rule: HashMap<String, usize> = HashMap::new();

        for record in &self.records {
            *by_channel.entry(record.channel.clone()).or_default() += 1;
            *by_priority.entry(record.priority.to_string()).or_default() += 1;
            *by_rule.entry(record.rule_id.clone()).or_default() += 1;
        }

        NotificationStats {
            total_sent,
            total_delivered,
            total_failed,
            by_channel,
            by_priority,
            by_rule,
        }
    }

    /// Update the maximum history size. If the new size is smaller than the
    /// current count, the oldest records are evicted.
    pub fn set_max_size(&mut self, new_max: usize) {
        self.max_size = new_max;
        while self.records.len() > self.max_size {
            self.records.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::NotificationPriority;
    use chrono::Utc;

    fn make_record(id: &str, rule_id: &str, channel: &str, delivered: bool) -> NotificationRecord {
        NotificationRecord {
            id: id.into(),
            rule_id: rule_id.into(),
            rule_name: format!("Rule {}", rule_id),
            channel: channel.into(),
            priority: NotificationPriority::Normal,
            title: "Test".into(),
            body: "Test body".into(),
            sent_at: Utc::now(),
            delivered,
            error: if delivered {
                None
            } else {
                Some("failed".into())
            },
            event_data: None,
        }
    }

    #[test]
    fn add_and_retrieve() {
        let mut hist = NotificationHistory::new(100);
        hist.add(make_record("a", "r1", "slack", true));
        hist.add(make_record("b", "r1", "discord", false));

        assert_eq!(hist.count(), 2);
        assert!(hist.get_by_id("a").is_some());
        assert_eq!(hist.get_by_rule("r1").len(), 2);
        assert_eq!(hist.get_by_channel("slack").len(), 1);
        assert_eq!(hist.get_failed().len(), 1);
    }

    #[test]
    fn fifo_eviction() {
        let mut hist = NotificationHistory::new(2);
        hist.add(make_record("a", "r1", "slack", true));
        hist.add(make_record("b", "r1", "slack", true));
        hist.add(make_record("c", "r1", "slack", true));

        assert_eq!(hist.count(), 2);
        // 'a' should have been evicted (oldest).
        assert!(hist.get_by_id("a").is_none());
        assert!(hist.get_by_id("b").is_some());
        assert!(hist.get_by_id("c").is_some());
    }

    #[test]
    fn stats_computation() {
        let mut hist = NotificationHistory::new(100);
        hist.add(make_record("a", "r1", "slack", true));
        hist.add(make_record("b", "r2", "discord", false));
        hist.add(make_record("c", "r1", "slack", true));

        let s = hist.stats();
        assert_eq!(s.total_sent, 3);
        assert_eq!(s.total_delivered, 2);
        assert_eq!(s.total_failed, 1);
        assert_eq!(s.by_channel.get("slack"), Some(&2));
        assert_eq!(s.by_channel.get("discord"), Some(&1));
    }
}
