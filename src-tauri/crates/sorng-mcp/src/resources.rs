//! # MCP Resources
//!
//! Defines the resource URIs and templates the MCP server exposes.
//! Resources provide structured contextual data that AI clients can read,
//! subscribe to, and reference in conversations.
//!
//! ## URI Scheme: `sorng://`
//!
//! | URI                            | Description                           |
//! |-------------------------------|---------------------------------------|
//! | `sorng://connections`          | All connections in the collection       |
//! | `sorng://connections/{id}`     | Single connection details              |
//! | `sorng://sessions`             | Active SSH/RDP/VNC sessions            |
//! | `sorng://sessions/{id}`        | Single session details                 |
//! | `sorng://settings`             | App settings (sanitized)               |
//! | `sorng://logs`                 | Recent action log entries              |
//! | `sorng://diagnostics`          | System diagnostics and health          |
//! | `sorng://server-stats/{id}`    | Server statistics for a session        |
//! | `sorng://scripts`              | Saved scripts                          |
//! | `sorng://groups`               | Connection groups/folder hierarchy     |

use crate::types::*;
use serde_json::json;

/// Returns all static resource definitions.
pub fn get_all_resources() -> Vec<McpResource> {
    vec![
        McpResource {
            uri: "sorng://connections".to_string(),
            name: "Connections".to_string(),
            description: Some("All connections in the current collection with name, protocol, hostname, port, and status.".to_string()),
            mime_type: Some("application/json".to_string()),
            size: None,
            annotations: None,
        },
        McpResource {
            uri: "sorng://sessions".to_string(),
            name: "Active Sessions".to_string(),
            description: Some("Currently active SSH, RDP, VNC, and other sessions with connection duration and metadata.".to_string()),
            mime_type: Some("application/json".to_string()),
            size: None,
            annotations: None,
        },
        McpResource {
            uri: "sorng://settings".to_string(),
            name: "Application Settings".to_string(),
            description: Some("Current application settings. Sensitive fields are redacted.".to_string()),
            mime_type: Some("application/json".to_string()),
            size: None,
            annotations: None,
        },
        McpResource {
            uri: "sorng://logs".to_string(),
            name: "Action Log".to_string(),
            description: Some("Recent application action log entries sorted by timestamp.".to_string()),
            mime_type: Some("application/json".to_string()),
            size: None,
            annotations: None,
        },
        McpResource {
            uri: "sorng://diagnostics".to_string(),
            name: "System Diagnostics".to_string(),
            description: Some("Application health: memory usage, connection stats, uptime, errors, and feature status.".to_string()),
            mime_type: Some("application/json".to_string()),
            size: None,
            annotations: None,
        },
        McpResource {
            uri: "sorng://scripts".to_string(),
            name: "Saved Scripts".to_string(),
            description: Some("Saved script commands for batch execution across servers.".to_string()),
            mime_type: Some("application/json".to_string()),
            size: None,
            annotations: None,
        },
        McpResource {
            uri: "sorng://groups".to_string(),
            name: "Connection Groups".to_string(),
            description: Some("Connection folder/group hierarchy with nested structure.".to_string()),
            mime_type: Some("application/json".to_string()),
            size: None,
            annotations: None,
        },
    ]
}

/// Returns all resource templates with URI patterns.
pub fn get_all_resource_templates() -> Vec<McpResourceTemplate> {
    vec![
        McpResourceTemplate {
            uri_template: "sorng://connections/{connectionId}".to_string(),
            name: "Connection Details".to_string(),
            description: Some("Detailed information about a specific connection including authentication config, tags, and recent history.".to_string()),
            mime_type: Some("application/json".to_string()),
            annotations: None,
        },
        McpResourceTemplate {
            uri_template: "sorng://sessions/{sessionId}".to_string(),
            name: "Session Details".to_string(),
            description: Some("Detailed information about a specific active session including duration, traffic stats, and connection health.".to_string()),
            mime_type: Some("application/json".to_string()),
            annotations: None,
        },
        McpResourceTemplate {
            uri_template: "sorng://server-stats/{sessionId}".to_string(),
            name: "Server Statistics".to_string(),
            description: Some("Live CPU, memory, disk, and network statistics from a connected server.".to_string()),
            mime_type: Some("application/json".to_string()),
            annotations: None,
        },
    ]
}

