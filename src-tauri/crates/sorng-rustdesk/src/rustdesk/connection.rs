use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use uuid::Uuid;

use super::service::{ConnectionRecord, RustDeskService};
use super::types::*;

const RUSTDESK_ARGV_SECRET_ERROR: &str =
    "This RustDesk operation is disabled because the installed CLI only accepts its secret in the OS-visible process argument list. Use the RustDesk client UI for password or assignment-token operations.";

fn reject_argv_secret(value: Option<&str>) -> Result<(), String> {
    if value.is_some() {
        return Err(RUSTDESK_ARGV_SECRET_ERROR.to_string());
    }
    Ok(())
}

fn validate_rustdesk_target(remote_id: &str) -> Result<(), String> {
    if remote_id.trim().is_empty()
        || remote_id.len() > 256
        || remote_id.starts_with('-')
        || remote_id.starts_with('/')
        || remote_id.chars().any(char::is_control)
    {
        return Err(
            "RustDesk target is empty, option-like, too long, or contains control characters"
                .to_string(),
        );
    }
    Ok(())
}

impl RustDeskService {
    // ── Remote Desktop Connection ───────────────────────────────────

    /// Initiate a new RustDesk connection (remote desktop, file transfer, tunnel, etc.).
    pub async fn connect(&mut self, request: RustDeskConnectRequest) -> Result<String, String> {
        validate_rustdesk_target(&request.remote_id)?;
        reject_argv_secret(request.password.as_deref())?;
        self.connections
            .retain(|_, record| !record._handle.is_finished());
        if self.connections.len() >= Self::MAX_TRACKED_CONNECTIONS {
            return Err("RustDesk connection tracker reached its 256-session limit".to_string());
        }
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found. Please install RustDesk.")?
            .to_string();

        let session_id = Uuid::new_v4().to_string();
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);

        let session = RustDeskSession {
            id: session_id.clone(),
            remote_id: request.remote_id.clone(),
            connection_type: request.connection_type.clone(),
            connected: false,
            connected_at: None,
            quality: request.quality.clone().unwrap_or(RustDeskQuality::Balanced),
            codec: request.codec.clone().unwrap_or(RustDeskCodec::Auto),
            view_only: request.view_only.unwrap_or(false),
            enable_audio: request.enable_audio.unwrap_or(true),
            enable_clipboard: request.enable_clipboard.unwrap_or(true),
            enable_file_transfer: request.enable_file_transfer.unwrap_or(true),
            force_relay: request.force_relay.unwrap_or(false),
            tunnel_local_port: request.tunnel_local_port,
            tunnel_remote_port: request.tunnel_remote_port,
            password_protected: false,
            remote_device_name: None,
            remote_os: None,
        };

        let args = self.build_connection_args(&request);
        let mut command = Command::new(&path);
        command
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start RustDesk client: {}", e))?;
        let process_id = child.id();
        match tokio::time::timeout(Duration::from_millis(250), child.wait()).await {
            Ok(Ok(status)) => {
                return Err(format!(
                    "RustDesk client exited before launch completed with status {}",
                    status
                ))
            }
            Ok(Err(e)) => return Err(format!("Failed to monitor RustDesk client launch: {}", e)),
            Err(_) => {}
        }

