//! Transfer queue — manages multiple concurrent uploads/downloads with
//! retry, backoff, cancellation, and progress tracking.

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::pool::FtpPool;
use crate::ftp::types::*;
use crate::ftp::TRANSFER_PROGRESS;
use chrono::Utc;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

/// The transfer queue holding items and configuration.
pub struct TransferQueue {
    pub items: HashMap<String, TransferItem>,
    pub order: VecDeque<String>,
    pub config: TransferQueueConfig,
    semaphore: Arc<Semaphore>,
}

impl TransferQueue {
    pub fn new(config: TransferQueueConfig) -> Self {
        let semaphore = Arc::new(Semaphore::new(config.max_concurrent as usize));
        Self {
            items: HashMap::new(),
            order: VecDeque::new(),
            config,
            semaphore,
        }
    }

    /// Enqueue a new transfer and return its id.
    pub fn enqueue(
        &mut self,
        session_id: &str,
        direction: TransferDirection,
        local_path: &str,
        remote_path: &str,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let item = TransferItem {
            id: id.clone(),
            session_id: session_id.to_string(),
            direction,
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            state: TransferState::Queued,
            total_bytes: None,
            transferred_bytes: 0,
            speed_bps: 0,
            eta_seconds: None,
            error: None,
            retry_count: 0,
            max_retries: self.config.default_retries,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            transfer_type: TransferType::Binary,
            resume_offset: 0,
        };
        self.items.insert(id.clone(), item);
        self.order.push_back(id.clone());
        id
    }

    /// Cancel a queued or in-progress transfer.
    pub fn cancel(&mut self, transfer_id: &str) -> FtpResult<()> {
        if let Some(item) = self.items.get_mut(transfer_id) {
            match item.state {
                TransferState::Queued | TransferState::InProgress => {
                    item.state = TransferState::Cancelled;
                    item.completed_at = Some(Utc::now());
                    Ok(())
                }
                _ => Err(FtpError::invalid_config(format!(
                    "Cannot cancel transfer in state {:?}",
                    item.state
                ))),
            }
        } else {
            Err(FtpError::not_found(format!(
                "Transfer {} not found",
                transfer_id
            )))
        }
    }

    /// Cancel all pending/in-progress transfers.
    pub fn cancel_all(&mut self) {
        for item in self.items.values_mut() {
            if matches!(item.state, TransferState::Queued | TransferState::InProgress) {
                item.state = TransferState::Cancelled;
                item.completed_at = Some(Utc::now());
            }
        }
    }

    /// Retry a failed transfer (re-enqueues it).
    pub fn retry(&mut self, transfer_id: &str) -> FtpResult<()> {
        if let Some(item) = self.items.get_mut(transfer_id) {
            if item.state != TransferState::Failed {
                return Err(FtpError::invalid_config("Can only retry failed transfers"));
            }
            item.state = TransferState::Queued;
            item.error = None;
            item.retry_count += 1;
            item.started_at = None;
            item.completed_at = None;
            self.order.push_back(transfer_id.to_string());
            Ok(())
        } else {
            Err(FtpError::not_found(format!(
                "Transfer {} not found",
                transfer_id
            )))
        }
    }

    /// Remove completed/cancelled/failed items older than `max_age_secs`.
    pub fn prune(&mut self, max_age_secs: i64) {
        let cutoff = Utc::now() - chrono::Duration::seconds(max_age_secs);
        let to_remove: Vec<String> = self
            .items
            .iter()
            .filter(|(_, item)| {
                matches!(
                    item.state,
                    TransferState::Completed | TransferState::Cancelled | TransferState::Failed
                ) && item
                    .completed_at
                    .map(|t| t < cutoff)
                    .unwrap_or(false)
            })
            .map(|(id, _)| id.clone())
            .collect();

        for id in &to_remove {
            self.items.remove(id);
            self.order.retain(|x| x != id);
        }
    }

    /// Get the next item ready for processing.
    pub fn next_pending(&mut self) -> Option<String> {
        while let Some(id) = self.order.pop_front() {
            if let Some(item) = self.items.get(&id) {
                if item.state == TransferState::Queued {
                    return Some(id);
                }
            }
        }
        None
    }

