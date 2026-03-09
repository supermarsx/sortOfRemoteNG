// ── SpamAssassin process management ──────────────────────────────────────────

use crate::client::SpamAssassinClient;
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

pub struct SpamAssassinProcessManager;

impl SpamAssassinProcessManager {
    /// Start spamd service via systemctl.
    pub async fn start(client: &SpamAssassinClient) -> SpamAssassinResult<()> {
        let out = client.exec_ssh("sudo systemctl start spamassassin").await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::process(format!(
                "start failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Stop spamd service via systemctl.
    pub async fn stop(client: &SpamAssassinClient) -> SpamAssassinResult<()> {
        let out = client.exec_ssh("sudo systemctl stop spamassassin").await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::process(format!(
                "stop failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Restart spamd service via systemctl.
    pub async fn restart(client: &SpamAssassinClient) -> SpamAssassinResult<()> {
        let out = client
            .exec_ssh("sudo systemctl restart spamassassin")
            .await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::process(format!(
                "restart failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Reload spamd configuration without full restart.
    pub async fn reload(client: &SpamAssassinClient) -> SpamAssassinResult<()> {
        client.reload().await
    }

    /// Get spamd daemon status including PID, children count, and uptime.
    pub async fn status(client: &SpamAssassinClient) -> SpamAssassinResult<SpamdStatus> {
        let is_active = client
            .exec_ssh("systemctl is-active spamassassin 2>&1")
            .await;
        let running = is_active
            .as_ref()
            .map(|o| o.stdout.trim() == "active")
            .unwrap_or(false);

        let mut pid = None;
        let mut children = 0u32;
        let mut connections_served = 0u64;
        let mut uptime_secs = None;

        if running {
            // Get PID
            let pid_out = client.exec_ssh("pgrep -f spamd | head -1").await;
            if let Ok(ref o) = pid_out {
                pid = o.stdout.trim().parse::<u32>().ok();
            }

            // Get child count
            let children_out = client.exec_ssh("pgrep -f 'spamd child' | wc -l").await;
            if let Ok(ref o) = children_out {
                children = o.stdout.trim().parse().unwrap_or(0);
            }

            // Get uptime from systemctl show
            let uptime_out = client
                .exec_ssh(
                    "systemctl show spamassassin --property=ActiveEnterTimestamp --no-pager 2>/dev/null",
                )
                .await;
            if let Ok(ref o) = uptime_out {
                let ts = o
                    .stdout
                    .trim()
                    .trim_start_matches("ActiveEnterTimestamp=")
                    .trim();
                if !ts.is_empty() {
                    // Try to compute seconds since start
                    let now_out = client.exec_ssh("date +%s").await;
                    let start_out = client.exec_ssh(&format!("date -d '{}' +%s", ts)).await;
                    if let (Ok(now), Ok(start)) = (now_out, start_out) {
                        if let (Ok(n), Ok(s)) = (
                            now.stdout.trim().parse::<u64>(),
                            start.stdout.trim().parse::<u64>(),
                        ) {
                            uptime_secs = Some(n.saturating_sub(s));
                        }
                    }
                }
            }

            // Get connections served from spamd log or /proc
            let conn_out = client
                .exec_ssh(
                    "journalctl -u spamassassin --no-pager -n 10000 2>/dev/null | grep -c 'connection from'",
                )
                .await;
            if let Ok(ref o) = conn_out {
                connections_served = o.stdout.trim().parse().unwrap_or(0);
            }
        }

        Ok(SpamdStatus {
            running,
            pid,
            children,
            connections_served,
            uptime_secs,
        })
    }

    /// Get SpamAssassin version string.
    pub async fn version(client: &SpamAssassinClient) -> SpamAssassinResult<String> {
        client.version().await
    }

    /// Get detailed SpamAssassin server information.
    pub async fn info(client: &SpamAssassinClient) -> SpamAssassinResult<SpamAssassinInfo> {
        let version = client
            .version()
            .await
            .unwrap_or_else(|_| "unknown".to_string());

        // Get rules version
        let rules_out = client
            .exec_ssh("ls /var/lib/spamassassin/ 2>/dev/null | sort -n | tail -1")
            .await;
        let rules_version = rules_out.ok().map(|o| o.stdout.trim().to_string());

        let config_path = client.config_dir().to_string();
        let local_cf = client.local_cf_path().to_string();

        // Get user_prefs path from config
        let prefs_out = client
            .exec_ssh("grep -r 'user_prefs' /etc/spamassassin/ 2>/dev/null | head -1")
            .await;
        let user_prefs_path = prefs_out.ok().and_then(|o| {
            let line = o.stdout.trim();
            if line.is_empty() {
                None
            } else {
                line.split_whitespace().last().map(|s| s.to_string())
            }
        });

        Ok(SpamAssassinInfo {
            version,
            rules_version,
            config_path,
            local_cf,
            user_prefs_path,
        })
    }

    /// Lint/check SpamAssassin configuration via `spamassassin --lint`.
    pub async fn lint(client: &SpamAssassinClient) -> SpamAssassinResult<ConfigTestResult> {
        let out = client.exec_ssh("sudo spamassassin --lint 2>&1").await?;

        let mut errors = Vec::new();
        let combined = format!("{}\n{}", out.stdout, out.stderr);

        for line in combined.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // SpamAssassin lint output categorizes issues with prefixes:
            // "warn:", "error:", "config: ..."
            if trimmed.starts_with("warn:")
                || trimmed.starts_with("error:")
                || trimmed.starts_with("config:")
            {
                errors.push(trimmed.to_string());
            }
        }

        Ok(ConfigTestResult {
            success: out.exit_code == 0 && errors.is_empty(),
            output: combined.trim().to_string(),
            errors,
        })
    }
}
