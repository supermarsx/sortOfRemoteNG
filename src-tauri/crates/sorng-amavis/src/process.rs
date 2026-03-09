// ── amavis process management ────────────────────────────────────────────────

use crate::client::AmavisClient;
use crate::error::{AmavisError, AmavisResult};
use crate::types::*;

pub struct AmavisProcessManager;

impl AmavisProcessManager {
    /// Start the amavisd service.
    pub async fn start(client: &AmavisClient) -> AmavisResult<()> {
        let out = client
            .ssh_exec("sudo systemctl start amavisd 2>&1 || sudo systemctl start amavis 2>&1 || sudo /etc/init.d/amavis start 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::process(format!(
                "Failed to start amavisd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Stop the amavisd service.
    pub async fn stop(client: &AmavisClient) -> AmavisResult<()> {
        let out = client
            .ssh_exec("sudo systemctl stop amavisd 2>&1 || sudo systemctl stop amavis 2>&1 || sudo /etc/init.d/amavis stop 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::process(format!(
                "Failed to stop amavisd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Restart the amavisd service.
    pub async fn restart(client: &AmavisClient) -> AmavisResult<()> {
        let out = client
            .ssh_exec("sudo systemctl restart amavisd 2>&1 || sudo systemctl restart amavis 2>&1 || sudo /etc/init.d/amavis restart 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::process(format!(
                "Failed to restart amavisd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Reload amavisd configuration without restarting.
    pub async fn reload(client: &AmavisClient) -> AmavisResult<()> {
        let out = client
            .ssh_exec("sudo amavisd-new reload 2>&1 || sudo systemctl reload amavisd 2>&1 || kill -HUP $(pgrep -x amavisd 2>/dev/null) 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::process(format!(
                "Failed to reload amavisd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Get the current status/process information.
    pub async fn status(client: &AmavisClient) -> AmavisResult<AmavisProcessInfo> {
        let active_out = client
            .ssh_exec("systemctl is-active amavisd 2>/dev/null || systemctl is-active amavis 2>/dev/null || echo inactive")
            .await?;
        let running = active_out.stdout.trim() == "active";

        let pid = if running {
            client
                .ssh_exec(
                    "pgrep -x amavisd 2>/dev/null || pgrep -x amavisd-new 2>/dev/null || echo ''",
                )
                .await
                .ok()
                .and_then(|o| {
                    o.stdout
                        .trim()
                        .lines()
                        .next()
                        .and_then(|l| l.parse::<u32>().ok())
                })
        } else {
            None
        };

        let version = client.version().await.ok();

        let config_file = client
            .ssh_exec("amavisd-new showkeys 2>&1 | head -1 | grep -oP 'using config file \\K.*' || echo '/etc/amavisd/amavisd.conf'")
            .await
            .ok()
            .map(|o| o.stdout.trim().to_string());

        let uptime_secs = if running {
            pid.and({
                // we don't have the output yet, but structure the command
                None::<u64> // Computed below
            });
            client
                .ssh_exec(
                    "ps -o etimes= -p $(pgrep -x amavisd 2>/dev/null || pgrep -x amavisd-new 2>/dev/null || echo 1) 2>/dev/null | head -1 | tr -d ' '"
                )
                .await
                .ok()
                .and_then(|o| o.stdout.trim().parse::<u64>().ok())
        } else {
            None
        };

        Ok(AmavisProcessInfo {
            pid,
            running,
            version,
            config_file,
            uptime_secs,
        })
    }

    /// Get the amavisd version string.
    pub async fn version(client: &AmavisClient) -> AmavisResult<String> {
        client.version().await
    }

    /// Run a debug SpamAssassin test on a message via amavisd-new.
    pub async fn debug_sa(client: &AmavisClient, message: &str) -> AmavisResult<String> {
        let escaped = message.replace('\'', "'\\''");
        let cmd = format!(
            "echo '{}' | amavisd-new -c /etc/amavisd/amavisd.conf debug-sa 2>&1 || echo '{}' | amavisd debug-sa 2>&1",
            escaped, escaped
        );
        let out = client.ssh_exec(&cmd).await?;
        Ok(out.stdout)
    }

    /// Dump the running amavisd configuration.
    pub async fn show_config(client: &AmavisClient) -> AmavisResult<String> {
        let out = client
            .ssh_exec("amavisd-new showkeys 2>&1; echo '---'; amavisd-new -c /etc/amavisd/amavisd.conf showkeys 2>&1 || amavisd showkeys 2>&1")
            .await?;
        Ok(out.stdout)
    }
}
