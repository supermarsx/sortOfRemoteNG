//! # MCP Service
//!
//! Central orchestrator for the MCP server. Owns the config, session manager,
//! auth manager, log buffer, metrics, and event history. Provides a unified
//! interface for the Tauri command layer.
//!
//! The `McpServiceState` type alias follows the standard crate pattern:
//! `Arc<Mutex<McpService>>` for thread-safe sharing across Tauri commands.

use crate::auth::AuthManager;
use crate::logging::McpLogBuffer;
use crate::session::SessionManager;
use crate::server;
use crate::transport::{McpHttpRequest, HttpMethod};
use crate::types::*;

use log::info;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Thread-safe shared state handle for the MCP service.
pub type McpServiceState = Arc<Mutex<McpService>>;

/// Central MCP service that coordinates all subsystems.
pub struct McpService {
    /// Current configuration (disabled by default).
    pub config: McpServerConfig,
    /// Session manager.
    pub sessions: SessionManager,
    /// Authentication manager.
    pub auth: AuthManager,
    /// Structured log buffer.
    pub log_buffer: McpLogBuffer,
    /// Aggregate metrics.
    pub metrics: McpMetrics,
    /// Event history (limited to last 500).
    pub events: Vec<McpEvent>,
    /// Tool call audit log.
    pub tool_call_logs: Vec<ToolCallLog>,
    /// Whether the HTTP server is currently running.
    pub running: bool,
    /// Timestamp when the server was last started.
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Last error message.
    pub last_error: Option<String>,
}

impl McpService {
    /// Create a new MCP service with default config (disabled).
    pub fn new() -> Self {
        let config = McpServerConfig::default();
        let sessions = SessionManager::new(config.max_sessions, config.session_timeout_secs);
        let auth = AuthManager::new(config.api_key.clone(), config.require_auth);

        Self {
            config,
            sessions,
            auth,
            log_buffer: McpLogBuffer::new(McpLogLevel::Info),
            metrics: McpMetrics::default(),
            events: Vec::new(),
            tool_call_logs: Vec::new(),
            running: false,
            started_at: None,
            last_error: None,
        }
    }

    /// Create a new MCP service with the given config.
    pub fn with_config(config: McpServerConfig) -> Self {
        let sessions = SessionManager::new(config.max_sessions, config.session_timeout_secs);
        let auth = AuthManager::new(config.api_key.clone(), config.require_auth);

        Self {
            config,
            sessions,
            auth,
            log_buffer: McpLogBuffer::new(McpLogLevel::Info),
            metrics: McpMetrics::default(),
            events: Vec::new(),
            tool_call_logs: Vec::new(),
            running: false,
            started_at: None,
            last_error: None,
        }
    }

    // ── Server Lifecycle ─────────────────────────────────────────

    /// Start the MCP server.
    pub fn start(&mut self) -> Result<McpServerStatus, String> {
        if !self.config.enabled {
            return Err("MCP server is disabled in settings".to_string());
        }
        if self.running {
            return Err("MCP server is already running".to_string());
        }

        let addr = server::listen_address(&self.config);
        info!("Starting MCP server on {}", addr);

        self.running = true;
        self.started_at = Some(chrono::Utc::now());
        self.last_error = None;

        self.log_buffer.log(
            McpLogLevel::Info,
            "mcp.server",
            &format!("MCP server started on {}", addr),
            None,
        );

        self.record_event(McpEventType::ServerStarted, json!({ "address": addr }));
        self.metrics.total_requests = 0;
        self.metrics.total_tool_calls = 0;
        self.metrics.total_resource_reads = 0;

        Ok(self.get_status())
    }

