// ── sorng-clamav – SSH/CLI client ─────────────────────────────────────────────
//! Executes ClamAV commands on a remote host via SSH.
//! Handles config file reading/writing, scanning, and process management.

use crate::error::{ClamavError, ClamavResult};
use crate::types::SshOutput;
use crate::types::ClamavConnectionConfig;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

/// ClamAV management client – connects via SSH to manage ClamAV remotely.
pub struct ClamavClient {
    pub config: ClamavConnectionConfig,
    #[allow(dead_code)]
    http: HttpClient,
}

impl ClamavClient {
    pub fn new(config: ClamavConnectionConfig) -> ClamavResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| ClamavError::connection_failed(format!("http client build: {e}")))?;
        Ok(Self { config, http })
    }

    // ── Path helpers ─────────────────────────────────────────────────

    pub fn clamscan_bin(&self) -> &str {
        self.config.clamscan_bin.as_deref().unwrap_or("/usr/bin/clamscan")
    }

    pub fn clamdscan_bin(&self) -> &str {
        self.config.clamdscan_bin.as_deref().unwrap_or("/usr/bin/clamdscan")
    }

    pub fn clamd_bin(&self) -> &str {
        self.config.clamd_bin.as_deref().unwrap_or("/usr/sbin/clamd")
    }

    pub fn freshclam_bin(&self) -> &str {
        self.config.freshclam_bin.as_deref().unwrap_or("/usr/bin/freshclam")
    }

    pub fn clamd_conf(&self) -> &str {
        self.config.clamd_conf.as_deref().unwrap_or("/etc/clamav/clamd.conf")
    }

    pub fn freshclam_conf(&self) -> &str {
        self.config.freshclam_conf.as_deref().unwrap_or("/etc/clamav/freshclam.conf")
    }

    pub fn clamd_socket(&self) -> &str {
        self.config.clamd_socket.as_deref().unwrap_or("/var/run/clamav/clamd.ctl")
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> ClamavResult<SshOutput> {
        debug!("CLAMAV SSH [{}]: {}", self.config.host, command);
        // Stub: actual implementation would use the SSH subsystem
        Err(ClamavError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    pub async fn read_remote_file(&self, path: &str) -> ClamavResult<String> {
        let out = self.exec_ssh(&format!("cat {}", shell_escape(path))).await?;
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
