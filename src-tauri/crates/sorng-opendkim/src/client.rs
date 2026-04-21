// ── sorng-opendkim – SSH/CLI client ──────────────────────────────────────────
//! Executes opendkim commands on a remote host via SSH.
//! Handles config file reading/writing, key management, and process control.

use crate::error::{OpendkimError, OpendkimResult};
use crate::types::*;
use log::debug;

/// OpenDKIM management client – connects via SSH to manage opendkim remotely.
pub struct OpendkimClient {
    pub config: OpendkimConnectionConfig,
}

impl OpendkimClient {
    pub fn new(config: OpendkimConnectionConfig) -> OpendkimResult<Self> {
        Ok(Self { config })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn opendkim_bin(&self) -> &str {
        self.config
            .opendkim_bin
            .as_deref()
            .unwrap_or("/usr/sbin/opendkim")
    }

    pub fn config_path(&self) -> &str {
        self.config
            .config_path
            .as_deref()
            .unwrap_or("/etc/opendkim.conf")
    }

    pub fn key_dir(&self) -> &str {
        self.config
            .key_dir
            .as_deref()
            .unwrap_or("/etc/opendkim/keys")
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> OpendkimResult<SshOutput> {
        debug!("DKIM SSH [{}]: {}", self.config.host, command);

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
            .map_err(|e| OpendkimError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> OpendkimResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> OpendkimResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> OpendkimResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_remote_dir(&self, path: &str) -> OpendkimResult<Vec<String>> {
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

    pub async fn create_dir(&self, path: &str) -> OpendkimResult<()> {
        self.exec_ssh(&format!("sudo mkdir -p {}", shell_escape(path)))
            .await?;
        Ok(())
    }

    pub async fn remove_file(&self, path: &str) -> OpendkimResult<()> {
        self.exec_ssh(&format!("sudo rm -f {}", shell_escape(path)))
            .await?;
        Ok(())
    }

    // ── Core commands ────────────────────────────────────────────────

    pub async fn version(&self) -> OpendkimResult<String> {
        let out = self
            .exec_ssh(&format!("{} -V 2>&1", self.opendkim_bin()))
            .await?;
        // opendkim -V outputs: "opendkim: OpenDKIM Filter v2.11.0"
        let version = out.stdout.lines().next().unwrap_or("").trim().to_string();
        Ok(version)
    }

    pub async fn reload(&self) -> OpendkimResult<()> {
        let out = self.exec_ssh("sudo systemctl reload opendkim 2>&1").await?;
        if out.exit_code != 0 {
            return Err(OpendkimError::reload(format!(
                "reload failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn status(&self) -> OpendkimResult<String> {
        let out = self.exec_ssh("systemctl is-active opendkim 2>&1").await?;
        Ok(out.stdout.trim().to_string())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
