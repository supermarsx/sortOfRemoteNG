// ── sorng-procmail – SSH/CLI client ──────────────────────────────────────────
//! Executes procmail commands on a remote host via SSH.
//! Handles procmailrc reading/writing, recipe management, and log queries.

use crate::error::{ProcmailError, ProcmailResult};
use crate::types::*;
use log::debug;

/// Procmail management client – connects via SSH to manage procmail remotely.
pub struct ProcmailClient {
    pub config: ProcmailConnectionConfig,
}

impl ProcmailClient {
    pub fn new(config: ProcmailConnectionConfig) -> ProcmailResult<Self> {
        Ok(Self { config })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn procmail_bin(&self) -> &str {
        self.config
            .procmail_bin
            .as_deref()
            .unwrap_or("/usr/bin/procmail")
    }

    pub fn procmailrc_path(&self) -> &str {
        self.config
            .procmailrc_path
            .as_deref()
            .unwrap_or("/etc/procmailrc")
    }

    pub fn log_path(&self) -> &str {
        self.config
            .log_path
            .as_deref()
            .unwrap_or("/var/log/procmail.log")
    }

    /// Return the per-user procmailrc path (~user/.procmailrc).
    pub fn user_rc_path(&self, user: &str) -> String {
        format!("/home/{}/.procmailrc", user)
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> ProcmailResult<SshOutput> {
        debug!("PROCMAIL SSH [{}]: {}", self.config.host, command);

        let ssh_user = self.config.ssh_user.as_deref().unwrap_or("root");
        let port = self.config.port.unwrap_or(22);
        let timeout = self.config.timeout_secs.unwrap_or(30);

        let mut ssh_args = vec![
            "-o".to_string(),
            "StrictHostKeyChecking=accept-new".to_string(),
            "-o".to_string(),
            format!("ConnectTimeout={}", timeout),
            "-p".to_string(),
            port.to_string(),
        ];

        if let Some(ref key) = self.config.ssh_key {
            ssh_args.push("-i".to_string());
            ssh_args.push(key.clone());
        }

        if self.config.ssh_key.is_none() && self.config.ssh_password.is_none() {
            ssh_args.push("-o".to_string());
            ssh_args.push("BatchMode=yes".to_string());
        }

        let target = format!("{}@{}", ssh_user, self.config.host);
        ssh_args.push(target);
        ssh_args.push(command.to_string());

        let use_sshpass = self.config.ssh_password.is_some() && self.config.ssh_key.is_none();

        let mut cmd = if use_sshpass {
            let mut c = tokio::process::Command::new("sshpass");
            c.arg("-e").arg("ssh");
            c.args(&ssh_args);
            if let Some(ref pw) = self.config.ssh_password {
                c.env("SSHPASS", pw);
            }
            c
        } else {
            let mut c = tokio::process::Command::new("ssh");
            c.args(&ssh_args);
            c
        };

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| ProcmailError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> ProcmailResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> ProcmailResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> ProcmailResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── Procmail core commands ───────────────────────────────────────

    pub async fn version(&self) -> ProcmailResult<String> {
        let out = self
            .exec_ssh(&format!("{} -v 2>&1", self.procmail_bin()))
            .await?;
        // procmail -v outputs version on the first line
        let ver = out.stdout.lines().next().unwrap_or("").trim().to_string();
        Ok(ver)
    }

    /// Read the procmailrc file for a specific user (or global if user is empty).
    pub async fn get_procmailrc(&self, user: &str) -> ProcmailResult<String> {
        let path = if user.is_empty() {
            self.procmailrc_path().to_string()
        } else {
            self.user_rc_path(user)
        };
        self.read_remote_file(&path).await
    }

    /// Write the procmailrc file for a specific user (or global if user is empty).
    pub async fn write_procmailrc(&self, user: &str, content: &str) -> ProcmailResult<()> {
        let path = if user.is_empty() {
            self.procmailrc_path().to_string()
        } else {
            self.user_rc_path(user)
        };
        self.write_remote_file(&path, content).await?;
        // Ensure correct permissions (0644 for procmailrc)
        self.exec_ssh(&format!("chmod 0644 {}", shell_escape(&path)))
            .await?;
        Ok(())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
