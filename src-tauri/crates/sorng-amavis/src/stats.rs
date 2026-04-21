// ── amavis stats / monitoring ────────────────────────────────────────────────

use crate::client::AmavisClient;
use crate::error::AmavisResult;
use crate::types::*;

pub struct StatsManager;

impl StatsManager {
    /// Get overall Amavis statistics by parsing log data and process info.
    pub async fn get_stats(client: &AmavisClient) -> AmavisResult<AmavisStats> {
        // Attempt to get stats from amavisd-agent or parse from logs
        let agent_out = client
            .ssh_exec("amavisd-agent 2>/dev/null || echo 'unavailable'")
            .await
            .ok()
            .map(|o| o.stdout)
            .unwrap_or_default();

        let (
            msgs_total,
            msgs_clean,
            msgs_spam,
            msgs_virus,
            msgs_banned,
            msgs_bad_header,
            msgs_unchecked,
        ) = if agent_out.contains("unavailable") {
            // Fall back to parsing mail log
            parse_stats_from_log(client).await
        } else {
            parse_agent_stats(&agent_out)
        };

        // Get process information for active/idle children
        let ps_out = client
            .ssh_exec("ps aux | grep '[a]mavisd' | wc -l")
            .await
            .ok()
            .map(|o| o.stdout.trim().parse::<u32>().unwrap_or(0))
            .unwrap_or(0);

        let uptime_out = client
            .ssh_exec(
                "ps -o etimes= -p $(pgrep -x amavisd 2>/dev/null || pgrep -x amavisd-new 2>/dev/null || echo 1) 2>/dev/null | head -1 | tr -d ' '"
            )
            .await
            .ok()
            .and_then(|o| o.stdout.trim().parse::<u64>().ok())
            .unwrap_or(0);

        // Estimate active vs idle based on process states
        let active_out = client
            .ssh_exec(
                "ps -C amavisd -o stat= 2>/dev/null || ps -C amavisd-new -o stat= 2>/dev/null",
            )
            .await
            .ok()
            .map(|o| o.stdout)
            .unwrap_or_default();

        let children_active = active_out
            .lines()
            .filter(|l| {
                let s = l.trim();
                s.starts_with('R') || s.starts_with('D')
            })
            .count() as u32;
        let children_idle = ps_out.saturating_sub(children_active).saturating_sub(1); // subtract master

        Ok(AmavisStats {
            msgs_total,
            msgs_clean,
            msgs_spam,
            msgs_virus,
            msgs_banned,
            msgs_bad_header,
            msgs_unchecked,
            avg_process_time_ms: 0.0, // computed from throughput if available
            uptime_secs: uptime_out,
            children_active,
            children_idle,
        })
    }

