// ── sorng-clamav – SSH/CLI client ─────────────────────────────────────────────
//! Executes ClamAV commands on a remote host via SSH.
//! Handles config file reading/writing, scanning, and process management.

use crate::error::{ClamavError, ClamavResult};
use crate::types::ClamavConnectionConfig;
use crate::types::SshOutput;
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

/// ClamAV management client – connects via SSH to manage ClamAV remotely.
pub struct ClamavClient {
    pub config: ClamavConnectionConfig,
    #[allow(dead_code)]
    http: HttpClient,
    ssh: Arc<dyn SshTransport>,
}

impl ClamavClient {
    pub fn new(config: ClamavConnectionConfig) -> ClamavResult<Self> {
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
        config: ClamavConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> ClamavResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| ClamavError::connection_failed(format!("http client build: {e}")))?;
        Ok(Self { config, http, ssh })
    }
    #[cfg(test)]
    pub(crate) fn with_test_transport(
        config: ClamavConnectionConfig,
        ssh: Arc<dyn SshTransport>,
    ) -> ClamavResult<Self> {
        Self::with_transport(config, ssh)
    }

    // ── Path helpers ─────────────────────────────────────────────────

    pub fn clamscan_bin(&self) -> &str {
        self.config
            .clamscan_bin
            .as_deref()
            .unwrap_or("/usr/bin/clamscan")
    }

    pub fn clamdscan_bin(&self) -> &str {
        self.config
            .clamdscan_bin
            .as_deref()
            .unwrap_or("/usr/bin/clamdscan")
    }

    pub fn clamd_bin(&self) -> &str {
        self.config
            .clamd_bin
            .as_deref()
            .unwrap_or("/usr/sbin/clamd")
    }

    pub fn freshclam_bin(&self) -> &str {
        self.config
            .freshclam_bin
            .as_deref()
            .unwrap_or("/usr/bin/freshclam")
    }

    pub fn clamd_conf(&self) -> &str {
        self.config
            .clamd_conf
            .as_deref()
            .unwrap_or("/etc/clamav/clamd.conf")
    }

    pub fn freshclam_conf(&self) -> &str {
        self.config
            .freshclam_conf
            .as_deref()
            .unwrap_or("/etc/clamav/freshclam.conf")
    }

    pub fn clamd_socket(&self) -> &str {
        self.config
            .clamd_socket
            .as_deref()
            .unwrap_or("/var/run/clamav/clamd.ctl")
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> ClamavResult<SshOutput> {
        debug!("CLAMAV SSH [{}]: {}", self.config.host, command);
        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(ClamavError::ssh)?;
        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn disconnect(&self) -> ClamavResult<()> {
        self.ssh.disconnect().await.map_err(ClamavError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> ClamavResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> ClamavResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> ClamavResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn socket_exists(&self, path: &str) -> ClamavResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -S {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── Core ClamAV commands ─────────────────────────────────────────

    pub async fn version(&self) -> ClamavResult<String> {
        let out = self
            .exec_ssh(&format!("{} --version 2>&1", self.clamscan_bin()))
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn clamd_version(&self) -> ClamavResult<String> {
        let out = self
            .exec_ssh(&format!(
                "echo VERSION | socat - UNIX-CONNECT:{} 2>&1",
                shell_escape(self.clamd_socket())
            ))
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn reload_database(&self) -> ClamavResult<()> {
        let out = self
            .exec_ssh(&format!(
                "echo RELOAD | socat - UNIX-CONNECT:{} 2>&1",
                shell_escape(self.clamd_socket())
            ))
            .await?;
        if !out.stdout.contains("RELOADING") {
            return Err(ClamavError::database_error(format!(
                "reload failed: {}",
                out.stdout
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
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    struct FakeSshTransport {
        outcomes: Mutex<VecDeque<Result<String, String>>>,
    }
    #[async_trait::async_trait]
    impl SshTransport for FakeSshTransport {
        async fn execute(&self, _: &str, _: Option<u64>) -> Result<String, String> {
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

    fn config() -> ClamavConnectionConfig {
        ClamavConnectionConfig {
            host: "mail.example.test".into(),
            port: Some(22),
            ssh_user: Some("admin".into()),
            ssh_password: None,
            ssh_key: None,
            clamscan_bin: None,
            clamdscan_bin: None,
            clamd_bin: None,
            freshclam_bin: None,
            clamd_conf: None,
            freshclam_conf: None,
            clamd_socket: None,
            timeout_secs: Some(5),
        }
    }

    #[tokio::test]
    async fn mandatory_config_write_preserves_remote_failure() {
        let fake = Arc::new(FakeSshTransport {
            outcomes: Mutex::new(
                vec![Err("Command failed with exit code 1: disk full".into())].into(),
            ),
        });
        let client = ClamavClient::with_test_transport(config(), fake).unwrap();
        let error = client
            .write_remote_file("/etc/clamav/clamd.conf", "LogTime yes")
            .await
            .unwrap_err();
        assert!(error.message.contains("disk full"));
    }
}
