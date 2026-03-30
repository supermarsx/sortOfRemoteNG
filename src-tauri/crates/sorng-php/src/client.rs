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
        self.config
            .fpm_pool_dir
            .clone()
            .unwrap_or_else(|| format!("{}/{}/fpm/pool.d", self.config_dir(), version))
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
            .map_err(|e| PhpError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> PhpResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
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
            .exec_ssh(&format!(
                "command -v {} >/dev/null 2>&1 && echo yes || echo no",
                shell_escape(cmd)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }
}

/// Minimal shell escaping to prevent injection via file paths or arguments.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
