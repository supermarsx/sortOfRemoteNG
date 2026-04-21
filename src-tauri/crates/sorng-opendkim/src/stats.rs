// ── OpenDKIM statistics management ───────────────────────────────────────────
//! Queries opendkim-stats and mail log for signing/verification metrics.

use crate::client::OpendkimClient;
use crate::error::OpendkimResult;
use crate::types::OpendkimStats;

pub struct StatsManager;

impl StatsManager {
    /// Get aggregated DKIM statistics by parsing opendkim stats data
    /// or the mail log.
    pub async fn get_stats(client: &OpendkimClient) -> OpendkimResult<OpendkimStats> {
        // Try opendkim-stats tool first
        let stats_out = client
            .exec_ssh("opendkim-stats 2>/dev/null || true")
            .await?;
        if !stats_out.stdout.trim().is_empty() {
            return Ok(parse_stats_output(&stats_out.stdout));
        }
        // Fall back to parsing syslog/mail.log for DKIM-related entries
        let log_out = client
            .exec_ssh("grep -c 'DKIM-Signature' /var/log/mail.log 2>/dev/null || echo 0")
            .await?;
        let signed: u64 = log_out.stdout.trim().parse().unwrap_or(0);
        let verified_out = client
            .exec_ssh("grep -c 'dkim=pass' /var/log/mail.log 2>/dev/null || echo 0")
            .await?;
        let verified: u64 = verified_out.stdout.trim().parse().unwrap_or(0);
        let bad_out = client
            .exec_ssh("grep -c 'dkim=fail' /var/log/mail.log 2>/dev/null || echo 0")
            .await?;
        let bad: u64 = bad_out.stdout.trim().parse().unwrap_or(0);
        let error_out = client
            .exec_ssh(
                "grep -c 'dkim=temperror\\|dkim=permerror' /var/log/mail.log 2>/dev/null || echo 0",
            )
            .await?;
        let errors: u64 = error_out.stdout.trim().parse().unwrap_or(0);
        Ok(OpendkimStats {
            messages_signed: signed,
            messages_verified: verified,
            signatures_good: verified,
            signatures_bad: bad,
            signatures_error: errors,
            dns_queries: 0,
        })
    }

    /// Reset statistics (rotate or truncate stats file).
    pub async fn reset_stats(client: &OpendkimClient) -> OpendkimResult<()> {
        // If a stats file exists, truncate it
        client
            .exec_ssh("sudo truncate -s 0 /var/lib/opendkim/stats.dat 2>/dev/null || true")
            .await?;
        Ok(())
    }

    /// Get the last N DKIM-related messages from the mail log.
    pub async fn get_last_messages(
        client: &OpendkimClient,
        count: u32,
    ) -> OpendkimResult<Vec<String>> {
        let cmd = format!(
            "grep -i 'opendkim\\|dkim' /var/log/mail.log 2>/dev/null | tail -n {}",
            count
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn parse_stats_output(raw: &str) -> OpendkimStats {
    let mut stats = OpendkimStats {
        messages_signed: 0,
        messages_verified: 0,
        signatures_good: 0,
        signatures_bad: 0,
        signatures_error: 0,
        dns_queries: 0,
    };
    for line in raw.lines() {
        let line = line.trim().to_lowercase();
        if line.contains("signed") {
            if let Some(n) = extract_number(&line) {
                stats.messages_signed = n;
            }
        } else if line.contains("verified") {
            if let Some(n) = extract_number(&line) {
                stats.messages_verified = n;
            }
        } else if line.contains("good") {
            if let Some(n) = extract_number(&line) {
                stats.signatures_good = n;
            }
        } else if line.contains("bad") || line.contains("fail") {
            if let Some(n) = extract_number(&line) {
                stats.signatures_bad = n;
            }
        } else if line.contains("error") {
            if let Some(n) = extract_number(&line) {
                stats.signatures_error = n;
            }
        } else if line.contains("dns") || line.contains("queries") {
            if let Some(n) = extract_number(&line) {
                stats.dns_queries = n;
            }
        }
    }
    stats
}

fn extract_number(line: &str) -> Option<u64> {
    line.split_whitespace()
        .find_map(|w| w.trim_end_matches(':').parse::<u64>().ok())
}
