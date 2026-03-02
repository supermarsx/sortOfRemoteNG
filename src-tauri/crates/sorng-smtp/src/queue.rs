//! Async send queue with retry, scheduling, throttling.
//!
//! Messages are enqueued and processed asynchronously with configurable
//! concurrency, retry logic (exponential backoff), and rate limiting.

use std::collections::HashMap;

use chrono::Utc;
use log::{debug, info, warn};

use crate::types::*;

/// The in-memory send queue.
pub struct SendQueue {
    items: Vec<QueueItem>,
    config: QueueConfig,
    /// Per-server last-send timestamp for rate limiting.
    last_send: HashMap<String, chrono::DateTime<Utc>>,
}

impl SendQueue {
    pub fn new(config: QueueConfig) -> Self {
        Self {
            items: Vec::new(),
            config,
            last_send: HashMap::new(),
        }
    }

    pub fn config(&self) -> &QueueConfig {
        &self.config
    }

    /// Enqueue a message.
    pub fn enqueue(&mut self, message: EmailMessage) -> SmtpResult<String> {
        if self.items.len() >= self.config.max_size {
            return Err(SmtpError::queue(format!(
                "Queue full ({}/{})",
                self.items.len(),
                self.config.max_size
            )));
        }
        let item = QueueItem::new(message);
        let id = item.id.clone();
        debug!("Enqueued message {}", id);
        self.items.push(item);
        Ok(id)
    }

    /// Enqueue a message with a specific schedule.
    pub fn enqueue_scheduled(
        &mut self,
        message: EmailMessage,
        schedule: SendSchedule,
    ) -> SmtpResult<String> {
        if self.items.len() >= self.config.max_size {
            return Err(SmtpError::queue("Queue full"));
        }
        let mut item = QueueItem::new(message);
        match schedule {
            SendSchedule::Immediate => {}
            SendSchedule::At(dt) => {
                item.scheduled_at = Some(dt);
            }
            SendSchedule::AfterSeconds(secs) => {
                item.scheduled_at = Some(Utc::now() + chrono::Duration::seconds(secs as i64));
            }
        }
        let id = item.id.clone();
        debug!("Enqueued scheduled message {}", id);
        self.items.push(item);
        Ok(id)
    }

    /// Enqueue for a specific profile.
    pub fn enqueue_with_profile(
        &mut self,
        message: EmailMessage,
        profile_name: &str,
    ) -> SmtpResult<String> {
        if self.items.len() >= self.config.max_size {
            return Err(SmtpError::queue("Queue full"));
        }
        let mut item = QueueItem::new(message);
        item.profile_name = Some(profile_name.to_string());
        let id = item.id.clone();
        self.items.push(item);
        Ok(id)
    }

    /// Get the next batch of items ready to send.
    pub fn next_batch(&mut self) -> Vec<&mut QueueItem> {
        let now = Utc::now();
        let batch_size = self.config.concurrency;

        self.items
            .iter_mut()
            .filter(|item| {
                matches!(item.status, QueueItemStatus::Pending | QueueItemStatus::ScheduledRetry)
                    && item
                        .scheduled_at
                        .map(|s| s <= now)
                        .unwrap_or(true)
            })
            .take(batch_size)
            .collect()
    }

    /// Mark an item as sending.
    pub fn mark_sending(&mut self, id: &str) -> SmtpResult<()> {
        let item = self
            .items
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or_else(|| SmtpError::queue(format!("Queue item not found: {}", id)))?;
        item.status = QueueItemStatus::Sending;
        item.send_started_at = Some(Utc::now());
        item.attempts += 1;
        Ok(())
    }

    /// Mark an item as successfully sent.
    pub fn mark_sent(
        &mut self,
        id: &str,
        recipients: Vec<RecipientDeliveryStatus>,
    ) -> SmtpResult<()> {
        let item = self
            .items
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or_else(|| SmtpError::queue(format!("Queue item not found: {}", id)))?;
        item.status = QueueItemStatus::Sent;
        item.completed_at = Some(Utc::now());
        for r in recipients {
            item.recipient_status.insert(r.address.clone(), r);
        }
        info!("Message {} sent successfully", id);
        Ok(())
    }

