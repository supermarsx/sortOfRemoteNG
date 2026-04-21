// ── ClamAV freshclam configuration management ───────────────────────────────

use crate::client::ClamavClient;
use crate::error::ClamavResult;
use crate::types::*;

pub struct FreshclamConfigManager;

impl FreshclamConfigManager {
    /// Get all configuration parameters from freshclam.conf.
    pub async fn get_all(client: &ClamavClient) -> ClamavResult<Vec<FreshclamConfig>> {
        let content = client.read_remote_file(client.freshclam_conf()).await?;
        Ok(parse_freshclam_config(&content))
    }

    /// Get a specific configuration parameter.
    pub async fn get_param(client: &ClamavClient, key: &str) -> ClamavResult<FreshclamConfig> {
        let all = Self::get_all(client).await?;
        all.into_iter()
            .find(|c| c.key.to_lowercase() == key.to_lowercase())
            .ok_or_else(|| {
                crate::error::ClamavError::config_not_found(&format!(
                    "Parameter '{}' not found in freshclam.conf",
                    key
                ))
            })
    }

    /// Set a configuration parameter (adds or updates).
    pub async fn set_param(client: &ClamavClient, key: &str, value: &str) -> ClamavResult<()> {
        let content = client.read_remote_file(client.freshclam_conf()).await?;
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
            .write_remote_file(client.freshclam_conf(), &new_content)
            .await
    }

    /// Delete a configuration parameter.
    pub async fn delete_param(client: &ClamavClient, key: &str) -> ClamavResult<()> {
        let content = client.read_remote_file(client.freshclam_conf()).await?;
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
            .write_remote_file(client.freshclam_conf(), &new_content)
            .await
    }

    /// Get the update check interval in hours (Checks directive).
    pub async fn get_update_interval(client: &ClamavClient) -> ClamavResult<u64> {
        let param = Self::get_param(client, "Checks").await;
        match param {
            Ok(p) => Ok(p.value.trim().parse().unwrap_or(24)),
            Err(_) => Ok(24), // default: 24 checks per day
        }
    }

    /// Set the update check interval in hours.
    pub async fn set_update_interval(client: &ClamavClient, hours: u64) -> ClamavResult<()> {
        Self::set_param(client, "Checks", &hours.to_string()).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_freshclam_config(content: &str) -> Vec<FreshclamConfig> {
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

        configs.push(FreshclamConfig {
            key,
            value,
            comment: pending_comment.take(),
        });
    }

    configs
}

#[allow(dead_code)]
fn format_freshclam_config(configs: &[FreshclamConfig]) -> String {
    let mut lines = Vec::new();
    for cfg in configs {
        if let Some(ref comment) = cfg.comment {
            lines.push(format!("# {}", comment));
        }
        if cfg.value.is_empty() {
            lines.push(cfg.key.clone());
        } else {
            lines.push(format!("{} {}", cfg.key, cfg.value));
        }
    }
    lines.join("\n") + "\n"
}
