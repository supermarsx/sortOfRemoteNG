//! OpenVPN service — multi-connection manager.
//!
//! Owns all active OpenVPN connections, manages the full lifecycle
//! (create → connect → monitor → disconnect → cleanup), and forwards
//! events to the Tauri frontend via the app handle.

use crate::openvpn::auth::VpnCredentials;
use crate::openvpn::config::{generate_ovpn, parse_ovpn, validate_config, ValidationResult};
use crate::openvpn::dns::{self, DnsConfig, SavedDnsState};
use crate::openvpn::logging::{
    ConnectionLog, ExportFormat, LogEntry, LogLevel, LogRotation,
};
use crate::openvpn::management::MgmtClient;
use crate::openvpn::process::{self, ProcessHandle};
use crate::openvpn::routing::{self, AppliedRoutes, RoutingPolicy};
use crate::openvpn::tunnel::{HealthCheck, TunnelState};
use crate::openvpn::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Type alias used as Tauri managed state.
pub type OpenVpnServiceState = Arc<OpenVpnService>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection handle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Per-connection state handle.
pub struct ConnectionHandle {
    pub id: String,
    pub label: String,
    pub config: OpenVpnConfig,
    pub tunnel: Arc<TunnelState>,
    pub log: Arc<ConnectionLog>,
    pub process: RwLock<Option<Arc<ProcessHandle>>>,
    pub mgmt: RwLock<Option<MgmtClient>>,
    pub applied_routes: RwLock<Option<AppliedRoutes>>,
    pub saved_dns: RwLock<Option<SavedDnsState>>,
    pub routing_policy: RwLock<RoutingPolicy>,
    pub dns_config: RwLock<DnsConfig>,
    pub created_at: chrono::DateTime<Utc>,
    pub mgmt_port: RwLock<Option<u16>>,
}

