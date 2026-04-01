//! # Gateway Service
//!
//! Main entry point for the gateway system. Orchestrates all sub-modules
//! and provides both Tauri-compatible and standalone server interfaces.

use crate::auth::GatewayAuthService;
use crate::config::GatewayConfig;
use crate::health::HealthMonitor;
use crate::letsencrypt_bridge::LetsEncryptBridge;
use crate::metrics::MetricsCollector;
use crate::policy::PolicyEngine;
use crate::proxy::ProxyEngine;
use crate::recording_bridge::RecordingBridge;
use crate::session::SessionManager;
use crate::tls::TlsManager;
use crate::tunnel::TunnelManager;
use crate::types::*;
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;

/// The top-level gateway service that coordinates all gateway features.
pub struct GatewayService {
    /// Gateway instance info
    info: GatewayInfo,
    /// Configuration
    config: GatewayConfig,
    /// Session management
    pub sessions: SessionManager,
    /// Proxy engine
    pub proxy: ProxyEngine,
    /// Tunnel management
    pub tunnels: TunnelManager,
    /// Policy engine
    pub policy: PolicyEngine,
    /// Health monitor
    pub health: HealthMonitor,
    /// Metrics collector
    pub metrics: MetricsCollector,
    /// Authentication service
    pub auth: GatewayAuthService,
    /// TLS manager
    pub tls: TlsManager,
    /// Let's Encrypt bridge
    pub letsencrypt: LetsEncryptBridge,
    /// Recording bridge
    pub recording: RecordingBridge,
    /// Whether the gateway server is running
    server_running: bool,
}

impl GatewayService {
    /// Create a new gateway service with the given configuration.
    pub fn new(config: GatewayConfig) -> GatewayServiceState {
        let info = GatewayInfo {
            id: uuid::Uuid::new_v4().to_string(),
            name: config.name.clone(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            started_at: Utc::now(),
            listen_addr: format!("{}:{}", config.listen_host, config.listen_port),
            headless: config.headless,
            platform: std::env::consts::OS.to_string(),
        };

        let data_dir = config.data_dir.clone();
        let service = GatewayService {
            info,
            config: config.clone(),
            sessions: SessionManager::new(),
            proxy: ProxyEngine::new(),
            tunnels: TunnelManager::new(),
            policy: PolicyEngine::new(&data_dir),
            health: HealthMonitor::new(),
            metrics: MetricsCollector::new(),
            auth: GatewayAuthService::new(&data_dir),
            tls: TlsManager::new(config.tls),
            letsencrypt: LetsEncryptBridge::new(config.letsencrypt),
            recording: RecordingBridge::new(config.recording_enabled),
            server_running: false,
        };

        Arc::new(Mutex::new(service))
    }

    /// Create with default settings (for Tauri integration).
    pub fn new_default(data_dir: String) -> GatewayServiceState {
        let config = GatewayConfig::default_with_dir(data_dir);
        Self::new(config)
    }

    /// Get gateway info.
    pub fn info(&self) -> &GatewayInfo {
        &self.info
    }

    /// Get the current configuration.
    pub fn config(&self) -> &GatewayConfig {
        &self.config
    }

    /// Check if the gateway server is running.
    pub fn is_running(&self) -> bool {
        self.server_running
    }

    // ── Session Operations ──────────────────────────────────────────

    /// Create a new proxy session after policy evaluation.
    pub async fn create_session(
        &mut self,
        user_id: &str,
        username: &str,
        protocol: GatewayProtocol,
        target_addr: &str,
        source_addr: &str,
    ) -> Result<GatewaySession, String> {
        // Evaluate access policies
        let policy_result = self
            .policy
            .evaluate(user_id, target_addr, protocol, source_addr)?;

        match policy_result {
            PolicyAction::Deny => {
                self.metrics.record_denial();
                return Err(format!(
                    "Access denied by policy: user {} to {}",
                    user_id, target_addr
                ));
            }
            PolicyAction::RequireMfa => {
                return Err("MFA required for this connection".to_string());
            }
            _ => {} // Allow, AllowWithRecording, AllowThrottled
        }

        let record = matches!(policy_result, PolicyAction::AllowWithRecording)
            || self.config.recording_enabled;

        let session = self.sessions.create_session(
            user_id,
            username,
            protocol,
            source_addr,
            target_addr,
            record,
        );

        self.metrics.record_connection(protocol);

        if record {
            self.recording.start_recording(&session.id)?;
        }

        log::info!(
            "[GATEWAY] Session {} created: {} -> {} ({:?})",
            session.id,
            username,
            target_addr,
            protocol
        );

        Ok(session)
    }

    /// Terminate a session.
    pub async fn terminate_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self.sessions.get_session(session_id)?;

        if session.recording {
            self.recording.stop_recording(session_id)?;
        }

        self.sessions.terminate_session(session_id)?;
        self.metrics.record_session_end(&session);

        log::info!(
            "[GATEWAY] Session {} terminated: {} -> {}",
            session_id,
            session.username,
            session.target_addr
        );

        Ok(())
    }

    /// List all active sessions.
    pub fn list_active_sessions(&self) -> Vec<&GatewaySession> {
        self.sessions.list_active()
    }

    /// List all sessions for a specific user.
    pub fn list_user_sessions(&self, user_id: &str) -> Vec<&GatewaySession> {
        self.sessions.list_by_user(user_id)
    }

    // ── Route Management ────────────────────────────────────────────

    /// Add a proxy route.
    pub fn add_route(&mut self, route: ProxyRoute) -> Result<(), String> {
        self.proxy.add_route(route)
    }

