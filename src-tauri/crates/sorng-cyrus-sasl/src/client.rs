// ── sorng-cyrus-sasl – SSH/CLI client ────────────────────────────────────────
//! Executes Cyrus SASL commands on a remote host via SSH.
//! Handles saslauthd management, sasldb operations, and mechanism queries.

use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;
use log::debug;

/// Cyrus SASL management client – connects via SSH to manage SASL remotely.
pub struct CyrusSaslClient {
    pub config: CyrusSaslConnectionConfig,
}

impl CyrusSaslClient {
    pub fn new(config: CyrusSaslConnectionConfig) -> CyrusSaslResult<Self> {
        Ok(Self { config })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn saslauthd_bin(&self) -> &str {
        self.config
            .saslauthd_bin
            .as_deref()
            .unwrap_or("/usr/sbin/saslauthd")
    }

    pub fn sasldblistusers_bin(&self) -> &str {
        self.config
            .sasldblistusers_bin
            .as_deref()
            .unwrap_or("/usr/sbin/sasldblistusers2")
    }

    pub fn saslpasswd_bin(&self) -> &str {
        self.config
            .saslpasswd_bin
            .as_deref()
            .unwrap_or("/usr/sbin/saslpasswd2")
    }

    pub fn config_dir(&self) -> &str {
        self.config.config_dir.as_deref().unwrap_or("/etc/sasl2")
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> CyrusSaslResult<SshOutput> {
        debug!("SASL SSH [{}]: {}", self.config.host, command);

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
            .map_err(|e| CyrusSaslError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> CyrusSaslResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> CyrusSaslResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> CyrusSaslResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── Core queries ─────────────────────────────────────────────────

    pub async fn version(&self) -> CyrusSaslResult<String> {
        let out = self
            .exec_ssh("saslauthd -v 2>&1 || pluginviewer --version 2>&1 || echo unknown")
            .await?;
        let ver = out
            .stdout
            .lines()
            .next()
            .unwrap_or("unknown")
            .trim()
            .to_string();
        Ok(ver)
    }

    pub async fn list_mechanisms(&self) -> CyrusSaslResult<Vec<String>> {
        let out = self
            .exec_ssh("pluginviewer --saslmechlist 2>/dev/null || saslauthd -v 2>&1")
            .await?;
        let mechs: Vec<String> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .flat_map(|l| {
                l.split_whitespace()
                    .filter(|w| {
                        w.chars()
                            .all(|c| c.is_ascii_uppercase() || c == '-' || c == '_')
                    })
                    .map(String::from)
                    .collect::<Vec<_>>()
            })
            .collect();
        Ok(mechs)
    }

    pub async fn saslauthd_status(&self) -> CyrusSaslResult<SaslauthStatus> {
        let pid_out = self
            .exec_ssh("pidof saslauthd 2>/dev/null || echo 0")
            .await?;
        let pid_str = pid_out.stdout.trim();
        let first_pid = pid_str
            .split_whitespace()
            .next()
            .and_then(|p| p.parse::<u32>().ok());
        let running = first_pid.map(|p| p > 0).unwrap_or(false);

        let socket_out = self
            .exec_ssh("ls /var/run/saslauthd/mux 2>/dev/null && echo exists || echo missing")
            .await;
        let socket_path = socket_out
            .ok()
            .filter(|o| o.stdout.contains("exists"))
            .map(|_| "/var/run/saslauthd/mux".to_string());

        let mech_out = self
            .exec_ssh("grep -oP '(?<=MECH=)\\S+' /etc/default/saslauthd 2>/dev/null || echo pam")
            .await;
        let mechanism = mech_out.ok().map(|o| o.stdout.trim().to_string());

        Ok(SaslauthStatus {
            running,
            pid: first_pid,
            socket_path,
            mechanism,
            threads_active: None,
            threads_idle: None,
            cache_hits: None,
            cache_misses: None,
        })
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
