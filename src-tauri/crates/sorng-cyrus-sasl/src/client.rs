// ── sorng-cyrus-sasl – SSH/CLI client ────────────────────────────────────────
//! Executes Cyrus SASL commands on a remote host via SSH.
//! Handles saslauthd management, sasldb operations, and mechanism queries.

use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
use std::sync::Arc;

#[async_trait::async_trait]
pub(crate) trait SshTransport: Send + Sync {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String>;
    async fn disconnect(&self) -> Result<(), String>;
}
#[async_trait::async_trait]
impl SshTransport for IntegrationSshSession {
    async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String> {
        IntegrationSshSession::execute(self, command, timeout_ms).await
    }
    async fn disconnect(&self) -> Result<(), String> {
        IntegrationSshSession::disconnect(self).await
    }
}

/// Cyrus SASL management client – connects via SSH to manage SASL remotely.
pub struct CyrusSaslClient {
    pub config: CyrusSaslConnectionConfig,
    ssh: Arc<dyn SshTransport>,
}

impl CyrusSaslClient {
    pub fn new(config: CyrusSaslConnectionConfig) -> CyrusSaslResult<Self> {
        let ssh = Arc::new(IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30),
        }));
        Ok(Self { config, ssh })
    }
    #[cfg(test)]
    pub(crate) fn with_test_transport(
        config: CyrusSaslConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> Self {
        Self { config, ssh }
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn saslauthd_bin(&self) -> &str {
        self.config
            .saslauthd_bin
            .as_deref()
            .unwrap_or("/usr/sbin/saslauthd")
    }

    pub fn sasldblistusers_bin(&self) -> &str {
        self.config
            .sasldblistusers_bin
            .as_deref()
            .unwrap_or("/usr/sbin/sasldblistusers2")
    }

    pub fn saslpasswd_bin(&self) -> &str {
        self.config
            .saslpasswd_bin
            .as_deref()
            .unwrap_or("/usr/sbin/saslpasswd2")
    }

    pub fn config_dir(&self) -> &str {
        self.config.config_dir.as_deref().unwrap_or("/etc/sasl2")
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> CyrusSaslResult<SshOutput> {
        debug!("Executing Cyrus SASL SSH command on {}", self.config.host);
        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(CyrusSaslError::ssh)?;
        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn disconnect(&self) -> CyrusSaslResult<()> {
        self.ssh.disconnect().await.map_err(CyrusSaslError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> CyrusSaslResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }
    pub async fn read_remote_file_if_exists(&self, path: &str) -> CyrusSaslResult<Option<String>> {
        const MISSING: &str = "__SORNG_FILE_NOT_FOUND__";
        let escaped = shell_escape(path);
        let out = self
            .exec_ssh(&format!(
                "if [ -f {escaped} ]; then cat -- {escaped}; elif [ ! -e {escaped} ]; then printf '%s' '{MISSING}'; else echo 'Path is not a regular file' >&2; exit 1; fi"
            ))
            .await?;
        if out.stdout == MISSING {
            Ok(None)
        } else {
            Ok(Some(out.stdout))
        }
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> CyrusSaslResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> CyrusSaslResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── Core queries ─────────────────────────────────────────────────

    pub async fn version(&self) -> CyrusSaslResult<String> {
        let out = self
            .exec_ssh(
                "if command -v saslauthd >/dev/null 2>&1; then saslauthd -v 2>&1; elif command -v pluginviewer >/dev/null 2>&1; then pluginviewer --version 2>&1; else echo 'Cyrus SASL binaries not found' >&2; exit 127; fi",
            )
            .await?;
        let ver = out.stdout.lines().next().unwrap_or("").trim().to_string();
        if ver.is_empty() {
            return Err(CyrusSaslError::parse("Cyrus SASL version output was empty"));
        }
        Ok(ver)
    }

    pub async fn list_mechanisms(&self) -> CyrusSaslResult<Vec<String>> {
        let out = self
            .exec_ssh(
                "if command -v pluginviewer >/dev/null 2>&1; then pluginviewer --saslmechlist; elif command -v saslauthd >/dev/null 2>&1; then saslauthd -v 2>&1; else echo 'Cyrus SASL binaries not found' >&2; exit 127; fi",
            )
            .await?;
        let mechs: Vec<String> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .flat_map(|l| {
                l.split_whitespace()
                    .filter(|w| {
                        w.chars()
                            .all(|c| c.is_ascii_uppercase() || c == '-' || c == '_')
                    })
                    .map(String::from)
                    .collect::<Vec<_>>()
            })
            .collect();
        Ok(mechs)
    }

    pub async fn saslauthd_status(&self) -> CyrusSaslResult<SaslauthStatus> {
        let pid_out = self
            .exec_ssh("systemctl show saslauthd --property=MainPID --value")
            .await?;
        let pid_str = pid_out.stdout.trim();
        let first_pid = pid_str
            .split_whitespace()
            .next()
            .and_then(|p| p.parse::<u32>().ok());
        let running = first_pid.map(|p| p > 0).unwrap_or(false);

        let socket_out = self
            .exec_ssh("test -S /var/run/saslauthd/mux && echo exists || echo missing")
            .await?;
        let socket_path = socket_out
            .stdout
            .contains("exists")
            .then(|| "/var/run/saslauthd/mux".to_string());

        let mechanism = self
            .read_remote_file_if_exists("/etc/default/saslauthd")
            .await?
            .and_then(|content| {
                content.lines().find_map(|line| {
                    line.trim()
                        .strip_prefix("MECH=")
                        .map(|value| value.trim_matches(['\"', '\'']).to_string())
                })
            });

        Ok(SaslauthStatus {
            running,
            pid: first_pid,
            socket_path,
            mechanism,
            threads_active: None,
            threads_idle: None,
            cache_hits: None,
            cache_misses: None,
        })
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn shell_escape(s: &str) -> String {
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
    }
}