    /// Mark an item as failed and potentially schedule retry.
    pub fn mark_failed(&mut self, id: &str, error: &str) -> SmtpResult<()> {
        let max_retries = self.config.max_retries;
        let base_delay = self.config.retry_base_delay_secs;
        let max_delay = self.config.retry_max_delay_secs;

        let item = self
            .items
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or_else(|| SmtpError::queue(format!("Queue item not found: {}", id)))?;

        item.error_log.push(error.to_string());

        if item.attempts < max_retries {
            // Schedule retry with exponential backoff
            let delay_secs = std::cmp::min(
                base_delay * 2u64.pow(item.attempts.saturating_sub(1)),
                max_delay,
            );
            item.status = QueueItemStatus::ScheduledRetry;
            item.scheduled_at = Some(Utc::now() + chrono::Duration::seconds(delay_secs as i64));
            warn!(
                "Message {} failed (attempt {}): {}. Retry in {}s",
                id, item.attempts, error, delay_secs
            );
        } else {
            item.status = QueueItemStatus::Failed;
            item.completed_at = Some(Utc::now());
            warn!(
                "Message {} permanently failed after {} attempts: {}",
                id, item.attempts, error
            );
        }
        Ok(())
    }

    /// Cancel a pending/scheduled item.
    pub fn cancel(&mut self, id: &str) -> SmtpResult<()> {
        let item = self
            .items
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or_else(|| SmtpError::queue(format!("Queue item not found: {}", id)))?;
        match item.status {
            QueueItemStatus::Pending | QueueItemStatus::ScheduledRetry => {
                item.status = QueueItemStatus::Cancelled;
                item.completed_at = Some(Utc::now());
                Ok(())
            }
            _ => Err(SmtpError::queue(format!(
                "Cannot cancel item {} in {:?} state",
                id, item.status
            ))),
        }
    }

    /// Get a queue item by ID.
    pub fn get(&self, id: &str) -> Option<&QueueItem> {
        self.items.iter().find(|i| i.id == id)
    }

    /// List all items, optionally filtered by status.
    pub fn list(&self, status: Option<QueueItemStatus>) -> Vec<&QueueItem> {
        match status {
            Some(s) => self.items.iter().filter(|i| i.status == s).collect(),
            None => self.items.iter().collect(),
        }
    }

    /// Get queue summary statistics.
    pub fn summary(&self) -> QueueSummary {
        let mut qs = QueueSummary {
            total: self.items.len(),
            ..Default::default()
        };
        for item in &self.items {
            match item.status {
                QueueItemStatus::Pending => qs.pending += 1,
                QueueItemStatus::Sending => qs.sending += 1,
                QueueItemStatus::Sent => qs.sent += 1,
                QueueItemStatus::Failed => qs.failed += 1,
                QueueItemStatus::ScheduledRetry => qs.scheduled_retry += 1,
                QueueItemStatus::Cancelled => qs.cancelled += 1,
            }
        }
        qs
    }

    /// Remove completed (sent/failed/cancelled) items.
    pub fn purge_completed(&mut self) -> usize {
        let before = self.items.len();
        self.items.retain(|i| {
            !matches!(
                i.status,
                QueueItemStatus::Sent | QueueItemStatus::Failed | QueueItemStatus::Cancelled
            )
        });
        let removed = before - self.items.len();
        if removed > 0 {
            debug!("Purged {} completed items from queue", removed);
        }
        removed
    }

    /// Clear all items.
    pub fn clear(&mut self) -> usize {
        let count = self.items.len();
        self.items.clear();
        count
    }

