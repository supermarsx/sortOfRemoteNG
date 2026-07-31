use super::service::RustDeskService;
use super::types::*;

/// File transfer operations via RustDesk.
impl RustDeskService {
    /// Initiate a file transfer session to a remote peer via CLI.
    #[allow(clippy::too_many_arguments)]
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
        let _ = (
            session_id,
            local_path,
            remote_path,
            file_name,
            total_bytes,
            direction,
            password,
            use_relay,
        );
        Err("Automated RustDesk file transfer is unavailable: the CLI only opens an interactive transfer UI and cannot prove the requested path operation or completion".to_string())
    }

    /// Upload a local file to a remote peer (convenience wrapper).
    #[allow(clippy::too_many_arguments)]
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
    #[allow(clippy::too_many_arguments)]
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
            if t.status == FileTransferStatus::Completed {
                100.0
            } else if t.total_bytes == 0 {
                0.0
            } else {
                ((t.transferred_bytes.min(t.total_bytes) as f64 / t.total_bytes as f64) * 100.0)
                    .clamp(0.0, 100.0)
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
        if remote_path.trim().is_empty()
            || remote_path.len() > 8 * 1024
            || remote_path.chars().any(char::is_control)
        {
            return Err(
                "Remote path is empty, too long, or contains control characters".to_string(),
            );
        }
        let session = self
            .get_session(session_id)
            .ok_or_else(|| format!("No active session {}", session_id))?;
        if !session.connected {
            return Err("RustDesk session has no verified connected state".to_string());
        }
        Err(
            "Remote RustDesk file listing is unavailable without native protocol integration"
                .to_string(),
        )
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
