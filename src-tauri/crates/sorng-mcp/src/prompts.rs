//! # MCP Prompts
//!
//! Predefined prompt templates that guide AI assistants through common
//! SortOfRemote NG workflows. Prompts help users accomplish multi-step
//! tasks without manually specifying each tool call.
//!
//! ## Available Prompts
//!
//! | Prompt                     | Description                                         |
//! |---------------------------|-----------------------------------------------------|
//! | `connect-to-server`        | Guided server connection setup                      |
//! | `troubleshoot-connection`  | Diagnose why a connection is failing                |
//! | `bulk-ssh-command`         | Execute a command across multiple servers            |
//! | `server-audit`             | Comprehensive security/performance audit             |
//! | `connection-migration`     | Export connections and recreate in new format        |
//! | `server-health-check`      | Quick multi-server health summary                   |

use crate::types::*;

/// Get all prompt definitions.
pub fn get_all_prompts() -> Vec<McpPrompt> {
    vec![
        McpPrompt {
            name: "connect-to-server".to_string(),
            description: Some("Guided workflow to connect to a server. Helps choose protocol, set up authentication, test connectivity, and open a session.".to_string()),
            arguments: Some(vec![
                PromptArgument {
                    name: "hostname".to_string(),
                    description: Some("The server hostname or IP address to connect to.".to_string()),
                    required: Some(true),
                },
                PromptArgument {
                    name: "protocol".to_string(),
                    description: Some("Preferred protocol: ssh, rdp, vnc, or auto-detect.".to_string()),
                    required: Some(false),
                },
                PromptArgument {
                    name: "username".to_string(),
                    description: Some("Username for authentication.".to_string()),
                    required: Some(false),
                },
            ]),
        },
        McpPrompt {
            name: "troubleshoot-connection".to_string(),
            description: Some("Diagnose connection issues by running connectivity checks, port scans, DNS lookups, and analyzing log entries for a problematic connection.".to_string()),
            arguments: Some(vec![
                PromptArgument {
                    name: "connection_id".to_string(),
                    description: Some("The ID of the connection to troubleshoot.".to_string()),
                    required: Some(false),
                },
                PromptArgument {
                    name: "hostname".to_string(),
                    description: Some("Hostname to troubleshoot (alternative to connection_id).".to_string()),
                    required: Some(false),
                },
                PromptArgument {
                    name: "error_message".to_string(),
                    description: Some("Error message received when trying to connect.".to_string()),
                    required: Some(false),
                },
            ]),
        },
        McpPrompt {
            name: "bulk-ssh-command".to_string(),
            description: Some("Execute a command across multiple servers. Helps select targets, run the command, collect results, and summarize outcomes.".to_string()),
            arguments: Some(vec![
                PromptArgument {
                    name: "command".to_string(),
                    description: Some("The command to run on each server.".to_string()),
                    required: Some(true),
                },
                PromptArgument {
                    name: "filter".to_string(),
                    description: Some("Filter expression to select servers (tag, group, hostname pattern).".to_string()),
                    required: Some(false),
                },
            ]),
        },
        McpPrompt {
            name: "server-audit".to_string(),
            description: Some("Comprehensive server audit: check for security vulnerabilities, open ports, outdated packages, disk usage, running services, and compliance status.".to_string()),
            arguments: Some(vec![
                PromptArgument {
                    name: "session_id".to_string(),
                    description: Some("Active SSH session ID to audit.".to_string()),
                    required: Some(true),
                },
                PromptArgument {
                    name: "checks".to_string(),
                    description: Some("Comma-separated list of audit checks: security, performance, disk, services, packages, all.".to_string()),
                    required: Some(false),
                },
            ]),
        },
        McpPrompt {
            name: "connection-migration".to_string(),
            description: Some("Migrate connections between formats. Export from one collection format and import to another, with field mapping and validation.".to_string()),
            arguments: Some(vec![
                PromptArgument {
                    name: "source_format".to_string(),
                    description: Some("Source format: mremoteng, csv, json, putty, securecrt.".to_string()),
                    required: Some(false),
                },
                PromptArgument {
                    name: "target_format".to_string(),
                    description: Some("Target format: json, csv, mremoteng.".to_string()),
                    required: Some(false),
                },
            ]),
        },
        McpPrompt {
            name: "server-health-check".to_string(),
            description: Some("Quick health check across selected servers: connectivity, CPU/RAM usage, disk space, service status. Generates a summary report.".to_string()),
            arguments: Some(vec![
                PromptArgument {
                    name: "filter".to_string(),
                    description: Some("Filter to select servers (e.g., tag:production, group:web-servers).".to_string()),
                    required: Some(false),
                },
                PromptArgument {
                    name: "metrics".to_string(),
                    description: Some("Comma-separated metrics to check: cpu, memory, disk, services, connectivity.".to_string()),
                    required: Some(false),
                },
            ]),
        },
    ]
}

