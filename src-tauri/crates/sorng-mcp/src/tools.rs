//! # MCP Tools
//!
//! Defines all MCP tools exposed by the SortOfRemote NG server.
//! Tools allow AI assistants to manage connections, execute SSH commands,
//! transfer files, query databases, and perform network operations.
//!
//! ## Tool Categories
//!
//! - **Connection Management** — list, search, create, update, delete, connect, disconnect
//! - **SSH Operations** — execute commands, list sessions, interactive shells
//! - **File Transfer** — SFTP list, upload, download, delete, mkdir
//! - **Database** — connect, query, list schemas
//! - **Network** — ping, port scan, DNS lookup, Wake-on-LAN
//! - **System** — diagnostics, settings, action log, performance metrics

use crate::types::*;
use serde_json::{json, Value};

/// Get all tool definitions.
pub fn get_all_tools() -> Vec<McpTool> {
    let mut tools = Vec::new();

    // ── Connection Management ───────────────────────────────────────
    tools.push(McpTool {
        name: "list_connections".to_string(),
        description: "List all connections in the current collection. Returns connection names, protocols, hostnames, and status.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "protocol": {
                    "type": "string",
                    "description": "Filter by protocol (ssh, rdp, vnc, etc.)"
                },
                "search": {
                    "type": "string",
                    "description": "Search connections by name, hostname, or description"
                },
                "group_id": {
                    "type": "string",
                    "description": "Filter by parent group ID"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Filter by tags"
                },
                "favorites_only": {
                    "type": "boolean",
                    "description": "Only return favorite connections"
                }
            }
        }),
        annotations: Some(ToolAnnotations {
            title: Some("List Connections".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(false),
        }),
    });

    tools.push(McpTool {
        name: "get_connection".to_string(),
        description: "Get detailed information about a specific connection by ID or name."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Connection ID" },
                "name": { "type": "string", "description": "Connection name (alternative to ID)" }
            }
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Get Connection".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(false),
        }),
    });

    tools.push(McpTool {
        name: "create_connection".to_string(),
        description: "Create a new connection entry. Supports SSH, RDP, VNC, FTP, database, and other protocols.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Connection display name" },
                "protocol": { "type": "string", "enum": ["ssh", "rdp", "vnc", "ftp", "sftp", "mysql", "telnet", "http", "https"], "description": "Connection protocol" },
                "hostname": { "type": "string", "description": "Host or IP address" },
                "port": { "type": "integer", "description": "Port number" },
                "username": { "type": "string", "description": "Username for authentication" },
                "description": { "type": "string", "description": "Optional description" },
                "tags": { "type": "array", "items": { "type": "string" }, "description": "Tags for organization" },
                "group_id": { "type": "string", "description": "Parent folder/group ID" }
            },
            "required": ["name", "protocol", "hostname"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Create Connection".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(false),
        }),
    });

    tools.push(McpTool {
        name: "update_connection".to_string(),
        description: "Update an existing connection's properties.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Connection ID to update" },
                "name": { "type": "string", "description": "New display name" },
                "hostname": { "type": "string", "description": "New hostname" },
                "port": { "type": "integer", "description": "New port" },
                "username": { "type": "string", "description": "New username" },
                "description": { "type": "string", "description": "New description" },
                "tags": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["id"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Update Connection".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(false),
        }),
    });

    tools.push(McpTool {
        name: "delete_connection".to_string(),
        description: "Delete a connection by ID. This action cannot be undone.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Connection ID to delete" }
            },
            "required": ["id"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Delete Connection".to_string()),
            read_only: Some(false),
            destructive: Some(true),
            requires_confirmation: Some(true),
            open_world: Some(false),
        }),
    });

    // ── SSH Operations ──────────────────────────────────────────────
    tools.push(McpTool {
        name: "ssh_connect".to_string(),
        description: "Establish an SSH connection to a remote server. Returns a session ID for subsequent operations.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "connection_id": { "type": "string", "description": "Connection ID to use" },
                "hostname": { "type": "string", "description": "Direct hostname (alternative to connection_id)" },
                "port": { "type": "integer", "description": "SSH port (default: 22)", "default": 22 },
                "username": { "type": "string", "description": "SSH username" },
                "password": { "type": "string", "description": "SSH password" },
                "private_key_path": { "type": "string", "description": "Path to private key file" }
            }
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SSH Connect".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "ssh_execute".to_string(),
        description: "Execute a command on a remote server via an active SSH session. Returns stdout, stderr, and exit code.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "Active SSH session ID" },
                "command": { "type": "string", "description": "Command to execute" },
                "timeout_secs": { "type": "integer", "description": "Command timeout in seconds (default: 30)", "default": 30 },
                "working_directory": { "type": "string", "description": "Working directory for the command" }
            },
            "required": ["session_id", "command"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SSH Execute Command".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "ssh_disconnect".to_string(),
        description: "Disconnect an active SSH session.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "SSH session ID to disconnect" }
            },
            "required": ["session_id"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SSH Disconnect".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "ssh_list_sessions".to_string(),
        description: "List all active SSH sessions with session IDs, connection info, and uptime."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        annotations: Some(ToolAnnotations {
            title: Some("List SSH Sessions".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(false),
        }),
    });

    // ── File Transfer (SFTP) ────────────────────────────────────────
    tools.push(McpTool {
        name: "sftp_list_directory".to_string(),
        description: "List files and directories on a remote server via SFTP.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "SSH session ID" },
                "path": { "type": "string", "description": "Remote directory path", "default": "/" },
                "show_hidden": { "type": "boolean", "description": "Show hidden files", "default": false }
            },
            "required": ["session_id"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SFTP List Directory".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "sftp_read_file".to_string(),
        description: "Read the contents of a text file on a remote server via SFTP. Returns the file contents as text.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "SSH session ID" },
                "path": { "type": "string", "description": "Remote file path" },
                "max_bytes": { "type": "integer", "description": "Maximum bytes to read (default: 1MB)", "default": 1048576 }
            },
            "required": ["session_id", "path"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SFTP Read File".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "sftp_write_file".to_string(),
        description: "Write content to a file on a remote server via SFTP.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "SSH session ID" },
                "path": { "type": "string", "description": "Remote file path" },
                "content": { "type": "string", "description": "File content to write" },
                "append": { "type": "boolean", "description": "Append to file instead of overwrite", "default": false }
            },
            "required": ["session_id", "path", "content"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SFTP Write File".to_string()),
            read_only: Some(false),
            destructive: Some(true),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "sftp_delete".to_string(),
        description: "Delete a file or directory on a remote server via SFTP.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "SSH session ID" },
                "path": { "type": "string", "description": "Remote path to delete" },
                "recursive": { "type": "boolean", "description": "Recursively delete directories", "default": false }
            },
            "required": ["session_id", "path"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SFTP Delete".to_string()),
            read_only: Some(false),
            destructive: Some(true),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "sftp_mkdir".to_string(),
        description: "Create a directory on a remote server via SFTP.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "SSH session ID" },
                "path": { "type": "string", "description": "Remote directory path to create" },
                "recursive": { "type": "boolean", "description": "Create parent directories as needed", "default": true }
            },
            "required": ["session_id", "path"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("SFTP Create Directory".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    // ── Database Operations ─────────────────────────────────────────
    tools.push(McpTool {
        name: "db_query".to_string(),
        description: "Execute a SQL query on a connected database. Returns results as a table.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "connection_id": { "type": "string", "description": "Database connection ID" },
                "query": { "type": "string", "description": "SQL query to execute" },
                "max_rows": { "type": "integer", "description": "Maximum rows to return (default: 100)", "default": 100 }
            },
            "required": ["connection_id", "query"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Database Query".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "db_list_schemas".to_string(),
        description: "List databases, tables, and columns for a connected database.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "connection_id": { "type": "string", "description": "Database connection ID" },
                "database": { "type": "string", "description": "Specific database name (optional)" }
            },
            "required": ["connection_id"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("List Database Schemas".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    // ── Network Utilities ───────────────────────────────────────────
    tools.push(McpTool {
        name: "ping_host".to_string(),
        description: "Ping a host to check connectivity and measure latency.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "hostname": { "type": "string", "description": "Host to ping" },
                "count": { "type": "integer", "description": "Number of pings (default: 4)", "default": 4 },
                "timeout_ms": { "type": "integer", "description": "Timeout per ping in ms (default: 5000)", "default": 5000 }
            },
            "required": ["hostname"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Ping Host".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "port_scan".to_string(),
        description: "Scan ports on a host to check which services are running.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "hostname": { "type": "string", "description": "Host to scan" },
                "ports": { "type": "string", "description": "Port range (e.g. '22,80,443' or '1-1024')", "default": "22,80,443,3389,5900" },
                "timeout_ms": { "type": "integer", "description": "Timeout per port in ms (default: 2000)", "default": 2000 }
            },
            "required": ["hostname"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Port Scan".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "dns_lookup".to_string(),
        description: "Perform a DNS lookup for a hostname.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "hostname": { "type": "string", "description": "Hostname to resolve" },
                "record_type": { "type": "string", "description": "DNS record type (A, AAAA, MX, TXT, etc.)", "default": "A" }
            },
            "required": ["hostname"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("DNS Lookup".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "wake_on_lan".to_string(),
        description: "Send a Wake-on-LAN magic packet to start a remote machine.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "mac_address": { "type": "string", "description": "MAC address of the target machine" },
                "broadcast_address": { "type": "string", "description": "Broadcast address (default: 255.255.255.255)" },
                "port": { "type": "integer", "description": "WoL port (default: 9)", "default": 9 }
            },
            "required": ["mac_address"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Wake-on-LAN".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    // ── System / App ────────────────────────────────────────────────
    tools.push(McpTool {
        name: "get_app_status".to_string(),
        description: "Get the current application status: active sessions, connection count, and server health.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        annotations: Some(ToolAnnotations {
            title: Some("App Status".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(false),
        }),
    });

    tools.push(McpTool {
        name: "get_action_log".to_string(),
        description: "Retrieve recent entries from the application action log.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "limit": { "type": "integer", "description": "Maximum entries to return (default: 50)", "default": 50 },
                "level": { "type": "string", "description": "Filter by log level (debug, info, warn, error)" },
                "search": { "type": "string", "description": "Search in log messages" }
            }
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Action Log".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(false),
        }),
    });

    tools.push(McpTool {
        name: "run_diagnostics".to_string(),
        description: "Run connectivity diagnostics for a specific connection.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "connection_id": { "type": "string", "description": "Connection ID to diagnose" },
                "checks": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Specific checks to run (dns, port, ssh_handshake, tls)"
                }
            },
            "required": ["connection_id"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Run Diagnostics".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "search_connections".to_string(),
        description: "Search connections with advanced filters including protocol, tags, hostname patterns, and recent activity.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Search query" },
                "protocol": { "type": "string", "description": "Filter by protocol" },
                "tags": { "type": "array", "items": { "type": "string" }, "description": "Filter by tags (AND)" },
                "connected_only": { "type": "boolean", "description": "Only return currently connected sessions" },
                "last_connected_days": { "type": "integer", "description": "Only connections used in the last N days" }
            }
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Search Connections".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(false),
        }),
    });

    tools.push(McpTool {
        name: "get_server_stats".to_string(),
        description: "Get system statistics (CPU, RAM, disk, uptime) from a connected SSH server."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "Active SSH session ID" }
            },
            "required": ["session_id"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Server Stats".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "bulk_ssh_execute".to_string(),
        description: "Execute a command across multiple SSH sessions simultaneously. Returns results per host.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "session_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "List of SSH session IDs"
                },
                "command": { "type": "string", "description": "Command to execute on all hosts" },
                "timeout_secs": { "type": "integer", "description": "Timeout per host in seconds", "default": 30 }
            },
            "required": ["session_ids", "command"]
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Bulk SSH Execute".to_string()),
            read_only: Some(false),
            destructive: Some(false),
            requires_confirmation: Some(true),
            open_world: Some(true),
        }),
    });

    tools.push(McpTool {
        name: "get_connection_tree".to_string(),
        description: "Get the full connection tree hierarchy with groups/folders and connections.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "include_details": { "type": "boolean", "description": "Include full connection details", "default": false }
            }
        }),
        annotations: Some(ToolAnnotations {
            title: Some("Connection Tree".to_string()),
            read_only: Some(true),
            destructive: Some(false),
            requires_confirmation: Some(false),
            open_world: Some(false),
        }),
    });

    tools
}

