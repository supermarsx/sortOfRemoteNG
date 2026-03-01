// ── Transfer queue – priority-ordered, serialised transfer execution ──────────

use crate::scp::service::ScpService;
use crate::scp::types::*;
use chrono::Utc;
use log::info;
use uuid::Uuid;

impl ScpService {
    // ── Queue management ─────────────────────────────────────────────────────

    /// Add a transfer to the queue.
    pub fn queue_add(
        &mut self,
        session_id: String,
        local_path: String,
        remote_path: String,
        direction: ScpTransferDirection,
        file_mode: Option<i32>,
        priority: Option<u32>,
    ) -> Result<ScpQueueEntry, String> {
        let entry = ScpQueueEntry {
            id: Uuid::new_v4().to_string(),
            session_id,
            local_path,
            remote_path,
            direction,
            file_mode: file_mode.unwrap_or(0o644),
            priority: priority.unwrap_or(50),
            status: ScpQueueStatus::Pending,
            added_at: Utc::now(),
            started_at: None,
            completed_at: None,
            error: None,
            bytes_transferred: 0,
            total_bytes: 0,
            retry_count: 0,
            max_retries: 3,
        };

        self.queue.push(entry.clone());
        // Sort by priority (higher = first)
        self.queue.sort_by(|a, b| b.priority.cmp(&a.priority));
        Ok(entry)
    }

    /// Remove a pending entry from the queue.
    pub fn queue_remove(&mut self, entry_id: &str) -> Result<(), String> {
        let idx = self
            .queue
            .iter()
            .position(|e| e.id == entry_id)
            .ok_or_else(|| format!("Queue entry '{}' not found", entry_id))?;

        if self.queue[idx].status == ScpQueueStatus::InProgress {
            return Err("Cannot remove an in-progress queue entry".into());
        }

        self.queue.remove(idx);
        Ok(())
    }

    /// List all queue entries.
    pub fn queue_list(&self) -> Vec<ScpQueueEntry> {
        self.queue.clone()
    }

    /// Get a summary of the queue state.
    pub fn queue_status(&self) -> ScpQueueSummary {
        let total = self.queue.len();
        let pending = self.queue.iter().filter(|e| e.status == ScpQueueStatus::Pending).count();
        let in_progress = self.queue.iter().filter(|e| e.status == ScpQueueStatus::InProgress).count();
        let completed = self.queue.iter().filter(|e| e.status == ScpQueueStatus::Completed).count();
        let failed = self.queue.iter().filter(|e| e.status == ScpQueueStatus::Failed).count();
        let cancelled = self.queue.iter().filter(|e| e.status == ScpQueueStatus::Cancelled).count();
        let paused = self.queue.iter().filter(|e| e.status == ScpQueueStatus::Paused).count();
        let total_bytes: u64 = self.queue.iter().map(|e| e.total_bytes).sum();
        let bytes_transferred: u64 = self.queue.iter().map(|e| e.bytes_transferred).sum();

        ScpQueueSummary {
            total,
            pending,
            in_progress,
            completed,
            failed,
            cancelled,
            paused,
            total_bytes,
            bytes_transferred,
            is_running: self.queue_running,
        }
    }

    /// Start processing the queue.
    pub async fn queue_start(&mut self) -> Result<(), String> {
        if self.queue_running {
            return Err("Queue is already running".into());
        }
        self.queue_running = true;
        info!("SCP queue started");

        // Process entries sequentially
        loop {
            // Find next pending entry
            let next_idx = self
                .queue
                .iter()
                .position(|e| e.status == ScpQueueStatus::Pending);

            let idx = match next_idx {
                Some(idx) => idx,
                None => break, // No more pending entries
            };

            if !self.queue_running {
                break; // Stopped
            }

            // Mark as in-progress
            self.queue[idx].status = ScpQueueStatus::InProgress;
            self.queue[idx].started_at = Some(Utc::now());

            let entry = self.queue[idx].clone();

            let transfer_req = ScpTransferRequest {
                session_id: entry.session_id.clone(),
                local_path: entry.local_path.clone(),
                remote_path: entry.remote_path.clone(),
                chunk_size: 1_048_576,
                verify_checksum: false,
                retry_count: entry.max_retries,
                retry_delay_ms: 2000,
                file_mode: entry.file_mode,
                preserve_times: true,
                create_parents: true,
                overwrite: true,
            };

            let result = match entry.direction {
                ScpTransferDirection::Upload => self.upload(transfer_req).await,
                ScpTransferDirection::Download => self.download(transfer_req).await,
            };

            // Update queue entry with result
            if let Some(q_entry) = self.queue.iter_mut().find(|e| e.id == entry.id) {
                match result {
                    Ok(r) => {
                        q_entry.status = ScpQueueStatus::Completed;
                        q_entry.bytes_transferred = r.bytes_transferred;
                        q_entry.completed_at = Some(Utc::now());
                    }
                    Err(e) => {
                        q_entry.status = ScpQueueStatus::Failed;
                        q_entry.error = Some(e);
                        q_entry.completed_at = Some(Utc::now());
                    }
                }
            }
        }

        self.queue_running = false;
        info!("SCP queue processing complete");
        Ok(())
    }