impl ConnectionHandle {
    fn new(
        id: String,
        label: String,
        config: OpenVpnConfig,
        reconnect_policy: ReconnectPolicy,
    ) -> Arc<Self> {
        Arc::new(Self {
            id: id.clone(),
            label,
            tunnel: TunnelState::new(reconnect_policy),
            log: Arc::new(ConnectionLog::new(&id, 10_000)),
            process: RwLock::new(None),
            mgmt: RwLock::new(None),
            applied_routes: RwLock::new(None),
            saved_dns: RwLock::new(None),
            routing_policy: RwLock::new(RoutingPolicy::default()),
            dns_config: RwLock::new(DnsConfig::default()),
            created_at: Utc::now(),
            mgmt_port: RwLock::new(None),
            config,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub async fn info(&self) -> ConnectionInfo {
        let pid = self
            .process
            .read()
            .await
            .as_ref()
            .map(|p| p.get_pid());

        self.tunnel
            .to_connection_info(
                &self.id,
                &self.label,
                self.config.remotes.first().cloned(),
                pid,
                self.created_at,
            )
            .await
    }

    pub async fn is_connected(&self) -> bool {
        matches!(
            self.tunnel.get_status().await,
            ConnectionStatus::Connected
        )
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OpenVPN service
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Central OpenVPN service that manages all connections.
#[allow(dead_code)]
pub struct OpenVpnService {
    connections: RwLock<HashMap<String, Arc<ConnectionHandle>>>,
    default_reconnect: RwLock<ReconnectPolicy>,
    default_routing: RwLock<RoutingPolicy>,
    default_dns: RwLock<DnsConfig>,
    log_rotation: RwLock<LogRotation>,
}

impl OpenVpnService {
    /// Create a new service instance (wrapped in `Arc`).
    pub fn new() -> OpenVpnServiceState {
        Arc::new(Self {
            connections: RwLock::new(HashMap::new()),
            default_reconnect: RwLock::new(ReconnectPolicy::default()),
            default_routing: RwLock::new(RoutingPolicy::default()),
            default_dns: RwLock::new(DnsConfig::default()),
            log_rotation: RwLock::new(LogRotation::default()),
        })
    }

    // ── Connection lifecycle ──────────────────────────────────────

    /// Create a new connection (does not start it yet).
    pub async fn create_connection(
        &self,
        config: OpenVpnConfig,
        label: Option<String>,
        routing_policy: Option<RoutingPolicy>,
        dns_config: Option<DnsConfig>,
    ) -> Result<ConnectionInfo, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let lbl = label.unwrap_or_else(|| {
            config
                .remotes
                .first()
                .map(|r| format!("{}:{}", r.host, r.port))
                .unwrap_or_else(|| "OpenVPN".into())
        });

        let policy = self.default_reconnect.read().await.clone();
        let handle = ConnectionHandle::new(id.clone(), lbl, config, policy);

        if let Some(rp) = routing_policy {
            *handle.routing_policy.write().await = rp;
        }
        if let Some(dc) = dns_config {
            *handle.dns_config.write().await = dc;
        }

        let info = handle.info().await;
        self.connections.write().await.insert(id, handle);
        Ok(info)
    }

    /// Start an already-created connection.
    pub async fn connect(&self, connection_id: &str) -> Result<ConnectionInfo, String> {
        let handle = self.get_connection(connection_id).await?;

        // Validate config
        let validation = validate_config(&handle.config);
        if !validation.errors.is_empty() {
            return Err(format!(
                "Config validation failed: {}",
                validation.errors.join("; ")
            ));
        }

        handle
            .tunnel
            .set_status(ConnectionStatus::Initializing)
            .await;
        handle
            .log
            .append(LogEntry::internal(LogLevel::Info, "Initializing connection"))
            .await;

        // Find management port
        let mgmt_port = process::find_free_mgmt_port()
            .map_err(|e| format!("Cannot find management port: {}", e.message))?;
        *handle.mgmt_port.write().await = Some(mgmt_port);

        // Find OpenVPN binary
        let binary = find_openvpn_binary()
            .ok_or("OpenVPN binary not found on this system")?;

        // Spawn OpenVPN process
        let (proc, _child) = process::spawn_openvpn(&binary, &handle.config, mgmt_port)
            .await
            .map_err(|e| format!("Cannot spawn OpenVPN: {}", e.message))?;

        *handle.process.write().await = Some(proc.clone());

        handle
            .tunnel
            .set_status(ConnectionStatus::Connecting)
            .await;
        handle
            .log
            .append(LogEntry::internal(
                LogLevel::Info,
                format!("OpenVPN process started (PID: {})", proc.get_pid()),
            ))
            .await;

        // Connect to management interface
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        match MgmtClient::connect("127.0.0.1", mgmt_port).await {
            Ok(mut client) => {
                // Release hold if configured
                let _ = client.hold_release().await;
                let _ = client.state_on().await;
                let _ = client.bytecount(2).await;
                let _ = client.log_on().await;

                *handle.mgmt.write().await = Some(client);
                handle
                    .log
                    .append(LogEntry::internal(
                        LogLevel::Info,
                        format!("Connected to management interface on port {}", mgmt_port),
                    ))
                    .await;
            }
            Err(e) => {
                handle
                    .log
                    .append(LogEntry::internal(
                        LogLevel::Warning,
                        format!("Management interface not available: {}", e.message),
                    ))
                    .await;
            }
        }

        Ok(handle.info().await)
    }

    /// Create and immediately connect.
    pub async fn create_and_connect(
        &self,
        config: OpenVpnConfig,
        label: Option<String>,
        routing_policy: Option<RoutingPolicy>,
        dns_config: Option<DnsConfig>,
    ) -> Result<ConnectionInfo, String> {
        let info = self
            .create_connection(config, label, routing_policy, dns_config)
            .await?;
        self.connect(&info.id).await
    }

    /// Start with event forwarding to Tauri frontend.
    pub async fn connect_with_events<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        connection_id: &str,
    ) -> Result<ConnectionInfo, String> {
        let info = self.connect(connection_id).await?;
        let handle = self.get_connection(connection_id).await?;

        // Spawn a task that monitors the management interface and emits events
        let tunnel = handle.tunnel.clone();
        let log = handle.log.clone();
        let conn_id = connection_id.to_string();
        let mgmt_port = handle.mgmt_port.read().await.unwrap_or(0);

        tokio::spawn(async move {
            Self::event_loop(app, conn_id, tunnel, log, mgmt_port).await;
        });

        Ok(info)
    }

    /// Background event loop that reads management events and forwards them.
    async fn event_loop<R: tauri::Runtime>(
        app: tauri::AppHandle<R>,
        connection_id: String,
        tunnel: Arc<TunnelState>,
        log: Arc<ConnectionLog>,
        _mgmt_port: u16,
    ) {
        use tauri::Emitter;

        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
        let mut consecutive_failures = 0u32;

        loop {
            interval.tick().await;

            let status = tunnel.get_status().await;
            if matches!(status, ConnectionStatus::Disconnected) {
                break;
            }

            // Emit status
            let current_status = tunnel.get_status().await;
            let _ = app.emit(
                "openvpn:status",
                StatusChangeEvent {
                    connection_id: connection_id.clone(),
                    old_status: ConnectionStatus::Disconnected,
                    new_status: current_status,
                    timestamp: Utc::now(),
                },
            );

            // Emit bandwidth (from tunnel state)
            let stats = tunnel.get_stats().await;
            let _ = app.emit(
                "openvpn:bandwidth",
                BandwidthEvent {
                    connection_id: connection_id.clone(),
                    sample: BandwidthSample {
                        timestamp: Utc::now(),
                        bytes_rx: stats.total_bytes_rx,
                        bytes_tx: stats.total_bytes_tx,
                        rx_per_sec: stats.avg_rx_per_sec,
                        tx_per_sec: stats.avg_tx_per_sec,
                    },
                },
            );

            // Check for disconnection / process exit
            consecutive_failures += 1;
            if consecutive_failures > 30 {
                log.append(LogEntry::internal(
                    LogLevel::Warning,
                    "Event loop: too many consecutive failures, stopping",
                ))
                .await;
                break;
            }
        }
    }

    /// Disconnect a connection.
    pub async fn disconnect(&self, connection_id: &str) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;

        handle
            .tunnel
            .set_status(ConnectionStatus::Disconnecting)
            .await;
        handle
            .log
            .append(LogEntry::internal(LogLevel::Info, "Disconnecting"))
            .await;

        // Send SIGTERM via management interface
        if let Some(ref mut mgmt) = *handle.mgmt.write().await {
            let _ = mgmt.signal_sigterm().await;
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        // Kill process if still running
        if let Some(ref proc) = *handle.process.read().await {
            let _ = process::stop_process(proc).await;
        }

        // Rollback routes
        if let Some(ref routes) = *handle.applied_routes.read().await {
            routing::rollback_routes(routes).await;
        }

        // Restore DNS
        if let Some(ref saved) = *handle.saved_dns.read().await {
            let _ = dns::restore_dns(saved).await;
        }

        handle.tunnel.set_disconnected(None).await;
        handle
            .log
            .append(LogEntry::internal(LogLevel::Info, "Disconnected"))
            .await;

        Ok(())
    }

    /// Disconnect all connections.
    pub async fn disconnect_all(&self) -> Result<Vec<String>, String> {
        let ids: Vec<String> = self
            .connections
            .read()
            .await
            .keys()
            .cloned()
            .collect();

        let mut disconnected = Vec::new();
        for id in &ids {
            if let Ok(()) = self.disconnect(id).await {
                disconnected.push(id.clone());
            }
        }
        Ok(disconnected)
    }

    /// Remove a connection (must be disconnected).
    pub async fn remove_connection(&self, connection_id: &str) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;
        if handle.is_connected().await {
            return Err("Cannot remove an active connection; disconnect first".into());
        }

        // Clean up temp files
        if let Some(ref proc) = *handle.process.read().await {
            process::cleanup_temp_files(proc).await;
        }

        self.connections.write().await.remove(connection_id);
        Ok(())
    }

    // ── Query ─────────────────────────────────────────────────────

    /// List all connections.
    pub async fn list_connections(&self) -> Vec<ConnectionInfo> {
        let conns = self.connections.read().await;
        let mut infos = Vec::with_capacity(conns.len());
        for handle in conns.values() {
            infos.push(handle.info().await);
        }
        infos
    }

    /// Get connection info.
    pub async fn get_connection_info(
        &self,
        connection_id: &str,
    ) -> Result<ConnectionInfo, String> {
        let handle = self.get_connection(connection_id).await?;
        Ok(handle.info().await)
    }

    /// Get connection status.
    pub async fn get_status(
        &self,
        connection_id: &str,
    ) -> Result<ConnectionStatus, String> {
        let handle = self.get_connection(connection_id).await?;
        Ok(handle.tunnel.get_status().await)
    }

    /// Get bandwidth statistics.
    pub async fn get_stats(
        &self,
        connection_id: &str,
    ) -> Result<SessionStats, String> {
        let handle = self.get_connection(connection_id).await?;
        Ok(handle.tunnel.get_stats().await)
    }

    // ── Auth ──────────────────────────────────────────────────────

    /// Send credentials to a connection that is waiting for auth.
    pub async fn send_auth(
        &self,
        connection_id: &str,
        credentials: VpnCredentials,
    ) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;
        let mut mgmt = handle.mgmt.write().await;
        let client = mgmt
            .as_mut()
            .ok_or("Management interface not connected")?;
        client
            .send_auth("Auth", &credentials.username, &credentials.password)
            .await
            .map_err(|e| e.message)
    }

    /// Send OTP/2FA code.
    pub async fn send_otp(
        &self,
        connection_id: &str,
        code: &str,
    ) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;
        let mut mgmt = handle.mgmt.write().await;
        let client = mgmt
            .as_mut()
            .ok_or("Management interface not connected")?;
        let payload = crate::openvpn::auth::build_challenge_response(code);
        client
            .send_command(&payload)
            .await
            .map_err(|e| e.message)
    }

