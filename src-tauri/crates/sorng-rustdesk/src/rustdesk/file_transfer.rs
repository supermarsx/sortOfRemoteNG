use super::service::RustDeskService;
use super::types::*;
use chrono::Utc;
use std::process::Stdio;
use uuid::Uuid;

/// File transfer operations via RustDesk.
impl RustDeskService {
    /// Initiate a file transfer session to a remote peer via CLI.
    pub async fn start_file_transfer(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        file_name: &str,
        total_bytes: u64,
        direction: FileTransferDirection,
        password: Option<&str>,
        use_relay: bool,
    ) -> Result<String, String> {
        // Look up the session to get the remote_id
        let remote_id = self
            .connections
            .get(session_id)
            .map(|r| r.session.remote_id.clone())
            .ok_or_else(|| format!("Session {} not found", session_id))?;

        let transfer_id = Uuid::new_v4().to_string();

        let transfer = RustDeskFileTransfer {
            id: transfer_id.clone(),
            session_id: session_id.to_string(),
            direction: direction.clone(),
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            file_name: file_name.to_string(),
            total_bytes,
            transferred_bytes: 0,
            status: FileTransferStatus::Queued,
            started_at: Utc::now(),
            completed_at: None,
            error: None,
        };

        self.file_transfers.insert(transfer_id.clone(), transfer);

        // Start the RustDesk file-transfer process via CLI
        let binary = self
            .binary_path()
            .ok_or_else(|| "RustDesk binary not found".to_string())?
            .to_string();

        let mut remote = remote_id.clone();
        if use_relay && !remote.ends_with("/r") {
            remote.push_str("/r");
        }

        let mut args = vec!["--file-transfer".to_string(), remote];

        if let Some(pw) = password {
            args.push("--password".to_string());
            args.push(pw.to_string());
        }

        let _child = tokio::process::Command::new(&binary)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start file transfer: {}", e))?;

        // Update status to in-progress
        if let Some(t) = self.file_transfers.get_mut(&transfer_id) {
            t.status = FileTransferStatus::InProgress;
        }

        log::info!(
            "Started file transfer {} ({:?}) to {} : {} -> {}",
            transfer_id,
            direction,
            remote_id,
            local_path,
            remote_path,
        );

        Ok(transfer_id)
    }

    /// Upload a local file to a remote peer (convenience wrapper).
    pub async fn upload_file(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        file_name: &str,
        total_bytes: u64,
        password: Option<&str>,
        use_relay: bool,
    ) -> Result<String, String> {
        self.start_file_transfer(
            session_id,
            local_path,
            remote_path,
            file_name,
            total_bytes,
            FileTransferDirection::Upload,
            password,
            use_relay,
        )
        .await
    }

    /// Download a file from a remote peer (convenience wrapper).
    pub async fn download_file(
        &mut self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        file_name: &str,
        total_bytes: u64,
        password: Option<&str>,
        use_relay: bool,
    ) -> Result<String, String> {
        self.start_file_transfer(
            session_id,
            local_path,
            remote_path,
            file_name,
            total_bytes,
            FileTransferDirection::Download,
            password,
            use_relay,
        )
        .await
    }

    /// Get active (non-completed, non-failed, non-cancelled) transfers.
    pub fn active_file_transfers(&self) -> Vec<RustDeskFileTransfer> {
        self.file_transfers
            .values()
            .filter(|t| {
                matches!(
                    t.status,
                    FileTransferStatus::Queued | FileTransferStatus::InProgress
                )
            })
            .cloned()
            .collect()
    }

    /// Estimate the progress of a file transfer as a percentage (0-100).
    pub fn transfer_progress(&self, transfer_id: &str) -> Option<f64> {
        self.file_transfers.get(transfer_id).map(|t| {
            if t.total_bytes == 0 {
                100.0
            } else {
                (t.transferred_bytes as f64 / t.total_bytes as f64) * 100.0
            }
        })
    }

    /// List remote files on a connected peer (requires an active session).
    /// In a full implementation, this would communicate over the RustDesk protocol.
    pub async fn list_remote_files(
        &self,
        session_id: &str,
        remote_path: &str,
    ) -> Result<Vec<RemoteFileEntry>, String> {
        // Check there's an active session
        let _session = self
            .get_session(session_id)
            .ok_or_else(|| format!("No active session {}", session_id))?;

        log::info!(
            "Listing remote files on session {} at path {}",
            session_id,
            remote_path,
        );

        // Stub: the real implementation would query the remote file system
        Ok(vec![RemoteFileEntry {
            name: ".".to_string(),
            path: remote_path.to_string(),
            is_dir: true,
            size: 0,
            modified: Some(Utc::now().to_rfc3339()),
            permissions: None,
        }])
    }

    /// Get transfer statistics: total, active, completed, failed, cancelled.
    pub fn file_transfer_stats(&self) -> (usize, usize, usize, usize, usize) {
        let total = self.file_transfers.len();
        let active = self
            .file_transfers
            .values()
            .filter(|t| {
                matches!(
                    t.status,
                    FileTransferStatus::Queued | FileTransferStatus::InProgress
                )
            })
            .count();
        let completed = self
            .file_transfers
            .values()
            .filter(|t| matches!(t.status, FileTransferStatus::Completed))
            .count();
        let failed = self
            .file_transfers
            .values()
            .filter(|t| matches!(t.status, FileTransferStatus::Failed))
            .count();
        let cancelled = self
            .file_transfers
            .values()
            .filter(|t| matches!(t.status, FileTransferStatus::Cancelled))
            .count();
        (total, active, completed, failed, cancelled)
    }
}
