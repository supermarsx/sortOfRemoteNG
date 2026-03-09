// ── sorng-ups – SSH/CLI client ────────────────────────────────────────────────
//! Executes NUT commands (upsc, upscmd, upsrw, etc.) on a remote host via SSH.

use crate::error::{UpsError, UpsResult};
use crate::types::*;
use log::debug;

/// UPS management client – connects via SSH to manage NUT remotely.
pub struct UpsClient {
    pub config: UpsConnectionConfig,
}

impl UpsClient {
    pub fn new(config: UpsConnectionConfig) -> UpsResult<Self> {
        Ok(Self { config })
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
        format!("{} {}", self.upsc_bin(), self.ups_addr(ups_name))
    }

    // ── SSH command execution stub ───────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> UpsResult<SshOutput> {
        debug!("UPS SSH [{}]: {}", self.config.host, command);
        Err(UpsError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    // ── NUT command wrappers ─────────────────────────────────────

    /// Run `upsc <ups>@<host>:<port> [var]` and return stdout.
    pub async fn exec_upsc(&self, ups_name: &str, var: Option<&str>) -> UpsResult<String> {
        let cmd = match var {
            Some(v) => format!("{} {} {}", self.upsc_bin(), self.ups_addr(ups_name), v),
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
            self.ups_addr(ups_name),
            cmd
        );
        let out = self.exec_ssh(&full).await?;
        Ok(out.stdout)
    }

    /// Run `upsrw -s <var>=<value> -u <user> -p <pass> <ups>@<host>:<port>`.
    pub async fn exec_upsrw(&self, ups_name: &str, var: &str, value: &str) -> UpsResult<String> {
        let nut_user = self.config.nut_user.as_deref().unwrap_or("admin");
        let nut_pass = self.config.nut_password.as_deref().unwrap_or("");
        let full = format!(
            "{} -s {}={} -u {} -p {} {}",
            self.upsrw_bin(),
            var,
            shell_escape(value),
            shell_escape(nut_user),
            shell_escape(nut_pass),
            self.ups_addr(ups_name),
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
