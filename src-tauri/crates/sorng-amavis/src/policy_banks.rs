// ── amavis policy bank management ────────────────────────────────────────────

use crate::client::AmavisClient;
use crate::error::{AmavisError, AmavisResult};
use crate::types::*;

const POLICY_BANKS_CONF: &str = "/etc/amavis/conf.d/50-user";

pub struct PolicyBankManager;

impl PolicyBankManager {
    /// List all policy banks defined in the amavis config.
    pub async fn list(client: &AmavisClient) -> AmavisResult<Vec<AmavisPolicyBank>> {
        let content = client
            .read_file(POLICY_BANKS_CONF)
            .await
            .unwrap_or_default();
        let banks = parse_policy_banks(&content);
        Ok(banks)
    }

    /// Get a single policy bank by name.
    pub async fn get(client: &AmavisClient, name: &str) -> AmavisResult<AmavisPolicyBank> {
        let banks = Self::list(client).await?;
        banks
            .into_iter()
            .find(|b| b.name == name)
            .ok_or_else(|| AmavisError::not_found(format!("Policy bank not found: {}", name)))
    }

    /// Create a new policy bank.
    pub async fn create(
        client: &AmavisClient,
        req: &CreatePolicyBankRequest,
    ) -> AmavisResult<AmavisPolicyBank> {
        let existing = Self::list(client).await?;
        if existing.iter().any(|b| b.name == req.name) {
            return Err(AmavisError::config(format!(
                "Policy bank already exists: {}",
                req.name
            )));
        }
        let bank = AmavisPolicyBank {
            name: req.name.clone(),
            description: req.description.clone(),
            bypass_virus_checks: req.bypass_virus_checks,
            bypass_spam_checks: req.bypass_spam_checks,
            bypass_banned_checks: req.bypass_banned_checks,
            bypass_header_checks: req.bypass_header_checks,
            spam_tag_level: req.spam_tag_level,
            spam_tag2_level: req.spam_tag2_level,
            spam_kill_level: req.spam_kill_level,
            spam_dsn_cutoff_level: req.spam_dsn_cutoff_level,
            virus_quarantine_to: req.virus_quarantine_to.clone(),
            spam_quarantine_to: req.spam_quarantine_to.clone(),
            banned_quarantine_to: req.banned_quarantine_to.clone(),
        };
        let snippet = render_policy_bank(&bank);
        let mut content = client
            .read_file(POLICY_BANKS_CONF)
            .await
            .unwrap_or_default();
        content.push_str("\n\n");
        content.push_str(&snippet);
        client.write_file(POLICY_BANKS_CONF, &content).await?;
        Ok(bank)
    }

    /// Update an existing policy bank.
    pub async fn update(
        client: &AmavisClient,
        name: &str,
        req: &UpdatePolicyBankRequest,
    ) -> AmavisResult<AmavisPolicyBank> {
        let mut bank = Self::get(client, name).await?;
        if let Some(ref d) = req.description {
            bank.description = Some(d.clone());
        }
        if let Some(v) = req.bypass_virus_checks {
            bank.bypass_virus_checks = Some(v);
        }
        if let Some(v) = req.bypass_spam_checks {
            bank.bypass_spam_checks = Some(v);
        }
        if let Some(v) = req.bypass_banned_checks {
            bank.bypass_banned_checks = Some(v);
        }
        if let Some(v) = req.bypass_header_checks {
            bank.bypass_header_checks = Some(v);
        }
        if let Some(v) = req.spam_tag_level {
            bank.spam_tag_level = Some(v);
        }
        if let Some(v) = req.spam_tag2_level {
            bank.spam_tag2_level = Some(v);
        }
        if let Some(v) = req.spam_kill_level {
            bank.spam_kill_level = Some(v);
        }
        if let Some(v) = req.spam_dsn_cutoff_level {
            bank.spam_dsn_cutoff_level = Some(v);
        }
        if let Some(ref v) = req.virus_quarantine_to {
            bank.virus_quarantine_to = Some(v.clone());
        }
        if let Some(ref v) = req.spam_quarantine_to {
            bank.spam_quarantine_to = Some(v.clone());
        }
        if let Some(ref v) = req.banned_quarantine_to {
            bank.banned_quarantine_to = Some(v.clone());
        }

        // Rewrite the config: remove old bank, append updated
        let content = client
            .read_file(POLICY_BANKS_CONF)
            .await
            .unwrap_or_default();
        let cleaned = remove_policy_bank_block(&content, name);
        let snippet = render_policy_bank(&bank);
        let new_content = format!("{}\n\n{}", cleaned.trim_end(), snippet);
        client.write_file(POLICY_BANKS_CONF, &new_content).await?;
        Ok(bank)
    }

