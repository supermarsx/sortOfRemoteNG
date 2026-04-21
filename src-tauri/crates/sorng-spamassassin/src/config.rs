// ── SpamAssassin configuration management ───────────────────────────────────

use crate::client::SpamAssassinClient;
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

pub struct SpamAssassinConfigManager;

impl SpamAssassinConfigManager {
    /// Read the entire contents of local.cf.
    pub async fn get_local_cf(client: &SpamAssassinClient) -> SpamAssassinResult<String> {
        client
            .read_remote_file(client.local_cf_path())
            .await
            .map_err(|_| SpamAssassinError::config_not_found(client.local_cf_path()))
    }

    /// Replace the entire contents of local.cf.
    pub async fn set_local_cf(
        client: &SpamAssassinClient,
        content: &str,
    ) -> SpamAssassinResult<()> {
        client
            .write_remote_file(client.local_cf_path(), content)
            .await
    }

    /// Get a specific parameter from local.cf by key name.
    pub async fn get_param(client: &SpamAssassinClient, key: &str) -> SpamAssassinResult<String> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once(char::is_whitespace) {
                if k == key {
                    return Ok(v.trim().to_string());
                }
            }
        }

        Err(SpamAssassinError::config_not_found(key))
    }

    /// Set a configuration parameter in local.cf. If the key exists, update; else append.
    pub async fn set_param(
        client: &SpamAssassinClient,
        key: &str,
        value: &str,
    ) -> SpamAssassinResult<()> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        let new_line = format!("{} {}", key, value);
        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with('#') && !trimmed.is_empty() {
                if let Some((k, _)) = trimmed.split_once(char::is_whitespace) {
                    if k == key {
                        new_lines.push(new_line.clone());
                        found = true;
                        continue;
                    }
                }
            }
            new_lines.push(line.to_string());
        }

        if !found {
            new_lines.push(new_line);
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await
    }

    /// Delete a configuration parameter from local.cf.
    pub async fn delete_param(client: &SpamAssassinClient, key: &str) -> SpamAssassinResult<()> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .map_err(|_| SpamAssassinError::config_not_found(client.local_cf_path()))?;

        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with('#') && !trimmed.is_empty() {
                if let Some((k, _)) = trimmed.split_once(char::is_whitespace) {
                    if k == key {
                        found = true;
                        continue; // skip this line
                    }
                }
            }
            new_lines.push(line.to_string());
        }

        if !found {
            return Err(SpamAssassinError::config_not_found(key));
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await
    }

    /// Read spamd configuration from /etc/default/spamassassin or systemd unit.
    pub async fn get_spamd_config(client: &SpamAssassinClient) -> SpamAssassinResult<SpamdConfig> {
        // Try reading /etc/default/spamassassin first (Debian/Ubuntu)
        let defaults = client
            .read_remote_file("/etc/default/spamassassin")
            .await
            .or_else(|_| {
                // RHEL/CentOS path
                Ok::<String, SpamAssassinError>(String::new())
            })
            .unwrap_or_default();

        let sysconfig = client
            .read_remote_file("/etc/sysconfig/spamassassin")
            .await
            .unwrap_or_default();

        let combined = format!("{}\n{}", defaults, sysconfig);

        let mut config = SpamdConfig {
            listen_address: None,
            port: None,
            max_children: None,
            min_children: None,
            min_spare: None,
            max_spare: None,
            timeout_child: None,
            pidfile: None,
            allowed_ips: Vec::new(),
            username: None,
        };

        // Parse OPTIONS/SAHOME etc from sysconfig-style files
        let options_line = combined
            .lines()
            .find(|l| {
                let t = l.trim();
                t.starts_with("OPTIONS=") || t.starts_with("SAHOME=")
            })
            .unwrap_or("");

        let opts = options_line
            .split_once('=')
            .map(|(_, v)| v.trim_matches('"').trim_matches('\''))
            .unwrap_or("");

        let opt_parts: Vec<&str> = opts.split_whitespace().collect();
        let mut i = 0;
        while i < opt_parts.len() {
            match opt_parts[i] {
                "-i" | "--listen" => {
                    if i + 1 < opt_parts.len() {
                        config.listen_address = Some(opt_parts[i + 1].to_string());
                        i += 1;
                    }
                }
                "-p" | "--port" => {
                    if i + 1 < opt_parts.len() {
                        config.port = opt_parts[i + 1].parse().ok();
                        i += 1;
                    }
                }
                "-m" | "--max-children" => {
                    if i + 1 < opt_parts.len() {
                        config.max_children = opt_parts[i + 1].parse().ok();
                        i += 1;
                    }
                }
                "--min-children" => {
                    if i + 1 < opt_parts.len() {
                        config.min_children = opt_parts[i + 1].parse().ok();
                        i += 1;
                    }
                }
                "--min-spare" => {
                    if i + 1 < opt_parts.len() {
                        config.min_spare = opt_parts[i + 1].parse().ok();
                        i += 1;
                    }
                }
                "--max-spare" => {
                    if i + 1 < opt_parts.len() {
                        config.max_spare = opt_parts[i + 1].parse().ok();
                        i += 1;
                    }
                }
                "--timeout-child" => {
                    if i + 1 < opt_parts.len() {
                        config.timeout_child = opt_parts[i + 1].parse().ok();
                        i += 1;
                    }
                }
                "-r" | "--pidfile" => {
                    if i + 1 < opt_parts.len() {
                        config.pidfile = Some(opt_parts[i + 1].to_string());
                        i += 1;
                    }
                }
                "-A" | "--allowed-ips" => {
                    if i + 1 < opt_parts.len() {
                        config.allowed_ips = opt_parts[i + 1]
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .collect();
                        i += 1;
                    }
                }
                "-u" | "--username" => {
                    if i + 1 < opt_parts.len() {
                        config.username = Some(opt_parts[i + 1].to_string());
                        i += 1;
                    }
                }
                _ => {}
            }
            i += 1;
        }

        Ok(config)
    }

    /// Write spamd configuration back to /etc/default/spamassassin.
    pub async fn set_spamd_config(
        client: &SpamAssassinClient,
        config: &SpamdConfig,
    ) -> SpamAssassinResult<()> {
        let mut options = Vec::new();

        if let Some(ref addr) = config.listen_address {
            options.push(format!("--listen={}", addr));
        }
        if let Some(port) = config.port {
            options.push(format!("--port={}", port));
        }
        if let Some(max) = config.max_children {
            options.push(format!("--max-children={}", max));
        }
        if let Some(min) = config.min_children {
            options.push(format!("--min-children={}", min));
        }
        if let Some(min_spare) = config.min_spare {
            options.push(format!("--min-spare={}", min_spare));
        }
        if let Some(max_spare) = config.max_spare {
            options.push(format!("--max-spare={}", max_spare));
        }
        if let Some(timeout) = config.timeout_child {
            options.push(format!("--timeout-child={}", timeout));
        }
        if let Some(ref pidfile) = config.pidfile {
            options.push(format!("--pidfile={}", pidfile));
        }
        if !config.allowed_ips.is_empty() {
            options.push(format!("--allowed-ips={}", config.allowed_ips.join(",")));
        }
        if let Some(ref user) = config.username {
            options.push(format!("--username={}", user));
        }

        let options_str = options.join(" ");

        // Read existing file and update OPTIONS line
        let existing = client
            .read_remote_file("/etc/default/spamassassin")
            .await
            .unwrap_or_default();

        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in existing.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("OPTIONS=") {
                new_lines.push(format!("OPTIONS=\"{}\"", options_str));
                found = true;
            } else {
                new_lines.push(line.to_string());
            }
        }

        if !found {
            new_lines.push(format!("OPTIONS=\"{}\"", options_str));
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file("/etc/default/spamassassin", &new_content)
            .await
    }

    /// Test SpamAssassin configuration using `spamassassin --lint`.
    pub async fn test_config(client: &SpamAssassinClient) -> SpamAssassinResult<ConfigTestResult> {
        let out = client.exec_ssh("sudo spamassassin --lint 2>&1").await?;

        let mut errors = Vec::new();
        for line in out.stdout.lines().chain(out.stderr.lines()) {
            let trimmed = line.trim();
            if trimmed.contains("error")
                || trimmed.contains("warn")
                || trimmed.starts_with("config:")
            {
                errors.push(trimmed.to_string());
            }
        }

        Ok(ConfigTestResult {
            success: out.exit_code == 0 && errors.is_empty(),
            output: format!("{}\n{}", out.stdout, out.stderr).trim().to_string(),
            errors,
        })
    }
}
