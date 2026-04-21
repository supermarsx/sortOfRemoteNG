// ── SpamAssassin rule management ─────────────────────────────────────────────

use crate::client::{shell_escape, SpamAssassinClient};
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

pub struct RuleManager;

impl RuleManager {
    /// List all SpamAssassin rules by parsing config files and `spamassassin --lint -D`.
    pub async fn list(client: &SpamAssassinClient) -> SpamAssassinResult<Vec<SpamRule>> {
        // Parse rules from all .cf files in the config directory
        let cf_files = client.list_remote_dir(client.config_dir()).await?;
        let mut rules = Vec::new();

        for file in &cf_files {
            if !file.ends_with(".cf") && !file.ends_with(".pre") {
                continue;
            }
            let path = format!("{}/{}", client.config_dir(), file);
            let content = match client.read_remote_file(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };
            let is_custom = file == "local.cf" || file.starts_with("custom_");
            let parsed = parse_rules_from_cf(&content, is_custom);
            rules.extend(parsed);
        }

        // Merge score overrides from local.cf
        let local_cf = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();
        let score_overrides = parse_score_lines(&local_cf);
        for rule in &mut rules {
            if let Some(sc) = score_overrides.iter().find(|s| s.name == rule.name) {
                rule.score = sc.score;
            }
        }

        Ok(rules)
    }

    /// Get a single rule by name.
    pub async fn get(client: &SpamAssassinClient, name: &str) -> SpamAssassinResult<SpamRule> {
        let rules = Self::list(client).await?;
        rules
            .into_iter()
            .find(|r| r.name == name)
            .ok_or_else(|| SpamAssassinError::rule_not_found(name))
    }

    /// List all score assignments from local.cf and *.cf files.
    pub async fn list_scores(
        client: &SpamAssassinClient,
    ) -> SpamAssassinResult<Vec<SpamRuleScore>> {
        let mut scores = Vec::new();

        let cf_files = client.list_remote_dir(client.config_dir()).await?;
        for file in &cf_files {
            if !file.ends_with(".cf") {
                continue;
            }
            let path = format!("{}/{}", client.config_dir(), file);
            let content = match client.read_remote_file(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };
            scores.extend(parse_score_lines(&content));
        }

        Ok(scores)
    }

    /// Set a score for a rule in local.cf.
    pub async fn set_score(
        client: &SpamAssassinClient,
        name: &str,
        score: f64,
    ) -> SpamAssassinResult<()> {
        let local_cf = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        let score_line = format!("score {} {:.1}", name, score);
        let mut new_content = String::new();
        let mut found = false;

        for line in local_cf.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("score ")
                && trimmed
                    .split_whitespace()
                    .nth(1)
                    .map(|n| n == name)
                    .unwrap_or(false)
            {
                new_content.push_str(&score_line);
                new_content.push('\n');
                found = true;
            } else {
                new_content.push_str(line);
                new_content.push('\n');
            }
        }

