// ── Transfer history – records of completed/failed transfers ─────────────────

use crate::scp::service::ScpService;
use crate::scp::types::*;
use crate::scp::SCP_TRANSFER_HISTORY;
use chrono::Utc;

const MAX_HISTORY_SIZE: usize = 500;

/// Record a completed or failed transfer in global history.
pub(crate) fn record_transfer(
    svc: &ScpService,
    result: &ScpTransferResult,
    session_id: &str,
) {
    let (host, username) = svc
        .sessions
        .get(session_id)
        .map(|h| (h.info.host.clone(), h.info.username.clone()))
        .unwrap_or_else(|| ("unknown".into(), "unknown".into()));

    let record = ScpTransferRecord {
        transfer_id: result.transfer_id.clone(),
        session_id: session_id.to_string(),
        host,
        username,
        direction: result.direction.clone(),
        local_path: result.local_path.clone(),
        remote_path: result.remote_path.clone(),
        bytes_transferred: result.bytes_transferred,
        duration_ms: result.duration_ms,
        average_speed: result.average_speed,
        success: result.success,
        error: result.error.clone(),
        checksum: result.checksum.clone(),
        timestamp: Utc::now(),
    };

    if let Ok(mut history) = SCP_TRANSFER_HISTORY.lock() {
        history.push(record);
        // Trim to max size
        if history.len() > MAX_HISTORY_SIZE {
            let excess = history.len() - MAX_HISTORY_SIZE;
            history.drain(0..excess);
        }
    }
}

impl ScpService {
    /// Get transfer history, optionally filtered by session_id.
    pub fn get_history(&self, session_id: Option<&str>, limit: Option<usize>) -> Vec<ScpTransferRecord> {
        if let Ok(history) = SCP_TRANSFER_HISTORY.lock() {
            let mut filtered: Vec<&ScpTransferRecord> = if let Some(sid) = session_id {
                history.iter().filter(|r| r.session_id == sid).collect()
            } else {
                history.iter().collect()
            };

            let limit = limit.unwrap_or(100);
            filtered.reverse();
            filtered.into_iter().take(limit).cloned().collect()
        } else {
            Vec::new()
        }
    }

    /// Clear all transfer history.
    pub fn clear_history(&self) -> u32 {
        if let Ok(mut history) = SCP_TRANSFER_HISTORY.lock() {
            let count = history.len() as u32;
            history.clear();
            count
        } else {
            0
        }
    }

    /// Get history statistics.
    pub fn history_stats(&self) -> ScpHistoryStats {
        if let Ok(history) = SCP_TRANSFER_HISTORY.lock() {
            let total = history.len();
            let succeeded = history.iter().filter(|r| r.success).count();
            let failed = history.iter().filter(|r| !r.success).count();
            let total_bytes: u64 = history.iter().map(|r| r.bytes_transferred).sum();
            let total_duration_ms: u64 = history.iter().map(|r| r.duration_ms).sum();
            let uploads = history
                .iter()
                .filter(|r| r.direction == ScpTransferDirection::Upload)
                .count();
            let downloads = history
                .iter()
                .filter(|r| r.direction == ScpTransferDirection::Download)
                .count();
            let avg_speed = if total_duration_ms > 0 {
                total_bytes as f64 / (total_duration_ms as f64 / 1000.0)
            } else {
                0.0
            };

            ScpHistoryStats {
                total_transfers: total,
                succeeded,
                failed,
                total_bytes,
                total_duration_ms,
                average_speed: avg_speed,
                uploads,
                downloads,
            }
        } else {
            ScpHistoryStats {
                total_transfers: 0,
                succeeded: 0,
                failed: 0,
                total_bytes: 0,
                total_duration_ms: 0,
                average_speed: 0.0,
                uploads: 0,
                downloads: 0,
            }
        }
    }
}

/// Statistics about transfer history.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpHistoryStats {
    pub total_transfers: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub total_bytes: u64,
    pub total_duration_ms: u64,
    pub average_speed: f64,
    pub uploads: usize,
    pub downloads: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_history_initially_empty() {
        // Clear any previous test state
        if let Ok(mut h) = SCP_TRANSFER_HISTORY.lock() {
            h.clear();
        }
        let state = ScpService::new();
        let svc = state.lock().await;
        let records = svc.get_history(None, None);
        assert!(records.is_empty());
    }

    #[tokio::test]
    async fn test_clear_history() {
        // Clear any previous test state
        if let Ok(mut h) = SCP_TRANSFER_HISTORY.lock() {
            h.clear();
        }
        let state = ScpService::new();
        let svc = state.lock().await;
        let count = svc.clear_history();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_history_stats_empty() {
        if let Ok(mut h) = SCP_TRANSFER_HISTORY.lock() {
            h.clear();
        }
        let state = ScpService::new();
        let svc = state.lock().await;
        let stats = svc.history_stats();
        assert_eq!(stats.total_transfers, 0);
        assert_eq!(stats.succeeded, 0);
        assert_eq!(stats.failed, 0);
    }

    #[test]
    fn test_history_stats_serialization() {
        let stats = ScpHistoryStats {
            total_transfers: 10,
            succeeded: 8,
            failed: 2,
            total_bytes: 1_000_000,
            total_duration_ms: 5000,
            average_speed: 200_000.0,
            uploads: 6,
            downloads: 4,
        };
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("totalTransfers"));
        assert!(json.contains("averageSpeed"));
    }
}