/// Get a prompt by name.
pub fn get_prompt(name: &str) -> Option<McpPrompt> {
    get_all_prompts().into_iter().find(|p| p.name == name)
}

/// Generate prompt messages for the "connect-to-server" prompt.
pub fn generate_connect_prompt(hostname: &str, protocol: Option<&str>, username: Option<&str>) -> Vec<PromptMessage> {
    let proto_hint = protocol.map(|p| format!(" using {}", p)).unwrap_or_default();
    let user_hint = username.map(|u| format!(" as user '{}'", u)).unwrap_or_default();

    vec![
        PromptMessage {
            role: "user".to_string(),
            content: PromptContent::Text {
                text: format!(
                    "Help me connect to the server at '{}'{}{}.

Please:
1. Check if a connection entry already exists for this host.
2. If not, create one with the appropriate protocol and settings.
3. Run connectivity diagnostics (ping, port check).
4. Establish the connection.
5. If it's an SSH server, show basic system info (hostname, OS, uptime).",
                    hostname, proto_hint, user_hint
                ),
            },
        },
    ]
}

/// Generate prompt messages for the "troubleshoot-connection" prompt.
pub fn generate_troubleshoot_prompt(
    connection_id: Option<&str>,
    hostname: Option<&str>,
    error_message: Option<&str>,
) -> Vec<PromptMessage> {
    let target = match (connection_id, hostname) {
        (Some(id), _) => format!("connection ID '{}'", id),
        (_, Some(h)) => format!("host '{}'", h),
        _ => "the problematic connection".to_string(),
    };
    let error_ctx = error_message
        .map(|e| format!("\n\nThe error I'm seeing is: {}", e))
        .unwrap_or_default();

    vec![
        PromptMessage {
            role: "user".to_string(),
            content: PromptContent::Text {
                text: format!(
                    "I'm having trouble connecting to {}. Please diagnose the issue.{}

Steps to investigate:
1. Look up the connection details.
2. Run DNS lookup to verify the hostname resolves.
3. Ping the host to check basic connectivity.
4. Scan the relevant port(s) to see if the service is reachable.
5. Check recent log entries for related errors.
6. Provide a diagnosis and recommended fix.",
                    target, error_ctx
                ),
            },
        },
    ]
}

/// Generate prompt messages for the "bulk-ssh-command" prompt.
pub fn generate_bulk_command_prompt(command: &str, filter: Option<&str>) -> Vec<PromptMessage> {
    let filter_hint = filter
        .map(|f| format!("matching filter '{}'", f))
        .unwrap_or_else(|| "from the available connections".to_string());

    vec![
        PromptMessage {
            role: "user".to_string(),
            content: PromptContent::Text {
                text: format!(
                    "Execute the following command across multiple servers {}:

```
{}
```

Please:
1. List available SSH connections matching the criteria.
2. Connect to each server that isn't already connected.
3. Execute the command on all servers.
4. Collect and summarize the results, highlighting any failures.
5. Show a comparison table of outputs per host.",
                    filter_hint, command
                ),
            },
        },
    ]
}

/// Generate prompt messages for the "server-audit" prompt.
pub fn generate_audit_prompt(session_id: &str, checks: Option<&str>) -> Vec<PromptMessage> {
    let checks_list = checks.unwrap_or("all");

    vec![
        PromptMessage {
            role: "user".to_string(),
            content: PromptContent::Text {
                text: format!(
                    "Perform a comprehensive audit on the server connected via session '{}'.

Audit scope: {}

Please check:
1. **Security**: Open ports, running services, SSH config, fail2ban status, firewall rules.
2. **Performance**: CPU usage, memory, swap, load averages, top processes.
3. **Disk**: Disk usage per mount, inode usage, any near-full partitions.
4. **Services**: Status of key services (sshd, nginx/apache, docker, systemd).
5. **Packages**: Outdated packages, pending security updates.

Provide a structured report with findings and recommendations.",
                    session_id, checks_list
                ),
            },
        },
    ]
}

