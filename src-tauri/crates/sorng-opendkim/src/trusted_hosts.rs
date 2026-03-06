// ── OpenDKIM trusted & internal hosts management ─────────────────────────────
//! Manages TrustedHosts and InternalHosts files.
//! Each file is a simple list of hosts/IPs/CIDRs, one per line, with
//! optional # comments.

use crate::client::OpendkimClient;
use crate::error::{OpendkimError, OpendkimResult};
use crate::types::{InternalHost, TrustedHost};

pub struct TrustedHostManager;

impl TrustedHostManager {
    // ── TrustedHosts ─────────────────────────────────────────────────

    /// Resolve TrustedHosts file path from opendkim.conf.
    async fn trusted_hosts_path(client: &OpendkimClient) -> OpendkimResult<String> {
        let conf = client.read_remote_file(client.config_path()).await?;
        for line in conf.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("TrustedHosts") || trimmed.starts_with("ExternalIgnoreList") {
                let value = trimmed
                    .splitn(2, char::is_whitespace)
                    .nth(1)
                    .unwrap_or("")
                    .trim();
                let path = value
                    .strip_prefix("refile:")
                    .or_else(|| value.strip_prefix("file:"))
                    .unwrap_or(value);
                return Ok(path.to_string());
            }
        }
        Ok("/etc/opendkim/trusted.hosts".to_string())
    }

    /// List all trusted hosts.
    pub async fn list(client: &OpendkimClient) -> OpendkimResult<Vec<TrustedHost>> {
        let path = Self::trusted_hosts_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        Ok(parse_host_list(&content)
            .into_iter()
            .map(|(host, comment)| TrustedHost { host, comment })
            .collect())
    }

    /// Add a trusted host.
    pub async fn add(client: &OpendkimClient, host: &TrustedHost) -> OpendkimResult<()> {
        let path = Self::trusted_hosts_path(client).await?;
        let content = client.read_remote_file(&path).await.unwrap_or_default();
        let existing = parse_host_list(&content);
        if existing.iter().any(|(h, _)| h == &host.host) {
            return Err(OpendkimError::trusted_host(format!(
                "host already exists: {}",
                host.host
            )));
        }
        let mut new_content = content;
        if !new_content.ends_with('\n') && !new_content.is_empty() {
            new_content.push('\n');
        }
        new_content.push_str(&format_host_line(&host.host, &host.comment));
        new_content.push('\n');
        client.write_remote_file(&path, &new_content).await
    }

    /// Remove a trusted host.
    pub async fn remove(client: &OpendkimClient, host: &str) -> OpendkimResult<()> {
        let path = Self::trusted_hosts_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        let entries = parse_host_list(&content);
        if !entries.iter().any(|(h, _)| h == host) {
            return Err(OpendkimError::trusted_host(format!(
                "host not found: {}",
                host
            )));
        }
        let filtered: Vec<_> = entries.into_iter().filter(|(h, _)| h != host).collect();
        let new_content = serialize_host_list(&filtered);
        client.write_remote_file(&path, &new_content).await
    }

    // ── InternalHosts ────────────────────────────────────────────────

    /// Resolve InternalHosts file path from opendkim.conf.
    async fn internal_hosts_path(client: &OpendkimClient) -> OpendkimResult<String> {
        let conf = client.read_remote_file(client.config_path()).await?;
        for line in conf.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("InternalHosts") {
                let value = trimmed
                    .splitn(2, char::is_whitespace)
                    .nth(1)
                    .unwrap_or("")
                    .trim();
                let path = value
                    .strip_prefix("refile:")
                    .or_else(|| value.strip_prefix("file:"))
                    .unwrap_or(value);
                return Ok(path.to_string());
            }
        }
        Ok("/etc/opendkim/internal.hosts".to_string())
    }

    /// List all internal hosts.
    pub async fn list_internal(client: &OpendkimClient) -> OpendkimResult<Vec<InternalHost>> {
        let path = Self::internal_hosts_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        Ok(parse_host_list(&content)
            .into_iter()
            .map(|(host, comment)| InternalHost { host, comment })
            .collect())
    }

    /// Add an internal host.
    pub async fn add_internal(
        client: &OpendkimClient,
        host: &InternalHost,
    ) -> OpendkimResult<()> {
        let path = Self::internal_hosts_path(client).await?;
        let content = client.read_remote_file(&path).await.unwrap_or_default();
        let existing = parse_host_list(&content);
        if existing.iter().any(|(h, _)| h == &host.host) {
            return Err(OpendkimError::trusted_host(format!(
                "internal host already exists: {}",
                host.host
            )));
        }
        let mut new_content = content;
        if !new_content.ends_with('\n') && !new_content.is_empty() {
            new_content.push('\n');
        }
        new_content.push_str(&format_host_line(&host.host, &host.comment));
        new_content.push('\n');
        client.write_remote_file(&path, &new_content).await
    }

    /// Remove an internal host.
    pub async fn remove_internal(
        client: &OpendkimClient,
        host: &str,
    ) -> OpendkimResult<()> {
        let path = Self::internal_hosts_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        let entries = parse_host_list(&content);
        if !entries.iter().any(|(h, _)| h == host) {
            return Err(OpendkimError::trusted_host(format!(
                "internal host not found: {}",
                host
            )));
        }
        let filtered: Vec<_> = entries.into_iter().filter(|(h, _)| h != host).collect();
        let new_content = serialize_host_list(&filtered);
        client.write_remote_file(&path, &new_content).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_host_list(content: &str) -> Vec<(String, Option<String>)> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (host, comment) = if let Some(pos) = line.find('#') {
            (
                line[..pos].trim().to_string(),
                Some(line[pos + 1..].trim().to_string()),
            )
        } else {
            (line.to_string(), None)
        };
        if !host.is_empty() {
            entries.push((host, comment));
        }
    }
    entries
}

fn format_host_line(host: &str, comment: &Option<String>) -> String {
    match comment {
        Some(c) => format!("{}\t# {}", host, c),
        None => host.to_string(),
    }
}

fn serialize_host_list(entries: &[(String, Option<String>)]) -> String {
    let mut out = String::new();
    for (host, comment) in entries {
        out.push_str(&format_host_line(host, comment));
        out.push('\n');
    }
    out
}
