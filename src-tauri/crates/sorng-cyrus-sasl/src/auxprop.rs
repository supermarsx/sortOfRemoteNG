// ── Cyrus SASL auxprop plugin management ─────────────────────────────────────

use crate::client::{shell_escape, CyrusSaslClient};
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;
use std::collections::HashMap;

pub struct AuxpropManager;

impl AuxpropManager {
    /// List all available auxprop plugins.
    pub async fn list(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<AuxpropPlugin>> {
        let out = client
            .exec_ssh("pluginviewer --auxprop-list 2>/dev/null || pluginviewer -a 2>/dev/null || echo ''")
            .await?;
        let plugins = parse_auxprop_list(&out.stdout);
        Ok(plugins)
    }

    /// Get a single auxprop plugin by name.
    pub async fn get(client: &CyrusSaslClient, name: &str) -> CyrusSaslResult<AuxpropPlugin> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| CyrusSaslError::plugin_error(format!("Auxprop plugin not found: {name}")))
    }

    /// Configure an auxprop plugin by writing settings into the SASL config.
    pub async fn configure(
        client: &CyrusSaslClient,
        name: &str,
        settings: HashMap<String, String>,
    ) -> CyrusSaslResult<()> {
        // Verify plugin exists
        Self::get(client, name).await?;

        let config_path = format!("{}/auxprop-{}.conf", client.config_dir(), name);
        let mut content = String::new();
        content.push_str(&format!("# Auxprop plugin configuration: {}\n", name));
        content.push_str("# Managed by sorng-cyrus-sasl\n\n");
        content.push_str(&format!("auxprop_plugin: {}\n", name));

        for (key, value) in &settings {
            content.push_str(&format!("{}: {}\n", key, value));
        }

        client.write_remote_file(&config_path, &content).await?;
        Ok(())
    }

    /// Test an auxprop plugin by verifying it loads correctly.
    pub async fn test(client: &CyrusSaslClient, name: &str) -> CyrusSaslResult<SaslTestResult> {
        let out = client
            .exec_ssh(&format!(
                "pluginviewer --auxprop-list 2>/dev/null | grep -i {}",
                shell_escape(name)
            ))
            .await?;

        let found = !out.stdout.trim().is_empty();
        let message = if found {
            format!("Auxprop plugin '{}' is available and loadable", name)
        } else {
            format!("Auxprop plugin '{}' was not found or cannot be loaded", name)
        };

        Ok(SaslTestResult {
            success: found,
            mechanism_used: Some(format!("auxprop:{}", name)),
            message,
        })
    }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

fn parse_auxprop_list(raw: &str) -> Vec<AuxpropPlugin> {
    let mut plugins = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // pluginviewer output for auxprop:
        //   Plugin "sasldb" , API version: 8
        //   Plugin "sql" , API version: 8
        // Or simpler output: sasldb sql ldapdb
        if trimmed.starts_with("Plugin") || trimmed.contains("API version") {
            if let Some(name) = extract_plugin_name(trimmed) {
                if seen.insert(name.clone()) {
                    plugins.push(AuxpropPlugin {
                        name: name.clone(),
                        plugin_type: "auxprop".to_string(),
                        description: describe_auxprop(&name),
                        available: true,
                    });
                }
            }
        } else {
            // Fallback: whitespace-separated names
            for token in trimmed.split_whitespace() {
                let name = token.trim_end_matches(',').to_lowercase();
                if !name.is_empty() && seen.insert(name.clone()) {
                    plugins.push(AuxpropPlugin {
                        name: name.clone(),
                        plugin_type: "auxprop".to_string(),
                        description: describe_auxprop(&name),
                        available: true,
                    });
                }
            }
        }
    }

    // Add well-known plugins that might not be loaded
    for known in &["sasldb", "sql", "ldapdb"] {
        if !seen.contains(*known) {
            plugins.push(AuxpropPlugin {
                name: known.to_string(),
                plugin_type: "auxprop".to_string(),
                description: describe_auxprop(known),
                available: false,
            });
        }
    }

    plugins
}

fn extract_plugin_name(line: &str) -> Option<String> {
    let start = line.find('"')? + 1;
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

fn describe_auxprop(name: &str) -> String {
    match name {
        "sasldb" => "Berkeley DB-based property storage".to_string(),
        "sql" => "SQL-based property storage (MySQL, PostgreSQL, SQLite)".to_string(),
        "ldapdb" => "LDAP-based property storage".to_string(),
        _ => format!("Auxprop plugin: {}", name),
    }
}
