// ── OpenDKIM statistics management ───────────────────────────────────────────
//! Queries opendkim-stats and mail log for signing/verification metrics.

use crate::client::OpendkimClient;
use crate::error::{OpendkimError, OpendkimResult};
use crate::types::OpendkimStats;

pub struct StatsManager;

const STATS_TOOL_ABSENT: &str = "__SORNG_OPENDKIM_STATS_TOOL_ABSENT__";
const MAIL_LOG_ABSENT: &str = "__SORNG_MAIL_LOG_ABSENT__";

impl StatsManager {
    /// Get aggregated DKIM statistics by parsing opendkim stats data
    /// or the mail log.
    pub async fn get_stats(client: &OpendkimClient) -> OpendkimResult<OpendkimStats> {
        // Try opendkim-stats tool first
        let stats_out = client
            .exec_ssh(&format!(
                "if command -v opendkim-stats >/dev/null 2>&1; then opendkim-stats; \
                 else printf '%s' '{STATS_TOOL_ABSENT}'; fi"
            ))
            .await?;
        if stats_out.stdout != STATS_TOOL_ABSENT && !stats_out.stdout.trim().is_empty() {
            return Ok(parse_stats_output(&stats_out.stdout));
        }
        // Fall back to parsing syslog/mail.log for DKIM-related entries
        let signed = count_log_matches(client, "DKIM-Signature").await?;
        let verified = count_log_matches(client, "dkim=pass").await?;
        let bad = count_log_matches(client, "dkim=fail").await?;
        let errors = count_log_matches(client, "dkim=temperror\\|dkim=permerror").await?;
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
            .exec_ssh(
                "if [ -e /var/lib/opendkim/stats.dat ]; then \
                 sudo truncate -s 0 /var/lib/opendkim/stats.dat; fi",
            )
            .await?;
        Ok(())
    }

    /// Get the last N DKIM-related messages from the mail log.
    pub async fn get_last_messages(
        client: &OpendkimClient,
        count: u32,
    ) -> OpendkimResult<Vec<String>> {
        let cmd = format!(
            "matches=$(grep -i 'opendkim\\|dkim' /var/log/mail.log); code=$?; \
             if [ \"$code\" -eq 0 ]; then printf '%s\\n' \"$matches\" | tail -n {count}; \
             elif [ \"$code\" -ne 1 ]; then exit \"$code\"; fi"
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

async fn count_log_matches(client: &OpendkimClient, pattern: &str) -> OpendkimResult<u64> {
    let command = format!(
        "if [ ! -e /var/log/mail.log ]; then printf '%s' '{MAIL_LOG_ABSENT}'; \
         elif [ ! -r /var/log/mail.log ]; then printf '%s\\n' 'Mail log is not readable' >&2; exit 66; \
         else count=$(grep -c '{pattern}' /var/log/mail.log); code=$?; \
         if [ \"$code\" -eq 0 ] || [ \"$code\" -eq 1 ]; then printf '%s\\n' \"$count\"; \
         else exit \"$code\"; fi; fi"
    );
    let raw = client.exec_ssh(&command).await?.stdout;
    if raw == MAIL_LOG_ABSENT {
        return Ok(0);
    }
    raw.trim().parse::<u64>().map_err(|error| {
        OpendkimError::parse(format!(
            "Invalid OpenDKIM log count for pattern {pattern:?}: {error}; output was {raw:?}"
        ))
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::OpendkimConnectionConfig;

    fn config() -> OpendkimConnectionConfig {
        crate::client::test_connection_config()
    }

    #[tokio::test]
    async fn reset_stats_does_not_hide_mutation_failure() {
        let (client, _) = OpendkimClient::scripted(
            config(),
            vec![Err(
                "Command failed with exit code 1: operation not permitted".into(),
            )],
        );

        let error = StatsManager::reset_stats(&client).await.unwrap_err();
        assert!(error.message.contains("operation not permitted"));
    }

    #[tokio::test]
    async fn malformed_log_count_is_not_reported_as_zero() {
        let (client, _) = OpendkimClient::scripted(
            config(),
            vec![Ok(STATS_TOOL_ABSENT.into()), Ok("not-a-number".into())],
        );

        let error = StatsManager::get_stats(&client).await.unwrap_err();
        assert!(matches!(
            error.kind,
            crate::error::OpendkimErrorKind::ParseError
        ));
    }
}
