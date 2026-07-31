// ── sorng-spamassassin – SSH/CLI client ──────────────────────────────────────
//! Executes SpamAssassin commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and rule queries.

use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
use std::time::Duration;

const MAX_SSH_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SSH_ERROR_BYTES: usize = 64 * 1024;

/// SpamAssassin management client – connects via SSH to manage SpamAssassin remotely.
pub struct SpamAssassinClient {
    pub config: SpamAssassinConnectionConfig,
    #[allow(dead_code)]
    http: HttpClient,
    ssh: IntegrationSshSession,
}

impl SpamAssassinClient {
    pub fn new(mut config: SpamAssassinConnectionConfig) -> SpamAssassinResult<Self> {
        config.host = config.host.trim().to_string();
        if config.host.is_empty() {
            return Err(SpamAssassinError::connection_failed(
                "SSH host cannot be empty",
            ));
        }

        if let Some(user) = config.ssh_user.as_mut() {
            *user = user.trim().to_string();
            if user.is_empty() {
                return Err(SpamAssassinError::connection_failed(
                    "SSH user cannot be empty",
                ));
            }
        }

        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| SpamAssassinError::connection_failed(format!("http client build: {e}")))?;
        let ssh = IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30).max(1),
        });

        Ok(Self { config, http, ssh })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn spamc_bin(&self) -> &str {
        self.config.spamc_bin.as_deref().unwrap_or("/usr/bin/spamc")
    }

    pub fn spamd_bin(&self) -> &str {
        self.config
            .spamd_bin
            .as_deref()
            .unwrap_or("/usr/sbin/spamd")
    }

    pub fn sa_update_bin(&self) -> &str {
        self.config
            .sa_update_bin
            .as_deref()
            .unwrap_or("/usr/bin/sa-update")
    }

    pub fn sa_learn_bin(&self) -> &str {
        self.config
            .sa_learn_bin
            .as_deref()
            .unwrap_or("/usr/bin/sa-learn")
    }

    pub fn config_dir(&self) -> &str {
        self.config
            .config_dir
            .as_deref()
            .unwrap_or("/etc/spamassassin")
    }

    pub fn local_cf_path(&self) -> &str {
        self.config
            .local_cf_path
            .as_deref()
            .unwrap_or("/etc/spamassassin/local.cf")
    }

    // ── SSH command execution ────────────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> SpamAssassinResult<SshOutput> {
        debug!("Executing SpamAssassin SSH command on {}", self.config.host);

        let output = self
            .ssh
            .execute(
                command,
                Some(
                    self.config
                        .timeout_secs
                        .unwrap_or(30)
                        .max(1)
                        .saturating_mul(1000),
                ),
            )
            .await
            .map_err(|error| {
                SpamAssassinError::ssh(redact_and_bound_error(
                    error,
                    &[self.config.ssh_password.as_deref()],
                ))
            })?;

        if output.len() > MAX_SSH_OUTPUT_BYTES {
            return Err(SpamAssassinError::ssh(format!(
                "SSH command output exceeded the {} byte limit",
                MAX_SSH_OUTPUT_BYTES
            )));
        }

        Ok(SshOutput {
            stdout: output,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> SpamAssassinResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> SpamAssassinResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> SpamAssassinResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_remote_dir(&self, path: &str) -> SpamAssassinResult<Vec<String>> {
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

    // ── SpamAssassin core commands ───────────────────────────────────

    pub async fn version(&self) -> SpamAssassinResult<String> {
        let out = self
            .exec_ssh(&format!(
                "{} --version 2>&1",
                shell_escape(self.spamc_bin())
            ))
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn spamc(&self, args: &str) -> SpamAssassinResult<SshOutput> {
        let cmd = format!("{} {}", shell_escape(self.spamc_bin()), args);
        self.exec_ssh(&cmd).await
    }

    pub async fn sa_update(&self, args: &str) -> SpamAssassinResult<SshOutput> {
        let cmd = format!("sudo {} {}", shell_escape(self.sa_update_bin()), args);
        self.exec_ssh(&cmd).await
    }

    pub async fn sa_learn(&self, args: &str) -> SpamAssassinResult<SshOutput> {
        let cmd = format!("sudo {} {}", shell_escape(self.sa_learn_bin()), args);
        self.exec_ssh(&cmd).await
    }

    pub async fn reload(&self) -> SpamAssassinResult<()> {
        let out = self
            .exec_ssh("sudo systemctl reload spamassassin 2>&1")
            .await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::reload(format!(
                "reload failed: {}",
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

fn redact_and_bound_error(mut error: String, secrets: &[Option<&str>]) -> String {
    for secret in secrets.iter().filter_map(|value| *value) {
        if !secret.is_empty() {
            error = error.replace(secret, "[REDACTED]");
            error = error.replace(&shell_escape(secret), "[REDACTED]");
        }
    }

    truncate_utf8(error, MAX_SSH_ERROR_BYTES)
}

fn truncate_utf8(mut value: String, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value;
    }

    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value.push_str(" [truncated]");
    value
}
