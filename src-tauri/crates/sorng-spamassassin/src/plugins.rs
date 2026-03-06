// ── SpamAssassin plugin management ───────────────────────────────────────────

use crate::client::SpamAssassinClient;
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;
use std::collections::HashMap;

pub struct PluginManager;

impl PluginManager {
    /// List all SpamAssassin plugins by inspecting .pre files and local.cf.
    pub async fn list(client: &SpamAssassinClient) -> SpamAssassinResult<Vec<SpamPlugin>> {
        let files = client.list_remote_dir(client.config_dir()).await?;
        let mut plugins = Vec::new();

        for file in &files {
            if !file.ends_with(".pre") && !file.ends_with(".cf") {
                continue;
            }
            let path = format!("{}/{}", client.config_dir(), file);
            let content = match client.read_remote_file(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };

            for line in content.lines() {
                let trimmed = line.trim();

                // loadplugin lines: "loadplugin Mail::SpamAssassin::Plugin::DCC"
                // or commented out: "# loadplugin Mail::SpamAssassin::Plugin::DCC"
                let (is_enabled, plugin_line) = if trimmed.starts_with("loadplugin ") {
                    (true, trimmed)
                } else if trimmed.starts_with("# loadplugin ") || trimmed.starts_with("#loadplugin ") {
                    (false, trimmed.trim_start_matches('#').trim())
                } else {
                    continue;
                };

                let parts: Vec<&str> = plugin_line.split_whitespace().collect();
                if parts.len() < 2 {
                    continue;
                }

                let full_name = parts[1].to_string();
                let short_name = full_name
                    .rsplit("::")
                    .next()
                    .unwrap_or(&full_name)
                    .to_string();

                // Avoid duplicates
                if plugins.iter().any(|p: &SpamPlugin| p.name == short_name) {
                    continue;
                }

                let description = get_plugin_description(&short_name);
                let config = Self::read_plugin_config_from_content(&content, &full_name);

                plugins.push(SpamPlugin {
                    name: short_name,
                    enabled: is_enabled,
                    description,
                    config,
                });
            }
        }

        Ok(plugins)
    }

    /// Get details for a specific plugin by name.
    pub async fn get(
        client: &SpamAssassinClient,
        name: &str,
    ) -> SpamAssassinResult<SpamPlugin> {
        let plugins = Self::list(client).await?;
        plugins
            .into_iter()
            .find(|p| p.name == name || p.name.ends_with(name))
            .ok_or_else(|| {
                SpamAssassinError::internal(format!("Plugin '{}' not found", name))
            })
    }

    /// Enable a plugin by uncommenting its loadplugin line in the .pre file.
    pub async fn enable(client: &SpamAssassinClient, name: &str) -> SpamAssassinResult<()> {
        let files = client.list_remote_dir(client.config_dir()).await?;

        for file in &files {
            if !file.ends_with(".pre") {
                continue;
            }
            let path = format!("{}/{}", client.config_dir(), file);
            let content = match client.read_remote_file(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };

            let mut modified = false;
            let mut new_lines: Vec<String> = Vec::new();

            for line in content.lines() {
                let trimmed = line.trim();
                if (trimmed.starts_with("# loadplugin ") || trimmed.starts_with("#loadplugin "))
                    && trimmed.contains(name)
                {
                    let uncommented = trimmed
                        .trim_start_matches('#')
                        .trim()
                        .to_string();
                    new_lines.push(uncommented);
                    modified = true;
                } else {
                    new_lines.push(line.to_string());
                }
            }

            if modified {
                let new_content = new_lines.join("\n") + "\n";
                client.write_remote_file(&path, &new_content).await?;
                return Ok(());
            }
        }

        Err(SpamAssassinError::internal(format!(
            "Plugin '{}' not found in any .pre file",
            name
        )))
    }

    /// Disable a plugin by commenting out its loadplugin line in the .pre file.
    pub async fn disable(client: &SpamAssassinClient, name: &str) -> SpamAssassinResult<()> {
        let files = client.list_remote_dir(client.config_dir()).await?;

        for file in &files {
            if !file.ends_with(".pre") {
                continue;
            }
            let path = format!("{}/{}", client.config_dir(), file);
            let content = match client.read_remote_file(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };

            let mut modified = false;
            let mut new_lines: Vec<String> = Vec::new();

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("loadplugin ") && trimmed.contains(name) {
                    new_lines.push(format!("# {}", trimmed));
                    modified = true;
                } else {
                    new_lines.push(line.to_string());
                }
            }

            if modified {
                let new_content = new_lines.join("\n") + "\n";
                client.write_remote_file(&path, &new_content).await?;
                return Ok(());
            }
        }

