// ── dovecot quota management ─────────────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

pub struct QuotaManager;

impl QuotaManager {
    /// Get quota usage for a user via `doveadm quota get`.
    pub async fn get(client: &DovecotClient, user: &str) -> DovecotResult<DovecotQuota> {
        let out = client
            .doveadm(&format!("quota get -u {}", shell_escape(user)))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::quota(format!(
                "Failed to get quota for '{}': {}",
                user, out.stderr
            )));
        }

        let mut storage_limit = None;
        let mut storage_used = 0u64;
        let mut message_limit = None;
        let mut message_used = 0u64;

        // Parse doveadm quota get output:
        // Quota name Type    Value  Limit  %
        // User quota STORAGE 12345  102400 12
        // User quota MESSAGE 150    10000  2
        for line in out.stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                continue;
            }
            // Find the type keyword (STORAGE or MESSAGE)
            let type_idx = parts.iter().position(|&p| p == "STORAGE" || p == "MESSAGE");
            if let Some(idx) = type_idx {
                let quota_type = parts[idx];
                let value = parts
                    .get(idx + 1)
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0);
                let limit = parts.get(idx + 2).and_then(|v| {
                    if *v == "-" {
                        None
                    } else {
                        v.parse::<u64>().ok()
                    }
                });
                match quota_type {
                    "STORAGE" => {
                        storage_used = value;
                        storage_limit = limit;
                    }
                    "MESSAGE" => {
                        message_used = value;
                        message_limit = limit;
                    }
                    _ => {}
                }
            }
        }

        let percent_used = if let Some(limit) = storage_limit {
            if limit > 0 {
                (storage_used as f64 / limit as f64) * 100.0
            } else {
                0.0
            }
        } else {
            0.0
        };

        Ok(DovecotQuota {
            user: user.to_string(),
            storage_limit,
            storage_used,
            message_limit,
            message_used,
            percent_used,
        })
    }

    /// Set quota for a user via config file manipulation.
    pub async fn set(
        client: &DovecotClient,
        user: &str,
        rule: &DovecotQuotaRule,
    ) -> DovecotResult<()> {
        // Build a quota override via userdb extra fields
        let quota_value = if let Some(storage_mb) = rule.storage_limit_mb {
            format!("*:storage={}M", storage_mb)
        } else if let Some(msg_limit) = rule.message_limit {
            format!("*:messages={}", msg_limit)
        } else {
            return Err(DovecotError::quota("No quota limit specified".to_string()));
        };

        // Write to the user's quota override file
        let override_path = format!("{}/quota-overrides", client.config_dir());
        let entry = format!("{}:{}", user, quota_value);

        // Remove old entry and add new one
        let cmd = format!(
            "sudo sed -i '/^{}:/d' {} 2>/dev/null; echo {} | sudo tee -a {} > /dev/null",
            user,
            shell_escape(&override_path),
            shell_escape(&entry),
            shell_escape(&override_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(DovecotError::quota(format!(
                "Failed to set quota for '{}': {}",
                user, out.stderr
            )));
        }
        Ok(())
    }

    /// Recalculate quota for a user via `doveadm quota recalc`.
    pub async fn recalculate(client: &DovecotClient, user: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!("quota recalc -u {}", shell_escape(user)))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::quota(format!(
                "Failed to recalculate quota for '{}': {}",
                user, out.stderr
            )));
        }
        Ok(())
    }

    /// List configured quota rules from the dovecot config.
    pub async fn list_rules(client: &DovecotClient) -> DovecotResult<Vec<DovecotQuotaRule>> {
        let out = client
            .doveadm("config -f tabescaped plugin/quota_rule")
            .await;
        let mut rules = Vec::new();

        // Also check config files for quota_rule directives
        let config_path = format!("{}/conf.d/90-quota.conf", client.config_dir());
        let content = client
            .read_remote_file(&config_path)
            .await
            .unwrap_or_default();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("quota_rule") {
                if let Some((key, value)) = trimmed.split_once('=') {
                    let rule_name = key.trim().to_string();
                    let value = value.trim().to_string();
                    let mut storage_limit_mb = None;
                    let mut message_limit = None;

                    for part in value.split(':') {
                        if let Some(storage) = part.strip_prefix("storage=") {
                            let storage = storage.trim_end_matches('M').trim_end_matches('m');
                            storage_limit_mb = storage.parse().ok();
                        } else if let Some(messages) = part.strip_prefix("messages=") {
                            message_limit = messages.parse().ok();
                        }
                    }

                    rules.push(DovecotQuotaRule {
                        rule: rule_name,
                        storage_limit_mb,
                        message_limit,
                    });
                }
            }
        }

        // If we got doveadm output, parse it too
        if let Ok(ref o) = out {
            for line in o.stdout.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let mut storage_limit_mb = None;
                let mut message_limit = None;
                for part in line.split(':') {
                    if let Some(storage) = part.strip_prefix("storage=") {
                        let storage = storage.trim_end_matches('M').trim_end_matches('m');
                        storage_limit_mb = storage.parse().ok();
                    } else if let Some(messages) = part.strip_prefix("messages=") {
                        message_limit = messages.parse().ok();
                    }
                }
                rules.push(DovecotQuotaRule {
                    rule: line.to_string(),
                    storage_limit_mb,
                    message_limit,
                });
            }
        }

        Ok(rules)
    }

    /// Set a global quota rule in the config.
    pub async fn set_rule(client: &DovecotClient, rule: &DovecotQuotaRule) -> DovecotResult<()> {
        let config_path = format!("{}/conf.d/90-quota.conf", client.config_dir());
        let content = client
            .read_remote_file(&config_path)
            .await
            .unwrap_or_default();

        let mut parts = Vec::new();
        if let Some(storage) = rule.storage_limit_mb {
            parts.push(format!("storage={}M", storage));
        }
        if let Some(messages) = rule.message_limit {
            parts.push(format!("messages={}", messages));
        }
        let rule_value = format!("*:{}", parts.join(":"));
        let line = format!("  {} = {}", rule.rule, rule_value);

        // Check if rule already exists and update, or append
        let mut new_content = String::new();
        let mut found = false;
        for existing_line in content.lines() {
            if existing_line.trim().starts_with(&rule.rule) {
                new_content.push_str(&line);
                new_content.push('\n');
                found = true;
            } else {
                new_content.push_str(existing_line);
                new_content.push('\n');
            }
        }
        if !found {
            // Insert before the closing brace of plugin section
            new_content = new_content.trim_end().to_string();
            new_content.push('\n');
            new_content.push_str(&line);
            new_content.push('\n');
        }

        client.write_remote_file(&config_path, &new_content).await?;
        Ok(())
    }

    /// Delete a quota rule from the config.
    pub async fn delete_rule(client: &DovecotClient, name: &str) -> DovecotResult<()> {
        let config_path = format!("{}/conf.d/90-quota.conf", client.config_dir());
        let cmd = format!(
            "sudo sed -i '/^[[:space:]]*{}[[:space:]]*=/d' {}",
            name,
            shell_escape(&config_path)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(DovecotError::quota(format!(
                "Failed to delete quota rule '{}': {}",
                name, out.stderr
            )));
        }
        Ok(())
    }
}