    /// Stop the MCP server.
    pub fn stop(&mut self) -> Result<McpServerStatus, String> {
        if !self.running {
            return Err("MCP server is not running".to_string());
        }

        info!("Stopping MCP server");
        self.running = false;

        // Cleanup sessions
        let session_count = self.sessions.active_count();
        self.sessions = SessionManager::new(self.config.max_sessions, self.config.session_timeout_secs);

        self.log_buffer.log(
            McpLogLevel::Info,
            "mcp.server",
            &format!("MCP server stopped. {} sessions terminated.", session_count),
            None,
        );

        self.record_event(McpEventType::ServerStopped, json!({ "sessions_terminated": session_count }));

        Ok(self.get_status())
    }

    /// Get current server status.
    pub fn get_status(&self) -> McpServerStatus {
        let uptime_secs = if let Some(started) = self.started_at {
            if self.running {
                (chrono::Utc::now() - started).num_seconds() as u64
            } else {
                0
            }
        } else {
            0
        };

        McpServerStatus {
            running: self.running,
            listen_address: if self.running { Some(server::listen_address(&self.config)) } else { None },
            port: Some(self.config.port),
            active_sessions: self.sessions.active_count(),
            total_requests: self.metrics.total_requests,
            total_tool_calls: self.metrics.total_tool_calls,
            total_resource_reads: self.metrics.total_resource_reads,
            started_at: self.started_at,
            uptime_secs: Some(uptime_secs),
            last_error: self.last_error.clone(),
            version: MCP_SERVER_VERSION.to_string(),
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        }
    }

    // ── Configuration ────────────────────────────────────────────

    /// Update the server configuration. Requires restart if running.
    pub fn update_config(&mut self, config: McpServerConfig) -> Result<(), String> {
        let was_running = self.running;

        if was_running {
            self.stop()?;
        }

        self.config = config.clone();
        self.sessions.update_config(config.max_sessions, config.session_timeout_secs);
        self.auth = AuthManager::new(config.api_key.clone(), config.require_auth);

        self.log_buffer.log(
            McpLogLevel::Info,
            "mcp.config",
            "MCP server configuration updated",
            None,
        );

        self.record_event(McpEventType::ConfigChanged, json!({
            "enabled": config.enabled,
            "port": config.port,
            "require_auth": config.require_auth,
        }));

        if was_running && config.enabled {
            self.start()?;
        }

        Ok(())
    }

    /// Generate a new API key.
    pub fn generate_api_key(&mut self) -> String {
        let key = AuthManager::generate_api_key();
        self.config.api_key = key.clone();
        self.auth = AuthManager::new(self.config.api_key.clone(), self.config.require_auth);

        self.log_buffer.log(
            McpLogLevel::Info,
            "mcp.auth",
            "New API key generated",
            None,
        );

        key
    }

    // ── Request Handling ─────────────────────────────────────────

    /// Handle an incoming MCP request. Returns the response body and optional session ID.
    pub fn handle_request(&mut self, method: &str, body: Option<&str>, headers: HashMap<String, String>, path: Option<&str>) -> (String, u16, HashMap<String, String>) {
        if !self.running {
            let resp = crate::transport::McpHttpResponse::json(
                503,
                &serde_json::to_value(crate::protocol::build_error(
                    Value::Null,
                    error_codes::INTERNAL_ERROR,
                    "MCP server is not running",
                    None,
                )).unwrap_or_default(),
            );
            return (resp.body.unwrap_or_default(), resp.status, resp.headers);
        }

        let http_method = match method.to_uppercase().as_str() {
            "POST" => HttpMethod::Post,
            "GET" => HttpMethod::Get,
            "DELETE" => HttpMethod::Delete,
            "OPTIONS" => HttpMethod::Options,
            _ => {
                return ("Method not allowed".to_string(), 405, HashMap::new());
            }
        };

        let req = McpHttpRequest {
            method: http_method,
            path: path.map(|p| p.to_string()),
            body: body.map(|b| b.to_string()),
            headers,
        };

        let outcome = server::handle_request(
            &req,
            &self.config,
            &mut self.sessions,
            &mut self.auth,
            &mut self.log_buffer,
        );

        // Update metrics
        self.metrics.total_requests += 1;
        for event in &outcome.events {
            match event.event_type {
                McpEventType::ToolCalled => self.metrics.total_tool_calls += 1,
                McpEventType::ResourceRead => self.metrics.total_resource_reads += 1,
                _ => {}
            }
        }

        // Record events
        for event in outcome.events {
            self.events.push(event);
        }
        self.trim_events();

        (
            outcome.response.body.unwrap_or_default(),
            outcome.response.status,
            outcome.response.headers,
        )
    }

