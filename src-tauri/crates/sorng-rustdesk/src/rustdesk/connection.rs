use chrono::Utc;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

use super::service::{ConnectionRecord, RustDeskService};
use super::types::*;

impl RustDeskService {
    // ── Remote Desktop Connection ───────────────────────────────────

    /// Initiate a new RustDesk connection (remote desktop, file transfer, tunnel, etc.).
    pub async fn connect(&mut self, request: RustDeskConnectRequest) -> Result<String, String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found. Please install RustDesk.")?
            .to_string();

        let session_id = Uuid::new_v4().to_string();
        let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);

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
            password_protected: request.password.is_some(),
            remote_device_name: None,
            remote_os: None,
        };

        let args = self.build_connection_args(&request);
        let path_clone = path.clone();
        let remote_id = request.remote_id.clone();
        let sid = session_id.clone();

        let handle = tokio::task::spawn(async move {
            Self::run_connection_process(path_clone, args, remote_id, sid, shutdown_rx).await;
        });

        let record = ConnectionRecord {
            session,
            process_id: None,
            shutdown_tx,
            _handle: handle,
        };

        self.connections.insert(session_id.clone(), record);

        // Mark as connected after spawn
        if let Some(r) = self.connections.get_mut(&session_id) {
            r.session.connected = true;
            r.session.connected_at = Some(Utc::now());
        }

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

        if let Some(ref pwd) = request.password {
            args.push("--password".to_string());
            args.push(pwd.clone());
        }

        args
    }

    /// Spawn the RustDesk process and monitor it until shutdown.
    async fn run_connection_process(
        rustdesk_path: String,
        args: Vec<String>,
        remote_id: String,
        _session_id: String,
        mut shutdown_rx: tokio::sync::mpsc::Receiver<()>,
    ) {
        match Command::new(&rustdesk_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(mut child) => {
                log::info!("RustDesk process started for remote: {}", remote_id);

                // Monitor stdout
                if let Some(stdout) = child.stdout.take() {
                    let rid = remote_id.clone();
                    tokio::task::spawn(async move {
                        let reader = BufReader::new(stdout);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            log::debug!("RustDesk [{}] stdout: {}", rid, line);
                        }
                    });
                }

                // Monitor stderr
                if let Some(stderr) = child.stderr.take() {
                    let rid = remote_id.clone();
                    tokio::task::spawn(async move {
                        let reader = BufReader::new(stderr);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            log::warn!("RustDesk [{}] stderr: {}", rid, line);
                        }
                    });
                }

                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        log::info!("Shutting down RustDesk connection to {}", remote_id);
                        let _ = child.kill().await;
                    }
                    status = child.wait() => {
                        match status {
                            Ok(exit) => log::info!(
                                "RustDesk process for {} exited: {:?}", remote_id, exit
                            ),
                            Err(e) => log::error!(
                                "Error waiting for RustDesk process {}: {}", remote_id, e
                            ),
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to start RustDesk process: {}", e);
            }
        }
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
    pub async fn create_tunnel(
        &mut self,
        request: CreateTunnelRequest,
    ) -> Result<String, String> {
        let connect_request = RustDeskConnectRequest {
            remote_id: request.remote_id.clone(),
            password: request.password.clone(),
            connection_type: RustDeskConnectionType::PortForward,
            quality: None,
            view_only: None,
            enable_audio: None,
            enable_clipboard: None,
            enable_file_transfer: None,
            codec: None,
            force_relay: None,
            tunnel_local_port: Some(request.local_port),
            tunnel_remote_port: Some(request.remote_port),
        };
        let session_id = self.connect(connect_request).await?;

        let tunnel = RustDeskTunnel {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.clone(),
            local_port: request.local_port,
            remote_port: request.remote_port,
            remote_host: request.remote_host.unwrap_or_else(|| "localhost".to_string()),
            active: true,
            bytes_sent: 0,
            bytes_received: 0,
            created_at: Utc::now(),
        };

        let tunnel_id = tunnel.id.clone();
        self.tunnels.insert(tunnel_id.clone(), tunnel);
        Ok(tunnel_id)
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
        let record = self
            .connections
            .get(session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;

        if !record.session.connected {
            return Err("Session is not connected".to_string());
        }

        // RustDesk CLI doesn't support real-time input injection;
        // this requires the RustDesk native protocol integration.
        // For now we log the intent — full integration requires the
        // rendezvous/relay WebSocket protocol.
        log::debug!(
            "Input event {:?} for session {} (type={:?})",
            event.data,
            session_id,
            event.input_type,
        );

        Ok(())
    }

    // ── Set Permanent Password via CLI ──────────────────────────────

    /// Set the permanent (unattended) password on the local RustDesk client.
    pub async fn set_permanent_password(&self, password: &str) -> Result<(), String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let output = Command::new(&path)
            .args(["--password", password])
            .output()
            .await
            .map_err(|e| format!("Failed to set password: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to set password: {}", stderr))
        }
    }

    // ── Install Service via CLI ─────────────────────────────────────

    /// Install the RustDesk system service.
    pub async fn install_service(&self) -> Result<(), String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let output = Command::new(&path)
            .arg("--install-service")
            .output()
            .await
            .map_err(|e| format!("Failed to install service: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to install service: {}", stderr))
        }
    }

    /// Silent install
    pub async fn silent_install(&self) -> Result<(), String> {
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let output = Command::new(&path)
            .args(["--silent-install", "1"])
            .output()
            .await
            .map_err(|e| format!("Failed to silent install: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Silent install failed: {}", stderr))
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
        let path = self
            .binary_path()
            .ok_or("RustDesk binary not found")?
            .to_string();

        let mut args = vec!["--assign".to_string(), "--token".to_string(), token.to_string()];
        if let Some(v) = user_name {
            args.push("--user_name".to_string());
            args.push(v.to_string());
        }
        if let Some(v) = strategy_name {
            args.push("--strategy_name".to_string());
            args.push(v.to_string());
        }
        if let Some(v) = address_book_name {
            args.push("--address_book_name".to_string());
            args.push(v.to_string());
        }
        if let Some(v) = device_group_name {
            args.push("--device_group_name".to_string());
            args.push(v.to_string());
        }

        let output = Command::new(&path)
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("Assign failed: {}", e))?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}
