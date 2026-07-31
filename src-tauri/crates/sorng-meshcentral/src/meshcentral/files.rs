//! File transfer operations — upload, download, progress tracking.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const MAX_TRACKED_TRANSFERS: usize = 1024;

/// Shared file transfer progress tracker.
#[derive(Debug, Clone)]
pub struct McFileTransferTracker {
    transfers: Arc<Mutex<HashMap<String, McFileTransferProgress>>>,
}

impl McFileTransferTracker {
    pub fn new() -> Self {
        Self {
            transfers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_transfer(
        &self,
        transfer_id: &str,
        direction: McTransferDirection,
        total_bytes: Option<u64>,
        device_id: &str,
    ) {
        let progress = McFileTransferProgress {
            transfer_id: transfer_id.to_string(),
            device_id: device_id.to_string(),
            direction,
            bytes_transferred: 0,
            total_bytes,
            percent: Some(0.0),
            status: McTransferStatus::Pending,
        };
        if let Ok(mut map) = self.transfers.lock() {
            if map.len() >= MAX_TRACKED_TRANSFERS {
                map.retain(|_, transfer| {
                    matches!(
                        transfer.status,
                        McTransferStatus::Pending | McTransferStatus::InProgress
                    )
                });
            }
            if map.len() >= MAX_TRACKED_TRANSFERS {
                return;
            }
            map.insert(transfer_id.to_string(), progress);
        }
    }

    pub fn update_progress(&self, transfer_id: &str, bytes: u64) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.bytes_transferred = bytes;
                p.status = McTransferStatus::InProgress;
                if let Some(total) = p.total_bytes {
                    if total > 0 {
                        p.bytes_transferred = bytes.min(total);
                        p.percent = Some((p.bytes_transferred as f64 / total as f64) * 100.0);
                    }
                }
            }
        }
    }

    pub fn complete_transfer(&self, transfer_id: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                if let Some(total) = p.total_bytes {
                    p.bytes_transferred = total;
                }
                p.percent = Some(100.0);
                p.status = McTransferStatus::Completed;
            }
        }
    }

    pub fn fail_transfer(&self, transfer_id: &str, _error: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = McTransferStatus::Failed;
            }
        }
    }

    pub fn cancel_transfer(&self, transfer_id: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            if let Some(p) = map.get_mut(transfer_id) {
                p.status = McTransferStatus::Cancelled;
            }
        }
    }

    pub fn get_progress(&self, transfer_id: &str) -> Option<McFileTransferProgress> {
        if let Ok(map) = self.transfers.lock() {
            map.get(transfer_id).cloned()
        } else {
            None
        }
    }

    pub fn get_all_active(&self) -> Vec<McFileTransferProgress> {
        if let Ok(map) = self.transfers.lock() {
            map.values()
                .filter(|p| {
                    matches!(
                        p.status,
                        McTransferStatus::Pending | McTransferStatus::InProgress
                    )
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    pub fn remove_transfer(&self, transfer_id: &str) {
        if let Ok(mut map) = self.transfers.lock() {
            map.remove(transfer_id);
        }
    }

    pub fn clear_completed(&self) {
        if let Ok(mut map) = self.transfers.lock() {
            map.retain(|_, p| {
                !matches!(
                    p.status,
                    McTransferStatus::Completed
                        | McTransferStatus::Failed
                        | McTransferStatus::Cancelled
                )
            });
        }
    }
}

impl Default for McFileTransferTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl McApiClient {
    /// Upload a file to a device.
    ///
    /// The file is sent through the MeshCentral relay tunnel protocol.
    /// In the real implementation, this opens a WebSocket tunnel to the agent.
    /// This method prepares the upload request and returns transfer metadata.
    pub async fn upload_file(&self, upload: &McFileUpload) -> MeshCentralResult<String> {
        let _ = upload;
        Err(MeshCentralError::FileTransferFailed(
            "MeshCentral upload is unavailable until the relay WebSocket can stream and acknowledge file data"
                .to_string(),
        ))
    }

    /// Download a file from a device.
    ///
    /// Returns a transfer ID that can be used to track progress.
    pub async fn download_file(&self, download: &McFileDownload) -> MeshCentralResult<String> {
        let _ = download;
        Err(MeshCentralError::FileTransferFailed(
            "MeshCentral download is unavailable until the relay WebSocket can stream and verify file data"
                .to_string(),
        ))
    }

    /// List files in a directory on a remote device.
    pub async fn list_remote_files(
        &self,
        node_id: &str,
        path: &str,
    ) -> MeshCentralResult<serde_json::Value> {
        let _ = (node_id, path);
        Err(MeshCentralError::FileTransferFailed(
            "Remote file listing is unavailable without the MeshCentral file-relay WebSocket"
                .to_string(),
        ))
    }

    /// Create a directory on a remote device.
    pub async fn create_remote_directory(
        &self,
        node_id: &str,
        path: &str,
    ) -> MeshCentralResult<String> {
        let _ = (node_id, path);
        Err(MeshCentralError::FileTransferFailed(
            "Remote directory creation is unavailable without verified file-relay completion"
                .to_string(),
        ))
    }

    /// Delete a file or directory on a remote device.
    pub async fn delete_remote_file(
        &self,
        node_id: &str,
        path: &str,
        files: &[String],
        recursive: bool,
    ) -> MeshCentralResult<String> {
        let _ = (node_id, path, files, recursive);
        Err(MeshCentralError::FileTransferFailed(
            "Remote deletion is unavailable without verified file-relay completion".to_string(),
        ))
    }

    /// Rename a file on a remote device.
    pub async fn rename_remote_file(
        &self,
        node_id: &str,
        path: &str,
        old_name: &str,
        new_name: &str,
    ) -> MeshCentralResult<String> {
        let _ = (node_id, path, old_name, new_name);
        Err(MeshCentralError::FileTransferFailed(
            "Remote rename is unavailable without verified file-relay completion".to_string(),
        ))
    }
}