    /// Delete a policy bank.
    pub async fn delete(client: &AmavisClient, name: &str) -> AmavisResult<()> {
        let content = client.read_file(POLICY_BANKS_CONF).await?;
        let cleaned = remove_policy_bank_block(&content, name);
        if cleaned.len() == content.len() {
            return Err(AmavisError::not_found(format!(
                "Policy bank not found: {}",
                name
            )));
        }
        client.write_file(POLICY_BANKS_CONF, &cleaned).await
    }

    /// Activate a policy bank by ensuring it is not commented out.
    pub async fn activate(client: &AmavisClient, name: &str) -> AmavisResult<()> {
        let content = client.read_file(POLICY_BANKS_CONF).await?;
        let marker = format!("$policy_bank{{'{}'}}", name);
        let mut result = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') && trimmed.contains(&marker) {
                // Uncomment
                result.push(trimmed.trim_start_matches('#').trim_start().to_string());
            } else {
                result.push(line.to_string());
            }
        }
        client
            .write_file(POLICY_BANKS_CONF, &result.join("\n"))
            .await
    }

    /// Deactivate a policy bank by commenting it out.
    pub async fn deactivate(client: &AmavisClient, name: &str) -> AmavisResult<()> {
        let content = client.read_file(POLICY_BANKS_CONF).await?;
        let marker = format!("$policy_bank{{'{}'}}", name);
        let mut in_block = false;
        let mut brace_depth = 0i32;
        let mut result = Vec::new();
        for line in content.lines() {
            if !in_block && line.contains(&marker) {
                in_block = true;
                brace_depth = 0;
            }
            if in_block {
                for ch in line.chars() {
                    if ch == '{' {
                        brace_depth += 1;
                    } else if ch == '}' {
                        brace_depth -= 1;
                    }
                }
                result.push(format!("# {}", line));
                if brace_depth <= 0 && line.contains("};") {
                    in_block = false;
                }
            } else {
                result.push(line.to_string());
            }
        }
        client
            .write_file(POLICY_BANKS_CONF, &result.join("\n"))
            .await
    }
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

fn parse_policy_banks(content: &str) -> Vec<AmavisPolicyBank> {
    let mut banks = Vec::new();
    let mut lines = content.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        // Look for $policy_bank{'NAME'} = { ... };
        if let Some(start) = trimmed.find("$policy_bank{'") {
            let after = &trimmed[start + "$policy_bank{'".len()..];
            if let Some(end) = after.find("'}") {
                let name = after[..end].to_string();
                // Collect the block content
                let mut block = String::new();
                let mut brace_depth = 0i32;
                // Count braces on the current line
                for ch in trimmed.chars() {
                    if ch == '{' {
                        brace_depth += 1;
                    } else if ch == '}' {
                        brace_depth -= 1;
                    }
                }
                block.push_str(trimmed);
                block.push('\n');
                while brace_depth > 0 {
                    if let Some(next_line) = lines.next() {
                        for ch in next_line.chars() {
                            if ch == '{' {
                                brace_depth += 1;
                            } else if ch == '}' {
                                brace_depth -= 1;
                            }
                        }
                        block.push_str(next_line);
                        block.push('\n');
                    } else {
                        break;
                    }
                }
                let bank = parse_bank_block(&name, &block);
                banks.push(bank);
            }
        }
    }
    banks
}

fn parse_bank_block(name: &str, block: &str) -> AmavisPolicyBank {
    AmavisPolicyBank {
        name: name.to_string(),
        description: extract_block_comment(block),
        bypass_virus_checks: extract_bool_field(block, "bypass_virus_checks_maps"),
        bypass_spam_checks: extract_bool_field(block, "bypass_spam_checks_maps"),
        bypass_banned_checks: extract_bool_field(block, "bypass_banned_checks_maps"),
        bypass_header_checks: extract_bool_field(block, "bypass_header_checks_maps"),
        spam_tag_level: extract_float_field(block, "spam_tag_level"),
        spam_tag2_level: extract_float_field(block, "spam_tag2_level"),
        spam_kill_level: extract_float_field(block, "spam_kill_level"),
        spam_dsn_cutoff_level: extract_float_field(block, "spam_dsn_cutoff_level"),
        virus_quarantine_to: extract_string_field(block, "virus_quarantine_to"),
        spam_quarantine_to: extract_string_field(block, "spam_quarantine_to"),
        banned_quarantine_to: extract_string_field(block, "banned_quarantine_to"),
    }
}