    // ── Sessions ─────────────────────────────────────────────────

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<McpSession> {
        self.sessions.list_sessions()
    }

    /// Disconnect a specific session.
    pub fn disconnect_session(&mut self, session_id: &str) -> Result<(), String> {
        if self.sessions.get_session(session_id).is_none() {
            return Err(format!("Session not found: {}", session_id));
        }
        self.sessions.remove_session(session_id);
        self.record_event(McpEventType::SessionEnded, json!({ "session_id": session_id }));
        Ok(())
    }

    // ── Metrics & Events ─────────────────────────────────────────

    /// Get current metrics.
    pub fn get_metrics(&self) -> McpMetrics {
        McpMetrics {
            active_sessions: self.sessions.active_count(),
            ..self.metrics.clone()
        }
    }

    /// Reset metrics counters.
    pub fn reset_metrics(&mut self) {
        self.metrics = McpMetrics::default();
    }

    /// Get the event history.
    pub fn get_events(&self, limit: usize) -> Vec<McpEvent> {
        let start = if self.events.len() > limit {
            self.events.len() - limit
        } else {
            0
        };
        self.events[start..].to_vec()
    }

    /// Get tool call logs.
    pub fn get_tool_call_logs(&self, limit: usize) -> Vec<ToolCallLog> {
        let start = if self.tool_call_logs.len() > limit {
            self.tool_call_logs.len() - limit
        } else {
            0
        };
        self.tool_call_logs[start..].to_vec()
    }

    /// Record a tool call.
    pub fn record_tool_call(&mut self, tool_name: &str, params: Value, result: Value, success: bool, duration_ms: u64) {
        self.tool_call_logs.push(ToolCallLog {
            id: uuid::Uuid::new_v4().to_string(),
            tool_name: tool_name.to_string(),
            arguments: params,
            result: Some(result),
            success,
            duration_ms,
            timestamp: chrono::Utc::now(),
            session_id: None,
            error: None,
        });

        // Trim to 500
        if self.tool_call_logs.len() > 500 {
            self.tool_call_logs.drain(0..self.tool_call_logs.len() - 500);
        }
    }

    // ── Logs ─────────────────────────────────────────────────────

    /// Get log entries.
    pub fn get_logs(&self, limit: usize) -> Vec<crate::logging::McpLogEntry> {
        self.log_buffer.get_entries(limit)
    }

    /// Clear log entries.
    pub fn clear_logs(&mut self) {
        self.log_buffer.clear();
    }

    // ── Tools / Resources / Prompts listing ──────────────────────

    /// Get the filtered list of available tools.
    pub fn get_tools(&self) -> Vec<McpTool> {
        let all = crate::tools::get_all_tools();
        if self.config.enabled_tools.is_empty() {
            all
        } else {
            all.into_iter()
                .filter(|t| crate::capabilities::is_tool_enabled(&self.config, &t.name))
                .collect()
        }
    }

    /// Get the filtered list of available resources.
    pub fn get_resources(&self) -> Vec<McpResource> {
        let all = crate::resources::get_all_resources();
        if self.config.enabled_resources.is_empty() {
            all
        } else {
            all.into_iter()
                .filter(|r| crate::capabilities::is_resource_enabled(&self.config, &r.uri))
                .collect()
        }
    }

