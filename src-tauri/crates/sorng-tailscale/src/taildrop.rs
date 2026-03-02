//! # Tailscale Taildrop
//!
//! Send and receive files between Tailscale nodes. Manage transfers,
//! track progress, configure receive directory.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Taildrop configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaildropConfig {
    pub enabled: bool,
    pub receive_dir: String,
    pub auto_accept: bool,
    pub max_file_size_mb: Option<u64>,
    pub allowed_extensions: Option<Vec<String>>,
}

impl Default for TaildropConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            receive_dir: default_receive_dir(),
            auto_accept: false,
            max_file_size_mb: None,
            allowed_extensions: None,
        }
    }
}

fn default_receive_dir() -> String {
    if cfg!(target_os = "windows") {
        dirs_str("Downloads")
    } else if cfg!(target_os = "macos") {
        dirs_str("Downloads")
    } else {
        dirs_str("Downloads")
    }
}

fn dirs_str(subdir: &str) -> String {
    format!("~/{}", subdir)
}

/// Active file transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTransfer {
    pub id: String,
    pub direction: TransferDirection,
    pub peer_id: String,
    pub peer_name: String,
    pub file_name: String,
    pub file_size: u64,
    pub transferred: u64,
    pub state: TransferState,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_secs: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferDirection {
    Send,
    Receive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferState {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
    WaitingForAccept,
}

/// Transfer progress tracker.
#[derive(Debug, Clone)]
pub struct TransferTracker {
    pub transfers: Arc<Mutex<HashMap<String, FileTransfer>>>,
}

impl TransferTracker {
    pub fn new() -> Self {
        Self {
            transfers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn add_transfer(&self, transfer: FileTransfer) {
        if let Ok(mut map) = self.transfers.lock() {
            map.insert(transfer.id.clone(), transfer);
        }
    }

    pub fn update_progress(&self, id: &str, transferred: u64, speed: Option<f64>) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(t) = map.get_mut(id) {
                t.transferred = transferred;
                t.speed_bytes_per_sec = speed;
                if t.file_size > 0 {
                    if let Some(spd) = speed {
                        if spd > 0.0 {
                            let remaining = (t.file_size - transferred) as f64;
                            t.eta_secs = Some(remaining / spd);
                        }
                    }
                }
                if transferred >= t.file_size {
                    t.state = TransferState::Completed;
                } else {
                    t.state = TransferState::InProgress;
                }
            }
        }
    }

    pub fn mark_completed(&self, id: &str, timestamp: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(t) = map.get_mut(id) {
                t.state = TransferState::Completed;
                t.completed_at = Some(timestamp.to_string());
                t.transferred = t.file_size;
            }
        }
    }

    pub fn mark_failed(&self, id: &str, error: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(t) = map.get_mut(id) {
                t.state = TransferState::Failed;
                t.error = Some(error.to_string());
            }
        }
    }

    pub fn cancel(&self, id: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(t) = map.get_mut(id) {
                t.state = TransferState::Cancelled;
            }
        }
    }

    pub fn get_active(&self) -> Vec<FileTransfer> {
        self.transfers
            .lock()
            .map(|map| {
                map.values()
                    .filter(|t| matches!(t.state, TransferState::InProgress | TransferState::Pending | TransferState::WaitingForAccept))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_completed(&self) -> Vec<FileTransfer> {
        self.transfers
            .lock()
            .map(|map| {
                map.values()
                    .filter(|t| t.state == TransferState::Completed)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn cleanup_completed(&self) {
        if let Ok(mut map) = self.transfers.lock() {
            map.retain(|_, t| {
                matches!(
                    t.state,
                    TransferState::InProgress | TransferState::Pending | TransferState::WaitingForAccept
                )
            });
        }
    }
}

/// Build send file command.
pub fn send_command(target: &str, files: &[String]) -> Vec<String> {
    let mut cmd = vec!["tailscale".to_string(), "file".to_string(), "cp".to_string()];
    for f in files {
        cmd.push(f.clone());
    }
    cmd.push(format!("{}:", target));
    cmd
}

/// Build receive command (wait for incoming files).
pub fn receive_command(output_dir: &str) -> Vec<String> {
    vec![
        "tailscale".to_string(),
        "file".to_string(),
        "get".to_string(),
        output_dir.to_string(),
    ]
}

/// Validate a file for sending.
pub fn validate_send(
    file_path: &str,
    file_size: u64,
    config: &TaildropConfig,
) -> Result<(), String> {
    if !config.enabled {
        return Err("Taildrop is disabled".to_string());
    }

    if let Some(max_size) = config.max_file_size_mb {
        let max_bytes = max_size * 1024 * 1024;
        if file_size > max_bytes {
            return Err(format!(
                "File size ({} bytes) exceeds maximum ({} MB)",
                file_size, max_size
            ));
        }
    }

    if let Some(allowed) = &config.allowed_extensions {
        let ext = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !allowed.iter().any(|a| a.eq_ignore_ascii_case(ext)) {
            return Err(format!(
                "File extension '.{}' is not in the allowed list",
                ext
            ));
        }
    }

    Ok(())
}

/// Compute transfer statistics.
pub fn compute_transfer_stats(transfers: &[FileTransfer]) -> TransferStats {
    let total = transfers.len();
    let active = transfers
        .iter()
        .filter(|t| t.state == TransferState::InProgress)
        .count();
    let completed = transfers
        .iter()
        .filter(|t| t.state == TransferState::Completed)
        .count();
    let failed = transfers
        .iter()
        .filter(|t| t.state == TransferState::Failed)
        .count();

    let total_bytes: u64 = transfers.iter().map(|t| t.file_size).sum();
    let transferred_bytes: u64 = transfers.iter().map(|t| t.transferred).sum();

    let avg_speed = transfers
        .iter()
        .filter_map(|t| t.speed_bytes_per_sec)
        .sum::<f64>()
        / active.max(1) as f64;

    TransferStats {
        total,
        active,
        completed,
        failed,
        total_bytes,
        transferred_bytes,
        average_speed_bytes_per_sec: avg_speed,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferStats {
    pub total: usize,
    pub active: usize,
    pub completed: usize,
    pub failed: usize,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub average_speed_bytes_per_sec: f64,
}