/// Check if a URI matches a known resource pattern. Returns the resource name if found.
pub fn match_resource_uri(uri: &str) -> Option<String> {
    // Direct match
    for r in get_all_resources() {
        if r.uri == uri {
            return Some(r.name);
        }
    }

    // Template match
    if uri.starts_with("sorng://connections/") && uri.len() > "sorng://connections/".len() {
        return Some("Connection Details".to_string());
    }
    if uri.starts_with("sorng://sessions/") && uri.len() > "sorng://sessions/".len() {
        return Some("Session Details".to_string());
    }
    if uri.starts_with("sorng://server-stats/") && uri.len() > "sorng://server-stats/".len() {
        return Some("Server Statistics".to_string());
    }

    None
}

/// Extract the ID from a parameterized resource URI.
pub fn extract_resource_id(uri: &str) -> Option<String> {
    let prefixes = [
        "sorng://connections/",
        "sorng://sessions/",
        "sorng://server-stats/",
    ];
    for prefix in prefixes {
        if let Some(id) = uri.strip_prefix(prefix) {
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

/// Build a text/plain resource content response.
pub fn text_resource(uri: &str, text: &str) -> ResourceContent {
    ResourceContent {
        uri: uri.to_string(),
        mime_type: Some("text/plain".to_string()),
        text: Some(text.to_string()),
        blob: None,
    }
}

/// Build an application/json resource content response.
pub fn json_resource(uri: &str, value: &serde_json::Value) -> ResourceContent {
    ResourceContent {
        uri: uri.to_string(),
        mime_type: Some("application/json".to_string()),
        text: Some(serde_json::to_string_pretty(value).unwrap_or_default()),
        blob: None,
    }
}

/// Build a resource-not-found error payload.
pub fn resource_not_found(uri: &str) -> serde_json::Value {
    json!({
        "code": crate::types::error_codes::RESOURCE_NOT_FOUND,
        "message": format!("Resource not found: {}", uri)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_all_resources() {
        let resources = get_all_resources();
        assert!(resources.len() >= 5);
        for r in &resources {
            assert!(r.uri.starts_with("sorng://"));
            assert!(!r.name.is_empty());
            assert!(r.mime_type.is_some());
        }
    }

    #[test]
    fn test_get_all_templates() {
        let templates = get_all_resource_templates();
        assert!(templates.len() >= 3);
        for t in &templates {
            assert!(t.uri_template.contains('{'));
        }
    }

    #[test]
    fn test_match_resource_uri() {
        assert_eq!(
            match_resource_uri("sorng://connections"),
            Some("Connections".to_string())
        );
        assert_eq!(
            match_resource_uri("sorng://connections/abc-123"),
            Some("Connection Details".to_string())
        );
        assert_eq!(
            match_resource_uri("sorng://sessions/x"),
            Some("Session Details".to_string())
        );
        assert_eq!(
            match_resource_uri("sorng://server-stats/y"),
            Some("Server Statistics".to_string())
        );
        assert!(match_resource_uri("sorng://unknown").is_none());
    }

    #[test]
    fn test_extract_resource_id() {
        assert_eq!(
            extract_resource_id("sorng://connections/abc"),
            Some("abc".to_string())
        );
        assert_eq!(
            extract_resource_id("sorng://sessions/xyz"),
            Some("xyz".to_string())
        );
        assert!(extract_resource_id("sorng://connections").is_none());
        assert!(extract_resource_id("sorng://connections/").is_none());
    }

    #[test]
    fn test_json_resource() {
        let r = json_resource("sorng://test", &json!({"key": "value"}));
        assert_eq!(r.uri, "sorng://test");
        assert_eq!(r.mime_type.as_deref(), Some("application/json"));
        assert!(r.text.unwrap().contains("key"));
    }
}
