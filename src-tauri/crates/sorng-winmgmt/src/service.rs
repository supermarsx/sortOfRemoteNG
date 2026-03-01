//! Aggregate service facade for the Windows Management crate.
//!
//! Manages WMI sessions and delegates to the domain-specific managers
//! (services, event logs, processes, perf monitoring, registry,
//! scheduled tasks, system info).

use crate::transport::WmiTransport;
use crate::types::*;
use chrono::Utc;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Alias for Tauri managed state.
pub type WinMgmtServiceState = Arc<Mutex<WinMgmtService>>;

/// Internal session wrapper that owns the transport alongside metadata.
struct ManagedSession {
    meta: WmiSession,
    config: WmiConnectionConfig,
    transport: WmiTransport,
}

/// Central service managing WMI sessions to remote Windows hosts.
pub struct WinMgmtService {
    /// Active sessions keyed by session ID.
    sessions: HashMap<String, ManagedSession>,
    /// Global configuration.
    config: WinMgmtConfig,
}

/// Configuration for the Windows Management service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinMgmtConfig {
    /// Default namespace for WMI queries.
    pub default_namespace: String,
    /// HTTP timeout in seconds for WinRM transport.
    pub timeout_seconds: u64,
    /// Maximum number of concurrent sessions.
    pub max_sessions: usize,
    /// Whether to verify TLS certificates.
    pub verify_tls: bool,
}

impl Default for WinMgmtConfig {
    fn default() -> Self {
        Self {
            default_namespace: "root/cimv2".to_string(),
            timeout_seconds: 30,
            max_sessions: 50,
            verify_tls: false,
        }
    }
}

/// Summary of a connected session (for UI listing).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub hostname: String,
    pub protocol: String,
    pub port: u16,
    pub namespace: String,
    pub state: String,
}

impl WinMgmtService {
    /// Create a new service with default config.
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            config: WinMgmtConfig::default(),
        }
    }

    /// Create a new service with custom config.
    pub fn with_config(config: WinMgmtConfig) -> Self {
        Self {
            sessions: HashMap::new(),
            config,
        }
    }

    /// Get the current configuration.
    pub fn config(&self) -> &WinMgmtConfig {
        &self.config
    }

    /// Update the configuration.
    pub fn set_config(&mut self, config: WinMgmtConfig) {
        self.config = config;
    }

    // ─── Session Management ──────────────────────────────────────────

    /// Connect to a remote host and create a new WMI session.
    pub async fn connect(
        &mut self,
        config: WmiConnectionConfig,
    ) -> Result<String, String> {
        if self.sessions.len() >= self.config.max_sessions {
            return Err(format!(
                "Maximum session limit ({}) reached",
                self.config.max_sessions
            ));
        }

        let session_id = uuid::Uuid::new_v4().to_string();

        info!(
            "Connecting to {} via {:?} (session {})",
            config.computer_name, config.protocol, session_id
        );

        // Build transport from connection config
        let mut transport = WmiTransport::new(&config)
            .map_err(|e| format!("Failed to create transport: {e}"))?;

        // Set auth if credentials provided
        if let Some(header) = WmiTransport::build_auth_header(&config) {
            transport.set_auth(header);
        }

        // Test connectivity
        transport
            .test_connection()
            .await
            .map_err(|e| format!("Connection test failed: {e}"))?;

        let now = Utc::now();
        let meta = WmiSession {
            id: session_id.clone(),
            computer_name: config.computer_name.clone(),
            namespace: config.namespace.clone(),
            state: WmiSessionState::Connected,
            protocol: config.protocol.clone(),
            auth_method: config.auth_method.clone(),
            connected_at: now,
            last_activity: now,
        };

        let managed = ManagedSession {
            meta,
            config: config.clone(),
            transport,
        };

        self.sessions.insert(session_id.clone(), managed);

        info!(
            "Session {} connected to {}",
            session_id, config.computer_name
        );

        Ok(session_id)
    }

    /// Disconnect a session.
    pub fn disconnect(&mut self, session_id: &str) -> Result<(), String> {
        let managed = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;
        info!(
            "Session {} disconnected from {}",
            session_id, managed.config.computer_name
        );
        Ok(())
    }

    /// Disconnect all sessions.
    pub fn disconnect_all(&mut self) -> usize {
        let count = self.sessions.len();
        self.sessions.clear();
        info!("Disconnected {} sessions", count);
        count
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        self.sessions
            .values()
            .map(|s| SessionSummary {
                session_id: s.meta.id.clone(),
                hostname: s.meta.computer_name.clone(),
                protocol: format!("{:?}", s.meta.protocol),
                port: s.config.effective_port(),
                namespace: s.meta.namespace.clone(),
                state: format!("{:?}", s.meta.state),
            })
            .collect()
    }

    /// Get session count.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Check if a session exists.
    pub fn has_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// Get a mutable reference to the transport for a session.
    pub fn get_transport(
        &mut self,
        session_id: &str,
    ) -> Result<&mut WmiTransport, String> {
        let managed = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {session_id}"))?;

        match managed.meta.state {
            WmiSessionState::Connected => {}
            WmiSessionState::Disconnected => {
                return Err(format!("Session {session_id} is disconnected"));
            }
            WmiSessionState::Error => {
                return Err(format!("Session {session_id} is in error state"));
            }
        }

        managed.meta.last_activity = Utc::now();
        Ok(&mut managed.transport)
    }

    /// Execute a raw WQL query on a session.
    pub async fn raw_query(
        &mut self,
        session_id: &str,
        query: &str,
    ) -> Result<Vec<HashMap<String, String>>, String> {
        let transport = self.get_transport(session_id)?;
        transport.wql_query(query).await
    }
}

impl Default for WinMgmtService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = WinMgmtConfig::default();
        assert_eq!(config.default_namespace, "root/cimv2");
        assert_eq!(config.timeout_seconds, 30);
        assert_eq!(config.max_sessions, 50);
        assert!(!config.verify_tls);
    }

    #[test]
    fn test_service_new() {
        let svc = WinMgmtService::new();
        assert_eq!(svc.session_count(), 0);
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn test_disconnect_missing() {
        let mut svc = WinMgmtService::new();
        assert!(svc.disconnect("nonexistent").is_err());
    }

    #[test]
    fn test_has_session() {
        let svc = WinMgmtService::new();
        assert!(!svc.has_session("unknown"));
    }

    #[test]
    fn test_disconnect_all() {
        let mut svc = WinMgmtService::new();
        assert_eq!(svc.disconnect_all(), 0);
    }
}