    /// Remove a proxy route.
    pub fn remove_route(&mut self, route_id: &str) -> Result<(), String> {
        self.proxy.remove_route(route_id)
    }

    /// List all proxy routes.
    pub fn list_routes(&self) -> Vec<&ProxyRoute> {
        self.proxy.list_routes()
    }

    /// Enable/disable a route.
    pub fn set_route_enabled(&mut self, route_id: &str, enabled: bool) -> Result<(), String> {
        self.proxy.set_route_enabled(route_id, enabled)
    }

    // ── Policy Management ───────────────────────────────────────────

    /// Add an access policy.
    pub fn add_policy(&mut self, policy: AccessPolicy) -> Result<(), String> {
        self.policy.add_policy(policy)
    }

    /// Remove an access policy.
    pub fn remove_policy(&mut self, policy_id: &str) -> Result<(), String> {
        self.policy.remove_policy(policy_id)
    }

    /// List all policies.
    pub fn list_policies(&self) -> Vec<&AccessPolicy> {
        self.policy.list_policies()
    }

    // ── Health & Metrics ────────────────────────────────────────────

    /// Get current gateway health.
    pub fn get_health(&self) -> GatewayHealth {
        self.health.check(&self.info, &self.sessions, &self.metrics)
    }

    /// Get current metrics snapshot.
    pub fn get_metrics(&self) -> GatewayMetrics {
        self.metrics.snapshot()
    }

    // ── API Key Management ──────────────────────────────────────────

    /// Create a new API key for a user.
    pub fn create_api_key(
        &mut self,
        name: &str,
        user_id: &str,
        permissions: Vec<GatewayPermission>,
    ) -> Result<(GatewayApiKey, String), String> {
        self.auth.create_api_key(name, user_id, permissions)
    }

    /// Revoke an API key.
    pub fn revoke_api_key(&mut self, key_id: &str) -> Result<(), String> {
        self.auth.revoke_key(key_id)
    }

    /// Authenticate with an API key.
    pub fn authenticate_api_key(&mut self, key: &str) -> Result<GatewayApiKey, String> {
        self.auth.authenticate(key)
    }

    // ── Server Lifecycle ────────────────────────────────────────────

    /// Start the gateway server.
    pub async fn start(&mut self) -> Result<(), String> {
        if self.server_running {
            return Err("Gateway is already running".to_string());
        }

        log::info!(
            "[GATEWAY] Starting gateway '{}' on {}",
            self.info.name,
            self.info.listen_addr
        );

        self.server_running = true;
        self.info.started_at = Utc::now();

        // Initialise the Let's Encrypt bridge (starts renewal loop, OCSP stapling, etc.)
        if let Err(e) = self.letsencrypt.init().await {
            log::warn!("[GATEWAY] Let's Encrypt bridge init failed: {e}");
        }

        // Start TCP/TLS listeners for each proxy route
        let routes = self.proxy.list_routes().into_iter().cloned().collect::<Vec<_>>();
        for route in routes {
            if !route.enabled { continue; }
            let listen_addr = format!("0.0.0.0:{}", route.listen_port);
            let backend_addr = format!("{}:{}", route.target_host, route.target_port);
            let protocol = route.protocol;
            tokio::spawn(async move {
                use tokio::net::TcpListener;
                let listener = match TcpListener::bind(&listen_addr).await {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!("[GATEWAY] Failed to bind {}: {}", listen_addr, e);
                        return;
                    }
                };
                log::info!("[GATEWAY] Listening on {} for {:?}", listen_addr, protocol);
                loop {
                    match listener.accept().await {
                        Ok((mut inbound, addr)) => {
                            let backend_addr = backend_addr.clone();
                            tokio::spawn(async move {
                                match tokio::net::TcpStream::connect(&backend_addr).await {
                                    Ok(mut outbound) => {
                                        let (mut ri, mut wi) = inbound.split();
                                        let (mut ro, mut wo) = outbound.split();
                                        let c1 = tokio::io::copy(&mut ri, &mut wo);
                                        let c2 = tokio::io::copy(&mut ro, &mut wi);
                                        let _ = tokio::try_join!(c1, c2);
                                    }
                                    Err(e) => {
                                        log::error!("[GATEWAY] Failed to connect to backend {}: {}", backend_addr, e);
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            log::error!("[GATEWAY] Accept error on {}: {}", listen_addr, e);
                        }
                    }
                }
            });
        }

        Ok(())
    }

    /// Stop the gateway server.
    pub async fn stop(&mut self) -> Result<(), String> {
        if !self.server_running {
            return Err("Gateway is not running".to_string());
        }

        log::info!("[GATEWAY] Stopping gateway '{}'", self.info.name);

        // Shut down Let's Encrypt bridge first
        if let Err(e) = self.letsencrypt.shutdown().await {
            log::warn!("[GATEWAY] Let's Encrypt bridge shutdown error: {e}");
        }

        // Terminate all active sessions
        let active_ids: Vec<String> = self
            .sessions
            .list_active()
            .iter()
            .map(|s| s.id.clone())
            .collect();

        for session_id in active_ids {
            let _ = self.terminate_session(&session_id).await;
        }

        self.server_running = false;
        Ok(())
    }

    /// Reload configuration (for headless mode hot-reload).
    pub fn reload_config(&mut self, new_config: GatewayConfig) -> Result<(), String> {
        log::info!("[GATEWAY] Reloading configuration");
        self.config = new_config;
        // Re-apply TLS settings
        self.tls = TlsManager::new(self.config.tls.clone());
        // Re-apply Let's Encrypt settings
        self.letsencrypt = LetsEncryptBridge::new(self.config.letsencrypt.clone());
        Ok(())
    }
}