        let handle = tokio::task::spawn(async move {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
                status = child.wait() => {
                    if let Err(e) = status {
                        log::error!("Failed to wait for RustDesk client process: {}", e);
                    }
                }
            }
        });

        let record = ConnectionRecord {
            session,
            process_id,
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), record);

        Ok(session_id)
    }

    /// Build CLI arguments based on connection request.
    fn build_connection_args(&self, request: &RustDeskConnectRequest) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();

        match request.connection_type {
            RustDeskConnectionType::RemoteDesktop => {
                args.push("--connect".to_string());
                let mut remote_id = request.remote_id.clone();
                if request.force_relay.unwrap_or(false) {
                    remote_id.push_str("/r");
                }
                args.push(remote_id);
            }
            RustDeskConnectionType::FileTransfer => {
                args.push("--file-transfer".to_string());
                args.push(request.remote_id.clone());
            }
            RustDeskConnectionType::PortForward => {
                args.push("--port-forward".to_string());
                args.push(request.remote_id.clone());
                if let (Some(local), Some(remote)) =
                    (request.tunnel_local_port, request.tunnel_remote_port)
                {
                    args.push(format!("{}:localhost:{}", local, remote));
                }
            }
            RustDeskConnectionType::ViewCamera => {
                args.push("--connect".to_string());
                args.push(request.remote_id.clone());
            }
            RustDeskConnectionType::Terminal => {
                args.push("--connect".to_string());
                args.push(request.remote_id.clone());
            }
        }

        args
    }

    // ── Direct IP Connection ────────────────────────────────────────

    /// Connect to a device by direct IP address (bypasses ID server).
    pub async fn connect_direct_ip(
        &mut self,
        ip: &str,
        port: Option<u16>,
        password: Option<String>,
    ) -> Result<String, String> {
        let addr = match port {
            Some(p) => format!("{}:{}", ip, p),
            None => ip.to_string(),
        };
        let request = RustDeskConnectRequest {
            remote_id: addr,
            password,
            connection_type: RustDeskConnectionType::RemoteDesktop,
            quality: Some(RustDeskQuality::Balanced),
            view_only: Some(false),
            enable_audio: Some(true),
            enable_clipboard: Some(true),
            enable_file_transfer: Some(true),
            codec: Some(RustDeskCodec::Auto),
            force_relay: Some(false),
            tunnel_local_port: None,
            tunnel_remote_port: None,
        };
        self.connect(request).await
    }

    // ── TCP Tunnel (Port Forward) ───────────────────────────────────

    /// Create a TCP tunnel through a RustDesk connection.
    pub async fn create_tunnel(&mut self, request: CreateTunnelRequest) -> Result<String, String> {
        validate_rustdesk_target(&request.remote_id)?;
        reject_argv_secret(request.password.as_deref())?;
        if request.local_port == 0 || request.remote_port == 0 {
            return Err("RustDesk tunnel ports must be non-zero".to_string());
        }
        if let Some(host) = request.remote_host.as_deref() {
            if host.trim().is_empty() || host.len() > 253 || host.chars().any(char::is_control) {
                return Err("RustDesk tunnel host is empty, too long, or invalid".to_string());
            }
        }
        Err("RustDesk CLI tunnel lifecycle cannot be verified or monitored; refusing to report an active tunnel".to_string())
    }

    /// Close a TCP tunnel.
    pub async fn close_tunnel(&mut self, tunnel_id: &str) -> Result<(), String> {
        let tunnel = self
            .tunnels
            .remove(tunnel_id)
            .ok_or_else(|| format!("Tunnel {} not found", tunnel_id))?;

        // Disconnect the underlying session
        let _ = self.disconnect(&tunnel.session_id).await;
        Ok(())
    }

    // ── Send Input ──────────────────────────────────────────────────

    /// Send an input event to a connected remote desktop session.
    pub async fn send_input(
        &self,
        session_id: &str,
        event: RustDeskInputEvent,
    ) -> Result<(), String> {
        let _record = self
            .connections
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        let _ = event;
        Err(
            "RustDesk input injection is unavailable without native protocol integration"
                .to_string(),
        )
    }

    // ── Set Permanent Password via CLI ──────────────────────────────

    /// Set the permanent (unattended) password on the local RustDesk client.
    pub async fn set_permanent_password(&self, password: &str) -> Result<(), String> {
        let _ = password;
        Err(RUSTDESK_ARGV_SECRET_ERROR.to_string())
    }

    // ── Install Service via CLI ─────────────────────────────────────

    /// Install the RustDesk system service.
    pub async fn install_service(&self) -> Result<(), String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let (status, _) =
            Self::run_bounded_command(&path, &["--install-service"], Duration::from_secs(120))
                .await?;
        if status.success() {
            Ok(())
        } else {
            Err("RustDesk service installation returned a non-zero status".to_string())
        }
    }

    /// Silent install
    pub async fn silent_install(&self) -> Result<(), String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let (status, _) =
            Self::run_bounded_command(&path, &["--silent-install", "1"], Duration::from_secs(120))
                .await?;
        if status.success() {
            Ok(())
        } else {
            Err("RustDesk silent installation returned a non-zero status".to_string())
        }
    }

    // ── Assign via CLI ──────────────────────────────────────────────

    /// Assign the local device to a user/strategy/address-book via CLI token.
    pub async fn assign_via_cli(
        &self,
        token: &str,
        user_name: Option<&str>,
        strategy_name: Option<&str>,
        address_book_name: Option<&str>,
        device_group_name: Option<&str>,
    ) -> Result<String, String> {
        let _ = (
            token,
            user_name,
            strategy_name,
            address_book_name,
            device_group_name,
        );
        Err(RUSTDESK_ARGV_SECRET_ERROR.to_string())
    }
}

#[cfg(test)]
mod process_safety_tests {
    use super::*;

    #[test]
    fn secret_cli_operations_fail_closed() {
        assert_eq!(
            reject_argv_secret(Some("secret-sentinel")).expect_err("secret must be rejected"),
            RUSTDESK_ARGV_SECRET_ERROR
        );
        assert!(reject_argv_secret(None).is_ok());
    }

    #[test]
    fn option_like_remote_targets_are_rejected() {
        for target in ["--password", "/option", "remote\nnext", ""] {
            assert!(validate_rustdesk_target(target).is_err(), "{target:?}");
        }
        assert!(validate_rustdesk_target("123 456 789").is_ok());
    }
}
