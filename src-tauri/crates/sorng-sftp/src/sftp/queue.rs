// ── Transfer queue with priority ordering ────────────────────────────────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use chrono::Utc;
use log::info;
use uuid::Uuid;

impl SftpService {
    /// Add a transfer to the queue.
    pub async fn queue_add(
        &mut self,
        request: SftpTransferRequest,
        priority: Option<i32>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let entry = QueueEntry {
            id: id.clone(),
            request,
            priority: priority.unwrap_or(0),
            added_at: Utc::now(),
            status: TransferStatus::Queued,
            progress: None,
        };
        self.queue.push(entry);
        self.queue.sort_by(|a, b| b.priority.cmp(&a.priority)); // highest-priority first
        info!("SFTP queue: added {}", id);
        Ok(id)
    }

    /// Remove an item from the queue.
    pub async fn queue_remove(&mut self, queue_id: &str) -> Result<(), String> {
        let idx = self
            .queue
            .iter()
            .position(|e| e.id == queue_id)
            .ok_or_else(|| format!("Queue item '{}' not found", queue_id))?;
        self.queue.remove(idx);
        Ok(())
    }

    /// Clear all completed / failed / cancelled entries.
    pub async fn queue_clear_done(&mut self) -> usize {
        let before = self.queue.len();
        self.queue.retain(|e| {
            !matches!(
                e.status,
                TransferStatus::Completed | TransferStatus::Failed | TransferStatus::Cancelled
            )
        });
        before - self.queue.len()
    }

    /// Get current queue status.
    pub async fn queue_status(&self) -> QueueStatus {
        let pending = self
            .queue
            .iter()
            .filter(|e| e.status == TransferStatus::Queued)
            .count();
        let active = self
            .queue
            .iter()
            .filter(|e| e.status == TransferStatus::InProgress)
            .count();
        let completed = self
            .queue
            .iter()
            .filter(|e| e.status == TransferStatus::Completed)
            .count();
        let failed = self
            .queue
            .iter()
            .filter(|e| e.status == TransferStatus::Failed)
            .count();
        let total_remaining: u64 = self
            .queue
            .iter()
            .filter(|e| matches!(e.status, TransferStatus::Queued | TransferStatus::InProgress))
            .filter_map(|e| {
                e.progress
                    .as_ref()
                    .map(|p| p.total_bytes.saturating_sub(p.transferred_bytes))
            })
            .sum();

        QueueStatus {
            total: self.queue.len(),
            pending,
            active,
            completed,
            failed,
            total_bytes_remaining: total_remaining,
            is_running: self.queue_running,
        }
    }

    /// List all queue entries.
    pub async fn queue_list(&self) -> Vec<QueueEntry> {
        self.queue.clone()
    }

    /// Re-order an item in the queue.
    pub async fn queue_set_priority(
        &mut self,
        queue_id: &str,
        priority: i32,
    ) -> Result<(), String> {
        let entry = self
            .queue
            .iter_mut()
            .find(|e| e.id == queue_id)
            .ok_or_else(|| format!("Queue item '{}' not found", queue_id))?;
        entry.priority = priority;
        self.queue.sort_by(|a, b| b.priority.cmp(&a.priority));
        Ok(())
    }

    /// Process the queue sequentially (called from a spawned task).
    pub async fn queue_start(&mut self) -> Result<usize, String> {
        if self.queue_running {
            return Err("Queue is already running".into());
        }
        self.queue_running = true;
        let mut processed = 0usize;

        // Take pending items
        while let Some(idx) = self
            .queue
            .iter()
            .position(|e| e.status == TransferStatus::Queued)
        {
            self.queue[idx].status = TransferStatus::InProgress;
            let request = self.queue[idx].request.clone();

            let result = match request.direction {
                TransferDirection::Upload => self.upload(request).await,
                TransferDirection::Download => self.download(request).await,
            };

            match result {
                Ok(r) => {
                    self.queue[idx].status = if r.success {
                        TransferStatus::Completed
                    } else {
                        TransferStatus::Failed
                    };
                    self.queue[idx].progress =
                        self.get_transfer_progress(&r.transfer_id);
                }
                Err(_e) => {
                    self.queue[idx].status = TransferStatus::Failed;
                }
            }
            processed += 1;
        }

        self.queue_running = false;
        info!("SFTP queue processing complete: {} items", processed);
        Ok(processed)
    }

    /// Stop queue processing after the current transfer finishes.
    pub async fn queue_stop(&mut self) {
        self.queue_running = false;
    }

    /// Retry all failed items in the queue.
    pub async fn queue_retry_failed(&mut self) -> usize {
        let mut count = 0;
        for entry in &mut self.queue {
            if entry.status == TransferStatus::Failed {
                entry.status = TransferStatus::Queued;
                entry.progress = None;
                count += 1;
            }
        }
        count
    }
}
