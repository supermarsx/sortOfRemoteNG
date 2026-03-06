// ── postfix queue management ──────────────────────────────────────────────────

use crate::client::{shell_escape, PostfixClient};
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

pub struct QueueManager;

impl QueueManager {
    /// List queue summaries (active, deferred, hold, corrupt, incoming).
    pub async fn list_queues(client: &PostfixClient) -> PostfixResult<Vec<PostfixQueue>> {
        let mut queues = Vec::new();
        let queue_names = [
            (QueueName::Active, "active"),
            (QueueName::Deferred, "deferred"),
            (QueueName::Hold, "hold"),
            (QueueName::Corrupt, "corrupt"),
            (QueueName::Incoming, "incoming"),
        ];
        for (queue_enum, queue_dir_name) in &queue_names {
            let dir = format!("{}/{}", client.queue_dir(), queue_dir_name);
            let out = client
                .exec_ssh(&format!(
                    "find {} -type f 2>/dev/null | wc -l",
                    shell_escape(&dir)
                ))
                .await;
            let count = out
                .ok()
                .and_then(|o| o.stdout.trim().parse::<u64>().ok())
                .unwrap_or(0);
            let size_out = client
                .exec_ssh(&format!(
                    "du -sb {} 2>/dev/null | cut -f1",
                    shell_escape(&dir)
                ))
                .await;
            let size_bytes = size_out
                .ok()
                .and_then(|o| o.stdout.trim().parse::<u64>().ok())
                .unwrap_or(0);
            queues.push(PostfixQueue {
                queue_name: queue_enum.clone(),
                count,
                size_bytes,
            });
        }
        Ok(queues)
    }

    /// List entries in a specific queue.
    pub async fn list_entries(
        client: &PostfixClient,
        queue_name: &str,
    ) -> PostfixResult<Vec<PostfixQueueEntry>> {
        let all = client.postqueue_list().await?;
        let filtered: Vec<PostfixQueueEntry> = all
            .into_iter()
            .filter(|e| {
                e.status.to_lowercase() == queue_name.to_lowercase()
                    || queue_name == "all"
            })
            .collect();
        Ok(filtered)
    }

    /// Get a specific queue entry by ID.
    pub async fn get_entry(
        client: &PostfixClient,
        queue_id: &str,
    ) -> PostfixResult<PostfixQueueEntry> {
        let all = client.postqueue_list().await?;
        all.into_iter()
            .find(|e| e.queue_id == queue_id)
            .ok_or_else(|| {
                PostfixError::queue_error(format!("Queue entry '{}' not found", queue_id))
            })
    }

    /// Flush all queued mail (attempt delivery).
    pub async fn flush(client: &PostfixClient) -> PostfixResult<()> {
        client.postqueue_flush().await
    }

    /// Flush a specific queue by queue name.
    pub async fn flush_queue(client: &PostfixClient, queue_name: &str) -> PostfixResult<()> {
        let out = client
            .exec_ssh(&format!(
                "sudo postsuper -r {} 2>&1",
                shell_escape(queue_name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "flush queue '{}' failed: {}",
                queue_name, out.stderr
            )));
        }
        client.postqueue_flush().await
    }

    /// Delete a specific queue entry.
    pub async fn delete_entry(client: &PostfixClient, queue_id: &str) -> PostfixResult<()> {
        client.postsuper_delete(queue_id).await
    }

    /// Hold a specific queue entry (move to hold queue).
    pub async fn hold_entry(client: &PostfixClient, queue_id: &str) -> PostfixResult<()> {
        client.postsuper_hold(queue_id).await
    }

    /// Release a held queue entry.
    pub async fn release_entry(client: &PostfixClient, queue_id: &str) -> PostfixResult<()> {
        client.postsuper_release(queue_id).await
    }

    /// Delete all queued messages.
    pub async fn delete_all(client: &PostfixClient) -> PostfixResult<()> {
        let out = client.exec_ssh("sudo postsuper -d ALL").await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "delete all failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Requeue all deferred messages (re-submit to active queue).
    pub async fn requeue_all(client: &PostfixClient) -> PostfixResult<()> {
        let out = client.exec_ssh("sudo postsuper -r ALL").await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "requeue all failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Purge all temporary files from the queue directory.
    pub async fn purge(client: &PostfixClient) -> PostfixResult<()> {
        let out = client.exec_ssh("sudo postsuper -p").await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "purge failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }
}
