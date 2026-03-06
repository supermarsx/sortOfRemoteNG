// ── OpenDKIM config management ───────────────────────────────────────────────
//! Manages opendkim.conf parameters (key=value format).

use crate::client::OpendkimClient;
use crate::error::{OpendkimError, OpendkimResult};
use crate::types::{ConfigTestResult, OpendkimConfig};

pub struct OpendkimConfigManager;

impl OpendkimConfigManager {
    /// Get all configuration parameters from opendkim.conf.
    pub async fn get_all(client: &OpendkimClient) -> OpendkimResult<Vec<OpendkimConfig>> {
        let raw = client.read_remote_file(client.config_path()).await?;
        Ok(parse_config(&raw))
    }

    /// Get a specific configuration parameter by key.
    pub async fn get_param(
        client: &OpendkimClient,
        key: &str,
    ) -> OpendkimResult<OpendkimConfig> {
        let all = Self::get_all(client).await?;
        all.into_iter()
            .find(|p| p.key.eq_ignore_ascii_case(key))
            .ok_or_else(|| {
                OpendkimError::config_not_found(&format!("parameter '{}' not found", key))
            })
    }

    /// Set a configuration parameter. If the key already exists, its value
    /// is updated in place; otherwise a new line is appended.
    pub async fn set_param(
        client: &OpendkimClient,
        key: &str,
        value: &str,
    ) -> OpendkimResult<()> {
        let raw = client.read_remote_file(client.config_path()).await?;
        let mut lines: Vec<String> = raw.lines().map(String::from).collect();
        let mut found = false;
        for line in &mut lines {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
            if parts.first().map(|k| k.eq_ignore_ascii_case(key)).unwrap_or(false) {
                // Preserve leading whitespace
                let leading: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                *line = format!("{}{}\t{}", leading, key, value);
                found = true;
                break;
            }
        }
        if !found {
            lines.push(format!("{}\t{}", key, value));
        }
        let new_content = lines.join("\n") + "\n";
        client
            .write_remote_file(client.config_path(), &new_content)
            .await
    }

    /// Delete a configuration parameter by key.
    pub async fn delete_param(
        client: &OpendkimClient,
        key: &str,
    ) -> OpendkimResult<()> {
        let raw = client.read_remote_file(client.config_path()).await?;
        let lines: Vec<&str> = raw.lines().collect();
        let mut new_lines = Vec::new();
        let mut found = false;
        for line in &lines {
            let trimmed = line.trim();
            if !trimmed.starts_with('#') && !trimmed.is_empty() {
                let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
                if parts.first().map(|k| k.eq_ignore_ascii_case(key)).unwrap_or(false) {
                    found = true;
                    continue;
                }
            }
            new_lines.push(*line);
        }
        if !found {
            return Err(OpendkimError::config_not_found(&format!(
                "parameter '{}' not found",
                key
            )));
        }
        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.config_path(), &new_content)
            .await
    }

    /// Test the configuration using opendkim -n.
    pub async fn test_config(client: &OpendkimClient) -> OpendkimResult<ConfigTestResult> {
        let bin = client.opendkim_bin();
        let conf = client.config_path();
        let out = client
            .exec_ssh(&format!("sudo {} -n -x {} 2>&1", bin, conf))
            .await;
        match out {
            Ok(o) => Ok(ConfigTestResult {
                success: o.exit_code == 0,
                output: format!("{}{}", o.stdout, o.stderr),
                errors: if o.exit_code != 0 {
                    o.stderr
                        .lines()
                        .filter(|l| !l.is_empty())
                        .map(String::from)
                        .collect()
                } else {
                    vec![]
                },
            }),
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute opendkim -n".into()],
            }),
        }
    }

    /// Get the current operating mode (s = sign, v = verify, sv = both).
    pub async fn get_mode(client: &OpendkimClient) -> OpendkimResult<String> {
        let param = Self::get_param(client, "Mode").await;
        match param {
            Ok(p) => Ok(p.value),
            Err(_) => Ok("sv".to_string()), // default mode
        }
    }

    /// Set the operating mode.
    pub async fn set_mode(
        client: &OpendkimClient,
        mode: &str,
    ) -> OpendkimResult<()> {
        // Validate mode
        let valid = ["s", "v", "sv", "vs"];
        if !valid.contains(&mode) {
            return Err(OpendkimError::config_syntax(format!(
                "invalid mode '{}': expected one of s, v, sv",
                mode
            )));
        }
        Self::set_param(client, "Mode", mode).await
    }

    /// Get the milter socket configuration.
    pub async fn get_socket(client: &OpendkimClient) -> OpendkimResult<String> {
        let param = Self::get_param(client, "Socket").await;
        match param {
            Ok(p) => Ok(p.value),
            Err(_) => Ok("local:/run/opendkim/opendkim.sock".to_string()),
        }
    }

    /// Set the milter socket configuration.
    pub async fn set_socket(
        client: &OpendkimClient,
        socket: &str,
    ) -> OpendkimResult<()> {
        Self::set_param(client, "Socket", socket).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_config(content: &str) -> Vec<OpendkimConfig> {
    let mut params = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (data, comment) = if let Some(pos) = line.find('#') {
            (&line[..pos], Some(line[pos + 1..].trim().to_string()))
        } else {
            (line, None)
        };
        let parts: Vec<&str> = data.splitn(2, char::is_whitespace).collect();
        if parts.len() >= 2 {
            params.push(OpendkimConfig {
                key: parts[0].to_string(),
                value: parts[1].trim().to_string(),
                comment,
            });
        } else if parts.len() == 1 && !parts[0].is_empty() {
            // Boolean-style params (key without value)
            params.push(OpendkimConfig {
                key: parts[0].to_string(),
                value: String::new(),
                comment,
            });
        }
    }
    params
}
