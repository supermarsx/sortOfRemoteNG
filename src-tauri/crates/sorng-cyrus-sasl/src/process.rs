// ── Cyrus SASL process management ────────────────────────────────────────────

use crate::client::CyrusSaslClient;
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;

pub struct CyrusSaslProcessManager;

impl CyrusSaslProcessManager {
    /// Start the saslauthd service.
    pub async fn start(client: &CyrusSaslClient) -> CyrusSaslResult<()> {
        let out = client
            .exec_ssh("sudo systemctl start saslauthd 2>&1 || sudo service saslauthd start 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to start saslauthd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Stop the saslauthd service.
    pub async fn stop(client: &CyrusSaslClient) -> CyrusSaslResult<()> {
        let out = client
            .exec_ssh("sudo systemctl stop saslauthd 2>&1 || sudo service saslauthd stop 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to stop saslauthd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Restart the saslauthd service.
    pub async fn restart(client: &CyrusSaslClient) -> CyrusSaslResult<()> {
        let out = client
            .exec_ssh(
                "sudo systemctl restart saslauthd 2>&1 || sudo service saslauthd restart 2>&1",
            )
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to restart saslauthd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Reload saslauthd configuration (HUP signal).
    pub async fn reload(client: &CyrusSaslClient) -> CyrusSaslResult<()> {
        let out = client
            .exec_ssh("sudo systemctl reload saslauthd 2>&1 || sudo kill -HUP $(pidof saslauthd | awk '{print $1}') 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::reload_failed(format!(
                "Failed to reload saslauthd: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Get the running status string of saslauthd.
    pub async fn status(client: &CyrusSaslClient) -> CyrusSaslResult<String> {
        let out = client
            .exec_ssh("systemctl is-active saslauthd 2>&1 || service saslauthd status 2>&1")
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    /// Get the Cyrus SASL version string.
    pub async fn version(client: &CyrusSaslClient) -> CyrusSaslResult<String> {
        client.version().await
    }

    /// Get comprehensive SASL info.
    pub async fn info(client: &CyrusSaslClient) -> CyrusSaslResult<SaslInfo> {
        let version = client
            .version()
            .await
            .unwrap_or_else(|_| "unknown".to_string());
        let mechs = client.list_mechanisms().await.unwrap_or_default();
        let status = client.saslauthd_status().await;
        let running = status.as_ref().map(|s| s.running).unwrap_or(false);

        // Detect plugin directory
        let plugin_out = client
            .exec_ssh(
                "ls -d /usr/lib/sasl2 /usr/lib64/sasl2 /usr/lib/x86_64-linux-gnu/sasl2 2>/dev/null | head -1",
            )
            .await;
        let plugin_dir = plugin_out
            .ok()
            .map(|o| o.stdout.trim().to_string())
            .filter(|s| !s.is_empty());

        Ok(SaslInfo {
            version,
            available_mechanisms: mechs,
            plugin_dir,
            config_dir: client.config_dir().to_string(),
            saslauthd_running: running,
        })
    }

    /// Test the overall SASL configuration.
    pub async fn test_config(client: &CyrusSaslClient) -> CyrusSaslResult<SaslTestResult> {
        // Check saslauthd is running
        let status = client.saslauthd_status().await?;
        if !status.running {
            return Ok(SaslTestResult {
                success: false,
                mechanism_used: None,
                message: "saslauthd is not running".to_string(),
            });
        }

        // Check config directory exists
        let config_exists = client
            .file_exists(client.config_dir())
            .await
            .unwrap_or(false);
        if !config_exists {
            return Ok(SaslTestResult {
                success: false,
                mechanism_used: None,
                message: format!(
                    "SASL config directory does not exist: {}",
                    client.config_dir()
                ),
            });
        }

        // Check mechanisms are available
        let mechs = client.list_mechanisms().await.unwrap_or_default();
        if mechs.is_empty() {
            return Ok(SaslTestResult {
                success: false,
                mechanism_used: None,
                message: "No SASL mechanisms available".to_string(),
            });
        }

        // Check saslauthd socket
        let socket_exists = client
            .exec_ssh("test -S /var/run/saslauthd/mux && echo yes || echo no")
            .await;
        let socket_ok = socket_exists
            .ok()
            .map(|o| o.stdout.trim() == "yes")
            .unwrap_or(false);

        if !socket_ok {
            return Ok(SaslTestResult {
                success: false,
                mechanism_used: None,
                message: "saslauthd socket not found at /var/run/saslauthd/mux".to_string(),
            });
        }

        Ok(SaslTestResult {
            success: true,
            mechanism_used: status.mechanism.clone(),
            message: format!(
                "SASL configuration OK. {} mechanisms available. saslauthd running (pid: {}).",
                mechs.len(),
                status.pid.unwrap_or(0)
            ),
        })
    }
}