/// Get the tool definition by name.
pub fn get_tool(name: &str) -> Option<McpTool> {
    get_all_tools().into_iter().find(|t| t.name == name)
}

/// Build a text-only tool result.
pub fn text_result(text: &str) -> ToolResult {
    ToolResult {
        content: vec![ToolContent::Text {
            text: text.to_string(),
        }],
        is_error: None,
    }
}

/// Build a JSON tool result.
pub fn json_result(value: &Value) -> ToolResult {
    ToolResult {
        content: vec![ToolContent::Text {
            text: serde_json::to_string_pretty(value).unwrap_or_default(),
        }],
        is_error: None,
    }
}

/// Build an error tool result.
pub fn error_result(message: &str) -> ToolResult {
    ToolResult {
        content: vec![ToolContent::Text {
            text: message.to_string(),
        }],
        is_error: Some(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_all_tools() {
        let tools = get_all_tools();
        assert!(tools.len() >= 20);

        // Verify all tools have required fields
        for tool in &tools {
            assert!(!tool.name.is_empty());
            assert!(!tool.description.is_empty());
            assert!(tool.input_schema.is_object());
        }
    }

    #[test]
    fn test_get_tool_by_name() {
        assert!(get_tool("ssh_execute").is_some());
        assert!(get_tool("list_connections").is_some());
        assert!(get_tool("nonexistent").is_none());
    }

    #[test]
    fn test_tool_categories() {
        let tools = get_all_tools();
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();

        // Connection management
        assert!(names.contains(&"list_connections"));
        assert!(names.contains(&"create_connection"));
        assert!(names.contains(&"delete_connection"));

        // SSH
        assert!(names.contains(&"ssh_connect"));
        assert!(names.contains(&"ssh_execute"));
        assert!(names.contains(&"ssh_disconnect"));

        // SFTP
        assert!(names.contains(&"sftp_list_directory"));
        assert!(names.contains(&"sftp_read_file"));

        // Network
        assert!(names.contains(&"ping_host"));
        assert!(names.contains(&"port_scan"));

        // System
        assert!(names.contains(&"get_app_status"));
        assert!(names.contains(&"get_server_stats"));
    }

    #[test]
    fn test_tool_annotations() {
        let ssh_exec = get_tool("ssh_execute").unwrap();
        let ann = ssh_exec.annotations.unwrap();
        assert_eq!(ann.read_only, Some(false));
        assert_eq!(ann.open_world, Some(true));
        assert_eq!(ann.requires_confirmation, Some(true));

        let list = get_tool("list_connections").unwrap();
        let ann = list.annotations.unwrap();
        assert_eq!(ann.read_only, Some(true));
        assert_eq!(ann.open_world, Some(false));
    }

    #[test]
    fn test_result_builders() {
        let text = text_result("hello");
        assert_eq!(text.content.len(), 1);
        assert!(text.is_error.is_none());

        let err = error_result("failed");
        assert_eq!(err.is_error, Some(true));
    }
}
