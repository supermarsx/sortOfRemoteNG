// ── sorng-mac/src/client.rs ───────────────────────────────────────────────────
//! SSH client wrapper for executing MAC management commands on remote hosts.

use crate::error::{MacError, MacResult};
use crate::types::MacConnectionConfig;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};

/// MAC management client – connects via SSH to manage MAC frameworks remotely.
pub struct MacClient {
    pub config: MacConnectionConfig,
    ssh: IntegrationSshSession,
}

impl MacClient {
    pub fn new(config: MacConnectionConfig) -> MacResult<Self> {
        if config.host.is_empty() {
            return Err(MacError::connection("Host cannot be empty"));
        }
        if config.ssh_user.is_empty() {
            return Err(MacError::connection("SSH user cannot be empty"));
        }
        let ssh = IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: &config.ssh_user,
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30),
        });
        Ok(Self { config, ssh })
    }

    /// Execute a command over SSH on the remote host.
    ///
    pub async fn run_command(&self, cmd: &str) -> MacResult<String> {
        log::debug!("Executing MAC command on {}", self.config.host);
        self.ssh
            .execute(
                cmd,
                Some(self.config.timeout_secs.unwrap_or(30).saturating_mul(1000)),
            )
            .await
            .map_err(MacError::ssh)
    }

    /// Execute a command with sudo wrapping.
    pub async fn run_sudo_command(&self, cmd: &str) -> MacResult<String> {
        if self.config.ssh_user == "root" {
            return self.run_command(cmd).await;
        }
        if self.config.sudo_password.is_some() {
            return Err(MacError::ssh(
                "password-based sudo is not supported safely; configure passwordless sudo or connect as root",
            ));
        }
        let sudo_cmd = format!("sudo -n -- sh -c {}", shell_quote(cmd));
        self.run_command(&sudo_cmd).await
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