    /// Mutable access to the internal items vec.
    pub fn items_mut(&mut self) -> &mut Vec<QueueItem> {
        &mut self.items
    }

    /// Check if we should throttle sending to a given server.
    pub fn should_throttle(&self, server: &str) -> bool {
        if self.config.throttle_ms == 0 {
            return false;
        }
        if let Some(last) = self.last_send.get(server) {
            let elapsed = Utc::now().signed_duration_since(*last);
            elapsed.num_milliseconds() < self.config.throttle_ms as i64
        } else {
            false
        }
    }

    /// Record a send to a server for rate-limiting.
    pub fn record_send(&mut self, server: &str) {
        self.last_send.insert(server.to_string(), Utc::now());
    }

    /// Retry all failed items (reset them to pending).
    pub fn retry_all_failed(&mut self) -> usize {
        let mut count = 0;
        for item in &mut self.items {
            if item.status == QueueItemStatus::Failed {
                item.status = QueueItemStatus::Pending;
                item.attempts = 0;
                item.error_log.clear();
                item.completed_at = None;
                item.scheduled_at = None;
                count += 1;
            }
        }
        count
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_msg() -> EmailMessage {
        let mut msg = EmailMessage::default();
        msg.from = EmailAddress::new("a@b.com");
        msg.to.push(EmailAddress::new("c@d.com"));
        msg.subject = "Test".into();
        msg.text_body = Some("Hello".into());
        msg
    }

    #[test]
    fn enqueue_and_get() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id = q.enqueue(sample_msg()).unwrap();
        assert!(q.get(&id).is_some());
        assert_eq!(q.summary().total, 1);
        assert_eq!(q.summary().pending, 1);
    }

    #[test]
    fn enqueue_full_queue() {
        let cfg = QueueConfig {
            max_size: 1,
            ..Default::default()
        };
        let mut q = SendQueue::new(cfg);
        q.enqueue(sample_msg()).unwrap();
        assert!(q.enqueue(sample_msg()).is_err());
    }

    #[test]
    fn enqueue_scheduled() {
        let mut q = SendQueue::new(QueueConfig::default());
        let future = Utc::now() + chrono::Duration::hours(1);
        let id = q
            .enqueue_scheduled(sample_msg(), SendSchedule::At(future))
            .unwrap();
        let item = q.get(&id).unwrap();
        assert!(item.scheduled_at.is_some());
    }

