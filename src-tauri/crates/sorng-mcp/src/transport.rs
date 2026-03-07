//! # MCP Transport — Streamable HTTP
//!
//! Implements the MCP Streamable HTTP transport. The server listens on a
//! configurable port and handles:
//!
//! - **POST /mcp** — Receives JSON-RPC requests, returns JSON or SSE stream
//! - **GET /mcp** — Opens an SSE stream for server-initiated messages
//! - **DELETE /mcp** — Terminates an MCP session
//! - **GET /health** — Health check endpoint
//!
//! Supports session management via `Mcp-Session-Id` headers, CORS, and
//! optional API key authentication.

use crate::types::*;

use serde_json::Value;
use std::collections::HashMap;
use chrono::Utc;

/// SSE event for streaming.
#[derive(Debug, Clone)]
pub struct SseEvent {
    pub id: Option<String>,
    pub event: Option<String>,
    pub data: String,
}

impl SseEvent {
    /// Format as SSE text.
    pub fn to_sse_string(&self) -> String {
        let mut out = String::new();
        if let Some(ref id) = self.id {
            out.push_str(&format!("id: {id}\n"));
        }
        if let Some(ref event) = self.event {
            out.push_str(&format!("event: {event}\n"));
        }
        for line in self.data.lines() {
            out.push_str(&format!("data: {line}\n"));
        }
        out.push('\n');
        out
    }
}

/// Transport configuration derived from McpServerConfig.
pub struct TransportConfig {
    pub host: String,
    pub port: u16,
    pub cors_enabled: bool,
    pub cors_origins: Vec<String>,
    pub require_auth: bool,
    pub sse_enabled: bool,
}

impl From<&McpServerConfig> for TransportConfig {
    fn from(config: &McpServerConfig) -> Self {
        Self {
            host: config.host.clone(),
            port: config.port,
            cors_enabled: config.cors_enabled,
            cors_origins: config.cors_origins.clone(),
            require_auth: config.require_auth,
            sse_enabled: config.sse_enabled,
        }
    }
}

/// Represents an incoming HTTP request to the MCP endpoint.
#[derive(Debug, Clone)]
pub struct McpHttpRequest {
    pub method: HttpMethod,
    pub path: Option<String>,
    pub body: Option<String>,
    pub headers: HashMap<String, String>,
}

/// HTTP methods we handle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Delete,
    Options,
}

/// Represents an HTTP response from the MCP endpoint.
#[derive(Debug, Clone)]
pub struct McpHttpResponse {
    pub status: u16,
    pub content_type: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

impl McpHttpResponse {
    pub fn json(status: u16, body: &Value) -> Self {
        Self {
            status,
            content_type: "application/json".to_string(),
            headers: HashMap::new(),
            body: Some(serde_json::to_string(body).unwrap_or_default()),
        }
    }

    pub fn accepted() -> Self {
        Self {
            status: 202,
            content_type: "text/plain".to_string(),
            headers: HashMap::new(),
            body: None,
        }
    }

    pub fn method_not_allowed() -> Self {
        Self {
            status: 405,
            content_type: "text/plain".to_string(),
            headers: HashMap::new(),
            body: Some("Method Not Allowed".to_string()),
        }
    }

    pub fn not_found() -> Self {
        Self {
            status: 404,
            content_type: "text/plain".to_string(),
            headers: HashMap::new(),
            body: Some("Not Found".to_string()),
        }
    }

