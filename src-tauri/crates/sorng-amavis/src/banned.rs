// ── amavis banned file rules management ──────────────────────────────────────

use crate::client::{shell_escape, AmavisClient};
use crate::error::{AmavisError, AmavisResult};
use crate::types::*;

const BANNED_RULES_CONF: &str = "/etc/amavis/conf.d/50-user";

pub struct BannedManager;

impl BannedManager {
    /// List all banned file type rules.
    pub async fn list_rules(client: &AmavisClient) -> AmavisResult<Vec<AmavisBannedRule>> {
        let content = client
            .read_file(BANNED_RULES_CONF)
            .await
            .unwrap_or_default();
        let rules = parse_banned_rules(&content);
        Ok(rules)
    }

    /// Get a single banned rule by ID.
    pub async fn get_rule(client: &AmavisClient, id: &str) -> AmavisResult<AmavisBannedRule> {
        let rules = Self::list_rules(client).await?;
        rules
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| AmavisError::ban_not_found(id))
    }

    /// Create a new banned file type rule.
    pub async fn create_rule(
        client: &AmavisClient,
        req: &CreateBannedRuleRequest,
    ) -> AmavisResult<AmavisBannedRule> {
        let id = uuid::Uuid::new_v4().to_string();
        let rule = AmavisBannedRule {
            id: id.clone(),
            pattern: req.pattern.clone(),
            description: req.description.clone(),
            policy_bank: req.policy_bank.clone(),
            enabled: true,
        };
        let line = render_banned_rule(&rule);
        let mut content = client
            .read_file(BANNED_RULES_CONF)
            .await
            .unwrap_or_default();

        // Find or create the @banned_filename_re section
        if content.contains("@banned_filename_re") {
            // Insert before the closing ");
            if let Some(pos) = content.rfind(");") {
                let before = &content[..pos];
                let after = &content[pos..];
                content = format!("{}\n  {},\n{}", before.trim_end(), line, after);
            } else {
                content.push_str(&format!("\n  {},\n", line));
            }
        } else {
            // Create the entire block
            content.push_str(&format!(
                "\n@banned_filename_re = new_RE(\n  {},\n);\n",
                line
            ));
        }
        client.write_file(BANNED_RULES_CONF, &content).await?;
        Ok(rule)
    }

    /// Update an existing banned rule.
    pub async fn update_rule(
        client: &AmavisClient,
        id: &str,
        req: &UpdateBannedRuleRequest,
    ) -> AmavisResult<AmavisBannedRule> {
        let mut rule = Self::get_rule(client, id).await?;
        if let Some(ref p) = req.pattern {
            rule.pattern = p.clone();
        }
        if let Some(ref d) = req.description {
            rule.description = Some(d.clone());
        }
        if let Some(ref p) = req.policy_bank {
            rule.policy_bank = Some(p.clone());
        }
        if let Some(e) = req.enabled {
            rule.enabled = e;
        }

        // Remove old rule and re-add
        let content = client
            .read_file(BANNED_RULES_CONF)
            .await
            .unwrap_or_default();
        let cleaned = remove_banned_rule_by_id(&content, id);
        let line = render_banned_rule(&rule);
        let new_content = if cleaned.contains("@banned_filename_re") {
            if let Some(pos) = cleaned.rfind(");") {
                let before = &cleaned[..pos];
                let after = &cleaned[pos..];
                format!("{}\n  {},\n{}", before.trim_end(), line, after)
            } else {
                format!("{}\n  {},\n", cleaned, line)
            }
        } else {
            format!(
                "{}\n@banned_filename_re = new_RE(\n  {},\n);\n",
                cleaned, line
            )
        };
        client.write_file(BANNED_RULES_CONF, &new_content).await?;
        Ok(rule)
    }

    /// Delete a banned rule by ID.
    pub async fn delete_rule(client: &AmavisClient, id: &str) -> AmavisResult<()> {
        let content = client.read_file(BANNED_RULES_CONF).await?;
        let cleaned = remove_banned_rule_by_id(&content, id);
        if cleaned.len() == content.len() {
            return Err(AmavisError::ban_not_found(id));
        }
        client.write_file(BANNED_RULES_CONF, &cleaned).await
    }

    /// Test whether a filename would be blocked by current banned rules.
    pub async fn test_filename(client: &AmavisClient, filename: &str) -> AmavisResult<bool> {
        let rules = Self::list_rules(client).await?;
        for rule in &rules {
            if !rule.enabled {
                continue;
            }
            // Simple pattern matching - in production this would evaluate the
            // actual Perl regex patterns from amavis config
            let pattern_lower = rule.pattern.to_lowercase();
            let filename_lower = filename.to_lowercase();
            if filename_lower.contains(&pattern_lower) {
                return Ok(true);
            }
            // Check for extension-based matching
            if pattern_lower.starts_with("\\.") {
                let ext = pattern_lower.trim_start_matches("\\.");
                if filename_lower.ends_with(&format!(".{}", ext)) {
                    return Ok(true);
                }
            }
        }

        // Also try the amavisd test command if available
        let _out = client
            .ssh_exec(&format!(
                "echo {} | amavisd-new -c /etc/amavisd/amavisd.conf test-keys 2>/dev/null || true",
                shell_escape(filename)
            ))
            .await
            .ok();

        Ok(false)
    }
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

