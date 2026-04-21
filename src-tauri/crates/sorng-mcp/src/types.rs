//! # MCP Protocol Types
//!
//! Core data types for the Model Context Protocol — JSON-RPC messages, tools,
//! resources, prompts, capabilities, and session management primitives.
//! Follows the MCP specification (2025-03-26).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── MCP Protocol Version ────────────────────────────────────────────

/// Current MCP protocol version supported by this server.
pub const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

/// Server name as reported in the initialize response.
pub const MCP_SERVER_NAME: &str = "SortOfRemote NG";

/// Server version string.
pub const MCP_SERVER_VERSION: &str = "0.1.0";

// ── JSON-RPC 2.0 ───────────────────────────────────────────────────

/// A JSON-RPC 2.0 request message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// A JSON-RPC 2.0 success response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub result: serde_json::Value,
}

/// A JSON-RPC 2.0 error response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub error: JsonRpcErrorData,
}

/// JSON-RPC error object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcErrorData {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl std::fmt::Display for JsonRpcErrorData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

/// A JSON-RPC 2.0 notification (no id).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// Unified JSON-RPC message (request, response, error, or notification).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    Request(JsonRpcRequest),
    Response(JsonRpcResponse),
    Error(JsonRpcError),
    Notification(JsonRpcNotification),
}

/// Standard JSON-RPC error codes.
pub mod error_codes {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
    /// MCP-specific: resource not found.
    pub const RESOURCE_NOT_FOUND: i32 = -32002;
    /// MCP-specific: request cancelled.
    pub const REQUEST_CANCELLED: i32 = -32800;
}

// ── MCP Capabilities ────────────────────────────────────────────────

/// Server capabilities advertised during initialization.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<ToolsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<ResourcesCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompts: Option<PromptsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logging: Option<LoggingCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completions: Option<CompletionsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourcesCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscribe: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptsCapability {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_changed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoggingCapability {}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CompletionsCapability {}

/// Client capabilities received during initialization.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<serde_json::Value>,
}

/// Implementation info (client or server).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImplementationInfo {
    pub name: String,
    pub version: String,
}

// ── Initialize ──────────────────────────────────────────────────────

/// Parameters for the `initialize` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: String,
    pub capabilities: ClientCapabilities,
    pub client_info: ImplementationInfo,
}

/// Result of the `initialize` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: String,
    pub capabilities: ServerCapabilities,
    pub server_info: ImplementationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
}

// ── Tools ───────────────────────────────────────────────────────────

/// An MCP tool definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<ToolAnnotations>,
}

/// Tool annotations describing behavior and safety characteristics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnnotations {
    /// Human-readable title for the tool.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Whether the tool may perform destructive operations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive: Option<bool>,
    /// Whether the tool is read-only (no side effects).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    /// Whether the tool requires user confirmation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_confirmation: Option<bool>,
    /// Whether the tool accesses the network.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_world: Option<bool>,
}

/// Content item in a tool result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
    #[serde(rename = "resource")]
    Resource { resource: ResourceContent },
}

/// Result of a tool call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub content: Vec<ToolContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// Parameters for tools/call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallParams {
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

/// Parameters for tools/list.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}

// ── Resources ───────────────────────────────────────────────────────

/// An MCP resource definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResource {
    pub uri: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<serde_json::Value>,
}

/// An MCP resource template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceTemplate {
    pub uri_template: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<serde_json::Value>,
}

/// Resource content (text or binary).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceContent {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
}

/// Parameters for resources/read.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceReadParams {
    pub uri: String,
}

/// Parameters for resources/subscribe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceSubscribeParams {
    pub uri: String,
}

// ── Prompts ─────────────────────────────────────────────────────────

/// An MCP prompt definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPrompt {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<PromptArgument>>,
}

/// A prompt argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptArgument {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
}

/// Parameters for prompts/get.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptGetParams {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<HashMap<String, String>>,
}

/// A message in a prompt response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptMessage {
    pub role: String,
    pub content: PromptContent,
}

/// Content of a prompt message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PromptContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "resource")]
    Resource { resource: ResourceContent },
}

// ── Logging ─────────────────────────────────────────────────────────

