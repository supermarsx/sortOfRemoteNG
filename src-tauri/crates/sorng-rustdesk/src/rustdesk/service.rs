use std::collections::HashMap;
use std::process::{ExitStatus, Stdio};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

use super::api_client::RustDeskApiClient;
use super::types::*;

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
    const MAX_CLI_OUTPUT_BYTES: usize = 64 * 1024;
    pub(crate) const MAX_TRACKED_CONNECTIONS: usize = 256;

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

        let path = candidates
            .iter()
            .find(|p| std::path::Path::new(p).is_file())
            .map(|path| path.to_string());

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
        self.connections
            .get(session_id)
            .filter(|record| !record._handle.is_finished())
            .map(|record| record.session.clone())
    }

    pub fn list_sessions(&self) -> Vec<RustDeskSession> {
        self.connections
            .values()
            .filter(|record| !record._handle.is_finished())
            .map(|record| record.session.clone())
            .collect()
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

        let (status, stdout) =
            Self::run_bounded_command(&path, &["--version"], Duration::from_secs(10)).await?;
        if status.success() {
            let ver = String::from_utf8_lossy(&stdout).trim().to_string();
            if ver.is_empty() {
                return Err("RustDesk returned an empty version".to_string());
            }
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

        let (status, stdout) =
            Self::run_bounded_command(&path, &["--get-id"], Duration::from_secs(10)).await?;
        if status.success() {
            let id = String::from_utf8_lossy(&stdout).trim().to_string();
            if id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
                return Err("RustDesk returned an invalid local ID".to_string());
            }
            Ok(id)
        } else {
            Err("RustDesk --get-id failed".to_string())
        }
    }

    // ── Service Status ──────────────────────────────────────────────

    pub async fn check_service_running(&mut self) -> Result<bool, String> {
        #[cfg(target_os = "windows")]
        {
            let (status, stdout) =
                Self::run_bounded_command("sc", &["query", "RustDesk"], Duration::from_secs(10))
                    .await?;
            if !status.success() {
                return Err("Windows could not determine RustDesk service status".to_string());
            }
            let running = String::from_utf8_lossy(&stdout)
                .lines()
                .any(|line| line.split_whitespace().any(|field| field == "RUNNING"));
            self.binary_info.service_running = running;
            return Ok(running);
        }

        #[cfg(target_os = "linux")]
        {
            let (status, stdout) = Self::run_bounded_command(
                "systemctl",
                &["is-active", "rustdesk"],
                Duration::from_secs(10),
            )
            .await?;
            if !status.success() && status.code() != Some(3) {
                return Err("systemd could not determine RustDesk service status".to_string());
            }
            let active = String::from_utf8_lossy(&stdout)
                .trim()
                .eq_ignore_ascii_case("active");
            self.binary_info.service_running = active;
            return Ok(active);
        }

        #[cfg(target_os = "macos")]
        {
            let (status, _) =
                Self::run_bounded_command("pgrep", &["rustdesk"], Duration::from_secs(10)).await?;
            let running = if status.success() {
                true
            } else if status.code() == Some(1) {
                false
            } else {
                return Err("macOS could not determine RustDesk process status".to_string());
            };
            self.binary_info.service_running = running;
            return Ok(running);
        }

        #[allow(unreachable_code)]
        Err("RustDesk service status is unavailable on this platform".to_string())
    }

    // ── Server Configuration ────────────────────────────────────────

    pub fn configure_server(&mut self, config: RustDeskServerConfig) -> Result<(), String> {
        validate_optional_endpoint("relay server", config.relay_server.as_deref())?;
        validate_optional_secret("server key", config.server_key.as_deref())?;
        let client = RustDeskApiClient::new(config.api_url.clone(), config.api_token.clone())?;
        self.api_client = Some(client);
        self.server_config = Some(config);
        Ok(())
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

    pub fn set_client_config(&mut self, config: RustDeskClientConfig) -> Result<(), String> {
        validate_optional_endpoint("ID server", config.id_server.as_deref())?;
        validate_optional_endpoint("relay server", config.relay_server.as_deref())?;
        validate_optional_endpoint("API server", config.api_server.as_deref())?;
        validate_optional_endpoint("direct server", config.direct_server.as_deref())?;
        validate_optional_secret("client key", config.key.as_deref())?;
        self.client_config = Some(config);
        Ok(())
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
        let _ = self
            .connections
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        let _ = update;
        Err("Live RustDesk session settings are unavailable through the CLI; refusing to report an unapplied update".to_string())
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
            if record._handle.is_finished() {
                return Err("RustDesk client process has already exited".to_string());
            }
            let _ = record.shutdown_tx.send(()).await;
            Ok(())
        } else {
            Err(format!("Session {} not found", session_id))
        }
    }

    // ── Connection Statistics ────────────────────────────────────────

    pub fn active_session_count(&self) -> usize {
        self.connections
            .values()
            .filter(|record| record.session.connected && !record._handle.is_finished())
            .count()
    }

    pub fn total_session_count(&self) -> usize {
        self.connections
            .values()
            .filter(|record| !record._handle.is_finished())
            .count()
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
    ) -> Result<String, String> {
        let _ = (
            session_id,
            direction,
            local_path,
            remote_path,
            file_name,
            total_bytes,
        );
        Err("Manual RustDesk transfer records are disabled because no native transfer lifecycle is wired".to_string())
    }

    pub fn update_transfer_progress(
        &mut self,
        transfer_id: &str,
        bytes: u64,
        status: FileTransferStatus,
    ) -> Result<(), String> {
        let _ = (transfer_id, bytes, status);
        Err("Manual RustDesk transfer progress injection is disabled".to_string())
    }

    pub fn cancel_file_transfer(&mut self, transfer_id: &str) -> Result<(), String> {
        let _ = transfer_id;
        Err("RustDesk transfer cancellation is unavailable because no native transfer lifecycle is wired".to_string())
    }

    pub(crate) async fn run_bounded_command(
        program: &str,
        args: &[&str],
        timeout: Duration,
    ) -> Result<(ExitStatus, Vec<u8>), String> {
        let mut command = tokio::process::Command::new(program);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start RustDesk helper process: {}", e))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "RustDesk helper stdout was unavailable".to_string())?;

        tokio::time::timeout(timeout, async move {
            let mut output = Vec::new();
            let mut bounded = stdout.take((Self::MAX_CLI_OUTPUT_BYTES + 1) as u64);
            bounded
                .read_to_end(&mut output)
                .await
                .map_err(|e| format!("Failed to read RustDesk helper output: {}", e))?;
            if output.len() > Self::MAX_CLI_OUTPUT_BYTES {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err("RustDesk helper output exceeds the 64 KiB limit".to_string());
            }
            let status = child
                .wait()
                .await
                .map_err(|e| format!("Failed to wait for RustDesk helper process: {}", e))?;
            Ok((status, output))
        })
        .await
        .map_err(|_| "RustDesk helper process timed out".to_string())?
    }
}

fn validate_optional_endpoint(name: &str, value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value {
        if value.trim().is_empty() || value.len() > 2 * 1024 || value.chars().any(char::is_control)
        {
            return Err(format!(
                "RustDesk {} is empty, too long, or contains control characters",
                name
            ));
        }
    }
    Ok(())
}

fn validate_optional_secret(name: &str, value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value {
        if value.is_empty() || value.len() > 16 * 1024 || value.chars().any(char::is_control) {
            return Err(format!(
                "RustDesk {} is empty, too long, or contains control characters",
                name
            ));
        }
    }
    Ok(())
}
