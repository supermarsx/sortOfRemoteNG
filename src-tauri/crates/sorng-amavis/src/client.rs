// ── sorng-amavis – SSH/CLI client ─────────────────────────────────────────────
//! Executes Amavis commands on a remote host via SSH.
//! Handles config file reading/writing, process control, and runtime queries.

use crate::error::{AmavisError, AmavisResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
use std::sync::Arc;

#[async_trait::async_trait]
pub(crate) trait SshTransport: Send + Sync {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String>;
    async fn disconnect(&self) -> Result<(), String>;
    async fn is_connected(&self) -> bool;
}

#[async_trait::async_trait]
impl SshTransport for IntegrationSshSession {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String> {
        IntegrationSshSession::execute(self, command, timeout_ms).await
    }
    async fn disconnect(&self) -> Result<(), String> {
        IntegrationSshSession::disconnect(self).await
    }
    async fn is_connected(&self) -> bool {
        IntegrationSshSession::is_connected(self).await
    }
}

/// Amavis management client – connects via SSH to manage amavisd-new remotely.
pub struct AmavisClient {
    pub config: AmavisConnectionConfig,
    ssh: Arc<dyn SshTransport>,
}

impl AmavisClient {
    /// Create a new client with the given connection configuration.
    /// Connection is lazily established on first command execution.
    pub fn new(config: AmavisConnectionConfig) -> AmavisResult<Self> {
        let ssh = Arc::new(IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: &config.username,
            port: config.port,
            private_key: config.private_key.as_deref(),
            password: config.password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30),
        }));
        Ok(Self { config, ssh })
    }

    #[cfg(test)]
    pub(crate) fn with_test_transport(
        config: AmavisConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> Self {
        Self { config, ssh }
    }

    // ── SSH command execution stub ───────────────────────────────
    //
    // In production these call through the app's SSH infrastructure.
    // Modelled as async methods returning structured types.

    /// Execute a command via SSH and return the output.
    pub async fn ssh_exec(&self, command: &str) -> AmavisResult<SshOutput> {
        debug!("Executing Amavis SSH command on {}", self.config.host);

        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(AmavisError::ssh)?;

        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    /// Read a remote file's contents via SSH.
    pub async fn read_file(&self, path: &str) -> AmavisResult<String> {
        let out = self
            .ssh_exec(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn read_file_if_exists(&self, path: &str) -> AmavisResult<Option<String>> {
        const MISSING: &str = "__SORNG_FILE_NOT_FOUND__";
        let escaped = shell_escape(path);
        let out = self
            .ssh_exec(&format!(
                "if [ -f {escaped} ]; then cat -- {escaped}; elif [ ! -e {escaped} ]; then printf '%s' '{MISSING}'; else echo 'Path is not a regular file' >&2; exit 1; fi"
            ))
            .await?;
        if out.stdout == MISSING {
            Ok(None)
        } else {
            Ok(Some(out.stdout))
        }
    }

    /// Write content to a remote file via SSH.
    pub async fn write_file(&self, path: &str, content: &str) -> AmavisResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.ssh_exec(&cmd).await?;
        Ok(())
    }

    /// Check whether a file exists on the remote host.
    pub async fn file_exists(&self, path: &str) -> AmavisResult<bool> {
        let out = self
            .ssh_exec(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── Amavis-specific helpers ──────────────────────────────────

    /// Ping the remote host and build a connection summary.
    pub async fn ping(&self) -> AmavisResult<AmavisConnectionSummary> {
        self.ssh_exec("true").await?;
        let version = Some(self.version().await?);
        let active_out = self
            .ssh_exec(
                "if systemctl show amavisd --property=LoadState --value 2>/dev/null | grep -qx loaded; then systemctl show amavisd --property=ActiveState --value; else systemctl show amavis --property=ActiveState --value; fi",
            )
            .await?;
        let running = active_out.stdout.trim() == "active";
        let uptime_secs = if running {
            let uptime = self
                .ssh_exec(
                    "pid=$(pgrep -x amavisd || pgrep -x amavisd-new) || exit $?; ps -o etimes= -p \"$pid\" | tr -d ' '",
                )
                .await?;
            Some(uptime.stdout.trim().parse::<u64>().map_err(|error| {
                AmavisError::parse(format!("Invalid Amavis uptime output: {error}"))
            })?)
        } else {
            None
        };
        Ok(AmavisConnectionSummary {
            host: self.config.host.clone(),
            version,
            running,
            uptime_secs,
        })
    }

    /// Retrieve the amavisd-new version string.
    pub async fn version(&self) -> AmavisResult<String> {
        let out = self
            .ssh_exec(
                "if command -v amavisd-new >/dev/null 2>&1; then amavisd-new --version 2>&1; elif command -v amavisd >/dev/null 2>&1; then amavisd --version 2>&1; else echo 'Amavis binary not found' >&2; exit 127; fi",
            )
            .await?;
        let raw = out.stdout.trim().to_string();
        // The version line is typically "amavisd-new-2.13.0 ..."
        let version = raw.lines().next().unwrap_or(&raw).trim().to_string();
        Ok(version)
    }

    pub async fn is_connected(&self) -> bool {
        self.ssh.is_connected().await
    }

    pub async fn disconnect(&self) -> AmavisResult<()> {
        self.ssh.disconnect().await.map_err(AmavisError::ssh)
    }
}

/// Escape a string for safe use in a POSIX shell command.
pub fn shell_escape(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    if s.chars().all(|c| {
        c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | ':' | '=' | '+' | ',')
    }) {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::SshTransport;
    use std::collections::VecDeque;
    use std::sync::Mutex;
    pub(crate) struct FakeSshTransport {
        outcomes: Mutex<VecDeque<Result<String, String>>>,
        commands: Mutex<Vec<String>>,
    }
    impl FakeSshTransport {
        pub(crate) fn new(outcomes: Vec<Result<String, String>>) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into()),
                commands: Mutex::new(Vec::new()),
            }
        }
        pub(crate) fn commands(&self) -> Vec<String> {
            self.commands.lock().unwrap().clone()
        }
    }
    #[async_trait::async_trait]
    impl SshTransport for FakeSshTransport {
        async fn execute(&self, command: &str, _: Option<u64>) -> Result<String, String> {
            self.commands.lock().unwrap().push(command.into());
            self.outcomes
                .lock()
                .unwrap()
                .pop_front()
                .expect("fake SSH outcome exhausted")
        }
        async fn disconnect(&self) -> Result<(), String> {
            Ok(())
        }
        async fn is_connected(&self) -> bool {
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_escape_simple() {
        assert_eq!(shell_escape("hello"), "hello");
    }

    #[test]
    fn test_shell_escape_empty() {
        assert_eq!(shell_escape(""), "''");
    }

    #[test]
    fn test_shell_escape_special() {
        assert_eq!(shell_escape("hello world"), "'hello world'");
    }

    #[test]
    fn test_shell_escape_single_quotes() {
        assert_eq!(shell_escape("it's"), "'it'\\''s'");
    }

    #[test]
    fn test_shell_escape_path() {
        assert_eq!(shell_escape("/etc/amavis/conf.d"), "/etc/amavis/conf.d");
    }

    #[tokio::test]
    async fn test_new_client() {
        let config = AmavisConnectionConfig {
            host: "mail.example.com".to_string(),
            port: 22,
            username: "root".to_string(),
            password: None,
            private_key: None,
            timeout_secs: Some(30),
        };
        let client = AmavisClient::new(config).unwrap();
        assert_eq!(client.config.host, "mail.example.com");
        assert!(!client.is_connected().await);
    }
}