/// MCP log level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpLogLevel {
    Debug,
    Info,
    Warning,
    Error,
    Critical,
    Alert,
    Emergency,
}

/// Parameters for a log notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogNotificationParams {
    pub level: McpLogLevel,
    pub logger: String,
    pub data: serde_json::Value,
}

/// Parameters for logging/setLevel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetLogLevelParams {
    pub level: McpLogLevel,
}

// ── Progress ────────────────────────────────────────────────────────

/// Parameters for a progress notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressParams {
    pub progress_token: serde_json::Value,
    pub progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// ── Cancellation ────────────────────────────────────────────────────

/// Parameters for the cancellation notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelParams {
    pub request_id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

// ── MCP Server Configuration ────────────────────────────────────────

/// Configuration for the MCP server (persisted in app settings).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    /// Whether the MCP server is enabled (disabled by default).
    pub enabled: bool,
    /// Port to listen on (default: 3100).
    pub port: u16,
    /// Host to bind to (default: "127.0.0.1" — localhost only).
    pub host: String,
    /// Require authentication for incoming connections.
    pub require_auth: bool,
    /// API key for authentication (auto-generated if empty).
    pub api_key: String,
    /// Whether to allow remote connections (default: false, localhost only).
    pub allow_remote: bool,
    /// Maximum concurrent MCP sessions.
    pub max_sessions: u32,
    /// Session timeout in seconds (0 = no timeout).
    pub session_timeout_secs: u64,
    /// Enable CORS headers.
    pub cors_enabled: bool,
    /// Allowed CORS origins (empty = allow all when cors_enabled).
    pub cors_origins: Vec<String>,
    /// Rate limit: max requests per minute per session (0 = unlimited).
    pub rate_limit_per_minute: u32,
    /// Enable structured logging via MCP notifications.
    pub logging_enabled: bool,
    /// Minimum log level for MCP logging.
    pub log_level: McpLogLevel,
    /// Tools to expose (empty = all tools).
    pub enabled_tools: Vec<String>,
    /// Resources to expose (empty = all resources).
    pub enabled_resources: Vec<String>,
    /// Prompts to expose (empty = all prompts).
    pub enabled_prompts: Vec<String>,
    /// Whether to include sensitive data (passwords, keys) in resources.
    pub expose_sensitive_data: bool,
    /// Custom server instructions sent to clients.
    pub server_instructions: String,
    /// Enable SSE streaming for long-running operations.
    pub sse_enabled: bool,
    /// Auto-start the MCP server when the app launches.
    pub auto_start: bool,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 3100,
            host: "127.0.0.1".to_string(),
            require_auth: true,
            api_key: String::new(),
            allow_remote: false,
            max_sessions: 10,
            session_timeout_secs: 3600,
            cors_enabled: true,
            cors_origins: vec![],
            rate_limit_per_minute: 120,
            logging_enabled: true,
            log_level: McpLogLevel::Info,
            enabled_tools: vec![],
            enabled_resources: vec![],
            enabled_prompts: vec![],
            expose_sensitive_data: false,
            server_instructions: "SortOfRemote NG MCP Server — manage remote connections, execute SSH commands, transfer files, and query databases through AI assistant integration.".to_string(),
            sse_enabled: true,
            auto_start: false,
        }
    }
}

// ── MCP Server Status ───────────────────────────────────────────────

/// Runtime status of the MCP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    /// Whether the server is currently running.
    pub running: bool,
    /// Address the server is listening on.
    pub listen_address: Option<String>,
    /// Port the server is bound to.
    pub port: Option<u16>,
    /// Number of active MCP sessions.
    pub active_sessions: u32,
    /// Total requests handled since start.
    pub total_requests: u64,
    /// Total tool calls executed.
    pub total_tool_calls: u64,
    /// Total resource reads.
    pub total_resource_reads: u64,
    /// When the server was started.
    pub started_at: Option<DateTime<Utc>>,
    /// Uptime in seconds.
    pub uptime_secs: Option<u64>,
    /// Last error message.
    pub last_error: Option<String>,
    /// Server version.
    pub version: String,
    /// Protocol version.
    pub protocol_version: String,
}