    /// Get a list of child processes.
    pub async fn get_child_processes(
        client: &AmavisClient,
    ) -> AmavisResult<Vec<AmavisChildProcess>> {
        let out = client
            .ssh_exec(
                "ps -C amavisd -o pid=,stat=,etimes= 2>/dev/null || ps -C amavisd-new -o pid=,stat=,etimes= 2>/dev/null"
            )
            .await?;

        let mut children = Vec::new();
        for line in out.stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 {
                continue;
            }
            let pid = match parts[0].parse::<u32>() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let state = parts[1].to_string();
            let uptime = parts
                .get(2)
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            let started_at = chrono::Utc::now()
                .checked_sub_signed(chrono::Duration::seconds(uptime as i64))
                .map(|dt| dt.to_rfc3339());

            children.push(AmavisChildProcess {
                pid,
                state,
                msgs_processed: 0, // not easily available without amavisd-agent
                started_at,
            });
        }
        Ok(children)
    }

    /// Get throughput metrics.
    pub async fn get_throughput(client: &AmavisClient) -> AmavisResult<AmavisThroughput> {
        // Parse recent log entries to calculate throughput
        let out = client
            .ssh_exec(
                "journalctl -u amavisd --since '5 min ago' --no-pager 2>/dev/null | grep -c 'Passed\\|Blocked' || grep -c 'amavis.*Passed\\|amavis.*Blocked' /var/log/mail.log 2>/dev/null || echo 0"
            )
            .await?;

        let msgs_in_window = out.stdout.trim().parse::<f64>().unwrap_or(0.0);
        let msgs_per_minute = msgs_in_window / 5.0;

        // Estimate bytes per minute from average message size
        let avg_size_out = client
            .ssh_exec(
                "journalctl -u amavisd --since '5 min ago' --no-pager 2>/dev/null | grep -oP 'Hits: [^,]+, size: \\K[0-9]+' | awk '{s+=$1; n++} END {if(n>0) print s/n; else print 0}' || echo 0"
            )
            .await?;
        let avg_size = avg_size_out.stdout.trim().parse::<f64>().unwrap_or(0.0);
        let bytes_per_minute = msgs_per_minute * avg_size;

        // Estimate latency from log timestamps
        let latency_out = client
            .ssh_exec(
                "journalctl -u amavisd --since '5 min ago' --no-pager 2>/dev/null | grep -oP '\\(\\K[0-9]+\\s+ms\\)' | head -20 | awk '{s+=$1; n++} END {if(n>0) print s/n; else print 0}' || echo 0"
            )
            .await?;
        let avg_latency_ms = latency_out.stdout.trim().parse::<f64>().unwrap_or(0.0);

        Ok(AmavisThroughput {
            msgs_per_minute,
            bytes_per_minute,
            avg_latency_ms,
        })
    }

    /// Reset statistics (restart the amavisd-agent counters).
    pub async fn reset_stats(client: &AmavisClient) -> AmavisResult<()> {
        // amavisd-agent doesn't have a built-in reset, so we restart the agent
        let out = client
            .ssh_exec("sudo systemctl restart amavisd-snmp-subagent 2>/dev/null; echo ok")
            .await?;
        if out.exit_code != 0 {
            log::warn!("Stats reset may not have fully succeeded: {}", out.stderr);
        }
        Ok(())
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async fn parse_stats_from_log(client: &AmavisClient) -> (u64, u64, u64, u64, u64, u64, u64) {
    let out = client
        .ssh_exec(
            "journalctl -u amavisd --since 'today' --no-pager 2>/dev/null || tail -10000 /var/log/mail.log 2>/dev/null | grep amavis"
        )
        .await
        .ok()
        .map(|o| o.stdout)
        .unwrap_or_default();

    let mut total = 0u64;
    let mut clean = 0u64;
    let mut spam = 0u64;
    let mut virus = 0u64;
    let mut banned = 0u64;
    let mut bad_header = 0u64;

    for line in out.lines() {
        if line.contains("Passed CLEAN") || line.contains("Passed clean") {
            clean += 1;
            total += 1;
        } else if line.contains("Blocked SPAM") || line.contains("Blocked spam") {
            spam += 1;
            total += 1;
        } else if line.contains("Blocked INFECTED") || line.contains("Blocked virus") {
            virus += 1;
            total += 1;
        } else if line.contains("Blocked BANNED") {
            banned += 1;
            total += 1;
        } else if line.contains("Blocked BAD-HEADER") {
            bad_header += 1;
            total += 1;
        } else if line.contains("Passed") || line.contains("Blocked") {
            total += 1;
        }
    }

    let unchecked = total.saturating_sub(clean + spam + virus + banned + bad_header);
    (total, clean, spam, virus, banned, bad_header, unchecked)
}

fn parse_agent_stats(output: &str) -> (u64, u64, u64, u64, u64, u64, u64) {
    let mut total = 0u64;
    let mut clean = 0u64;
    let mut spam = 0u64;
    let mut virus = 0u64;
    let mut banned = 0u64;
    let mut bad_header = 0u64;

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let value = parts
            .last()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let key = parts[0].to_lowercase();
        if key.contains("total") {
            total = value;
        } else if key.contains("clean") || key.contains("passed") {
            clean = value;
        } else if key.contains("spam") {
            spam = value;
        } else if key.contains("virus") || key.contains("infected") {
            virus = value;
        } else if key.contains("banned") {
            banned = value;
        } else if key.contains("bad-header") || key.contains("badh") {
            bad_header = value;
        }
    }

    let unchecked = total.saturating_sub(clean + spam + virus + banned + bad_header);
    (total, clean, spam, virus, banned, bad_header, unchecked)
}