        if !found {
            new_content.push_str(&score_line);
            new_content.push('\n');
        }

        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }

    /// Create a custom rule and add it to local.cf.
    pub async fn create_custom(
        client: &SpamAssassinClient,
        req: &CreateCustomRuleRequest,
    ) -> SpamAssassinResult<SpamRule> {
        let local_cf = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        // Check if rule already exists
        for line in local_cf.lines() {
            let trimmed = line.trim();
            if (trimmed.starts_with("header ")
                || trimmed.starts_with("body ")
                || trimmed.starts_with("rawbody ")
                || trimmed.starts_with("full ")
                || trimmed.starts_with("uri ")
                || trimmed.starts_with("meta ")
                || trimmed.starts_with("eval "))
                && trimmed
                    .split_whitespace()
                    .nth(1)
                    .map(|n| n == req.name)
                    .unwrap_or(false)
            {
                return Err(SpamAssassinError::internal(format!(
                    "Rule '{}' already exists",
                    req.name
                )));
            }
        }

        // Build rule definition lines
        let mut addition = String::new();
        addition.push_str(&format!("\n# Custom rule: {}\n", req.description));
        addition.push_str(&format!("{} {} {}\n", req.rule_type, req.name, req.pattern));
        addition.push_str(&format!("score {} {:.1}\n", req.name, req.score));
        addition.push_str(&format!("describe {} {}\n", req.name, req.description));

        let new_content = format!("{}{}", local_cf, addition);
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;

        Ok(SpamRule {
            name: req.name.clone(),
            score: req.score,
            description: req.description.clone(),
            area: req.rule_type.to_uppercase(),
            enabled: true,
            is_custom: true,
            test_type: req.rule_type.clone(),
        })
    }

    /// Delete a custom rule from local.cf.
    pub async fn delete_custom(client: &SpamAssassinClient, name: &str) -> SpamAssassinResult<()> {
        let local_cf = client
            .read_remote_file(client.local_cf_path())
            .await
            .map_err(|_| SpamAssassinError::config_not_found(client.local_cf_path()))?;

        let mut new_lines: Vec<String> = Vec::new();
        let mut found = false;

        for line in local_cf.lines() {
            let trimmed = line.trim();
            let refers_to_rule = trimmed
                .split_whitespace()
                .nth(1)
                .map(|n| n == name)
                .unwrap_or(false);

            let is_rule_line = (trimmed.starts_with("header ")
                || trimmed.starts_with("body ")
                || trimmed.starts_with("rawbody ")
                || trimmed.starts_with("full ")
                || trimmed.starts_with("uri ")
                || trimmed.starts_with("meta ")
                || trimmed.starts_with("eval ")
                || trimmed.starts_with("score ")
                || trimmed.starts_with("describe "))
                && refers_to_rule;

            if is_rule_line {
                found = true;
                continue;
            }
            // Also skip comment lines immediately preceding a deleted rule
            if trimmed.starts_with("# Custom rule:") && !found {
                // Peek: this heuristic removes the comment only if the next
                // rule line matches, which we already handle above.
            }
            new_lines.push(line.to_string());
        }

        if !found {
            return Err(SpamAssassinError::rule_not_found(name));
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }

    /// Enable a rule by removing any `score RULE 0` override.
    pub async fn enable(client: &SpamAssassinClient, name: &str) -> SpamAssassinResult<()> {
        let local_cf = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();

        let mut new_lines: Vec<String> = Vec::new();

        for line in local_cf.lines() {
            let trimmed = line.trim();
            // Remove score-zero overrides for this rule
            if trimmed.starts_with("score ") {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 3 && parts[1] == name {
                    if let Ok(s) = parts[2].parse::<f64>() {
                        if s == 0.0 {
                            continue; // skip the zero-score line
                        }
                    }
                }
            }
            new_lines.push(line.to_string());
        }

        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(client.local_cf_path(), &new_content)
            .await?;
        Ok(())
    }

    /// Disable a rule by setting its score to 0 in local.cf.
    pub async fn disable(client: &SpamAssassinClient, name: &str) -> SpamAssassinResult<()> {
        Self::set_score(client, name, 0.0).await
    }

    /// List only custom rules (those defined in local.cf).
    pub async fn list_custom(client: &SpamAssassinClient) -> SpamAssassinResult<Vec<SpamRule>> {
        let content = client
            .read_remote_file(client.local_cf_path())
            .await
            .unwrap_or_default();
        Ok(parse_rules_from_cf(&content, true))
    }

    /// Get the description for a specific rule.
    pub async fn get_rule_description(
        client: &SpamAssassinClient,
        name: &str,
    ) -> SpamAssassinResult<String> {
        let cf_files = client.list_remote_dir(client.config_dir()).await?;

        for file in &cf_files {
            if !file.ends_with(".cf") {
                continue;
            }
            let path = format!("{}/{}", client.config_dir(), file);
            let content = match client.read_remote_file(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("describe ") {
                    let parts: Vec<&str> = trimmed.splitn(3, char::is_whitespace).collect();
                    if parts.len() >= 3 && parts[1] == name {
                        return Ok(parts[2].to_string());
                    }
                }
            }
        }

        // Fallback: try spamassassin --lint -D to pull the rule description
        let out = client
            .exec_ssh(&format!(
                "spamassassin --lint -D rules 2>&1 | grep -i {}",
                shell_escape(name)
            ))
            .await;
        match out {
            Ok(o) if !o.stdout.trim().is_empty() => Ok(o.stdout.trim().to_string()),
            _ => Err(SpamAssassinError::rule_not_found(name)),
        }
    }
}

// ─── Parse helpers ───────────────────────────────────────────────────────────

fn parse_rules_from_cf(content: &str, is_custom: bool) -> Vec<SpamRule> {
    let test_keywords = ["header", "body", "rawbody", "full", "uri", "meta", "eval"];
    let mut rules: Vec<SpamRule> = Vec::new();
    let mut descriptions: Vec<(String, String)> = Vec::new();
    let mut scores: Vec<(String, f64)> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Parse rule definitions: <type> <NAME> <pattern>
        for keyword in &test_keywords {
            if let Some(stripped) = trimmed.strip_prefix(*keyword) {
                let rest = stripped.trim();
                let parts: Vec<&str> = rest.splitn(2, char::is_whitespace).collect();
                if !parts.is_empty() && !parts[0].is_empty() {
                    let name = parts[0].to_string();
                    // Avoid duplicate entries
                    if !rules.iter().any(|r| r.name == name) {
                        rules.push(SpamRule {
                            name,
                            score: 1.0,
                            description: String::new(),
                            area: keyword.to_uppercase(),
                            enabled: true,
                            is_custom,
                            test_type: keyword.to_string(),
                        });
                    }
                }
                break;
            }
        }

        // Parse describe lines
        if trimmed.starts_with("describe ") {
            let parts: Vec<&str> = trimmed.splitn(3, char::is_whitespace).collect();
            if parts.len() >= 3 {
                descriptions.push((parts[1].to_string(), parts[2].to_string()));
            }
        }

        // Parse score lines
        if trimmed.starts_with("score ") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 3 {
                if let Ok(s) = parts[2].parse::<f64>() {
                    scores.push((parts[1].to_string(), s));
                }
            }
        }
    }

    // Apply descriptions and scores
    for rule in &mut rules {
        if let Some((_, desc)) = descriptions.iter().find(|(n, _)| n == &rule.name) {
            rule.description = desc.clone();
        }
        if let Some((_, score)) = scores.iter().find(|(n, _)| n == &rule.name) {
            rule.score = *score;
            rule.enabled = *score != 0.0;
        }
    }

    rules
}

fn parse_score_lines(content: &str) -> Vec<SpamRuleScore> {
    let mut scores = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("score ") {
            let parts: Vec<&str> = trimmed.splitn(4, char::is_whitespace).collect();
            if parts.len() >= 3 {
                if let Ok(s) = parts[2].parse::<f64>() {
                    let comment = if parts.len() >= 4 {
                        Some(parts[3].trim_start_matches('#').trim().to_string())
                    } else {
                        None
                    };
                    scores.push(SpamRuleScore {
                        name: parts[1].to_string(),
                        score: s,
                        comment,
                    });
                }
            }
        }
    }
    scores
}