    pub fn bad_request(msg: &str) -> Self {
        Self {
            status: 400,
            content_type: "application/json".to_string(),
            headers: HashMap::new(),
            body: Some(serde_json::to_string(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32600, "message": msg }
            }))
            .unwrap_or_default()),
        }
    }

    pub fn unauthorized() -> Self {
        Self {
            status: 401,
            content_type: "text/plain".to_string(),
            headers: HashMap::new(),
            body: Some("Unauthorized".to_string()),
        }
    }

    pub fn too_many_requests() -> Self {
        Self {
            status: 429,
            content_type: "text/plain".to_string(),
            headers: HashMap::new(),
            body: Some("Too Many Requests".to_string()),
        }
    }

    /// Add CORS headers based on configuration.
    pub fn with_cors(mut self, config: &TransportConfig, origin: Option<&str>) -> Self {
        if !config.cors_enabled {
            return self;
        }
        let allowed = if config.cors_origins.is_empty() {
            origin.unwrap_or("*").to_string()
        } else if let Some(orig) = origin {
            if config.cors_origins.iter().any(|o| o == orig || o == "*") {
                orig.to_string()
            } else {
                return self; // Origin not allowed
            }
        } else {
            "*".to_string()
        };
        self.headers
            .insert("Access-Control-Allow-Origin".to_string(), allowed);
        self.headers.insert(
            "Access-Control-Allow-Methods".to_string(),
            "GET, POST, DELETE, OPTIONS".to_string(),
        );
        self.headers.insert(
            "Access-Control-Allow-Headers".to_string(),
            "Content-Type, Accept, Authorization, Mcp-Session-Id".to_string(),
        );
        self.headers.insert(
            "Access-Control-Expose-Headers".to_string(),
            "Mcp-Session-Id".to_string(),
        );
        self
    }

    /// Attach session ID header.
    pub fn with_session_id(mut self, session_id: &str) -> Self {
        self.headers
            .insert("Mcp-Session-Id".to_string(), session_id.to_string());
        self
    }
}

/// Process a health check request.
pub fn handle_health() -> McpHttpResponse {
    McpHttpResponse::json(
        200,
        &serde_json::json!({
            "status": "ok",
            "server": MCP_SERVER_NAME,
            "version": MCP_SERVER_VERSION,
            "protocol": MCP_PROTOCOL_VERSION,
            "timestamp": Utc::now().to_rfc3339()
        }),
    )
}

/// Process an OPTIONS preflight request.
pub fn handle_options(config: &TransportConfig, origin: Option<&str>) -> McpHttpResponse {
    McpHttpResponse {
        status: 204,
        content_type: String::new(),
        headers: HashMap::new(),
        body: None,
    }
    .with_cors(config, origin)
}

/// Validate Origin header for DNS rebinding protection.
pub fn validate_origin(origin: Option<&str>, config: &TransportConfig) -> bool {
    if config.cors_origins.is_empty() {
        // If no specific origins configured, allow localhost origins
        match origin {
            None => true,
            Some(o) => {
                let lower = o.to_lowercase();
                lower.contains("localhost")
                    || lower.contains("127.0.0.1")
                    || lower.contains("[::1]")
                    || lower.starts_with("tauri://")
            }
        }
    } else {
        match origin {
            None => true,
            Some(o) => config.cors_origins.iter().any(|allowed| allowed == o || allowed == "*"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sse_event_format() {
        let event = SseEvent {
            id: Some("1".to_string()),
            event: Some("message".to_string()),
            data: r#"{"jsonrpc":"2.0","id":1,"result":{}}"#.to_string(),
        };
        let s = event.to_sse_string();
        assert!(s.contains("id: 1\n"));
        assert!(s.contains("event: message\n"));
        assert!(s.contains("data: "));
    }

    #[test]
    fn test_http_response_json() {
        let resp = McpHttpResponse::json(200, &serde_json::json!({"ok": true}));
        assert_eq!(resp.status, 200);
        assert_eq!(resp.content_type, "application/json");
        assert!(resp.body.as_deref().unwrap().contains("\"ok\":true"));
    }

    #[test]
    fn test_validate_origin_localhost() {
        let config = TransportConfig {
            host: "127.0.0.1".to_string(),
            port: 3100,
            cors_enabled: true,
            cors_origins: vec![],
            require_auth: false,
            sse_enabled: true,
        };
        assert!(validate_origin(None, &config));
        assert!(validate_origin(Some("http://localhost:3000"), &config));
        assert!(validate_origin(Some("http://127.0.0.1:3000"), &config));
        assert!(validate_origin(Some("tauri://localhost"), &config));
        assert!(!validate_origin(Some("http://evil.com"), &config));
    }

    #[test]
    fn test_cors_headers() {
        let config = TransportConfig {
            host: "127.0.0.1".to_string(),
            port: 3100,
            cors_enabled: true,
            cors_origins: vec!["http://localhost:3000".to_string()],
            require_auth: false,
            sse_enabled: true,
        };
        let resp = McpHttpResponse::json(200, &serde_json::json!({}))
            .with_cors(&config, Some("http://localhost:3000"));
        assert_eq!(
            resp.headers.get("Access-Control-Allow-Origin").unwrap(),
            "http://localhost:3000"
        );
    }
}
