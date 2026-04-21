//! # Headless Server
//!
//! The HTTP/REST management API server for the gateway in headless mode.
//! Provides endpoints for session management, health checks, metrics,
//! route configuration, and policy management.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Server status information returned by the management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    /// Gateway info
    pub gateway: GatewayInfo,
    /// Health status
    pub health: GatewayHealth,
    /// Metrics snapshot
    pub metrics: GatewayMetrics,
}

/// Request to create a new proxy session via the management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub user_id: String,
    pub username: String,
    pub protocol: GatewayProtocol,
    pub target_addr: String,
}

/// Request to create a new proxy route.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRouteRequest {
    pub name: String,
    pub description: Option<String>,
    pub protocol: GatewayProtocol,
    pub listen_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub upstream_tls: bool,
    pub record_sessions: bool,
    pub bandwidth_limit: u64,
    pub connect_timeout_secs: u32,
    pub idle_timeout_secs: u32,
}

/// Generic API response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}

/// Headless server configuration and lifecycle.
///
/// In headless mode, the gateway runs as a standalone server process without
/// any GUI. The management API is the primary interface for controlling it.
///
/// ## Endpoints (when running with Axum)
///
/// - `GET  /health`          — Health check (configurable path)
/// - `GET  /metrics`         — Metrics snapshot (configurable path)
/// - `GET  /api/v1/status`   — Full server status
/// - `GET  /api/v1/sessions` — List active sessions
/// - `POST /api/v1/sessions` — Create a new proxied session
/// - `DELETE /api/v1/sessions/:id` — Terminate a session
/// - `GET  /api/v1/routes`   — List proxy routes
/// - `POST /api/v1/routes`   — Create a proxy route
/// - `DELETE /api/v1/routes/:id` — Remove a route
/// - `GET  /api/v1/policies` — List access policies
/// - `POST /api/v1/policies` — Create a policy
/// - `DELETE /api/v1/policies/:id` — Remove a policy
/// - `GET  /api/v1/tunnels`  — List active tunnels
/// - `POST /api/v1/tunnels`  — Create a tunnel
/// - `DELETE /api/v1/tunnels/:id` — Close a tunnel
/// - `GET  /api/v1/keys`     — List API keys
/// - `POST /api/v1/keys`     — Create an API key
/// - `DELETE /api/v1/keys/:id` — Revoke an API key
///
/// Authentication is via `Authorization: Bearer <api_key>` header.
pub struct HeadlessServer {
    /// Bind address
    pub bind_addr: String,
    /// Bind port
    pub bind_port: u16,
    /// Whether the server is running
    pub running: bool,
}

impl HeadlessServer {
    pub fn new(bind_addr: &str, bind_port: u16) -> Self {
        Self {
            bind_addr: bind_addr.to_string(),
            bind_port,
            running: false,
        }
    }

    /// Get the full bind address.
    pub fn addr(&self) -> String {
        format!("{}:{}", self.bind_addr, self.bind_port)
    }
}