/// Generate prompt messages for any known prompt by name.
pub fn generate_prompt_messages(name: &str, args: &std::collections::HashMap<String, String>) -> Option<Vec<PromptMessage>> {
    match name {
        "connect-to-server" => {
            let hostname = args.get("hostname")?;
            Some(generate_connect_prompt(
                hostname,
                args.get("protocol").map(|s| s.as_str()),
                args.get("username").map(|s| s.as_str()),
            ))
        }
        "troubleshoot-connection" => Some(generate_troubleshoot_prompt(
            args.get("connection_id").map(|s| s.as_str()),
            args.get("hostname").map(|s| s.as_str()),
            args.get("error_message").map(|s| s.as_str()),
        )),
        "bulk-ssh-command" => {
            let command = args.get("command")?;
            Some(generate_bulk_command_prompt(
                command,
                args.get("filter").map(|s| s.as_str()),
            ))
        }
        "server-audit" => {
            let session_id = args.get("session_id")?;
            Some(generate_audit_prompt(
                session_id,
                args.get("checks").map(|s| s.as_str()),
            ))
        }
        "connection-migration" => {
            Some(vec![PromptMessage {
                role: "user".to_string(),
                content: PromptContent::Text {
                    text: format!(
                        "Help me migrate my connections{}{}.\n\n\
                        Please guide me through the migration process: identify the connections to migrate, \
                        validate the data, and perform the conversion.",
                        args.get("source_format").map(|f| format!(" from {} format", f)).unwrap_or_default(),
                        args.get("target_format").map(|f| format!(" to {} format", f)).unwrap_or_default(),
                    ),
                },
            }])
        }
        "server-health-check" => {
            Some(vec![PromptMessage {
                role: "user".to_string(),
                content: PromptContent::Text {
                    text: format!(
                        "Run a quick health check across servers{}.\n\n\
                        Check the following metrics: {}.\n\n\
                        Provide a summary table with status indicators for each server.",
                        args.get("filter").map(|f| format!(" matching '{}'", f)).unwrap_or_default(),
                        args.get("metrics").unwrap_or(&"cpu, memory, disk, connectivity".to_string()),
                    ),
                },
            }])
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_all_prompts() {
        let prompts = get_all_prompts();
        assert!(prompts.len() >= 5);
        for p in &prompts {
            assert!(!p.name.is_empty());
            assert!(p.description.is_some());
        }
    }

    #[test]
    fn test_get_prompt_by_name() {
        assert!(get_prompt("connect-to-server").is_some());
        assert!(get_prompt("server-audit").is_some());
        assert!(get_prompt("nonexistent").is_none());
    }

    #[test]
    fn test_generate_connect_prompt() {
        let msgs = generate_connect_prompt("192.168.1.1", Some("ssh"), None);
        assert_eq!(msgs.len(), 1);
        if let PromptContent::Text { ref text } = msgs[0].content {
            assert!(text.contains("192.168.1.1"));
            assert!(text.contains("ssh"));
        }
    }

    #[test]
    fn test_generate_troubleshoot_prompt() {
        let msgs = generate_troubleshoot_prompt(None, Some("example.com"), Some("Connection timed out"));
        assert_eq!(msgs.len(), 1);
        if let PromptContent::Text { ref text } = msgs[0].content {
            assert!(text.contains("example.com"));
            assert!(text.contains("Connection timed out"));
        }
    }

    #[test]
    fn test_generate_prompt_messages() {
        let mut args = std::collections::HashMap::new();
        args.insert("hostname".to_string(), "test.local".to_string());
        let msgs = generate_prompt_messages("connect-to-server", &args);
        assert!(msgs.is_some());

        args.clear();
        args.insert("command".to_string(), "uptime".to_string());
        let msgs = generate_prompt_messages("bulk-ssh-command", &args);
        assert!(msgs.is_some());

        let msgs = generate_prompt_messages("unknown", &args);
        assert!(msgs.is_none());
    }
}