    /// Stop queue processing.
    pub fn queue_stop(&mut self) -> Result<(), String> {
        if !self.queue_running {
            return Err("Queue is not running".into());
        }
        self.queue_running = false;
        info!("SCP queue stopped");
        Ok(())
    }

    /// Retry all failed entries.
    pub fn queue_retry_failed(&mut self) -> u32 {
        let mut count = 0u32;
        for entry in &mut self.queue {
            if entry.status == ScpQueueStatus::Failed {
                entry.status = ScpQueueStatus::Pending;
                entry.error = None;
                entry.retry_count += 1;
                entry.started_at = None;
                entry.completed_at = None;
                count += 1;
            }
        }
        count
    }

    /// Clear completed entries from the queue.
    pub fn queue_clear_done(&mut self) -> u32 {
        let before = self.queue.len();
        self.queue
            .retain(|e| e.status != ScpQueueStatus::Completed);
        (before - self.queue.len()) as u32
    }

    /// Clear all entries (including in-progress will be marked cancelled).
    pub fn queue_clear_all(&mut self) -> u32 {
        let count = self.queue.len() as u32;
        self.queue.clear();
        self.queue_running = false;
        count
    }

    /// Set priority on a queue entry.
    pub fn queue_set_priority(
        &mut self,
        entry_id: &str,
        priority: u32,
    ) -> Result<(), String> {
        let entry = self
            .queue
            .iter_mut()
            .find(|e| e.id == entry_id)
            .ok_or_else(|| format!("Queue entry '{}' not found", entry_id))?;

        entry.priority = priority;
        // Re-sort
        self.queue.sort_by(|a, b| b.priority.cmp(&a.priority));
        Ok(())
    }

    /// Pause a pending queue entry.
    pub fn queue_pause(&mut self, entry_id: &str) -> Result<(), String> {
        let entry = self
            .queue
            .iter_mut()
            .find(|e| e.id == entry_id)
            .ok_or_else(|| format!("Queue entry '{}' not found", entry_id))?;

        if entry.status != ScpQueueStatus::Pending {
            return Err(format!("Cannot pause entry in {:?} state", entry.status));
        }
        entry.status = ScpQueueStatus::Paused;
        Ok(())
    }

    /// Resume a paused queue entry.
    pub fn queue_resume(&mut self, entry_id: &str) -> Result<(), String> {
        let entry = self
            .queue
            .iter_mut()
            .find(|e| e.id == entry_id)
            .ok_or_else(|| format!("Queue entry '{}' not found", entry_id))?;

        if entry.status != ScpQueueStatus::Paused {
            return Err(format!("Cannot resume entry in {:?} state", entry.status));
        }
        entry.status = ScpQueueStatus::Pending;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_queue_add_and_list() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        let entry = svc
            .queue_add(
                "sess1".to_string(),
                "/tmp/test.txt".to_string(),
                "/home/user/test.txt".to_string(),
                ScpTransferDirection::Upload,
                None,
                None,
            )
            .unwrap();

        assert_eq!(entry.status, ScpQueueStatus::Pending);
        assert_eq!(entry.priority, 50);

        let list = svc.queue_list();
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn test_queue_remove() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        let entry = svc
            .queue_add(
                "s".to_string(),
                "/a".to_string(),
                "/b".to_string(),
                ScpTransferDirection::Upload,
                None,
                None,
            )
            .unwrap();

        svc.queue_remove(&entry.id).unwrap();
        assert!(svc.queue_list().is_empty());
    }

