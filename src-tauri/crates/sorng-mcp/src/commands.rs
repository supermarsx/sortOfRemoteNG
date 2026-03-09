//! # MCP Tauri Commands
//!
//! `#[tauri::command]` handlers that bridge the frontend UI to the MCP service.
//! All commands take `McpServiceState` via Tauri's managed state.

use crate::logging::McpLogEntry;
use crate::service::McpServiceState;
use crate::types::*;

use serde_json::Value;
use std::collections::HashMap;

/// Get the current MCP server status.
#[tauri::command]
pub fn mcp_get_status(state: tauri::State<'_, McpServiceState>) -> Result<McpServerStatus, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_status())
}

/// Start the MCP server.
#[tauri::command]
pub fn mcp_start_server(
    state: tauri::State<'_, McpServiceState>,
) -> Result<McpServerStatus, String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service.start()
}

/// Stop the MCP server.
#[tauri::command]
pub fn mcp_stop_server(
    state: tauri::State<'_, McpServiceState>,
) -> Result<McpServerStatus, String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service.stop()
}

/// Get the current MCP server config.
#[tauri::command]
pub fn mcp_get_config(state: tauri::State<'_, McpServiceState>) -> Result<McpServerConfig, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.config.clone())
}

/// Update the MCP server config. Restarts the server if it was running.
#[tauri::command]
pub fn mcp_update_config(
    state: tauri::State<'_, McpServiceState>,
    config: McpServerConfig,
) -> Result<(), String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service.update_config(config)
}

/// Generate a new API key for MCP authentication.
#[tauri::command]
pub fn mcp_generate_api_key(state: tauri::State<'_, McpServiceState>) -> Result<String, String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.generate_api_key())
}

/// List active MCP sessions.
#[tauri::command]
pub fn mcp_list_sessions(
    state: tauri::State<'_, McpServiceState>,
) -> Result<Vec<McpSession>, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.list_sessions())
}

/// Disconnect a specific MCP session.
#[tauri::command]
pub fn mcp_disconnect_session(
    state: tauri::State<'_, McpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service.disconnect_session(&session_id)
}

/// Get MCP server metrics.
#[tauri::command]
pub fn mcp_get_metrics(state: tauri::State<'_, McpServiceState>) -> Result<McpMetrics, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_metrics())
}

/// Get available MCP tools.
#[tauri::command]
pub fn mcp_get_tools(state: tauri::State<'_, McpServiceState>) -> Result<Vec<McpTool>, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_tools())
}

/// Get available MCP resources.
#[tauri::command]
pub fn mcp_get_resources(
    state: tauri::State<'_, McpServiceState>,
) -> Result<Vec<McpResource>, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_resources())
}

/// Get available MCP prompts.
#[tauri::command]
pub fn mcp_get_prompts(state: tauri::State<'_, McpServiceState>) -> Result<Vec<McpPrompt>, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_prompts())
}

/// Get MCP server logs.
#[tauri::command]
pub fn mcp_get_logs(
    state: tauri::State<'_, McpServiceState>,
    limit: Option<usize>,
) -> Result<Vec<McpLogEntry>, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_logs(limit.unwrap_or(100)))
}

/// Get MCP event history.
#[tauri::command]
pub fn mcp_get_events(
    state: tauri::State<'_, McpServiceState>,
    limit: Option<usize>,
) -> Result<Vec<McpEvent>, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_events(limit.unwrap_or(100)))
}

/// Get MCP tool call logs.
#[tauri::command]
pub fn mcp_get_tool_call_logs(
    state: tauri::State<'_, McpServiceState>,
    limit: Option<usize>,
) -> Result<Vec<ToolCallLog>, String> {
    let service = state.lock().map_err(|e| e.to_string())?;
    Ok(service.get_tool_call_logs(limit.unwrap_or(50)))
}

/// Clear MCP server logs.
#[tauri::command]
pub fn mcp_clear_logs(state: tauri::State<'_, McpServiceState>) -> Result<(), String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service.clear_logs();
    Ok(())
}

/// Reset MCP metrics counters.
#[tauri::command]
pub fn mcp_reset_metrics(state: tauri::State<'_, McpServiceState>) -> Result<(), String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    service.reset_metrics();
    Ok(())
}

/// Proxy an HTTP request to the MCP server (for testing from frontend).
#[tauri::command]
pub fn mcp_handle_request(
    state: tauri::State<'_, McpServiceState>,
    method: String,
    body: Option<String>,
    headers: Option<HashMap<String, String>>,
    path: Option<String>,
) -> Result<Value, String> {
    let mut service = state.lock().map_err(|e| e.to_string())?;
    let (response_body, status, response_headers) = service.handle_request(
        &method,
        body.as_deref(),
        headers.unwrap_or_default(),
        path.as_deref(),
    );

    Ok(serde_json::json!({
        "status": status,
        "headers": response_headers,
        "body": response_body,
    }))
}

/// Get all MCP command handlers for Tauri.
///
/// Used in `generate_handler![]` in lib.rs:
/// ```ignore
/// sorng_mcp::commands::get_command_handlers()
/// ```
pub fn get_command_names() -> Vec<&'static str> {
    vec![
        "mcp_get_status",
        "mcp_start_server",
        "mcp_stop_server",
        "mcp_get_config",
        "mcp_update_config",
        "mcp_generate_api_key",
        "mcp_list_sessions",
        "mcp_disconnect_session",
        "mcp_get_metrics",
        "mcp_get_tools",
        "mcp_get_resources",
        "mcp_get_prompts",
        "mcp_get_logs",
        "mcp_get_events",
        "mcp_get_tool_call_logs",
        "mcp_clear_logs",
        "mcp_reset_metrics",
        "mcp_handle_request",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_command_names() {
        let names = get_command_names();
        assert!(names.len() >= 17);
        assert!(names.contains(&"mcp_get_status"));
        assert!(names.contains(&"mcp_start_server"));
        assert!(names.contains(&"mcp_stop_server"));
        assert!(names.contains(&"mcp_handle_request"));
    }
}
