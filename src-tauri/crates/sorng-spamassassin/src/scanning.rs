// ── SpamAssassin message scanning ────────────────────────────────────────────

use crate::client::{shell_escape, SpamAssassinClient};
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

pub struct ScanManager;

impl ScanManager {
    /// Check a message for spam by piping it to spamc.
    pub async fn check_message(
        client: &SpamAssassinClient,
        message: &str,
    ) -> SpamAssassinResult<SpamCheckResult> {
        let escaped = message.replace('\'', "'\\''");
        let cmd = format!("echo '{}' | {} -R", escaped, client.spamc_bin());
        let out = client.exec_ssh(&cmd).await?;
        parse_spam_report(&out.stdout)
    }

    /// Check a file for spam using spamc.
    pub async fn check_file(
        client: &SpamAssassinClient,
        path: &str,
    ) -> SpamAssassinResult<SpamCheckResult> {
        let cmd = format!("{} -R < {}", client.spamc_bin(), shell_escape(path));
        let out = client.exec_ssh(&cmd).await?;
        parse_spam_report(&out.stdout)
    }

    /// Report a message as spam to collaborative networks (Razor, Pyzor, DCC).
    pub async fn report(client: &SpamAssassinClient, message: &str) -> SpamAssassinResult<String> {
        let escaped = message.replace('\'', "'\\''");
        let cmd = format!("echo '{}' | {} -r", escaped, client.spamc_bin());
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::process(format!(
                "report failed: {}",
                out.stderr
            )));
        }
        Ok(out.stdout.trim().to_string())
    }

    /// Revoke a previous spam report (tell collaborative networks this is ham).
    pub async fn revoke(client: &SpamAssassinClient, message: &str) -> SpamAssassinResult<String> {
        let escaped = message.replace('\'', "'\\''");
        let cmd = format!("echo '{}' | {} -k", escaped, client.spamc_bin());
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::process(format!(
                "revoke failed: {}",
                out.stderr
            )));
        }
        Ok(out.stdout.trim().to_string())
    }
}

// ─── Parse helpers ───────────────────────────────────────────────────────────

fn parse_spam_report(output: &str) -> SpamAssassinResult<SpamCheckResult> {
    let mut is_spam = false;
    let mut score = 0.0f64;
    let mut threshold = 5.0f64;
    let mut rules_hit = Vec::new();
    let mut report_lines = Vec::new();
    let mut in_rules = false;

    for line in output.lines() {
        let trimmed = line.trim();

        // First line: "Spam detection software, running on the system..."
        // Status line: "Content analysis details:   (X.X points, Y.Y required)"
        if trimmed.starts_with("Spam detection software") {
            continue;
        }

        // Status/score line variants:
        // "This mail is probably spam." or "This mail is not spam."
        if trimmed.contains("is probably spam") || trimmed.contains("is spam") {
            is_spam = true;
        }

        // Score line: "Content analysis details:   (5.4 points, 5.0 required)"
        if trimmed.contains("points,") && trimmed.contains("required") {
            let inner = trimmed
                .split('(')
                .nth(1)
                .unwrap_or("")
                .split(')')
                .next()
                .unwrap_or("");
            let parts: Vec<&str> = inner.split(',').collect();
            if let Some(score_part) = parts.first() {
                let s = score_part.trim().trim_end_matches(" points");
                if let Ok(val) = s.parse::<f64>() {
                    score = val;
                }
            }
            if let Some(thresh_part) = parts.get(1) {
                let t = thresh_part.trim().trim_end_matches(" required");
                if let Ok(val) = t.parse::<f64>() {
                    threshold = val;
                }
            }
            is_spam = score >= threshold;
        }

        // Alternate header format: "X-Spam-Status: Yes, score=X.X required=Y.Y"
        if trimmed.starts_with("X-Spam-Status:") {
            if trimmed.contains("Yes") {
                is_spam = true;
            }
            if let Some(s) = extract_header_value(trimmed, "score=") {
                score = s;
            }
            if let Some(t) = extract_header_value(trimmed, "required=") {
                threshold = t;
            }
        }

        // Rule hit lines in the report section:
        // " pts rule name              description"
        // "  2.5 RULE_NAME              Some description"
        if in_rules {
            let parts: Vec<&str> = trimmed.splitn(3, char::is_whitespace).collect();
            if parts.len() >= 2 {
                if let Ok(rule_score) = parts[0].parse::<f64>() {
                    let rule_name = parts[1].to_string();
                    let description = parts.get(2).unwrap_or(&"").to_string();
                    let area = categorize_rule_area(&rule_name);
                    rules_hit.push(SpamRuleHit {
                        name: rule_name,
                        score: rule_score,
                        description,
                        area,
                    });
                }
            }
        }

        // Detect start of rules section
        if trimmed.starts_with("pts rule name") || trimmed.starts_with("--- ----") {
            in_rules = true;
            continue;
        }

        report_lines.push(trimmed.to_string());
    }

    Ok(SpamCheckResult {
        is_spam,
        score,
        threshold,
        rules_hit,
        report: report_lines.join("\n"),
    })
}

fn extract_header_value(line: &str, key: &str) -> Option<f64> {
    if let Some(idx) = line.find(key) {
        let rest = &line[idx + key.len()..];
        let val_str = rest
            .split(|c: char| c.is_whitespace() || c == ',')
            .next()
            .unwrap_or("");
        val_str.parse::<f64>().ok()
    } else {
        None
    }
}

fn categorize_rule_area(rule_name: &str) -> String {
    if rule_name.starts_with("HEADER_") || rule_name.starts_with("HDR_") {
        "HEADER".to_string()
    } else if rule_name.starts_with("BODY_") {
        "BODY".to_string()
    } else if rule_name.starts_with("URI_") || rule_name.starts_with("URIBL_") {
        "URI".to_string()
    } else if rule_name.starts_with("BAYES_") {
        "BAYES".to_string()
    } else if rule_name.starts_with("DKIM_") || rule_name.starts_with("SPF_") {
        "AUTHENTICATION".to_string()
    } else if rule_name.starts_with("RCVD_") {
        "RECEIVED".to_string()
    } else if rule_name.starts_with("HTML_") {
        "HTML".to_string()
    } else if rule_name.starts_with("MIME_") {
        "MIME".to_string()
    } else if rule_name.starts_with("T_") {
        "TEST".to_string()
    } else {
        "GENERAL".to_string()
    }
}
