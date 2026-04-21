// ── ClamAV clamd configuration management ───────────────────────────────────

use crate::client::{shell_escape, ClamavClient};
use crate::error::ClamavResult;
use crate::types::*;

pub struct ClamdConfigManager;

impl ClamdConfigManager {
    /// Get all configuration parameters from clamd.conf.
    pub async fn get_all(client: &ClamavClient) -> ClamavResult<Vec<ClamdConfig>> {
        let content = client.read_remote_file(client.clamd_conf()).await?;
        Ok(parse_config_file(&content))
    }

    /// Get a specific configuration parameter.
    pub async fn get_param(client: &ClamavClient, key: &str) -> ClamavResult<ClamdConfig> {
        let all = Self::get_all(client).await?;
        all.into_iter()
            .find(|c| c.key.to_lowercase() == key.to_lowercase())
            .ok_or_else(|| {
                crate::error::ClamavError::config_not_found(&format!(
                    "Parameter '{}' not found in clamd.conf",
                    key
                ))
            })
    }

    /// Set a configuration parameter (adds or updates).
    pub async fn set_param(client: &ClamavClient, key: &str, value: &str) -> ClamavResult<()> {
        let content = client.read_remote_file(client.clamd_conf()).await?;
        let mut found = false;
        let mut lines: Vec<String> = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with('#') && !trimmed.is_empty() {
                if let Some((k, _)) = trimmed.split_once(char::is_whitespace) {
                    if k.to_lowercase() == key.to_lowercase() {
                        lines.push(format!("{} {}", key, value));
                        found = true;
                        continue;
                    }
                }
                // Handle boolean-style directives (key only, no value)
                if trimmed.to_lowercase() == key.to_lowercase() {
                    lines.push(format!("{} {}", key, value));
                    found = true;
                    continue;
                }
            }
            lines.push(line.to_string());
        }

        if !found {
            lines.push(format!("{} {}", key, value));
        }

        let new_content = lines.join("\n") + "\n";
        client
            .write_remote_file(client.clamd_conf(), &new_content)
            .await
    }

    /// Delete a configuration parameter.
    pub async fn delete_param(client: &ClamavClient, key: &str) -> ClamavResult<()> {
        let content = client.read_remote_file(client.clamd_conf()).await?;
        let filtered: Vec<&str> = content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with('#') || trimmed.is_empty() {
                    return true;
                }
                if let Some((k, _)) = trimmed.split_once(char::is_whitespace) {
                    k.to_lowercase() != key.to_lowercase()
                } else {
                    trimmed.to_lowercase() != key.to_lowercase()
                }
            })
            .collect();
        let new_content = filtered.join("\n") + "\n";
        client
            .write_remote_file(client.clamd_conf(), &new_content)
            .await
    }

    /// Get the configured LocalSocket path.
    pub async fn get_socket(client: &ClamavClient) -> ClamavResult<String> {
        let param = Self::get_param(client, "LocalSocket").await?;
        Ok(param.value)
    }

    /// Set the LocalSocket path.
    pub async fn set_socket(client: &ClamavClient, socket: &str) -> ClamavResult<()> {
        Self::set_param(client, "LocalSocket", socket).await
    }

    /// Test clamd configuration syntax.
    pub async fn test_config(client: &ClamavClient) -> ClamavResult<ConfigTestResult> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} --config-file={} --config-check 2>&1",
                client.clamd_bin(),
                shell_escape(client.clamd_conf())
            ))
            .await;

        match out {
            Ok(o) => {
                let errors: Vec<String> = o
                    .stderr
                    .lines()
                    .chain(o.stdout.lines())
                    .filter(|l| {
                        let lower = l.to_lowercase();
                        lower.contains("error") || lower.contains("warning")
                    })
                    .map(|l| l.trim().to_string())
                    .collect();

                Ok(ConfigTestResult {
                    success: o.exit_code == 0 && errors.is_empty(),
                    output: o.stdout,
                    errors,
                })
            }
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute clamd config check".into()],
            }),
        }
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_config_file(content: &str) -> Vec<ClamdConfig> {
    let mut configs = Vec::new();
    let mut pending_comment: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('#') {
            let comment_text = trimmed.trim_start_matches('#').trim().to_string();
            pending_comment = Some(comment_text);
            continue;
        }

        if trimmed.is_empty() {
            pending_comment = None;
            continue;
        }

        let (key, value) = if let Some((k, v)) = trimmed.split_once(char::is_whitespace) {
            (k.to_string(), v.trim().to_string())
        } else {
            (trimmed.to_string(), String::new())
        };

        configs.push(ClamdConfig {
            key,
            value,
            comment: pending_comment.take(),
        });
    }

    configs
}