        Err(SpamAssassinError::internal(format!(
            "Plugin '{}' not found in any .pre file",
            name
        )))
    }

    /// Configure a plugin setting in local.cf.
    pub async fn configure(
        client: &SpamAssassinClient,
        name: &str,
        key: &str,
        value: &str,
    ) -> SpamAssassinResult<()> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        let config_key = format!("{}_{}", name.to_lowercase(), key);
        let config_line = format!("{} {}", config_key, value);

        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(&config_key) && !trimmed.starts_with('#') {
                new_lines.push(config_line.clone());
                found = true;
            } else {
                new_lines.push(line.to_string());
            }
        }

        if !found {
            new_lines.push(format!("# Plugin config: {}", name));
            new_lines.push(config_line);
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }

    /// Get all configuration parameters for a specific plugin from local.cf.
    pub async fn get_config(
        client: &SpamAssassinClient,
        name: &str,
    ) -> SpamAssassinResult<HashMap<String, String>> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        let prefix = format!("{}_", name.to_lowercase());
        let mut config = HashMap::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            if trimmed.to_lowercase().starts_with(&prefix) {
                if let Some((key, value)) = trimmed.split_once(char::is_whitespace) {
                    config.insert(key.to_string(), value.trim().to_string());
                }
            }
        }

        // Also check for plugin-specific directives using the full plugin name
        let full_prefix = name.to_lowercase();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            if trimmed.to_lowercase().starts_with(&full_prefix) {
                if let Some((key, value)) = trimmed.split_once(char::is_whitespace) {
                    config
                        .entry(key.to_string())
                        .or_insert_with(|| value.trim().to_string());
                }
            }
        }

        Ok(config)
    }

    // ── Helpers ──────────────────────────────────────────────────

    fn read_plugin_config_from_content(content: &str, full_name: &str) -> HashMap<String, String> {
        let short = full_name.rsplit("::").next().unwrap_or(full_name);
        let prefix = short.to_lowercase();
        let mut config = HashMap::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            // Skip loadplugin lines themselves
            if trimmed.starts_with("loadplugin ") {
                continue;
            }
            if trimmed.to_lowercase().starts_with(&prefix) {
                if let Some((key, value)) = trimmed.split_once(char::is_whitespace) {
                    config.insert(key.to_string(), value.trim().to_string());
                }
            }
        }

        config
    }
}

// ─── Plugin descriptions ─────────────────────────────────────────────────────

fn get_plugin_description(name: &str) -> String {
    match name {
        "DCC" => "Distributed Checksum Clearinghouse – bulk mail detector".to_string(),
        "Pyzor" => "Pyzor collaborative spam-filtering network".to_string(),
        "Razor2" => "Vipul's Razor distributed spam detection".to_string(),
        "SpamCop" => "SpamCop reporting plugin".to_string(),
        "DKIM" => "DKIM signature verification".to_string(),
        "SPF" => "SPF (Sender Policy Framework) checking".to_string(),
        "URIDNSBL" => "URI-based DNS blocklist checking".to_string(),
        "Hashcash" => "Hashcash proof-of-work checking".to_string(),
        "Bayes" | "AutoLearnThreshold" => "Bayesian classifier".to_string(),
        "TextCat" => "Language detection for emails".to_string(),
        "AskDNS" => "Generic asynchronous DNS query rules".to_string(),
        "AWL" => "Auto-Whitelist sender reputation tracking".to_string(),
        "TxRep" => "Reputation-based scoring system".to_string(),
        "ShortCircuit" => "Short-circuit evaluation for high-confidence rules".to_string(),
        "AntiVirus" => "Antivirus integration".to_string(),
        "OLEVBMacro" => "OLE/VBA Macro detection in attachments".to_string(),
        "PDFInfo" => "PDF analysis for spam detection".to_string(),
        "ASN" => "Autonomous System Number lookups".to_string(),
        "ImageInfo" => "Image spam detection via embedded image analysis".to_string(),
        "RelayCountry" => "Relay country identification via GeoIP".to_string(),
        "URILocalBL" => "URI local blocklist checking".to_string(),
        "WLBLEval" => "Whitelist/Blacklist evaluation functions".to_string(),
        "VBounce" => "Virus bounce detection".to_string(),
        "FromNameSpoof" => "From-name spoofing detection".to_string(),
        "Phishing" => "Phishing URL detection".to_string(),
        "FreeMail" => "Free email provider detection".to_string(),
        _ => format!("SpamAssassin plugin: {}", name),
    }
}