    #[tokio::test]
    async fn test_queue_status() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        svc.queue_add("s".into(), "/a".into(), "/b".into(), ScpTransferDirection::Upload, None, None).unwrap();
        svc.queue_add("s".into(), "/c".into(), "/d".into(), ScpTransferDirection::Download, None, None).unwrap();

        let status = svc.queue_status();
        assert_eq!(status.total, 2);
        assert_eq!(status.pending, 2);
        assert_eq!(status.in_progress, 0);
        assert!(!status.is_running);
    }

    #[tokio::test]
    async fn test_queue_priority_ordering() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        svc.queue_add("s".into(), "/low".into(), "/low".into(), ScpTransferDirection::Upload, None, Some(10)).unwrap();
        svc.queue_add("s".into(), "/high".into(), "/high".into(), ScpTransferDirection::Upload, None, Some(90)).unwrap();
        svc.queue_add("s".into(), "/mid".into(), "/mid".into(), ScpTransferDirection::Upload, None, Some(50)).unwrap();

        let list = svc.queue_list();
        assert_eq!(list[0].local_path, "/high");
        assert_eq!(list[1].local_path, "/mid");
        assert_eq!(list[2].local_path, "/low");
    }

    #[tokio::test]
    async fn test_queue_set_priority() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        let e1 = svc.queue_add("s".into(), "/a".into(), "/a".into(), ScpTransferDirection::Upload, None, Some(10)).unwrap();
        let _e2 = svc.queue_add("s".into(), "/b".into(), "/b".into(), ScpTransferDirection::Upload, None, Some(50)).unwrap();

        svc.queue_set_priority(&e1.id, 100).unwrap();
        let list = svc.queue_list();
        assert_eq!(list[0].local_path, "/a");
    }

    #[tokio::test]
    async fn test_queue_clear_done() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        svc.queue_add("s".into(), "/a".into(), "/a".into(), ScpTransferDirection::Upload, None, None).unwrap();
        // Manually complete the entry
        svc.queue[0].status = ScpQueueStatus::Completed;

        svc.queue_add("s".into(), "/b".into(), "/b".into(), ScpTransferDirection::Upload, None, None).unwrap();

        let cleared = svc.queue_clear_done();
        assert_eq!(cleared, 1);
        assert_eq!(svc.queue_list().len(), 1);
    }

    #[tokio::test]
    async fn test_queue_retry_failed() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        svc.queue_add("s".into(), "/a".into(), "/a".into(), ScpTransferDirection::Upload, None, None).unwrap();
        svc.queue[0].status = ScpQueueStatus::Failed;
        svc.queue[0].error = Some("timeout".into());

        let count = svc.queue_retry_failed();
        assert_eq!(count, 1);
        assert_eq!(svc.queue[0].status, ScpQueueStatus::Pending);
        assert!(svc.queue[0].error.is_none());
    }

    #[tokio::test]
    async fn test_queue_pause_resume() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        let entry = svc.queue_add("s".into(), "/a".into(), "/a".into(), ScpTransferDirection::Upload, None, None).unwrap();

        svc.queue_pause(&entry.id).unwrap();
        assert_eq!(svc.queue[0].status, ScpQueueStatus::Paused);

        svc.queue_resume(&entry.id).unwrap();
        assert_eq!(svc.queue[0].status, ScpQueueStatus::Pending);
    }

    #[tokio::test]
    async fn test_queue_stop_not_running() {
        let state = ScpService::new();
        let mut svc = state.lock().await;
        let result = svc.queue_stop();
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_queue_clear_all() {
        let state = ScpService::new();
        let mut svc = state.lock().await;

        svc.queue_add("s".into(), "/a".into(), "/a".into(), ScpTransferDirection::Upload, None, None).unwrap();
        svc.queue_add("s".into(), "/b".into(), "/b".into(), ScpTransferDirection::Upload, None, None).unwrap();

        let count = svc.queue_clear_all();
        assert_eq!(count, 2);
        assert!(svc.queue.is_empty());
    }
}
