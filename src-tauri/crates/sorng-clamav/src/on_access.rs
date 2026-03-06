// ── ClamAV on-access scanning management ────────────────────────────────────

use crate::client::ClamavClient;
use crate::error::ClamavResult;
use crate::types::*;

pub struct OnAccessManager;

impl OnAccessManager {
    /// Get current on-access scanning configuration from clamd.conf.
    pub async fn get_config(client: &ClamavClient) -> ClamavResult<OnAccessConfig> {
        let content = client.read_remote_file(client.clamd_conf()).await?;
        Ok(parse_on_access_config(&content))
    }

    /// Set on-access configuration by writing relevant clamd.conf directives.
    pub async fn set_config(client: &ClamavClient, config: &OnAccessConfig) -> ClamavResult<()> {
        let content = client.read_remote_file(client.clamd_conf()).await?;
        let new_content = apply_on_access_config(&content, config);
        client
            .write_remote_file(client.clamd_conf(), &new_content)
            .await
    }

    /// Enable on-access scanning.
    pub async fn enable(client: &ClamavClient) -> ClamavResult<()> {
        let mut config = Self::get_config(client).await?;
        config.enabled = true;
        Self::set_config(client, &config).await
    }

    /// Disable on-access scanning.
    pub async fn disable(client: &ClamavClient) -> ClamavResult<()> {
        let mut config = Self::get_config(client).await?;
        config.enabled = false;
        Self::set_config(client, &config).await
    }

    /// Add an include path for on-access scanning.
    pub async fn add_path(client: &ClamavClient, path: &str) -> ClamavResult<()> {
        let mut config = Self::get_config(client).await?;
        if !config.include_paths.contains(&path.to_string()) {
            config.include_paths.push(path.to_string());
        }
        Self::set_config(client, &config).await
    }

    /// Remove an include path from on-access scanning.
    pub async fn remove_path(client: &ClamavClient, path: &str) -> ClamavResult<()> {
        let mut config = Self::get_config(client).await?;
        config.include_paths.retain(|p| p != path);
        Self::set_config(client, &config).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_on_access_config(content: &str) -> OnAccessConfig {
    let mut enabled = false;
    let mut mount_path = Vec::new();
    let mut include_paths = Vec::new();
    let mut exclude_paths = Vec::new();
    let mut exclude_users = Vec::new();
    let mut action = "notify".to_string();
    let mut max_file_size_mb = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once(char::is_whitespace) {
            let value = value.trim();
            match key {
                "OnAccessMountPath" => mount_path.push(value.to_string()),
                "OnAccessIncludePath" => include_paths.push(value.to_string()),
                "OnAccessExcludePath" => exclude_paths.push(value.to_string()),
                "OnAccessExcludeUname" | "OnAccessExcludeUID" => {
                    exclude_users.push(value.to_string());
                }
                "OnAccessPrevention" => {
                    if value.to_lowercase() == "yes" || value.to_lowercase() == "true" {
                        action = "deny".to_string();
                    }
                }
                "OnAccessMaxFileSize" => {
                    // Parse value like "5M" to u64
                    let num_str = value
                        .trim_end_matches(|c: char| !c.is_ascii_digit())
                        .to_string();
                    max_file_size_mb = num_str.parse().ok();
                }
                "ScanOnAccess" => {
                    enabled =
                        value.to_lowercase() == "yes" || value.to_lowercase() == "true";
                }
                _ => {}
            }
        }
    }

    OnAccessConfig {
        enabled,
        mount_path,
        include_paths,
        exclude_paths,
        exclude_users,
        action,
        max_file_size_mb,
    }
}

fn apply_on_access_config(content: &str, config: &OnAccessConfig) -> String {
    // Remove existing on-access directives
    let on_access_keys = [
        "ScanOnAccess",
        "OnAccessMountPath",
        "OnAccessIncludePath",
        "OnAccessExcludePath",
        "OnAccessExcludeUname",
        "OnAccessExcludeUID",
        "OnAccessPrevention",
        "OnAccessMaxFileSize",
    ];

    let mut lines: Vec<String> = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                return true;
            }
            if let Some((key, _)) = trimmed.split_once(char::is_whitespace) {
                !on_access_keys.contains(&key)
            } else {
                !on_access_keys.contains(&trimmed)
            }
        })
        .map(|l| l.to_string())
        .collect();

    // Add on-access configuration block
    lines.push(String::new());
    lines.push("# On-access scanning configuration".to_string());
    lines.push(format!(
        "ScanOnAccess {}",
        if config.enabled { "yes" } else { "no" }
    ));

    for path in &config.mount_path {
        lines.push(format!("OnAccessMountPath {}", path));
    }
    for path in &config.include_paths {
        lines.push(format!("OnAccessIncludePath {}", path));
    }
    for path in &config.exclude_paths {
        lines.push(format!("OnAccessExcludePath {}", path));
    }
    for user in &config.exclude_users {
        lines.push(format!("OnAccessExcludeUname {}", user));
    }

    if config.action == "deny" {
        lines.push("OnAccessPrevention yes".to_string());
    } else {
        lines.push("OnAccessPrevention no".to_string());
    }

    if let Some(max_size) = config.max_file_size_mb {
        lines.push(format!("OnAccessMaxFileSize {}M", max_size));
    }

    lines.join("\n") + "\n"
}