    /// Get the filtered list of available prompts.
    pub fn get_prompts(&self) -> Vec<McpPrompt> {
        let all = crate::prompts::get_all_prompts();
        if self.config.enabled_prompts.is_empty() {
            all
        } else {
            all.into_iter()
                .filter(|p| crate::capabilities::is_prompt_enabled(&self.config, &p.name))
                .collect()
        }
    }

    // ── Helpers ──────────────────────────────────────────────────

    fn record_event(&mut self, event_type: McpEventType, details: Value) {
        self.events.push(McpEvent {
            id: uuid::Uuid::new_v4().to_string(),
            event_type,
            timestamp: chrono::Utc::now(),
            session_id: None,
            details,
        });
        self.trim_events();
    }

    fn trim_events(&mut self) {
        if self.events.len() > 500 {
            self.events.drain(0..self.events.len() - 500);
        }
    }
}

impl Default for McpService {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a new `McpServiceState` (used during Tauri setup).
pub fn create_service_state() -> McpServiceState {
    Arc::new(Mutex::new(McpService::new()))
}

/// Create a `McpServiceState` with a specific config.
pub fn create_service_state_with_config(config: McpServerConfig) -> McpServiceState {
    Arc::new(Mutex::new(McpService::with_config(config)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_service() {
        let service = McpService::new();
        assert!(!service.running);
        assert!(!service.config.enabled);
        assert_eq!(service.config.port, 3100);
    }

    #[test]
    fn test_start_stop() {
        let mut service = McpService::with_config(McpServerConfig {
            enabled: true,
            ..McpServerConfig::default()
        });

        let status = service.start().unwrap();
        assert!(status.running);
        assert!(status.listen_address.is_some());

        let status = service.stop().unwrap();
        assert!(!status.running);
    }

    #[test]
    fn test_start_disabled() {
        let mut service = McpService::new();
        let result = service.start();
        assert!(result.is_err());
    }

    #[test]
    fn test_start_already_running() {
        let mut service = McpService::with_config(McpServerConfig {
            enabled: true,
            ..McpServerConfig::default()
        });
        service.start().unwrap();
        let result = service.start();
        assert!(result.is_err());
    }

    #[test]
    fn test_update_config() {
        let mut service = McpService::new();
        let new_config = McpServerConfig {
            enabled: true,
            port: 3200,
            ..McpServerConfig::default()
        };
        service.update_config(new_config).unwrap();
        assert_eq!(service.config.port, 3200);
        assert!(service.config.enabled);
    }

    #[test]
    fn test_generate_api_key() {
        let mut service = McpService::new();
        let key = service.generate_api_key();
        assert!(key.starts_with("sorng-mcp-"));
        assert_eq!(service.config.api_key, key);
    }

    #[test]
    fn test_metrics() {
        let service = McpService::new();
        let metrics = service.get_metrics();
        assert_eq!(metrics.total_requests, 0);
    }

    #[test]
    fn test_record_tool_call() {
        let mut service = McpService::new();
        service.record_tool_call("test_tool", json!({}), json!({"ok": true}), true, 42);
        let logs = service.get_tool_call_logs(10);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].tool_name, "test_tool");
        assert!(logs[0].success);
        assert_eq!(logs[0].duration_ms, 42);
    }

    #[test]
    fn test_events() {
        let mut service = McpService::with_config(McpServerConfig {
            enabled: true,
            ..McpServerConfig::default()
        });
        service.start().unwrap();
        let events = service.get_events(100);
        assert!(!events.is_empty());
    }

    #[test]
    fn test_get_tools_filtered() {
        let service = McpService::new();
        let tools = service.get_tools();
        assert!(tools.len() >= 20);

        let mut service2 = McpService::with_config(McpServerConfig {
            enabled_tools: vec!["ping_host".to_string(), "dns_lookup".to_string()],
            ..McpServerConfig::default()
        });
        let filtered = service2.get_tools();
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_create_service_state() {
        let state = create_service_state();
        let s = state.lock().unwrap();
        assert!(!s.running);
    }
}