    #[test]
    fn enqueue_with_profile() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id = q.enqueue_with_profile(sample_msg(), "gmail").unwrap();
        let item = q.get(&id).unwrap();
        assert_eq!(item.profile_name, Some("gmail".into()));
    }

    #[test]
    fn mark_sending_and_sent() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id).unwrap();
        assert_eq!(q.get(&id).unwrap().status, QueueItemStatus::Sending);
        assert_eq!(q.get(&id).unwrap().attempts, 1);

        q.mark_sent(&id, vec![]).unwrap();
        assert_eq!(q.get(&id).unwrap().status, QueueItemStatus::Sent);
    }

    #[test]
    fn mark_failed_with_retry() {
        let cfg = QueueConfig {
            max_retries: 3,
            ..Default::default()
        };
        let mut q = SendQueue::new(cfg);
        let id = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id).unwrap();
        q.mark_failed(&id, "timeout").unwrap();
        let item = q.get(&id).unwrap();
        assert_eq!(item.status, QueueItemStatus::ScheduledRetry);
        assert!(item.scheduled_at.is_some());
    }

    #[test]
    fn mark_failed_permanent() {
        let cfg = QueueConfig {
            max_retries: 1,
            ..Default::default()
        };
        let mut q = SendQueue::new(cfg);
        let id = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id).unwrap();
        q.mark_failed(&id, "permanent error").unwrap();
        assert_eq!(q.get(&id).unwrap().status, QueueItemStatus::Failed);
    }

    #[test]
    fn cancel_pending() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id = q.enqueue(sample_msg()).unwrap();
        q.cancel(&id).unwrap();
        assert_eq!(q.get(&id).unwrap().status, QueueItemStatus::Cancelled);
    }

    #[test]
    fn cancel_sending_fails() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id).unwrap();
        assert!(q.cancel(&id).is_err());
    }

    #[test]
    fn list_by_status() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id1 = q.enqueue(sample_msg()).unwrap();
        let _id2 = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id1).unwrap();
        q.mark_sent(&id1, vec![]).unwrap();

        assert_eq!(q.list(Some(QueueItemStatus::Sent)).len(), 1);
        assert_eq!(q.list(Some(QueueItemStatus::Pending)).len(), 1);
        assert_eq!(q.list(None).len(), 2);
    }

    #[test]
    fn summary_counts() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id1 = q.enqueue(sample_msg()).unwrap();
        let _id2 = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id1).unwrap();
        q.mark_sent(&id1, vec![]).unwrap();

        let s = q.summary();
        assert_eq!(s.total, 2);
        assert_eq!(s.sent, 1);
        assert_eq!(s.pending, 1);
    }

    #[test]
    fn purge_completed() {
        let mut q = SendQueue::new(QueueConfig::default());
        let id1 = q.enqueue(sample_msg()).unwrap();
        let _id2 = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id1).unwrap();
        q.mark_sent(&id1, vec![]).unwrap();

        let removed = q.purge_completed();
        assert_eq!(removed, 1);
        assert_eq!(q.summary().total, 1);
    }

    #[test]
    fn clear_queue() {
        let mut q = SendQueue::new(QueueConfig::default());
        q.enqueue(sample_msg()).unwrap();
        q.enqueue(sample_msg()).unwrap();
        assert_eq!(q.clear(), 2);
        assert_eq!(q.summary().total, 0);
    }

    #[test]
    fn should_throttle_no_history() {
        let q = SendQueue::new(QueueConfig::default());
        assert!(!q.should_throttle("smtp.example.com"));
    }

    #[test]
    fn record_send_enables_throttle() {
        let cfg = QueueConfig {
            throttle_ms: 60_000, // 60s
            ..Default::default()
        };
        let mut q = SendQueue::new(cfg);
        q.record_send("smtp.example.com");
        assert!(q.should_throttle("smtp.example.com"));
        assert!(!q.should_throttle("smtp.other.com"));
    }

    #[test]
    fn retry_all_failed() {
        let cfg = QueueConfig {
            max_retries: 1,
            ..Default::default()
        };
        let mut q = SendQueue::new(cfg);
        let id = q.enqueue(sample_msg()).unwrap();
        q.mark_sending(&id).unwrap();
        q.mark_failed(&id, "error").unwrap();
        assert_eq!(q.get(&id).unwrap().status, QueueItemStatus::Failed);

        let count = q.retry_all_failed();
        assert_eq!(count, 1);
        assert_eq!(q.get(&id).unwrap().status, QueueItemStatus::Pending);
        assert_eq!(q.get(&id).unwrap().attempts, 0);
    }

    #[test]
    fn next_batch_respects_concurrency() {
        let cfg = QueueConfig {
            concurrency: 2,
            ..Default::default()
        };
        let mut q = SendQueue::new(cfg);
        q.enqueue(sample_msg()).unwrap();
        q.enqueue(sample_msg()).unwrap();
        q.enqueue(sample_msg()).unwrap();
        let batch = q.next_batch();
        assert_eq!(batch.len(), 2);
    }

    #[test]
    fn next_batch_skips_future_scheduled() {
        let mut q = SendQueue::new(QueueConfig::default());
        let future = Utc::now() + chrono::Duration::hours(1);
        q.enqueue_scheduled(sample_msg(), SendSchedule::At(future))
            .unwrap();
        q.enqueue(sample_msg()).unwrap();
        let batch = q.next_batch();
        assert_eq!(batch.len(), 1);
    }
}
