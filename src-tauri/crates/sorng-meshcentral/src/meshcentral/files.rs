//! File transfer operations — upload, download, progress tracking.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
                        p.percent = Some((bytes as f64 / total as f64) * 100.0);
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
    pub async fn upload_file(
        &self,
        upload: &McFileUpload,
    ) -> MeshCentralResult<String> {
        // Validate the file exists locally
        let metadata = tokio::fs::metadata(&upload.local_path).await.map_err(|e| {
            MeshCentralError::FileTransferFailed(format!(
                "Cannot read local file '{}': {}",
                upload.local_path, e
            ))
        })?;

        if !metadata.is_file() {
            return Err(MeshCentralError::FileTransferFailed(format!(
                "'{}' is not a file",
                upload.local_path
            )));
        }

        let transfer_id = uuid::Uuid::new_v4().to_string();

        // Read the file content
        let file_data = tokio::fs::read(&upload.local_path).await.map_err(|e| {
            MeshCentralError::FileTransferFailed(format!(
                "Failed to read file '{}': {}",
                upload.local_path, e
            ))
        })?;

        // Create the file transfer relay request
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(upload.device_id));
        payload.insert("protocol".to_string(), json!(5)); // 5 = files
        payload.insert(
            "name".to_string(),
            json!(format!("upload_{}", transfer_id)),
        );

        // Initiate relay tunnel for file transfer
        let resp = self.send_action("msg", payload).await?;

        let success = McApiClient::is_success(&resp);
        if !success {
            return Err(MeshCentralError::FileTransferFailed(
                "Failed to initiate file transfer tunnel".to_string(),
            ));
        }

        // In a full implementation, the relay WebSocket would be used to:
        // 1. Send a "upload" command specifying remote_path
        // 2. Stream file data in chunks
        // 3. Close the transfer

        log::info!(
            "File upload initiated: {} ({} bytes) -> {}:{}",
            upload.local_path,
            file_data.len(),
            upload.device_id,
            upload.remote_path
        );

        Ok(transfer_id)
    }

    /// Download a file from a device.
    ///
    /// Returns a transfer ID that can be used to track progress.
    pub async fn download_file(
        &self,
        download: &McFileDownload,
    ) -> MeshCentralResult<String> {
        let transfer_id = uuid::Uuid::new_v4().to_string();

        // Create the file transfer relay request
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(download.device_id));
        payload.insert("protocol".to_string(), json!(5)); // 5 = files
        payload.insert(
            "name".to_string(),
            json!(format!("download_{}", transfer_id)),
        );

        let resp = self.send_action("msg", payload).await?;

        let success = McApiClient::is_success(&resp);
        if !success {
            return Err(MeshCentralError::FileTransferFailed(
                "Failed to initiate file download tunnel".to_string(),
            ));
        }

        // In a full implementation, the relay WebSocket would be used to:
        // 1. Send a "download" command specifying remote_path
        // 2. Receive file data in chunks
        // 3. Write to local_path

        log::info!(
            "File download initiated: {}:{} -> {}",
            download.device_id,
            download.remote_path,
            download.local_path
        );

        Ok(transfer_id)
    }

    /// List files in a directory on a remote device.
    pub async fn list_remote_files(
        &self,
        node_id: &str,
        path: &str,
    ) -> MeshCentralResult<serde_json::Value> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(node_id));
        payload.insert("protocol".to_string(), json!(5));
        payload.insert("path".to_string(), json!(path));

        let resp = self.send_action("msg", payload).await?;
        Ok(resp)
    }

    /// Create a directory on a remote device.
    pub async fn create_remote_directory(
        &self,
        node_id: &str,
        path: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(node_id));
        payload.insert("protocol".to_string(), json!(5));
        payload.insert("path".to_string(), json!(path));
        payload.insert("fileop".to_string(), json!("createfolder"));

        let resp = self.send_action("msg", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Directory created".to_string());
        Ok(result)
    }

    /// Delete a file or directory on a remote device.
    pub async fn delete_remote_file(
        &self,
        node_id: &str,
        path: &str,
        files: &[String],
        recursive: bool,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(node_id));
        payload.insert("protocol".to_string(), json!(5));
        payload.insert("path".to_string(), json!(path));
        payload.insert("fileop".to_string(), json!("delete"));
        payload.insert("delfiles".to_string(), json!(files));
        if recursive {
            payload.insert("rec".to_string(), json!(true));
        }

        let resp = self.send_action("msg", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "File(s) deleted".to_string());
        Ok(result)
    }

    /// Rename a file on a remote device.
    pub async fn rename_remote_file(
        &self,
        node_id: &str,
        path: &str,
        old_name: &str,
        new_name: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(node_id));
        payload.insert("protocol".to_string(), json!(5));
        payload.insert("path".to_string(), json!(path));
        payload.insert("fileop".to_string(), json!("rename"));
        payload.insert("oldname".to_string(), json!(old_name));
        payload.insert("newname".to_string(), json!(new_name));

        let resp = self.send_action("msg", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "File renamed".to_string());
        Ok(result)
    }
}
