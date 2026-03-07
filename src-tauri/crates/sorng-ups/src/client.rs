//! SSH/CLI client for UPS management via NUT commands.

use crate::error::{UpsError, UpsResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

/// UPS management client – connects via SSH to manage NUT remotely.
pub struct UpsClient {
    pub config: UpsConnectionConfig,
    _http: HttpClient,
}

impl UpsClient {
    pub fn new(config: UpsConnectionConfig) -> UpsResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| UpsError::connection(format!("http client build: {e}")))?;
        Ok(Self { config, _http: http })
    }

    // ── Path helpers ─────────────────────────────────────────────────

    pub fn nut_host(&self) -> &str {
        self.config.nut_host.as_deref().unwrap_or("localhost")
    }

    pub fn nut_port(&self) -> u16 {
        self.config.nut_port.unwrap_or(3493)
    }

    // ── SSH command execution stub ───────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> UpsResult<SshOutput> {
        debug!("UPS SSH [{}]: {}", self.config.host, command);
        Err(UpsError::not_connected(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    // ── NUT command helpers ──────────────────────────────────────────

    /// Run a NUT command via the SSH connection (`upsc`, `upscmd`, `upsrw`, etc.).
    pub async fn exec_nut_cmd(&self, cmd: &str, args: &[&str]) -> UpsResult<String> {
        let escaped_args: Vec<String> = args.iter().map(|a| shell_escape(a)).collect();
        let full = format!("{} {}", cmd, escaped_args.join(" "));
        let out = self.exec_ssh(&full).await?;
        if out.exit_code != 0 {
            return Err(UpsError::command(format!("{cmd} failed: {}", out.stderr)));
        }
        Ok(out.stdout)
    }

    /// Run `upsc <ups_name>[@host[:port]] [var]`
    pub async fn upsc(&self, ups_name: &str, var: Option<&str>) -> UpsResult<String> {
        let target = format!("{}@{}:{}", ups_name, self.nut_host(), self.nut_port());
        let cmd = match var {
            Some(v) => format!("upsc {} {}", shell_escape(&target), shell_escape(v)),
            None => format!("upsc {}", shell_escape(&target)),
        };
        let out = self.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(UpsError::command(format!("upsc failed: {}", out.stderr)));
        }
        Ok(out.stdout)
    }

    /// Run `upscmd [-u user -p pass] <ups_name>[@host[:port]] <command>`
    pub async fn upscmd(&self, ups_name: &str, cmd: &str) -> UpsResult<String> {
        let target = format!("{}@{}:{}", ups_name, self.nut_host(), self.nut_port());
        let auth = self.nut_auth_args();
        let full = format!("upscmd {} {} {}", auth, shell_escape(&target), shell_escape(cmd));
        let out = self.exec_ssh(&full).await?;
        if out.exit_code != 0 {
            return Err(UpsError::command(format!("upscmd failed: {}", out.stderr)));
        }
        Ok(out.stdout)
    }

    /// Run `upsrw [-s var=val] [-u user -p pass] <ups_name>[@host[:port]]`
    pub async fn upsrw(&self, ups_name: &str, var: &str, val: &str) -> UpsResult<String> {
        let target = format!("{}@{}:{}", ups_name, self.nut_host(), self.nut_port());
        let auth = self.nut_auth_args();
        let full = format!(
            "upsrw {} -s {}={} {}",
            auth,
            shell_escape(var),
            shell_escape(val),
            shell_escape(&target)
        );
        let out = self.exec_ssh(&full).await?;
        if out.exit_code != 0 {
            return Err(UpsError::command(format!("upsrw failed: {}", out.stderr)));
        }
        Ok(out.stdout)
    }

    /// Read a remote file via SSH.
    pub async fn read_remote_file(&self, path: &str) -> UpsResult<String> {
        let out = self.exec_ssh(&format!("cat {}", shell_escape(path))).await?;
        Ok(out.stdout)
    }

    /// Write content to a remote file via SSH.
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

    // ── Internal helpers ─────────────────────────────────────────────

    fn nut_auth_args(&self) -> String {
        match (&self.config.nut_user, &self.config.nut_password) {
            (Some(u), Some(p)) => format!("-u {} -p {}", shell_escape(u), shell_escape(p)),
            _ => String::new(),
        }
    }
}

/// Minimal shell-escaping for argument interpolation.
pub fn shell_escape(s: &str) -> String {
    if s.chars().all(|c| c.is_alphanumeric() || c == '/' || c == '.' || c == '-' || c == '_' || c == ':' || c == '@') {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
