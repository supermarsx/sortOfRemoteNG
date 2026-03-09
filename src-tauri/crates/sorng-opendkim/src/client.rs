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
        // Stub: actual implementation would use the SSH subsystem
        Err(OpendkimError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
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
