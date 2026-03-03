//! # MCP HTTP Server
//!
//! Manages the HTTP server lifecycle for the MCP Streamable HTTP transport.
//! The server listens on a configurable port (default 3100) and handles
//! JSON-RPC 2.0 requests over HTTP per the MCP 2025-03-26 specification.
//!
//! ## Endpoints
//!
//! | Method  | Path    | Description                                  |
//! |---------|---------|----------------------------------------------|
//! | POST    | `/mcp`  | JSON-RPC request/response                    |
//! | GET     | `/mcp`  | SSE stream for server-initiated notifications|
//! | DELETE  | `/mcp`  | Session termination                          |
//! | GET     | `/health` | Health check endpoint                      |
//! | OPTIONS | `*`     | CORS preflight                               |

use crate::auth::{AuthManager, AuthResult};
use crate::capabilities::build_initialize_result;
use crate::logging::McpLogBuffer;
use crate::protocol::{self, MethodCategory};
use crate::session::SessionManager;
use crate::transport::{McpHttpRequest, McpHttpResponse, HttpMethod};
use crate::types::*;

use log::{debug, error, info, warn};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Result of processing a single MCP request.
pub struct RequestOutcome {
    /// The primary HTTP response to send back.
    pub response: McpHttpResponse,
    /// Notifications queued for SSE broadcast (resource changes, logs, etc.).
    pub notifications: Vec<Value>,
    /// Whether a new session was created (attach Mcp-Session-Id header).
    pub new_session_id: Option<String>,
    /// Events to record.
    pub events: Vec<McpEvent>,
}

