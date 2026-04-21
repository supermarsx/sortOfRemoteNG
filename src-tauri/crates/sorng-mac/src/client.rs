// ── sorng-mac/src/client.rs ───────────────────────────────────────────────────
//! SSH client wrapper for executing MAC management commands on remote hosts.

use crate::error::{MacError, MacResult};
use crate::types::MacConnectionConfig;

/// MAC management client – connects via SSH to manage MAC frameworks remotely.
pub struct MacClient {
    pub config: MacConnectionConfig,
}

impl MacClient {
    pub fn new(config: MacConnectionConfig) -> MacResult<Self> {
        if config.host.is_empty() {
            return Err(MacError::connection("Host cannot be empty"));
        }
        if config.ssh_user.is_empty() {
            return Err(MacError::connection("SSH user cannot be empty"));
        }
        Ok(Self { config })
    }

    /// Execute a command over SSH on the remote host.
    ///
    /// Placeholder implementation — in production this would call through
    /// the app's SSH subsystem.
    pub async fn run_command(&self, cmd: &str) -> MacResult<String> {
        log::debug!("MAC command on {}: {}", self.config.host, cmd);
        // Stub: returns empty string — real implementation would use SSH
        Ok(String::new())
    }

    /// Execute a command with sudo wrapping.
    pub async fn run_sudo_command(&self, cmd: &str) -> MacResult<String> {
        let sudo_cmd = if let Some(ref _pw) = self.config.sudo_password {
            format!("sudo -S {}", cmd)
        } else {
            format!("sudo {}", cmd)
        };
        self.run_command(&sudo_cmd).await
    }
}
