// ── sorng-php – SSH/CLI client ────────────────────────────────────────────────
//! Executes PHP commands on a remote host via SSH.
//! Handles config file reading/writing, process management, and status queries.

use crate::error::{PhpError, PhpResult};
use crate::types::*;
use log::debug;

/// PHP management client – connects via SSH to manage PHP remotely.
pub struct PhpClient {
    pub config: PhpConnectionConfig,
}

impl PhpClient {
    pub fn new(config: PhpConnectionConfig) -> PhpResult<Self> {
        Ok(Self { config })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn php_bin(&self) -> &str {
        self.config.php_bin.as_deref().unwrap_or("php")
    }

    pub fn fpm_bin(&self) -> &str {
        self.config.fpm_bin.as_deref().unwrap_or("php-fpm")
    }

    pub fn composer_bin(&self) -> &str {
        self.config.composer_bin.as_deref().unwrap_or("composer")
    }

    pub fn config_dir(&self) -> &str {
        self.config.config_dir.as_deref().unwrap_or("/etc/php")
    }

    pub fn fpm_pool_dir(&self, version: &str) -> String {
        self.config.fpm_pool_dir.clone().unwrap_or_else(|| {
            format!("{}/{}/fpm/pool.d", self.config_dir(), version)
        })
    }

    /// Versioned PHP binary path
    pub fn versioned_php_bin(&self, version: &str) -> String {
        format!("php{}", version)
    }

    /// Versioned FPM service name
    pub fn fpm_service_name(&self, version: &str) -> String {
        format!("php{}-fpm", version)
    }

    // ── SSH command execution stub ───────────────────────────────────

    pub async fn exec_ssh(&self, command: &str) -> PhpResult<SshOutput> {
        debug!("PHP SSH [{}]: {}", self.config.host, command);
        Err(PhpError::ssh(format!(
            "SSH execution not connected to {}. Command: {}",
            self.config.host, command
        )))
    }

    pub async fn read_remote_file(&self, path: &str) -> PhpResult<String> {
        let out = self.exec_ssh(&format!("cat {}", shell_escape(path))).await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> PhpResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> PhpResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn dir_exists(&self, path: &str) -> PhpResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -d {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    pub async fn list_dir(&self, path: &str) -> PhpResult<Vec<String>> {
        let out = self
            .exec_ssh(&format!("ls -1 {} 2>/dev/null || true", shell_escape(path)))
            .await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect())
    }

    pub async fn symlink(&self, target: &str, link: &str) -> PhpResult<()> {
        self.exec_ssh(&format!(
            "sudo ln -sf {} {}",
            shell_escape(target),
            shell_escape(link)
        ))
        .await?;
        Ok(())
    }

    pub async fn remove_file(&self, path: &str) -> PhpResult<()> {
        self.exec_ssh(&format!("sudo rm -f {}", shell_escape(path)))
            .await?;
        Ok(())
    }

    pub async fn backup_file(&self, path: &str) -> PhpResult<String> {
        let backup = format!("{}.bak.{}", path, chrono::Utc::now().format("%Y%m%d%H%M%S"));
        self.exec_ssh(&format!(
            "sudo cp {} {}",
            shell_escape(path),
            shell_escape(&backup)
        ))
        .await?;
        Ok(backup)
    }

    /// Check if a command / binary exists on the remote host.
    pub async fn command_exists(&self, cmd: &str) -> PhpResult<bool> {
        let out = self
            .exec_ssh(&format!("command -v {} >/dev/null 2>&1 && echo yes || echo no", shell_escape(cmd)))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }
}

/// Minimal shell escaping to prevent injection via file paths or arguments.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