fn parse_banned_rules(content: &str) -> Vec<AmavisBannedRule> {
    let mut rules = Vec::new();
    let mut in_banned_block = false;
    let mut rule_index = 0u32;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.contains("@banned_filename_re") && trimmed.contains("new_RE") {
            in_banned_block = true;
            continue;
        }
        if in_banned_block {
            if trimmed == ");" || trimmed.starts_with(");") {
                in_banned_block = false;
                continue;
            }
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            // Parse patterns like: qr'^\.exe$'i,  or  qr'\.bat$'i, # executables
            let is_commented = trimmed.starts_with('#');
            let effective = if is_commented {
                trimmed.trim_start_matches('#').trim()
            } else {
                trimmed
            };
            if effective.starts_with("qr") || effective.starts_with('[') {
                let (pattern, description) = parse_qr_pattern(effective);
                let id_str = if let Some(ref desc) = description {
                    // Use description-based ID for stability
                    format!(
                        "banned-{:x}",
                        desc.bytes()
                            .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32))
                    )
                } else {
                    rule_index += 1;
                    format!("banned-{}", rule_index)
                };
                rules.push(AmavisBannedRule {
                    id: id_str,
                    pattern,
                    description,
                    policy_bank: None,
                    enabled: !is_commented,
                });
            }
        }
    }
    rules
}

fn parse_qr_pattern(s: &str) -> (String, Option<String>) {
    let mut pattern = s.to_string();
    let mut description = None;

    // Extract trailing comment
    if let Some(hash_pos) = s.rfind('#') {
        let comment = s[hash_pos + 1..].trim().to_string();
        if !comment.is_empty() {
            description = Some(comment);
        }
        pattern = s[..hash_pos].trim().to_string();
    }

    // Clean up the pattern
    pattern = pattern.trim_end_matches(',').trim().to_string();

    (pattern, description)
}

fn render_banned_rule(rule: &AmavisBannedRule) -> String {
    let prefix = if rule.enabled { "" } else { "# " };
    let comment = rule
        .description
        .as_ref()
        .map(|d| format!("  # {}", d))
        .unwrap_or_default();
    // Embed the ID in a comment for round-trip parsing
    format!("{}qr'{}'{} # id:{}", prefix, rule.pattern, comment, rule.id)
}

fn remove_banned_rule_by_id(content: &str, id: &str) -> String {
    let marker = format!("id:{}", id);
    content
        .lines()
        .filter(|line| !line.contains(&marker))
        .collect::<Vec<_>>()
        .join("\n")
}
