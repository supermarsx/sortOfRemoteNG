// ── SpamAssassin update channel management ──────────────────────────────────

use crate::client::{shell_escape, SpamAssassinClient};
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

pub struct ChannelManager;

impl ChannelManager {
    /// List configured update channels by inspecting sa-update configuration.
    pub async fn list(client: &SpamAssassinClient) -> SpamAssassinResult<Vec<SpamChannel>> {
        // Read the sa-update channels file if it exists
        let channels_file = format!("{}/sa-update-channels.txt", client.config_dir());
        let channels_content = client
            .read_remote_file(&channels_file)
            .await
            .unwrap_or_default();

        let mut channels = Vec::new();

        // Default channel is always present
        channels.push(SpamChannel {
            name: "updates.spamassassin.org".to_string(),
            channel_type: "official".to_string(),
            url: Some("http://updates.spamassassin.org/updates/".to_string()),
            key: None,
            last_update: None,
            update_available: false,
        });

        // Parse custom channels from the channels file
        for line in channels_content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            channels.push(SpamChannel {
                name: trimmed.to_string(),
                channel_type: "custom".to_string(),
                url: Some(format!("http://{}/updates/", trimmed)),
                key: None,
                last_update: None,
                update_available: false,
            });
        }

        // Try to get last-update timestamps via sa-update
        let list_out = client.sa_update("--list 2>&1").await;
        if let Ok(ref o) = list_out {
            for line in o.stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let channel_name = parts[0];
                    if let Some(ch) = channels.iter_mut().find(|c| c.name == channel_name) {
                        ch.last_update = parts.get(1).map(|s| s.to_string());
                        ch.update_available =
                            parts.get(2).map(|s| s.contains("update")).unwrap_or(false);
                    }
                }
            }
        }

        Ok(channels)
    }

    /// Update all channels using sa-update.
    pub async fn update_all(
        client: &SpamAssassinClient,
    ) -> SpamAssassinResult<Vec<ChannelUpdateResult>> {
        let channels = Self::list(client).await?;
        let mut results = Vec::new();

        for channel in &channels {
            let result = Self::update(client, &channel.name).await?;
            results.push(result);
        }

        Ok(results)
    }

    /// Update a single channel by name.
    pub async fn update(
        client: &SpamAssassinClient,
        channel_name: &str,
    ) -> SpamAssassinResult<ChannelUpdateResult> {
        let cmd = format!(
            "--channel {} --gpgkey {} 2>&1",
            shell_escape(channel_name),
            "\"\"" // Use configured GPG keys when available
        );

        let out = client.sa_update(&cmd).await;

        match out {
            Ok(ref o) => {
                // sa-update exit codes:
                //   0 = updated successfully
                //   1 = no updates available
                //   2+ = error
                let success = o.exit_code == 0;
                let rules_updated = if success {
                    // Try to extract count from output
                    extract_update_count(&o.stdout)
                } else {
                    0
                };
                let message = if o.exit_code == 1 {
                    "No updates available".to_string()
                } else if success {
                    format!("Updated {} rules", rules_updated)
                } else {
                    format!("Update failed: {}", o.stderr.trim())
                };

                Ok(ChannelUpdateResult {
                    channel: channel_name.to_string(),
                    success,
                    rules_updated,
                    message,
                })
            }
            Err(e) => Ok(ChannelUpdateResult {
                channel: channel_name.to_string(),
                success: false,
                rules_updated: 0,
                message: format!("Update error: {}", e),
            }),
        }
    }

    /// Add a custom update channel.
    pub async fn add(client: &SpamAssassinClient, name: &str, url: &str) -> SpamAssassinResult<()> {
        let channels_file = format!("{}/sa-update-channels.txt", client.config_dir());
        let existing = client
            .read_remote_file(&channels_file)
            .await
            .unwrap_or_default();

        // Check for duplicates
        for line in existing.lines() {
            if line.trim() == name {
                return Err(SpamAssassinError::channel_error(format!(
                    "Channel '{}' already exists",
                    name
                )));
            }
        }

        let new_content = if existing.ends_with('\n') || existing.is_empty() {
            format!("{}# {} ({})\n{}\n", existing, name, url, name)
        } else {
            format!("{}\n# {} ({})\n{}\n", existing, name, url, name)
        };

        client
            .write_remote_file(&channels_file, &new_content)
            .await?;
        Ok(())
    }

    /// Remove a custom update channel.
    pub async fn remove(client: &SpamAssassinClient, name: &str) -> SpamAssassinResult<()> {
        let channels_file = format!("{}/sa-update-channels.txt", client.config_dir());
        let existing = client
            .read_remote_file(&channels_file)
            .await
            .map_err(|_| SpamAssassinError::channel_error("channels file not found"))?;

        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in existing.lines() {
            let trimmed = line.trim();
            if trimmed == name {
                found = true;
                continue; // skip this channel
            }
            // Also skip the comment line preceding the channel
            if trimmed.starts_with('#') && trimmed.contains(name) && !found {
                continue;
            }
            new_lines.push(line.to_string());
        }

        if !found {
            return Err(SpamAssassinError::channel_error(format!(
                "Channel '{}' not found",
                name
            )));
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(&channels_file, &new_content)
            .await?;
        Ok(())
    }

    /// List imported GPG keys for sa-update.
    pub async fn list_keys(client: &SpamAssassinClient) -> SpamAssassinResult<Vec<String>> {
        let out = client
            .exec_ssh("sudo sa-update --list 2>&1 | grep -i 'channel.*key'")
            .await;

        let mut keys = Vec::new();
        if let Ok(ref o) = out {
            for line in o.stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    keys.push(trimmed.to_string());
                }
            }
        }

        // Also check the GPG keyring for sa-update keys
        let gpg_out = client
            .exec_ssh("sudo gpg --homedir /etc/spamassassin/sa-update-keys --list-keys 2>/dev/null")
            .await;
        if let Ok(ref o) = gpg_out {
            for line in o.stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("pub") || trimmed.starts_with("uid") {
                    keys.push(trimmed.to_string());
                }
            }
        }

        Ok(keys)
    }

    /// Import a GPG key for a sa-update channel.
    pub async fn import_key(client: &SpamAssassinClient, key: &str) -> SpamAssassinResult<()> {
        let out = client
            .sa_update(&format!("--import {}", shell_escape(key)))
            .await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::channel_error(format!(
                "key import failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn extract_update_count(output: &str) -> u32 {
    for line in output.lines() {
        let trimmed = line.trim().to_lowercase();
        if trimmed.contains("update") && trimmed.contains("rule") {
            for word in trimmed.split_whitespace() {
                if let Ok(n) = word.parse::<u32>() {
                    return n;
                }
            }
        }
    }
    0
}