fn extract_block_comment(block: &str) -> Option<String> {
    for line in block.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            return Some(trimmed.trim_start_matches('#').trim().to_string());
        }
    }
    None
}

fn extract_bool_field(block: &str, field: &str) -> Option<bool> {
    for line in block.lines() {
        let trimmed = line.trim();
        if trimmed.contains(field) && trimmed.contains("=>") {
            if trimmed.contains("[\\1]") || trimmed.contains("1") {
                return Some(true);
            }
            return Some(false);
        }
    }
    None
}

fn extract_float_field(block: &str, field: &str) -> Option<f64> {
    for line in block.lines() {
        let trimmed = line.trim();
        if trimmed.contains(field) && trimmed.contains("=>") {
            let parts: Vec<&str> = trimmed.split("=>").collect();
            if parts.len() == 2 {
                let value = parts[1]
                    .trim()
                    .trim_end_matches(',')
                    .trim_end_matches(';')
                    .trim();
                return value.parse::<f64>().ok();
            }
        }
    }
    None
}

fn extract_string_field(block: &str, field: &str) -> Option<String> {
    for line in block.lines() {
        let trimmed = line.trim();
        if trimmed.contains(field) && trimmed.contains("=>") {
            let parts: Vec<&str> = trimmed.split("=>").collect();
            if parts.len() == 2 {
                let value = parts[1]
                    .trim()
                    .trim_end_matches(',')
                    .trim_end_matches(';')
                    .trim()
                    .trim_matches('\'')
                    .trim_matches('"')
                    .to_string();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn remove_policy_bank_block(content: &str, name: &str) -> String {
    let marker = format!("$policy_bank{{'{}'}}", name);
    let mut result = Vec::new();
    let mut in_block = false;
    let mut brace_depth = 0i32;
    for line in content.lines() {
        if !in_block && line.contains(&marker) {
            in_block = true;
            brace_depth = 0;
        }
        if in_block {
            for ch in line.chars() {
                if ch == '{' {
                    brace_depth += 1;
                } else if ch == '}' {
                    brace_depth -= 1;
                }
            }
            if brace_depth <= 0 && line.contains("};") {
                in_block = false;
            }
            // skip the line (remove it)
        } else {
            result.push(line.to_string());
        }
    }
    result.join("\n")
}

fn render_policy_bank(bank: &AmavisPolicyBank) -> String {
    let mut lines = Vec::new();
    if let Some(ref desc) = bank.description {
        lines.push(format!("# {}", desc));
    }
    lines.push(format!("$policy_bank{{'{}'}} = {{", bank.name));
    if let Some(v) = bank.bypass_virus_checks {
        let val = if v { "[\\1]" } else { "[\\0]" };
        lines.push(format!("  bypass_virus_checks_maps => {},", val));
    }
    if let Some(v) = bank.bypass_spam_checks {
        let val = if v { "[\\1]" } else { "[\\0]" };
        lines.push(format!("  bypass_spam_checks_maps => {},", val));
    }
    if let Some(v) = bank.bypass_banned_checks {
        let val = if v { "[\\1]" } else { "[\\0]" };
        lines.push(format!("  bypass_banned_checks_maps => {},", val));
    }
    if let Some(v) = bank.bypass_header_checks {
        let val = if v { "[\\1]" } else { "[\\0]" };
        lines.push(format!("  bypass_header_checks_maps => {},", val));
    }
    if let Some(v) = bank.spam_tag_level {
        lines.push(format!("  spam_tag_level => {},", v));
    }
    if let Some(v) = bank.spam_tag2_level {
        lines.push(format!("  spam_tag2_level => {},", v));
    }
    if let Some(v) = bank.spam_kill_level {
        lines.push(format!("  spam_kill_level => {},", v));
    }
    if let Some(v) = bank.spam_dsn_cutoff_level {
        lines.push(format!("  spam_dsn_cutoff_level => {},", v));
    }
    if let Some(ref v) = bank.virus_quarantine_to {
        lines.push(format!("  virus_quarantine_to => '{}',", v));
    }
    if let Some(ref v) = bank.spam_quarantine_to {
        lines.push(format!("  spam_quarantine_to => '{}',", v));
    }
    if let Some(ref v) = bank.banned_quarantine_to {
        lines.push(format!("  banned_quarantine_to => '{}',", v));
    }
    lines.push("};".to_string());
    lines.join("\n")
}
