use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use chrono::Utc;

use super::types::*;
use super::api_client::RustDeskApiClient;

pub type RustDeskServiceState = Arc<Mutex<RustDeskService>>;

/// Internal record for a live connection managed by this service.
#[derive(Debug)]
#[allow(dead_code)]
pub(crate) struct ConnectionRecord {
    pub session: RustDeskSession,
    pub process_id: Option<u32>,
    pub shutdown_tx: tokio::sync::mpsc::Sender<()>,
    pub _handle: tokio::task::JoinHandle<()>,
}

/// Comprehensive RustDesk integration service.
///
/// Manages:
/// * Local binary discovery / version detection
/// * Live connection sessions (remote desktop, file transfer, tunnel)
/// * Server Pro API access through [`RustDeskApiClient`]
pub struct RustDeskService {
    pub(crate) connections: HashMap<String, ConnectionRecord>,
    pub(crate) tunnels: HashMap<String, RustDeskTunnel>,
    pub(crate) file_transfers: HashMap<String, RustDeskFileTransfer>,
    pub(crate) binary_info: RustDeskBinaryInfo,
    pub(crate) client_config: Option<RustDeskClientConfig>,
    pub(crate) server_config: Option<RustDeskServerConfig>,
    pub(crate) api_client: Option<RustDeskApiClient>,
}

impl std::fmt::Debug for RustDeskService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RustDeskService")
            .field("connections", &self.connections.len())
            .field("tunnels", &self.tunnels.len())
            .field("binary_info", &self.binary_info)
            .finish()
    }
}

impl RustDeskService {
    /// Create a new service wrapped in `Arc<Mutex<…>>` (standard pattern).
    pub fn new() -> RustDeskServiceState {
        let binary_info = Self::detect_binary();
        Arc::new(Mutex::new(RustDeskService {
            connections: HashMap::new(),
            tunnels: HashMap::new(),
            file_transfers: HashMap::new(),
            binary_info,
            client_config: None,
            server_config: None,
            api_client: None,
        }))
    }

    // ── Binary Detection ────────────────────────────────────────────

    /// Scan the OS for the RustDesk binary.
    fn detect_binary() -> RustDeskBinaryInfo {
        let candidates = if cfg!(target_os = "windows") {
            vec![
                "C:\\Program Files\\RustDesk\\rustdesk.exe",
                "C:\\Program Files (x86)\\RustDesk\\rustdesk.exe",
            ]
        } else if cfg!(target_os = "macos") {
            vec![
                "/Applications/RustDesk.app/Contents/MacOS/rustdesk",
                "/usr/local/bin/rustdesk",
            ]
        } else {
            vec![
                "/usr/bin/rustdesk",
                "/usr/local/bin/rustdesk",
                "/opt/rustdesk/rustdesk",
                "/snap/bin/rustdesk",
            ]
        };

        let found = candidates.iter().find(|p| std::path::Path::new(p).exists());

        let path_from_which = if found.is_none() {
            Self::find_in_path()
        } else {
            None
        };

        let path = found
            .map(|s| s.to_string())
            .or(path_from_which);

        let platform = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        }
        .to_string();

