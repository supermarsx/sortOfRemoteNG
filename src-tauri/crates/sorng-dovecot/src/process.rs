// ── dovecot process management ───────────────────────────────────────────────

use crate::client::DovecotClient;
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

pub struct DovecotProcessManager;

impl DovecotProcessManager {
    /// Start dovecot service via systemctl.
    pub async fn start(client: &DovecotClient) -> DovecotResult<()> {
        let out = client.exec_ssh("sudo systemctl start dovecot").await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "start failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Stop dovecot service via doveadm or systemctl.
    pub async fn stop(client: &DovecotClient) -> DovecotResult<()> {
        let out = client.exec_ssh("sudo systemctl stop dovecot").await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "stop failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Restart dovecot service via systemctl.
    pub async fn restart(client: &DovecotClient) -> DovecotResult<()> {
        let out = client.exec_ssh("sudo systemctl restart dovecot").await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "restart failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Reload dovecot configuration via doveadm.
    pub async fn reload(client: &DovecotClient) -> DovecotResult<()> {
        client.reload().await
    }

    /// Get service status via systemctl.
    pub async fn status(client: &DovecotClient) -> DovecotResult<String> {
        let out = client.exec_ssh("systemctl is-active dovecot 2>&1").await?;
        Ok(out.stdout.trim().to_string())
    }

    /// Get dovecot version string.
    pub async fn version(client: &DovecotClient) -> DovecotResult<String> {
        client.version().await
    }

    /// Get detailed dovecot info via `dovecot --version` and `doveconf -n`.
    pub async fn info(client: &DovecotClient) -> DovecotResult<DovecotInfo> {
        let version = client
            .version()
            .await
            .unwrap_or_else(|_| "unknown".to_string());

        // Get protocols
        let protocols_out = client
            .exec_ssh(&format!(
                "sudo {} -h protocols 2>/dev/null",
                client.dovecot_bin()
            ))
            .await;
        let protocols: Vec<String> = protocols_out
            .ok()
            .map(|o| o.stdout.split_whitespace().map(String::from).collect())
            .unwrap_or_default();

        // Get SSL library
        let ssl_out = client
            .exec_ssh(&format!(
                "{} --build-options 2>&1 | grep -i ssl",
                client.dovecot_bin()
            ))
            .await;
        let ssl_library = ssl_out.ok().map(|o| o.stdout.trim().to_string());

        // Get mail plugins
        let plugins_out = client
            .exec_ssh(&format!(
                "sudo {} -h mail_plugins 2>/dev/null",
                client.dovecot_bin()
            ))
            .await;
        let mail_plugins: Vec<String> = plugins_out
            .ok()
            .map(|o| o.stdout.split_whitespace().map(String::from).collect())
            .unwrap_or_default();

        // Get auth mechanisms
        let auth_out = client
            .exec_ssh(&format!(
                "sudo {} -h auth_mechanisms 2>/dev/null",
                client.dovecot_bin()
            ))
            .await;
        let auth_mechanisms: Vec<String> = auth_out
            .ok()
            .map(|o| o.stdout.split_whitespace().map(String::from).collect())
            .unwrap_or_default();

        Ok(DovecotInfo {
            version,
            protocols,
            ssl_library,
            mail_plugins,
            auth_mechanisms,
            config_path: format!("{}/dovecot.conf", client.config_dir()),
        })
    }

    /// List who is connected via `doveadm who`.
    pub async fn who(client: &DovecotClient) -> DovecotResult<Vec<DovecotProcess>> {
        let out = client.doveadm("who").await?;
        let mut processes = Vec::new();
        for line in out.stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }
            processes.push(DovecotProcess {
                pid: parts.get(2).and_then(|p| p.parse().ok()).unwrap_or(0),
                service: parts.get(1).unwrap_or(&"").to_string(),
                user: Some(parts.first().unwrap_or(&"").to_string()),
                ip: parts.get(3).map(|s| s.to_string()),
                state: None,
                uptime_secs: None,
            });
        }
        Ok(processes)
    }

    /// Get doveadm stats via `doveadm stats dump`.
    pub async fn stats(client: &DovecotClient) -> DovecotResult<Vec<DovecotStats>> {
        let out = client.doveadm("stats dump").await?;
        let mut stats = Vec::new();

        for line in out.stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 4 {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 3 {
                    continue;
                }
                stats.push(DovecotStats {
                    user: parts.first().map(|s| s.to_string()),
                    command: parts.get(1).unwrap_or(&"").to_string(),
                    count: parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
                    last_used: parts.get(3).map(|s| s.to_string()),
                    bytes_in: parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
                    bytes_out: parts.get(5).and_then(|s| s.parse().ok()).unwrap_or(0),
                });
                continue;
            }

            stats.push(DovecotStats {
                user: parts.first().map(|s| s.trim().to_string()),
                command: parts.get(1).unwrap_or(&"").trim().to_string(),
                count: parts
                    .get(2)
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0),
                last_used: parts.get(3).map(|s| s.trim().to_string()),
                bytes_in: parts
                    .get(4)
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0),
                bytes_out: parts
                    .get(5)
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0),
            });
        }
        Ok(stats)
    }

    /// Test configuration via dovecot config test.
    pub async fn test_config(client: &DovecotClient) -> DovecotResult<ConfigTestResult> {
        crate::config::DovecotConfigManager::test_config(client).await
    }
}