/// Process an inbound HTTP request and return the appropriate response.
///
/// This is a pure routing function — it does not manage networking or I/O.
/// The actual TCP server / HTTP framework calls into this.
pub fn handle_request(
    req: &McpHttpRequest,
    config: &McpServerConfig,
    sessions: &mut SessionManager,
    auth: &AuthManager,
    log_buffer: &mut McpLogBuffer,
) -> RequestOutcome {
    let mut notifications = Vec::new();
    let mut events = Vec::new();
    let new_session_id: Option<String>;

    // ── OPTIONS (CORS preflight) ─────────────────────────────────
    if req.method == HttpMethod::Options {
        return RequestOutcome {
            response: crate::transport::handle_options(config),
            notifications,
            new_session_id: None,
            events,
        };
    }

    // ── GET /health ──────────────────────────────────────────────
    if req.method == HttpMethod::Get && req.path.as_deref() == Some("/health") {
        return RequestOutcome {
            response: crate::transport::handle_health(config),
            notifications,
            new_session_id: None,
            events,
        };
    }

    // ── Authentication ───────────────────────────────────────────
    if config.require_auth && !config.api_key.is_empty() {
        match auth.validate(&req.headers) {
            AuthResult::Ok => {}
            AuthResult::Denied(reason) => {
                warn!("MCP auth denied: {}", reason);
                events.push(McpEvent {
                    id: uuid::Uuid::new_v4().to_string(),
                    event_type: McpEventType::AuthFailed,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    details: json!({ "reason": reason }),
                });
                return RequestOutcome {
                    response: McpHttpResponse::unauthorized(&reason),
                    notifications,
                    new_session_id: None,
                    events,
                };
            }
            AuthResult::Locked => {
                return RequestOutcome {
                    response: McpHttpResponse::too_many_requests("Account locked due to too many failed attempts"),
                    notifications,
                    new_session_id: None,
                    events,
                };
            }
        }
    }

    // ── Origin validation ────────────────────────────────────────
    if let Some(origin) = req.headers.get("origin") {
        if !crate::transport::validate_origin(origin, config) {
            return RequestOutcome {
                response: McpHttpResponse::unauthorized("Origin not allowed"),
                notifications,
                new_session_id: None,
                events,
            };
        }
    }

    // ── DELETE /mcp (session termination) ────────────────────────
    if req.method == HttpMethod::Delete {
        let session_id = req.headers.get("mcp-session-id").cloned();
        if let Some(ref sid) = session_id {
            sessions.remove_session(sid);
            info!("MCP session terminated: {}", sid);
            events.push(McpEvent {
                id: uuid::Uuid::new_v4().to_string(),
                event_type: McpEventType::SessionEnded,
                timestamp: chrono::Utc::now().to_rfc3339(),
                details: json!({ "session_id": sid }),
            });
        }
        return RequestOutcome {
            response: McpHttpResponse::accepted(),
            notifications,
            new_session_id: None,
            events,
        };
    }

    // ── GET /mcp (SSE stream) ────────────────────────────────────
    if req.method == HttpMethod::Get {
        // Return a marker response; the actual SSE stream is handled at
        // the transport layer. We just validate the session here.
        let session_id = req.headers.get("mcp-session-id").cloned();
        if let Some(ref sid) = session_id {
            if !sessions.is_valid(sid) {
                return RequestOutcome {
                    response: McpHttpResponse::not_found("Invalid or expired session"),
                    notifications,
                    new_session_id: None,
                    events,
                };
            }
            sessions.touch_session(sid);
        }
        return RequestOutcome {
            response: McpHttpResponse {
                status: 200,
                headers: {
                    let mut h = HashMap::new();
                    h.insert("content-type".to_string(), "text/event-stream".to_string());
                    h.insert("cache-control".to_string(), "no-cache".to_string());
                    h.insert("connection".to_string(), "keep-alive".to_string());
                    h
                },
                body: None,
            },
            notifications,
            new_session_id: None,
            events,
        };
    }

    // ── POST /mcp (JSON-RPC) ────────────────────────────────────
    if req.method != HttpMethod::Post {
        return RequestOutcome {
            response: McpHttpResponse::method_not_allowed(),
            notifications,
            new_session_id: None,
            events,
        };
    }

    let body = match &req.body {
        Some(b) => b.clone(),
        None => {
            return RequestOutcome {
                response: McpHttpResponse::bad_request("Missing request body"),
                notifications,
                new_session_id: None,
                events,
            };
        }
    };

    // Parse JSON-RPC message(s)
    let messages = match protocol::parse_message(&body) {
        Ok(msgs) => msgs,
        Err(e) => {
            return RequestOutcome {
                response: McpHttpResponse::json(
                    &protocol::build_error(
                        Value::Null,
                        error_codes::PARSE_ERROR,
                        &format!("Parse error: {}", e),
                        None,
                    ),
                ),
                notifications,
                new_session_id: None,
                events,
            };
        }
    };

    // Resolve session from header
    let session_id = req.headers.get("mcp-session-id").cloned();
    new_session_id = None; // Will be set below if Initialize

    // Process each message
    let mut responses = Vec::new();
    let mut created_session: Option<String> = None;

    for msg in &messages {
        if protocol::is_notification(msg) {
            // Notifications have no response
            let method = msg.method.as_deref().unwrap_or("");
            debug!("MCP notification: {}", method);

            match protocol::classify_method(method) {
                MethodCategory::Initialized => {
                    // Mark session as initialized
                    if let Some(ref sid) = session_id.as_ref().or(created_session.as_ref()) {
                        sessions.mark_initialized(sid);
                    }
                }
                MethodCategory::Cancelled => {
                    // Cancel a pending request — no-op in synchronous mode
                    debug!("Cancel notification received");
                }
                _ => {
                    debug!("Unknown notification: {}", method);
                }
            }
            continue;
        }

        let id = msg.id.clone().unwrap_or(Value::Null);
        let method = msg.method.as_deref().unwrap_or("");
        let category = protocol::classify_method(method);

        let response = match category {
            MethodCategory::Initialize => {
                // Create session
                match sessions.create_session() {
                    Some(session) => {
                        let sid = session.id.clone();
                        created_session = Some(sid.clone());

                        // Parse client info from params
                        if let Some(params) = &msg.params {
                            if let Ok(init_params) = serde_json::from_value::<InitializeParams>(params.clone()) {
                                if let Some(s) = sessions.get_session_mut(&sid) {
                                    s.client_info = Some(init_params.client_info);
                                    s.client_capabilities = init_params.capabilities;
                                    s.protocol_version = init_params.protocol_version;
                                }
                            }
                        }

                        info!("MCP session initialized: {}", sid);
                        events.push(McpEvent {
                            id: uuid::Uuid::new_v4().to_string(),
                            event_type: McpEventType::SessionStarted,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                            details: json!({ "session_id": sid }),
                        });

                        let result = build_initialize_result(config);
                        protocol::build_response(id, serde_json::to_value(result).unwrap_or_default())
                    }
                    None => {
                        protocol::build_error(
                            id,
                            error_codes::INTERNAL_ERROR,
                            "Maximum sessions reached",
                            None,
                        )
                    }
                }
            }

            MethodCategory::Ping => {
                protocol::build_response(id, json!({}))
            }

            MethodCategory::ToolsList => {
                let tools = crate::tools::get_all_tools();
                let filtered: Vec<&McpTool> = if config.enabled_tools.is_empty() {
                    tools.iter().collect()
                } else {
                    tools.iter().filter(|t| crate::capabilities::is_tool_enabled(&t.name, config)).collect()
                };
                protocol::build_response(id, json!({ "tools": filtered }))
            }

            MethodCategory::ToolsCall => {
                // Tool calls are dispatched to the Tauri app via events.
                // We return a placeholder — actual execution happens upstream.
                let tool_name = msg.params
                    .as_ref()
                    .and_then(|p| p.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");

                events.push(McpEvent {
                    id: uuid::Uuid::new_v4().to_string(),
                    event_type: McpEventType::ToolCalled,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    details: json!({ "tool": tool_name, "request_id": &id }),
                });

                log_buffer.log(
                    McpLogLevel::Info,
                    "mcp.tools",
                    &format!("Tool called: {}", tool_name),
                    Some(json!({ "params": msg.params })),
                );

                // The actual tool execution is handled by the service layer
                // which has access to app state. Return a deferred placeholder.
                protocol::build_response(id, json!({
                    "content": [{
                        "type": "text",
                        "text": format!("Tool '{}' execution is handled by the application layer. This response is a placeholder for the MCP server module.", tool_name)
                    }],
                    "isError": false,
                    "_deferred": true
                }))
            }

            MethodCategory::ResourcesList => {
                let resources = crate::resources::get_all_resources();
                let filtered: Vec<&McpResource> = if config.enabled_resources.is_empty() {
                    resources.iter().collect()
                } else {
                    resources.iter().filter(|r| crate::capabilities::is_resource_enabled(&r.uri, config)).collect()
                };
                protocol::build_response(id, json!({ "resources": filtered }))
            }

            MethodCategory::ResourcesTemplatesList => {
                let templates = crate::resources::get_all_resource_templates();
                protocol::build_response(id, json!({ "resourceTemplates": templates }))
            }

            MethodCategory::ResourcesRead => {
                // Like tools, resource reads are dispatched upstream
                let uri = msg.params
                    .as_ref()
                    .and_then(|p| p.get("uri"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("");

                if crate::resources::match_resource_uri(uri).is_none() {
                    protocol::build_error(
                        id,
                        error_codes::RESOURCE_NOT_FOUND,
                        &format!("Resource not found: {}", uri),
                        None,
                    )
                } else {
                    events.push(McpEvent {
                        id: uuid::Uuid::new_v4().to_string(),
                        event_type: McpEventType::ResourceRead,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        details: json!({ "uri": uri }),
                    });

                    // Placeholder — actual data comes from service layer
                    protocol::build_response(id, json!({
                        "contents": [{
                            "uri": uri,
                            "mimeType": "application/json",
                            "text": "{}"
                        }],
                        "_deferred": true
                    }))
                }
            }

            MethodCategory::ResourcesSubscribe => {
                let uri = msg.params
                    .as_ref()
                    .and_then(|p| p.get("uri"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("");

                if let Some(ref sid) = session_id.as_ref().or(created_session.as_ref()) {
                    sessions.add_subscription(sid, uri);
                    protocol::build_response(id, json!({}))
                } else {
                    protocol::build_error(id, error_codes::INVALID_REQUEST, "No active session", None)
                }
            }

            MethodCategory::ResourcesUnsubscribe => {
                let uri = msg.params
                    .as_ref()
                    .and_then(|p| p.get("uri"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("");

                if let Some(ref sid) = session_id.as_ref().or(created_session.as_ref()) {
                    sessions.remove_subscription(sid, uri);
                    protocol::build_response(id, json!({}))
                } else {
                    protocol::build_error(id, error_codes::INVALID_REQUEST, "No active session", None)
                }
            }

            MethodCategory::PromptsList => {
                let prompts = crate::prompts::get_all_prompts();
                let filtered: Vec<&McpPrompt> = if config.enabled_prompts.is_empty() {
                    prompts.iter().collect()
                } else {
                    prompts.iter().filter(|p| crate::capabilities::is_prompt_enabled(&p.name, config)).collect()
                };
                protocol::build_response(id, json!({ "prompts": filtered }))
            }

            MethodCategory::PromptsGet => {
                if let Some(params) = &msg.params {
                    let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    let args: HashMap<String, String> = params.get("arguments")
                        .and_then(|a| serde_json::from_value(a.clone()).ok())
                        .unwrap_or_default();

                    match crate::prompts::generate_prompt_messages(name, &args) {
                        Some(messages) => {
                            let description = crate::prompts::get_prompt(name)
                                .and_then(|p| p.description);
                            protocol::build_response(id, json!({
                                "description": description,
                                "messages": messages
                            }))
                        }
                        None => protocol::build_error(
                            id,
                            error_codes::INVALID_PARAMS,
                            &format!("Unknown prompt or missing required arguments: {}", name),
                            None,
                        ),
                    }
                } else {
                    protocol::build_error(id, error_codes::INVALID_PARAMS, "Missing params", None)
                }
            }

            MethodCategory::LoggingSetLevel => {
                if let Some(params) = &msg.params {
                    if let Ok(level_params) = serde_json::from_value::<SetLogLevelParams>(params.clone()) {
                        log_buffer.set_level(level_params.level.clone());
                        // Also update session-level if applicable
                        if let Some(ref sid) = session_id.as_ref().or(created_session.as_ref()) {
                            sessions.set_log_level(sid, level_params.level);
                        }
                        protocol::build_response(id, json!({}))
                    } else {
                        protocol::build_error(id, error_codes::INVALID_PARAMS, "Invalid log level", None)
                    }
                } else {
                    protocol::build_error(id, error_codes::INVALID_PARAMS, "Missing params", None)
                }
            }

            MethodCategory::Unknown(method_name) => {
                warn!("Unknown MCP method: {}", method_name);
                protocol::build_error(
                    id,
                    error_codes::METHOD_NOT_FOUND,
                    &format!("Method not found: {}", method_name),
                    None,
                )
            }

            _ => {
                protocol::build_error(id, error_codes::METHOD_NOT_FOUND, "Method not supported", None)
            }
        };

        responses.push(response);

        // Touch session to update last_active
        if let Some(ref sid) = session_id.as_ref().or(created_session.as_ref()) {
            sessions.touch_session(sid);
        }
    }

    // Build final response
    let http_response = if responses.is_empty() {
        McpHttpResponse::accepted()
    } else if responses.len() == 1 {
        McpHttpResponse::json(&responses[0])
    } else {
        McpHttpResponse::json(&Value::Array(responses))
    };

    // Apply CORS and session headers
    let mut response = crate::transport::with_cors(http_response, config);
    if let Some(ref sid) = created_session {
        response = crate::transport::with_session_id(response, sid);
    }

    RequestOutcome {
        response,
        notifications,
        new_session_id: created_session,
        events,
    }
}

/// Check if the server should accept requests (enabled + running check).
pub fn is_server_ready(config: &McpServerConfig) -> bool {
    config.enabled
}

/// Build the listen address string from config.
pub fn listen_address(config: &McpServerConfig) -> String {
    format!("{}:{}", config.host, config.port)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> McpServerConfig {
        McpServerConfig {
            enabled: true,
            require_auth: false,
            ..McpServerConfig::default()
        }
    }

    fn make_post(body: &str) -> McpHttpRequest {
        McpHttpRequest {
            method: HttpMethod::Post,
            body: Some(body.to_string()),
            headers: HashMap::new(),
            path: Some("/mcp".to_string()),
        }
    }

    #[test]
    fn test_handle_options() {
        let req = McpHttpRequest {
            method: HttpMethod::Options,
            body: None,
            headers: HashMap::new(),
            path: Some("/mcp".to_string()),
        };
        let config = test_config();
        let mut sessions = SessionManager::new(&config);
        let auth = AuthManager::new(&config);
        let mut log_buf = McpLogBuffer::new();

        let outcome = handle_request(&req, &config, &mut sessions, &auth, &mut log_buf);
        assert_eq!(outcome.response.status, 204);
    }

    #[test]
    fn test_handle_health() {
        let req = McpHttpRequest {
            method: HttpMethod::Get,
            body: None,
            headers: HashMap::new(),
            path: Some("/health".to_string()),
        };
        let config = test_config();
        let mut sessions = SessionManager::new(&config);
        let auth = AuthManager::new(&config);
        let mut log_buf = McpLogBuffer::new();

        let outcome = handle_request(&req, &config, &mut sessions, &auth, &mut log_buf);
        assert_eq!(outcome.response.status, 200);
    }

    #[test]
    fn test_handle_initialize() {
        let body = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0"
                }
            }
        })).unwrap();

        let req = make_post(&body);
        let config = test_config();
        let mut sessions = SessionManager::new(&config);
        let auth = AuthManager::new(&config);
        let mut log_buf = McpLogBuffer::new();

        let outcome = handle_request(&req, &config, &mut sessions, &auth, &mut log_buf);
        assert_eq!(outcome.response.status, 200);
        assert!(outcome.new_session_id.is_some());

        // Should have session created event
        assert!(!outcome.events.is_empty());
    }

    #[test]
    fn test_handle_ping() {
        let body = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "ping"
        })).unwrap();

        let req = make_post(&body);
        let config = test_config();
        let mut sessions = SessionManager::new(&config);
        let auth = AuthManager::new(&config);
        let mut log_buf = McpLogBuffer::new();

        let outcome = handle_request(&req, &config, &mut sessions, &auth, &mut log_buf);
        assert_eq!(outcome.response.status, 200);
    }

    #[test]
    fn test_handle_tools_list() {
        let body = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/list"
        })).unwrap();

        let req = make_post(&body);
        let config = test_config();
        let mut sessions = SessionManager::new(&config);
        let auth = AuthManager::new(&config);
        let mut log_buf = McpLogBuffer::new();

        let outcome = handle_request(&req, &config, &mut sessions, &auth, &mut log_buf);
        assert_eq!(outcome.response.status, 200);
        let body_str = outcome.response.body.unwrap();
        assert!(body_str.contains("tools"));
    }

    #[test]
    fn test_handle_auth_required() {
        let body = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "ping"
        })).unwrap();

        let req = make_post(&body);
        let config = McpServerConfig {
            enabled: true,
            require_auth: true,
            api_key: "test-key-12345".to_string(),
            ..McpServerConfig::default()
        };
        let mut sessions = SessionManager::new(&config);
        let auth = AuthManager::new(&config);
        let mut log_buf = McpLogBuffer::new();

        // Without auth header → denied
        let outcome = handle_request(&req, &config, &mut sessions, &auth, &mut log_buf);
        assert_eq!(outcome.response.status, 401);
    }

    #[test]
    fn test_handle_delete_session() {
        let config = test_config();
        let mut sessions = SessionManager::new(&config);
        let auth = AuthManager::new(&config);
        let mut log_buf = McpLogBuffer::new();

        // Create a session first
        let session = sessions.create_session().unwrap();
        let sid = session.id.clone();

        let mut headers = HashMap::new();
        headers.insert("mcp-session-id".to_string(), sid.clone());

        let req = McpHttpRequest {
            method: HttpMethod::Delete,
            body: None,
            headers,
            path: Some("/mcp".to_string()),
        };

        let outcome = handle_request(&req, &config, &mut sessions, &auth, &mut log_buf);
        assert_eq!(outcome.response.status, 202);
        assert!(sessions.get_session(&sid).is_none());
    }

    #[test]
    fn test_listen_address() {
        let config = McpServerConfig::default();
        assert_eq!(listen_address(&config), "127.0.0.1:3100");
    }
}