        match path {
            Some(p) => RustDeskBinaryInfo {
                path: p,
                version: None,
                installed: true,
                service_running: false,
                platform,
            },
            None => RustDeskBinaryInfo {
                path: String::new(),
                version: None,
                installed: false,
                service_running: false,
                platform,
            },
        }
    }

    fn find_in_path() -> Option<String> {
        let cmd = if cfg!(target_os = "windows") {
            "where"
        } else {
            "which"
        };
        if let Ok(output) = std::process::Command::new(cmd).arg("rustdesk").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path.lines().next().unwrap_or("").to_string());
                }
            }
        }
        None
    }

    // ── Public Queries ──────────────────────────────────────────────

    pub fn is_available(&self) -> bool {
        self.binary_info.installed
    }

    pub fn binary_path(&self) -> Option<&str> {
        if self.binary_info.installed {
            Some(&self.binary_info.path)
        } else {
            None
        }
    }

    pub fn get_binary_info(&self) -> &RustDeskBinaryInfo {
        &self.binary_info
    }

    pub fn get_session(&self, session_id: &str) -> Option<RustDeskSession> {
        self.connections.get(session_id).map(|c| c.session.clone())
    }

    pub fn list_sessions(&self) -> Vec<RustDeskSession> {
        self.connections.values().map(|c| c.session.clone()).collect()
    }

    pub fn list_tunnels(&self) -> Vec<RustDeskTunnel> {
        self.tunnels.values().cloned().collect()
    }

    pub fn get_tunnel(&self, tunnel_id: &str) -> Option<RustDeskTunnel> {
        self.tunnels.get(tunnel_id).cloned()
    }

    pub fn list_file_transfers(&self) -> Vec<RustDeskFileTransfer> {
        self.file_transfers.values().cloned().collect()
    }

    pub fn get_file_transfer(&self, transfer_id: &str) -> Option<RustDeskFileTransfer> {
        self.file_transfers.get(transfer_id).cloned()
    }

    // ── Version Detection ───────────────────────────────────────────

    pub async fn detect_version(&mut self) -> Result<String, String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let output = tokio::process::Command::new(&path)
            .arg("--version")
            .output()
            .await
            .map_err(|e| format!("Failed to execute RustDesk: {}", e))?;

        if output.status.success() {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            self.binary_info.version = Some(ver.clone());
            Ok(ver)
        } else {
            Err("RustDesk --version returned non-zero exit code".to_string())
        }
    }

    /// Try to get the local RustDesk machine ID.
    pub async fn get_local_id(&self) -> Result<String, String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let output = tokio::process::Command::new(&path)
            .arg("--get-id")
            .output()
            .await
            .map_err(|e| format!("Failed to execute RustDesk --get-id: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err("RustDesk --get-id failed".to_string())
        }
    }

    // ── Service Status ──────────────────────────────────────────────

    pub async fn check_service_running(&mut self) -> bool {
        #[cfg(target_os = "windows")]
        {
            if let Ok(output) = tokio::process::Command::new("sc")
                .args(["query", "RustDesk"])
                .output()
                .await
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let running = stdout.contains("RUNNING");
                self.binary_info.service_running = running;
                return running;
            }
        }

        #[cfg(target_os = "linux")]
        {
            if let Ok(output) = tokio::process::Command::new("systemctl")
                .args(["is-active", "rustdesk"])
                .output()
                .await
            {
                let active = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .eq_ignore_ascii_case("active");
                self.binary_info.service_running = active;
                return active;
            }
        }

        #[cfg(target_os = "macos")]
        {
            if let Ok(output) = tokio::process::Command::new("pgrep")
                .arg("rustdesk")
                .output()
                .await
            {
                let running = output.status.success();
                self.binary_info.service_running = running;
                return running;
            }
        }

        false
    }

    // ── Server Configuration ────────────────────────────────────────

    pub fn configure_server(&mut self, config: RustDeskServerConfig) {
        let client = RustDeskApiClient::new(config.api_url.clone(), config.api_token.clone());
        self.api_client = Some(client);
        self.server_config = Some(config);
    }

    pub fn get_server_config(&self) -> Option<&RustDeskServerConfig> {
        self.server_config.as_ref()
    }

    pub fn get_api_client(&self) -> Result<&RustDeskApiClient, String> {
        self.api_client
            .as_ref()
            .ok_or_else(|| "Server not configured. Call configure_server first.".to_string())
    }

    // ── Client Configuration ────────────────────────────────────────

    pub fn set_client_config(&mut self, config: RustDeskClientConfig) {
        self.client_config = Some(config);
    }

    pub fn get_client_config(&self) -> Option<&RustDeskClientConfig> {
        self.client_config.as_ref()
    }

    // ── Session Mutation Helpers ─────────────────────────────────────

    pub fn update_session_settings(
        &mut self,
        session_id: &str,
        update: RustDeskSessionUpdate,
    ) -> Result<(), String> {
        let record = self
            .connections
            .get_mut(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;

        if let Some(q) = update.quality {
            record.session.quality = q;
        }
        if let Some(c) = update.codec {
            record.session.codec = c;
        }
        if let Some(v) = update.view_only {
            record.session.view_only = v;
        }
        if let Some(a) = update.enable_audio {
            record.session.enable_audio = a;
        }
        if let Some(cb) = update.enable_clipboard {
            record.session.enable_clipboard = cb;
        }
        if let Some(ft) = update.enable_file_transfer {
            record.session.enable_file_transfer = ft;
        }
        Ok(())
    }

    // ── Cleanup ─────────────────────────────────────────────────────

    /// Disconnect all sessions and close tunnels.
    pub async fn shutdown(&mut self) {
        let ids: Vec<String> = self.connections.keys().cloned().collect();
        for id in ids {
            let _ = self.disconnect(&id).await;
        }
        self.tunnels.clear();
        self.file_transfers.clear();
    }

    /// Disconnect a single session by id.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(record) = self.connections.remove(session_id) {
            let _ = record.shutdown_tx.send(()).await;
            Ok(())
        } else {
            Err(format!("Session {} not found", session_id))
        }
    }

    // ── Connection Statistics ────────────────────────────────────────

    pub fn active_session_count(&self) -> usize {
        self.connections.values().filter(|c| c.session.connected).count()
    }

    pub fn total_session_count(&self) -> usize {
        self.connections.len()
    }

    pub fn active_tunnel_count(&self) -> usize {
        self.tunnels.values().filter(|t| t.active).count()
    }

    /// Record a file transfer in the internal tracker.
    pub fn record_file_transfer(
        &mut self,
        session_id: &str,
        direction: FileTransferDirection,
        local_path: &str,
        remote_path: &str,
        file_name: &str,
        total_bytes: u64,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let transfer = RustDeskFileTransfer {
            id: id.clone(),
            session_id: session_id.to_string(),
            direction,
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
        self.file_transfers.insert(id.clone(), transfer);
        id
    }

    pub fn update_transfer_progress(
        &mut self,
        transfer_id: &str,
        bytes: u64,
        status: FileTransferStatus,
    ) -> Result<(), String> {
        let t = self
            .file_transfers
            .get_mut(transfer_id)
            .ok_or_else(|| format!("Transfer {} not found", transfer_id))?;
        t.transferred_bytes = bytes;
        t.status = status.clone();
        if status == FileTransferStatus::Completed || status == FileTransferStatus::Failed {
            t.completed_at = Some(Utc::now());
        }
        Ok(())
    }

    pub fn cancel_file_transfer(&mut self, transfer_id: &str) -> Result<(), String> {
        let t = self
            .file_transfers
            .get_mut(transfer_id)
            .ok_or_else(|| format!("Transfer {} not found", transfer_id))?;

        if t.status == FileTransferStatus::InProgress || t.status == FileTransferStatus::Queued {
            t.status = FileTransferStatus::Cancelled;
            t.completed_at = Some(Utc::now());
            Ok(())
        } else {
            Err(format!("Transfer {} is not active", transfer_id))
        }
    }
}
