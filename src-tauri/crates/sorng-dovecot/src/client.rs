// ── sorng-dovecot – SSH/CLI client ───────────────────────────────────────────
//! Executes dovecot/doveadm commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and user queries.

use crate::error::{DovecotError, DovecotResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
use std::sync::Arc;
use std::time::Duration;

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

/// Dovecot management client – connects via SSH to manage Dovecot remotely.
pub struct DovecotClient {
    pub config: DovecotConnectionConfig,
    #[allow(dead_code)]
    http: HttpClient,
    ssh: Arc<dyn SshTransport>,
}

impl DovecotClient {
    pub fn new(config: DovecotConnectionConfig) -> DovecotResult<Self> {
        let ssh = Arc::new(IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30),
        }));
        Self::with_transport(config, ssh)
    }

    fn with_transport(
        config: DovecotConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> DovecotResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| DovecotError::connection_failed(format!("http client build: {e}")))?;
        Ok(Self { config, http, ssh })
    }

    #[cfg(test)]
    pub(crate) fn with_test_transport(
        config: DovecotConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> DovecotResult<Self> {
        Self::with_transport(config, ssh)
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn doveadm_bin(&self) -> &str {
        self.config
            .doveadm_bin
            .as_deref()
            .unwrap_or("/usr/bin/doveadm")
    }

    pub fn dovecot_bin(&self) -> &str {
        self.config
            .dovecot_bin
            .as_deref()
            .unwrap_or("/usr/sbin/dovecot")
    }

    pub fn config_dir(&self) -> &str {
        self.config.config_dir.as_deref().unwrap_or("/etc/dovecot")
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> DovecotResult<SshOutput> {
        debug!("Executing Dovecot SSH command on {}", self.config.host);
        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(DovecotError::ssh)?;
        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn disconnect(&self) -> DovecotResult<()> {
        self.ssh.disconnect().await.map_err(DovecotError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> DovecotResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn read_remote_file_if_exists(&self, path: &str) -> DovecotResult<Option<String>> {
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

    pub async fn write_remote_file(&self, path: &str, content: &str) -> DovecotResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> DovecotResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_remote_dir(&self, path: &str) -> DovecotResult<Vec<String>> {
        let out = self
            .exec_ssh(&format!("ls -1 {}", shell_escape(path)))
            .await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect())
    }

    // ── Dovecot core commands ────────────────────────────────────────

    pub async fn version(&self) -> DovecotResult<String> {
        let out = self
            .exec_ssh(&format!("{} --version 2>&1", self.dovecot_bin()))
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn doveadm(&self, args: &str) -> DovecotResult<SshOutput> {
        let cmd = format!("sudo {} {}", self.doveadm_bin(), args);
        self.exec_ssh(&cmd).await
    }

    pub async fn reload(&self) -> DovecotResult<()> {
        let out = self.doveadm("reload").await?;
        if out.exit_code != 0 {
            return Err(DovecotError::reload(format!(
                "reload failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn stop(&self) -> DovecotResult<()> {
        let out = self.doveadm("stop").await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "stop failed: {}",
                out.stderr
            )));
        }
        Ok(())
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
