// ── sorng-dovecot – SSH/CLI client ───────────────────────────────────────────
//! Executes dovecot/doveadm commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and user queries.

use crate::error::{DovecotError, DovecotResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

/// Dovecot management client – connects via SSH to manage Dovecot remotely.
pub struct DovecotClient {
    pub config: DovecotConnectionConfig,
    #[allow(dead_code)]
    http: HttpClient,
}

impl DovecotClient {
    pub fn new(config: DovecotConnectionConfig) -> DovecotResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| DovecotError::connection_failed(format!("http client build: {e}")))?;
        Ok(Self { config, http })
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
        debug!("DOVECOT SSH [{}]: {}", self.config.host, command);

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
            .map_err(|e| DovecotError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> DovecotResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
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
