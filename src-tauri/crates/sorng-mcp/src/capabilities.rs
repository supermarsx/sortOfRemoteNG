//! # MCP Capabilities
//!
//! Server capability negotiation — builds the capability set based on
//! configuration and negotiates with client capabilities.

use crate::types::*;

/// Build the server capabilities based on configuration.
pub fn build_server_capabilities(config: &McpServerConfig) -> ServerCapabilities {
    ServerCapabilities {
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
        logging: if config.logging_enabled {
            Some(LoggingCapability {})
        } else {
            None
        },
        completions: Some(CompletionsCapability {}),
        experimental: None,
    }
}

/// Build the initialize result.
pub fn build_initialize_result(config: &McpServerConfig) -> InitializeResult {
    InitializeResult {
        protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        capabilities: build_server_capabilities(config),
        server_info: ImplementationInfo {
            name: MCP_SERVER_NAME.to_string(),
            version: MCP_SERVER_VERSION.to_string(),
        },
        instructions: if config.server_instructions.is_empty() {
            None
        } else {
            Some(config.server_instructions.clone())
        },
    }
}

/// Negotiate protocol version. Returns the version to use.
pub fn negotiate_version(client_version: &str) -> String {
    // We support the latest version. If client sends a version we support, use it.
    // Otherwise, respond with our version and let the client decide.
    match client_version {
        "2025-03-26" | "2024-11-05" => client_version.to_string(),
        _ => MCP_PROTOCOL_VERSION.to_string(),
    }
}

/// Check if a specific tool is enabled in the configuration.
pub fn is_tool_enabled(config: &McpServerConfig, tool_name: &str) -> bool {
    config.enabled_tools.is_empty() || config.enabled_tools.iter().any(|t| t == tool_name)
}

/// Check if a specific resource is enabled in the configuration.
pub fn is_resource_enabled(config: &McpServerConfig, resource_uri: &str) -> bool {
    config.enabled_resources.is_empty()
        || config.enabled_resources.iter().any(|r| r == resource_uri)
}

/// Check if a specific prompt is enabled in the configuration.
pub fn is_prompt_enabled(config: &McpServerConfig, prompt_name: &str) -> bool {
    config.enabled_prompts.is_empty()
        || config.enabled_prompts.iter().any(|p| p == prompt_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_capabilities() {
        let config = McpServerConfig::default();
        let caps = build_server_capabilities(&config);
        assert!(caps.tools.is_some());
        assert!(caps.resources.is_some());
        assert!(caps.prompts.is_some());
        assert!(caps.logging.is_some()); // logging_enabled is true by default
    }

    #[test]
    fn test_negotiate_version() {
        assert_eq!(negotiate_version("2025-03-26"), "2025-03-26");
        assert_eq!(negotiate_version("2024-11-05"), "2024-11-05");
        assert_eq!(negotiate_version("1.0.0"), MCP_PROTOCOL_VERSION);
    }

    #[test]
    fn test_tool_enabled() {
        let mut config = McpServerConfig::default();
        assert!(is_tool_enabled(&config, "any_tool")); // empty = all
        config.enabled_tools = vec!["ssh_execute".to_string()];
        assert!(is_tool_enabled(&config, "ssh_execute"));
        assert!(!is_tool_enabled(&config, "other_tool"));
    }

    #[test]
    fn test_initialize_result() {
        let config = McpServerConfig::default();
        let result = build_initialize_result(&config);
        assert_eq!(result.protocol_version, MCP_PROTOCOL_VERSION);
        assert_eq!(result.server_info.name, MCP_SERVER_NAME);
        assert!(result.instructions.is_some());
    }
}
