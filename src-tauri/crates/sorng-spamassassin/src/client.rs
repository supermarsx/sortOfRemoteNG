// ── sorng-spamassassin – SSH/CLI client ──────────────────────────────────────
//! Executes SpamAssassin commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and rule queries.

use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;
use log::debug;
use reqwest::Client as HttpClient;
use std::time::Duration;

/// SpamAssassin management client – connects via SSH to manage SpamAssassin remotely.
pub struct SpamAssassinClient {
    pub config: SpamAssassinConnectionConfig,
    http: HttpClient,
}

impl SpamAssassinClient {
    pub fn new(config: SpamAssassinConnectionConfig) -> SpamAssassinResult<Self> {
        let http = HttpClient::builder()
            .timeout(Duration::from_secs(config.timeout_secs.unwrap_or(30)))
            .build()
            .map_err(|e| {
                SpamAssassinError::connection_failed(format!("http client build: {e}"))
            })?;
        Ok(Self { config, http })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn spamc_bin(&self) -> &str {
        self.config.spamc_bin.as_deref().unwrap_or("/usr/bin/spamc")
    }

    pub fn spamd_bin(&self) -> &str {
        self.config.spamd_bin.as_deref().unwrap_or("/usr/sbin/spamd")
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

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> SpamAssassinResult<SshOutput> {
        debug!("SPAMASSASSIN SSH [{}]: {}", self.config.host, command);
        // Stub: actual implementation would use the SSH subsystem
        Err(SpamAssassinError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
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
            .exec_ssh(&format!("{} --version 2>&1", self.spamc_bin()))
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn spamc(&self, args: &str) -> SpamAssassinResult<SshOutput> {
        let cmd = format!("{} {}", self.spamc_bin(), args);
        self.exec_ssh(&cmd).await
    }

    pub async fn sa_update(&self, args: &str) -> SpamAssassinResult<SshOutput> {
        let cmd = format!("sudo {} {}", self.sa_update_bin(), args);
        self.exec_ssh(&cmd).await
    }

    pub async fn sa_learn(&self, args: &str) -> SpamAssassinResult<SshOutput> {
        let cmd = format!("sudo {} {}", self.sa_learn_bin(), args);
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
