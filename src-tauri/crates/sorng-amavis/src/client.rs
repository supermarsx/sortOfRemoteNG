// ── sorng-amavis – SSH/CLI client ─────────────────────────────────────────────
//! Executes Amavis commands on a remote host via SSH.
//! Handles config file reading/writing, process control, and runtime queries.

use crate::error::{AmavisError, AmavisResult};
use crate::types::*;
use log::debug;

/// Amavis management client – connects via SSH to manage amavisd-new remotely.
pub struct AmavisClient {
    pub config: AmavisConnectionConfig,
    session: Option<SshSessionPlaceholder>,
}

/// Placeholder for a real SSH session handle.
#[allow(dead_code)]
struct SshSessionPlaceholder;

impl AmavisClient {
    /// Create a new client with the given connection configuration.
    /// Connection is lazily established on first command execution.
    pub fn new(config: AmavisConnectionConfig) -> AmavisResult<Self> {
        Ok(Self {
            config,
            session: None,
        })
    }

    // ── SSH command execution stub ───────────────────────────────
    //
    // In production these call through the app's SSH infrastructure.
    // Modelled as async methods returning structured types.

    /// Execute a command via SSH and return the output.
    pub async fn ssh_exec(&self, command: &str) -> AmavisResult<SshOutput> {
        debug!("AMAVIS SSH [{}]: {}", self.config.host, command);
        Err(AmavisError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    /// Read a remote file's contents via SSH.
    pub async fn read_file(&self, path: &str) -> AmavisResult<String> {
        let out = self
            .ssh_exec(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
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
        let version = self.version().await.ok();
        let active_out = self
            .ssh_exec("systemctl is-active amavisd 2>/dev/null || systemctl is-active amavis 2>/dev/null || echo inactive")
            .await
            .ok();
        let running = active_out
            .as_ref()
            .map(|o| o.stdout.trim() == "active")
            .unwrap_or(false);
        let uptime_secs = if running {
            self.ssh_exec(
                "ps -o etimes= -p $(pgrep -x amavisd 2>/dev/null || pgrep -x amavisd-new 2>/dev/null || echo 0) 2>/dev/null | tr -d ' '"
            )
            .await
            .ok()
            .and_then(|o| o.stdout.trim().parse::<u64>().ok())
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
            .ssh_exec("amavisd-new --version 2>&1 || amavisd --version 2>&1")
            .await?;
        let raw = out.stdout.trim().to_string();
        // The version line is typically "amavisd-new-2.13.0 ..."
        let version = raw.lines().next().unwrap_or(&raw).trim().to_string();
        Ok(version)
    }

    /// Return whether the `session` placeholder is populated.
    #[allow(dead_code)]
    pub fn is_connected(&self) -> bool {
        self.session.is_some()
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

    #[test]
    fn test_new_client() {
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
        assert!(!client.is_connected());
    }
}