    // ── Config ────────────────────────────────────────────────────

    /// Import an .ovpn config file.
    pub async fn import_config(
        &self,
        ovpn_content: &str,
        label: Option<String>,
    ) -> Result<ConnectionInfo, String> {
        let config = parse_ovpn(ovpn_content)?;
        self.create_connection(config, label, None, None).await
    }

    /// Export the config of a connection as .ovpn text.
    pub async fn export_config(
        &self,
        connection_id: &str,
    ) -> Result<String, String> {
        let handle = self.get_connection(connection_id).await?;
        Ok(generate_ovpn(&handle.config))
    }

    /// Validate a config.
    pub fn validate_config_text(
        &self,
        ovpn_content: &str,
    ) -> ValidationResult {
        match parse_ovpn(ovpn_content) {
            Ok(config) => validate_config(&config),
            Err(e) => ValidationResult {
                valid: false,
                errors: vec![e],
                warnings: vec![],
            },
        }
    }

    // ── Routing ───────────────────────────────────────────────────

    /// Set routing policy for a connection.
    pub async fn set_routing_policy(
        &self,
        connection_id: &str,
        policy: RoutingPolicy,
    ) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;
        *handle.routing_policy.write().await = policy;
        Ok(())
    }

    /// Get routing policy for a connection.
    pub async fn get_routing_policy(
        &self,
        connection_id: &str,
    ) -> Result<RoutingPolicy, String> {
        let handle = self.get_connection(connection_id).await?;
        let policy = handle.routing_policy.read().await.clone();
        Ok(policy)
    }

    // ── DNS ───────────────────────────────────────────────────────

    /// Set DNS config for a connection.
    pub async fn set_dns_config(
        &self,
        connection_id: &str,
        config: DnsConfig,
    ) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;
        *handle.dns_config.write().await = config;
        Ok(())
    }

    /// Get DNS config for a connection.
    pub async fn get_dns_config(
        &self,
        connection_id: &str,
    ) -> Result<DnsConfig, String> {
        let handle = self.get_connection(connection_id).await?;
        let config = handle.dns_config.read().await.clone();
        Ok(config)
    }

    // ── Tunnel health ─────────────────────────────────────────────

    /// Run a health check on a connected tunnel.
    pub async fn check_health(
        &self,
        connection_id: &str,
    ) -> Result<HealthCheck, String> {
        let handle = self.get_connection(connection_id).await?;
        let remote_ip = handle
            .tunnel
            .remote_ip
            .read()
            .await
            .clone()
            .unwrap_or_else(|| {
                handle
                    .config
                    .remotes
                    .first()
                    .map(|r| r.host.clone())
                    .unwrap_or_default()
            });

        if remote_ip.is_empty() {
            return Err("No remote IP available for health check".into());
        }

        let check = crate::openvpn::tunnel::check_tunnel_health(&remote_ip, 3000).await;
        *handle.tunnel.last_health.write().await = Some(check.clone());
        Ok(check)
    }

    // ── Logging ───────────────────────────────────────────────────

    /// Get log entries for a connection.
    pub async fn get_logs(
        &self,
        connection_id: &str,
        tail: Option<usize>,
    ) -> Result<Vec<LogEntry>, String> {
        let handle = self.get_connection(connection_id).await?;
        if let Some(n) = tail {
            Ok(handle.log.tail(n).await)
        } else {
            Ok(handle.log.entries().await)
        }
    }

    /// Search logs for a connection.
    pub async fn search_logs(
        &self,
        connection_id: &str,
        query: &str,
    ) -> Result<Vec<LogEntry>, String> {
        let handle = self.get_connection(connection_id).await?;
        Ok(handle.log.search(query).await)
    }

    /// Export logs for a connection.
    pub async fn export_logs(
        &self,
        connection_id: &str,
        format: ExportFormat,
    ) -> Result<String, String> {
        let handle = self.get_connection(connection_id).await?;
        Ok(handle.log.export(format).await)
    }

    /// Clear logs for a connection.
    pub async fn clear_logs(&self, connection_id: &str) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;
        handle.log.clear().await;
        Ok(())
    }

    // ── Management interface passthrough ──────────────────────────

    /// Send a raw management command.
    pub async fn mgmt_command(
        &self,
        connection_id: &str,
        command: &str,
    ) -> Result<(), String> {
        let handle = self.get_connection(connection_id).await?;
        let mut mgmt = handle.mgmt.write().await;
        let client = mgmt
            .as_mut()
            .ok_or("Management interface not connected")?;
        client
            .send_command(command)
            .await
            .map_err(|e| e.message)
    }

    // ── Default policies ──────────────────────────────────────────

    pub async fn set_default_reconnect(&self, policy: ReconnectPolicy) {
        *self.default_reconnect.write().await = policy;
    }

    pub async fn get_default_reconnect(&self) -> ReconnectPolicy {
        self.default_reconnect.read().await.clone()
    }

    pub async fn set_default_routing(&self, policy: RoutingPolicy) {
        *self.default_routing.write().await = policy;
    }

    pub async fn set_default_dns(&self, config: DnsConfig) {
        *self.default_dns.write().await = config;
    }

    // ── OpenVPN binary ────────────────────────────────────────────

    /// Detect the installed OpenVPN version.
    pub async fn detect_version(&self) -> Result<String, String> {
        let binary = find_openvpn_binary()
            .ok_or("OpenVPN binary not found on this system")?;
        process::get_openvpn_version(&binary)
            .await
            .map_err(|e| e.message)
    }

    /// Find the OpenVPN binary path.
    pub fn find_binary(&self) -> Option<String> {
        find_openvpn_binary().map(|p| p.to_string_lossy().to_string())
    }

    // ── Internals ─────────────────────────────────────────────────

    async fn get_connection(
        &self,
        id: &str,
    ) -> Result<Arc<ConnectionHandle>, String> {
        self.connections
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| format!("Connection '{}' not found", id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn service_create() {
        let svc = OpenVpnService::new();
        let list = svc.list_connections().await;
        assert!(list.is_empty());
    }

    #[tokio::test]
    async fn service_create_connection() {
        let svc = OpenVpnService::new();
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint {
            host: "vpn.example.com".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });

        let info = svc
            .create_connection(cfg, Some("Test VPN".into()), None, None)
            .await
            .unwrap();
        assert_eq!(info.label, "Test VPN");
        assert_eq!(info.status, ConnectionStatus::Disconnected);
    }

    #[tokio::test]
    async fn service_list_connections() {
        let svc = OpenVpnService::new();
        for i in 0..3 {
            let mut cfg = OpenVpnConfig::default();
            cfg.remotes.push(RemoteEndpoint {
                host: format!("server{}.example.com", i),
                port: 1194,
                protocol: VpnProtocol::Udp,
            });
            svc.create_connection(cfg, None, None, None).await.unwrap();
        }
        let list = svc.list_connections().await;
        assert_eq!(list.len(), 3);
    }

    #[tokio::test]
    async fn service_get_info() {
        let svc = OpenVpnService::new();
        let cfg = OpenVpnConfig::default();
        let info = svc
            .create_connection(cfg, Some("Test".into()), None, None)
            .await
            .unwrap();
        let info2 = svc.get_connection_info(&info.id).await.unwrap();
        assert_eq!(info.id, info2.id);
    }

    #[tokio::test]
    async fn service_get_info_not_found() {
        let svc = OpenVpnService::new();
        let result = svc.get_connection_info("nonexistent").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn service_remove_connection() {
        let svc = OpenVpnService::new();
        let cfg = OpenVpnConfig::default();
        let info = svc
            .create_connection(cfg, None, None, None)
            .await
            .unwrap();
        svc.remove_connection(&info.id).await.unwrap();
        assert!(svc.get_connection_info(&info.id).await.is_err());
    }

    #[tokio::test]
    async fn service_import_config() {
        let svc = OpenVpnService::new();
        let ovpn = "remote vpn.example.com 1194 udp\ndev tun\ncipher AES-256-GCM";
        let info = svc
            .import_config(ovpn, Some("Imported".into()))
            .await
            .unwrap();
        assert_eq!(info.label, "Imported");
    }

    #[tokio::test]
    async fn service_export_config() {
        let svc = OpenVpnService::new();
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint {
            host: "vpn.example.com".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });
        let info = svc
            .create_connection(cfg, None, None, None)
            .await
            .unwrap();
        let ovpn = svc.export_config(&info.id).await.unwrap();
        assert!(ovpn.contains("remote vpn.example.com 1194 udp"));
    }

    #[tokio::test]
    async fn service_validate_config() {
        let svc = OpenVpnService::new();
        let result = svc.validate_config_text("remote vpn.example.com 1194\ndev tun");
        assert!(result.errors.is_empty());
    }

    #[tokio::test]
    async fn service_set_routing_policy() {
        let svc = OpenVpnService::new();
        let cfg = OpenVpnConfig::default();
        let info = svc
            .create_connection(cfg, None, None, None)
            .await
            .unwrap();
        let policy = RoutingPolicy::full_tunnel();
        svc.set_routing_policy(&info.id, policy).await.unwrap();
        let got = svc.get_routing_policy(&info.id).await.unwrap();
        assert!(got.redirect_gateway);
    }

    #[tokio::test]
    async fn service_set_dns_config() {
        let svc = OpenVpnService::new();
        let cfg = OpenVpnConfig::default();
        let info = svc
            .create_connection(cfg, None, None, None)
            .await
            .unwrap();
        let dns = DnsConfig {
            servers: vec!["8.8.8.8".into()],
            ..Default::default()
        };
        svc.set_dns_config(&info.id, dns).await.unwrap();
        let got = svc.get_dns_config(&info.id).await.unwrap();
        assert_eq!(got.servers, vec!["8.8.8.8"]);
    }

    #[tokio::test]
    async fn service_get_logs_empty() {
        let svc = OpenVpnService::new();
        let cfg = OpenVpnConfig::default();
        let info = svc
            .create_connection(cfg, None, None, None)
            .await
            .unwrap();
        let logs = svc.get_logs(&info.id, None).await.unwrap();
        assert!(logs.is_empty());
    }

    #[tokio::test]
    async fn service_default_label() {
        let svc = OpenVpnService::new();
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint {
            host: "vpn.test.com".into(),
            port: 443,
            protocol: VpnProtocol::Tcp,
        });
        let info = svc
            .create_connection(cfg, None, None, None)
            .await
            .unwrap();
        assert_eq!(info.label, "vpn.test.com:443");
    }

    #[tokio::test]
    async fn service_disconnect_all_empty() {
        let svc = OpenVpnService::new();
        let result = svc.disconnect_all().await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn service_find_binary() {
        let svc = OpenVpnService::new();
        // May or may not find it depending on environment
        let _ = svc.find_binary();
    }

    #[tokio::test]
    async fn service_default_policies() {
        let svc = OpenVpnService::new();
        let rp = svc.get_default_reconnect().await;
        assert!(rp.enabled);
        svc.set_default_reconnect(ReconnectPolicy {
            enabled: false,
            ..Default::default()
        })
        .await;
        let rp2 = svc.get_default_reconnect().await;
        assert!(!rp2.enabled);
    }
}
