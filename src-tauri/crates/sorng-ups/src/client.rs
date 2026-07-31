// ── sorng-ups – SSH/CLI client ────────────────────────────────────────────────
//! Executes NUT commands (upsc, upscmd, upsrw, etc.) on a remote host via SSH.

use crate::error::{UpsError, UpsResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};

const MAX_SSH_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SSH_ERROR_BYTES: usize = 64 * 1024;

/// UPS management client – connects via SSH to manage NUT remotely.
pub struct UpsClient {
    pub config: UpsConnectionConfig,
    ssh: IntegrationSshSession,
}

impl UpsClient {
    pub fn new(mut config: UpsConnectionConfig) -> UpsResult<Self> {
        config.host = config.host.trim().to_string();
        if config.host.is_empty() {
            return Err(UpsError::connection("SSH host cannot be empty"));
        }

        if let Some(user) = config.ssh_user.as_mut() {
            *user = user.trim().to_string();
            if user.is_empty() {
                return Err(UpsError::connection("SSH user cannot be empty"));
            }
        }

        let ssh = IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30).max(1),
        });

        Ok(Self { config, ssh })
    }

    // ── Binary paths ─────────────────────────────────────────────

    pub fn upsc_bin(&self) -> &str {
        "upsc"
    }

    pub fn upscmd_bin(&self) -> &str {
        "upscmd"
    }

    pub fn upsrw_bin(&self) -> &str {
        "upsrw"
    }

    pub fn upsmon_bin(&self) -> &str {
        "upsmon"
    }

    pub fn upsd_bin(&self) -> &str {
        "upsd"
    }

    // ── NUT address helpers ──────────────────────────────────────

    fn nut_host(&self) -> &str {
        self.config.nut_host.as_deref().unwrap_or("localhost")
    }

    fn nut_port(&self) -> u16 {
        self.config.nut_port.unwrap_or(3493)
    }

    /// Build a NUT device address: `ups_name@host:port`
    fn ups_addr(&self, ups_name: &str) -> String {
        format!("{}@{}:{}", ups_name, self.nut_host(), self.nut_port())
    }

    /// Build the full `upsc` command string for a device.
    pub fn upsc_cmd(&self, ups_name: &str) -> String {
        format!(
            "{} {}",
            self.upsc_bin(),
            shell_escape(&self.ups_addr(ups_name))
        )
    }

    // ── SSH command execution ──────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> UpsResult<SshOutput> {
        debug!("Executing UPS SSH command on {}", self.config.host);

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
                UpsError::ssh(redact_and_bound_error(
                    error,
                    &[
                        self.config.ssh_password.as_deref(),
                        self.config.nut_password.as_deref(),
                    ],
                ))
            })?;

        if output.len() > MAX_SSH_OUTPUT_BYTES {
            return Err(UpsError::ssh(format!(
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

    pub async fn probe(&self) -> UpsResult<()> {
        self.ssh.probe().await.map_err(|error| {
            UpsError::ssh(redact_and_bound_error(
                error,
                &[
                    self.config.ssh_password.as_deref(),
                    self.config.nut_password.as_deref(),
                ],
            ))
        })
    }

    // ── NUT command wrappers ─────────────────────────────────────

    /// Run `upsc <ups>@<host>:<port> [var]` and return stdout.
    pub async fn exec_upsc(&self, ups_name: &str, var: Option<&str>) -> UpsResult<String> {
        let cmd = match var {
            Some(v) => format!(
                "{} {} {}",
                self.upsc_bin(),
                shell_escape(&self.ups_addr(ups_name)),
                shell_escape(v)
            ),
            None => self.upsc_cmd(ups_name),
        };
        let out = self.exec_ssh(&cmd).await?;
        Ok(out.stdout)
    }

    /// Run `upscmd -u <user> -p <pass> <ups>@<host>:<port> <command>`.
    pub async fn exec_upscmd(&self, ups_name: &str, cmd: &str) -> UpsResult<String> {
        let nut_user = self.config.nut_user.as_deref().unwrap_or("admin");
        let nut_pass = self.config.nut_password.as_deref().unwrap_or("");
        let full = format!(
            "{} -u {} -p {} {} {}",
            self.upscmd_bin(),
            shell_escape(nut_user),
            shell_escape(nut_pass),
            shell_escape(&self.ups_addr(ups_name)),
            shell_escape(cmd)
        );
        let out = self.exec_ssh(&full).await?;
        Ok(out.stdout)
    }

    /// Run `upsrw -s <var>=<value> -u <user> -p <pass> <ups>@<host>:<port>`.
    pub async fn exec_upsrw(&self, ups_name: &str, var: &str, value: &str) -> UpsResult<String> {
        let nut_user = self.config.nut_user.as_deref().unwrap_or("admin");
        let nut_pass = self.config.nut_password.as_deref().unwrap_or("");
        let setting = format!("{var}={value}");
        let full = format!(
            "{} -s {} -u {} -p {} {}",
            self.upsrw_bin(),
            shell_escape(&setting),
            shell_escape(nut_user),
            shell_escape(nut_pass),
            shell_escape(&self.ups_addr(ups_name)),
        );
        let out = self.exec_ssh(&full).await?;
        Ok(out.stdout)
    }

    // ── File helpers ─────────────────────────────────────────────

    pub async fn read_remote_file(&self, path: &str) -> UpsResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> UpsResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> UpsResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }
}

/// Minimal shell escaping to prevent injection via file paths or arguments.
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
