// ── SpamAssassin whitelist/blacklist and trusted network management ──────────

use crate::client::SpamAssassinClient;
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

pub struct WhitelistManager;

impl WhitelistManager {
    /// List all whitelist/blacklist entries from local.cf.
    pub async fn list(
        client: &SpamAssassinClient,
    ) -> SpamAssassinResult<Vec<SpamWhitelistEntry>> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        let entry_types = [
            "whitelist_from",
            "blacklist_from",
            "whitelist_to",
            "more_spam_to",
            "all_spam_to",
        ];

        let mut entries = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            for entry_type in &entry_types {
                if trimmed.starts_with(entry_type) {
                    let rest = trimmed[entry_type.len()..].trim();
                    let (pattern, comment) = if let Some(idx) = rest.find('#') {
                        (
                            rest[..idx].trim().to_string(),
                            Some(rest[idx + 1..].trim().to_string()),
                        )
                    } else {
                        (rest.to_string(), None)
                    };

                    if !pattern.is_empty() {
                        entries.push(SpamWhitelistEntry {
                            entry_type: entry_type.to_string(),
                            pattern,
                            comment,
                        });
                    }
                    break;
                }
            }
        }

        Ok(entries)
    }

    /// Add a whitelist/blacklist entry to local.cf.
    pub async fn add(
        client: &SpamAssassinClient,
        entry: &SpamWhitelistEntry,
    ) -> SpamAssassinResult<()> {
        let valid_types = [
            "whitelist_from",
            "blacklist_from",
            "whitelist_to",
            "more_spam_to",
            "all_spam_to",
        ];
        if !valid_types.contains(&entry.entry_type.as_str()) {
            return Err(SpamAssassinError::parse(format!(
                "Invalid entry type '{}'. Must be one of: {}",
                entry.entry_type,
                valid_types.join(", ")
            )));
        }

        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        // Check for duplicate
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(&entry.entry_type) {
                let rest = trimmed[entry.entry_type.len()..].trim();
                let existing_pattern = rest.split('#').next().unwrap_or("").trim();
                if existing_pattern == entry.pattern {
                    return Err(SpamAssassinError::internal(format!(
                        "Entry {} {} already exists",
                        entry.entry_type, entry.pattern
                    )));
                }
            }
        }

        let new_line = if let Some(ref comment) = entry.comment {
            format!("{} {} # {}", entry.entry_type, entry.pattern, comment)
        } else {
            format!("{} {}", entry.entry_type, entry.pattern)
        };

        let new_content = if content.ends_with('\n') || content.is_empty() {
            format!("{}{}\n", content, new_line)
        } else {
            format!("{}\n{}\n", content, new_line)
        };

        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }

    /// Remove a whitelist/blacklist entry from local.cf.
    pub async fn remove(
        client: &SpamAssassinClient,
        entry_type: &str,
        pattern: &str,
    ) -> SpamAssassinResult<()> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .map_err(|_| SpamAssassinError::config_not_found(client.local_cf_path()))?;

        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(entry_type) {
                let rest = trimmed[entry_type.len()..].trim();
                let existing_pattern = rest.split('#').next().unwrap_or("").trim();
                if existing_pattern == pattern {
                    found = true;
                    continue; // skip this entry
                }
            }
            new_lines.push(line.to_string());
        }

        if !found {
            return Err(SpamAssassinError::internal(format!(
                "Entry {} {} not found",
                entry_type, pattern
            )));
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }

    /// List trusted networks from local.cf.
    pub async fn list_trusted_networks(
        client: &SpamAssassinClient,
    ) -> SpamAssassinResult<Vec<SpamTrustedNetwork>> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        let mut networks = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("trusted_networks") || trimmed.starts_with("internal_networks") {
                let rest = trimmed
                    .split_once(char::is_whitespace)
                    .map(|(_, v)| v.trim())
                    .unwrap_or("");
                let (network, comment) = if let Some(idx) = rest.find('#') {
                    (
                        rest[..idx].trim().to_string(),
                        Some(rest[idx + 1..].trim().to_string()),
                    )
                } else {
                    (rest.to_string(), None)
                };

                if !network.is_empty() {
                    // Split multiple networks on a single line
                    for net in network.split_whitespace() {
                        networks.push(SpamTrustedNetwork {
                            network: net.to_string(),
                            comment: comment.clone(),
                        });
                    }
                }
            }
        }

        Ok(networks)
    }

    /// Add a trusted network to local.cf.
    pub async fn add_trusted_network(
        client: &SpamAssassinClient,
        network: &str,
    ) -> SpamAssassinResult<()> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        // Check if this network is already trusted
        let existing = Self::list_trusted_networks(client).await?;
        if existing.iter().any(|n| n.network == network) {
            return Err(SpamAssassinError::internal(format!(
                "Network '{}' is already trusted",
                network
            )));
        }

        let new_line = format!("trusted_networks {}", network);
        let new_content = if content.ends_with('\n') || content.is_empty() {
            format!("{}{}\n", content, new_line)
        } else {
            format!("{}\n{}\n", content, new_line)
        };

        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }

    /// Remove a trusted network from local.cf.
    pub async fn remove_trusted_network(
        client: &SpamAssassinClient,
        network: &str,
    ) -> SpamAssassinResult<()> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .map_err(|_| SpamAssassinError::config_not_found(client.local_cf_path()))?;

        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("trusted_networks") || trimmed.starts_with("internal_networks") {
                let rest = trimmed
                    .split_once(char::is_whitespace)
                    .map(|(_, v)| v.trim())
                    .unwrap_or("");
                let clean = rest.split('#').next().unwrap_or("").trim();
                let nets: Vec<&str> = clean.split_whitespace().collect();

                if nets.contains(&network) {
                    found = true;
                    // Rebuild line without this network
                    let remaining: Vec<&str> =
                        nets.into_iter().filter(|n| *n != network).collect();
                    if !remaining.is_empty() {
                        let keyword = if trimmed.starts_with("trusted_networks") {
                            "trusted_networks"
                        } else {
                            "internal_networks"
                        };
                        new_lines.push(format!("{} {}", keyword, remaining.join(" ")));
                    }
                    continue;
                }
            }
            new_lines.push(line.to_string());
        }

        if !found {
            return Err(SpamAssassinError::internal(format!(
                "Network '{}' not found in trusted networks",
                network
            )));
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }
}