    /// List all transfer items.
    pub fn list(&self) -> Vec<&TransferItem> {
        self.items.values().collect()
    }

    /// Get the current progress for a transfer.
    pub fn get_progress(&self, transfer_id: &str) -> Option<TransferProgress> {
        if let Ok(map) = TRANSFER_PROGRESS.lock() {
            map.get(transfer_id).cloned()
        } else {
            None
        }
    }

    /// Get all active progress snapshots.
    pub fn all_progress(&self) -> Vec<TransferProgress> {
        if let Ok(map) = TRANSFER_PROGRESS.lock() {
            map.values().cloned().collect()
        } else {
            Vec::new()
        }
    }

    /// Mark an item as in-progress.
    pub fn mark_started(&mut self, id: &str) {
        if let Some(item) = self.items.get_mut(id) {
            item.state = TransferState::InProgress;
            item.started_at = Some(Utc::now());
        }
    }

    /// Mark an item as completed.
    pub fn mark_completed(&mut self, id: &str, transferred: u64) {
        if let Some(item) = self.items.get_mut(id) {
            item.state = TransferState::Completed;
            item.transferred_bytes = transferred;
            item.completed_at = Some(Utc::now());
        }
    }

    /// Mark an item as failed.
    pub fn mark_failed(&mut self, id: &str, error: &str) {
        if let Some(item) = self.items.get_mut(id) {
            item.state = TransferState::Failed;
            item.error = Some(error.to_string());
            item.completed_at = Some(Utc::now());
        }
    }

    /// Get the concurrency semaphore.
    pub fn semaphore(&self) -> Arc<Semaphore> {
        self.semaphore.clone()
    }
}

/// Process the next pending item in the queue using the pool.
/// Returns `true` if an item was processed, `false` if the queue is empty.
pub async fn process_next(
    queue: &Arc<Mutex<TransferQueue>>,
    pool: &Arc<Mutex<FtpPool>>,
) -> bool {
    let (transfer_id, session_id, direction, local_path, remote_path) = {
        let mut q = queue.lock().await;
        match q.next_pending() {
            Some(id) => {
                let item = match q.items.get(&id) {
                    Some(i) => i,
                    None => return false,
                };
                let data = (
                    id.clone(),
                    item.session_id.clone(),
                    item.direction,
                    item.local_path.clone(),
                    item.remote_path.clone(),
                );
                q.mark_started(&id);
                data
            }
            None => return false,
        }
    };

    let sem = {
        let q = queue.lock().await;
        q.semaphore()
    };

    let _permit = match sem.acquire().await {
        Ok(p) => p,
        Err(_) => {
            let mut q = queue.lock().await;
            q.mark_failed(&transfer_id, "Semaphore closed");
            return true;
        }
    };

    let result = {
        let mut p = pool.lock().await;
        let client = match p.get_mut(&session_id) {
            Ok(c) => c,
            Err(e) => {
                let mut q = queue.lock().await;
                q.mark_failed(&transfer_id, &e.to_string());
                return true;
            }
        };

        match direction {
            TransferDirection::Download => {
                client
                    .download(&remote_path, &local_path, Some(&transfer_id))
                    .await
            }
            TransferDirection::Upload => {
                client
                    .upload(&local_path, &remote_path, Some(&transfer_id))
                    .await
            }
        }
    };

    let mut q = queue.lock().await;
    match result {
        Ok(transferred) => {
            q.mark_completed(&transfer_id, transferred);
        }
        Err(e) => {
            let item = q.items.get(&transfer_id);
            let should_retry = item
                .map(|i| i.retry_count < i.max_retries)
                .unwrap_or(false);

            if should_retry {
                q.mark_failed(&transfer_id, &e.to_string());
                let backoff = q.config.retry_backoff_sec;
                let _ = q.retry(&transfer_id);
                // Backoff delay
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
                });
            } else {
                q.mark_failed(&transfer_id, &e.to_string());
            }
        }
    }

    true
}

/// Drain the entire queue, processing items concurrently up to the limit.
pub async fn drain_queue(
    queue: Arc<Mutex<TransferQueue>>,
    pool: Arc<Mutex<FtpPool>>,
) {
    loop {
        if !process_next(&queue, &pool).await {
            break;
        }
    }
}