impl Default for McpServerStatus {
    fn default() -> Self {
        Self {
            running: false,
            listen_address: None,
            port: None,
            active_sessions: 0,
            total_requests: 0,
            total_tool_calls: 0,
            total_resource_reads: 0,
            started_at: None,
            uptime_secs: None,
            last_error: None,
            version: MCP_SERVER_VERSION.to_string(),
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        }
    }
}

// ── MCP Session ─────────────────────────────────────────────────────

/// An active MCP client session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSession {
    /// Unique session ID.
    pub id: String,
    /// Client info from initialization.
    pub client_info: Option<ImplementationInfo>,
    /// Negotiated protocol version.
    pub protocol_version: String,
    /// Client capabilities.
    pub client_capabilities: ClientCapabilities,
    /// When the session was created.
    pub created_at: DateTime<Utc>,
    /// When the session was last active.
    pub last_active: DateTime<Utc>,
    /// Number of requests in this session.
    pub request_count: u64,
    /// Current log level for this session.
    pub log_level: McpLogLevel,
    /// Resource subscriptions.
    pub subscriptions: Vec<String>,
    /// Whether initialization is complete.
    pub initialized: bool,
}

/// Event emitted by the MCP server for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEvent {
    pub id: String,
    pub event_type: McpEventType,
    pub timestamp: DateTime<Utc>,
    pub session_id: Option<String>,
    pub details: serde_json::Value,
}

/// Types of MCP events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpEventType {
    ServerStarted,
    ServerStopped,
    SessionCreated,
    SessionClosed,
    SessionStarted,
    SessionEnded,
    ToolCalled,
    ResourceRead,
    PromptUsed,
    AuthFailed,
    AuthFailure,
    RateLimited,
    ConfigChanged,
    Error,
}

/// Tool call log entry for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallLog {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    pub duration_ms: u64,
    pub timestamp: DateTime<Utc>,
}

/// Aggregated server metrics.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpMetrics {
    pub total_requests: u64,
    pub total_tool_calls: u64,
    pub total_resource_reads: u64,
    pub total_prompt_gets: u64,
    pub total_errors: u64,
    pub total_auth_failures: u64,
    pub total_rate_limited: u64,
    pub active_sessions: u32,
    pub peak_sessions: u32,
    pub avg_response_time_ms: f64,
    pub tool_call_counts: HashMap<String, u64>,
    pub resource_read_counts: HashMap<String, u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = McpServerConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.port, 3100);
        assert_eq!(config.host, "127.0.0.1");
        assert!(config.require_auth);
        assert!(!config.allow_remote);
        assert!(!config.auto_start);
        assert!(!config.expose_sensitive_data);
    }

    #[test]
    fn test_default_status() {
        let status = McpServerStatus::default();
        assert!(!status.running);
        assert!(status.listen_address.is_none());
        assert_eq!(status.protocol_version, MCP_PROTOCOL_VERSION);
    }

    #[test]
    fn test_json_rpc_serialization() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(serde_json::Value::Number(1.into())),
            method: "initialize".to_string(),
            params: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"method\":\"initialize\""));
    }

    #[test]
    fn test_tool_content_serialization() {
        let content = ToolContent::Text {
            text: "hello".to_string(),
        };
        let json = serde_json::to_string(&content).unwrap();
        assert!(json.contains("\"type\":\"text\""));
        assert!(json.contains("\"text\":\"hello\""));
    }

    #[test]
    fn test_error_codes() {
        assert_eq!(error_codes::PARSE_ERROR, -32700);
        assert_eq!(error_codes::METHOD_NOT_FOUND, -32601);
        assert_eq!(error_codes::RESOURCE_NOT_FOUND, -32002);
    }

    #[test]
    fn test_server_capabilities() {
        let caps = ServerCapabilities {
            tools: Some(ToolsCapability {
                list_changed: Some(true),
            }),
            resources: Some(ResourcesCapability {
                subscribe: Some(true),
                list_changed: Some(true),
            }),
            prompts: Some(PromptsCapability {
                list_changed: Some(false),
            }),
            logging: Some(LoggingCapability {}),
            completions: None,
            experimental: None,
        };
        let json = serde_json::to_value(&caps).unwrap();
        assert!(json["tools"]["listChanged"].as_bool().unwrap());
        assert!(json["resources"]["subscribe"].as_bool().unwrap());
    }
}
