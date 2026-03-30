// ── sorng-postfix – SSH/CLI client ────────────────────────────────────────────
//! Executes Postfix commands on a remote host via SSH.
//! Handles config file reading/writing, queue management, and process control.

use crate::error::{PostfixError, PostfixResult};
use crate::types::*;
use log::debug;

/// Postfix management client – connects via SSH to manage Postfix remotely.
pub struct PostfixClient {
    pub config: PostfixConnectionConfig,
}

impl PostfixClient {
    pub fn new(config: PostfixConnectionConfig) -> PostfixResult<Self> {
        Ok(Self { config })
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn postfix_bin(&self) -> &str {
        self.config
            .postfix_bin
            .as_deref()
            .unwrap_or("/usr/sbin/postfix")
    }

    pub fn config_dir(&self) -> &str {
        self.config.config_dir.as_deref().unwrap_or("/etc/postfix")
    }

    pub fn queue_dir(&self) -> &str {
        self.config
            .queue_dir
            .as_deref()
            .unwrap_or("/var/spool/postfix")
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> PostfixResult<SshOutput> {
        debug!("POSTFIX SSH [{}]: {}", self.config.host, command);

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
            .map_err(|e| PostfixError::ssh(format!("Failed to execute ssh: {}", e)))?;

        Ok(SshOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub async fn read_remote_file(&self, path: &str) -> PostfixResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    pub async fn write_remote_file(&self, path: &str, content: &str) -> PostfixResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> PostfixResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── Postfix process commands ─────────────────────────────────────

    pub async fn version(&self) -> PostfixResult<String> {
        let out = self.exec_ssh("postconf mail_version 2>&1").await?;
        let raw = out.stdout.trim().to_string();
        let version = raw
            .split('=')
            .nth(1)
            .map(|v| v.trim().to_string())
            .unwrap_or(raw);
        Ok(version)
    }

    pub async fn postconf(&self, param: &str) -> PostfixResult<String> {
        let out = self
            .exec_ssh(&format!("postconf {}", shell_escape(param)))
            .await?;
        let raw = out.stdout.trim().to_string();
        let value = raw
            .split_once('=')
            .map(|x| x.1)
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        Ok(value)
    }

    pub async fn postconf_set(&self, param: &str, value: &str) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!(
                "sudo postconf -e {}={}",
                shell_escape(param),
                shell_escape(value)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::config_syntax(&format!(
                "postconf -e failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn postconf_all(&self) -> PostfixResult<Vec<PostfixMainCfParam>> {
        let out = self.exec_ssh("postconf").await?;
        let default_out = self.exec_ssh("postconf -d").await.ok();
        let mut defaults = std::collections::HashMap::new();
        if let Some(ref dout) = default_out {
            for line in dout.stdout.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    defaults.insert(k.trim().to_string(), v.trim().to_string());
                }
            }
        }
        let mut params = Vec::new();
        for line in out.stdout.lines() {
            if let Some((k, v)) = line.split_once('=') {
                let name = k.trim().to_string();
                let value = v.trim().to_string();
                let default_value = defaults.get(&name).cloned();
                let is_default = default_value.as_deref() == Some(&value);
                params.push(PostfixMainCfParam {
                    name,
                    value,
                    default_value,
                    is_default,
                });
            }
        }
        Ok(params)
    }

    pub async fn postmap(&self, file: &str) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!("sudo postmap {}", shell_escape(file)))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::io(format!("postmap failed: {}", out.stderr)));
        }
        Ok(())
    }

    pub async fn postqueue_flush(&self) -> PostfixResult<()> {
        let out = self.exec_ssh("sudo postqueue -f").await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "postqueue -f failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn postqueue_list(&self) -> PostfixResult<Vec<PostfixQueueEntry>> {
        let out = self
            .exec_ssh("postqueue -j 2>/dev/null || postqueue -p")
            .await?;
        let mut entries = Vec::new();
        // Try JSON format first (Postfix 3.1+)
        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('{') {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    let queue_id = parsed
                        .get("queue_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let sender = parsed
                        .get("sender")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let recipients: Vec<String> = parsed
                        .get("recipients")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|r| {
                                    r.get("address").and_then(|a| a.as_str()).map(String::from)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let arrival_time = parsed
                        .get("arrival_time")
                        .and_then(|v| v.as_u64())
                        .map(|ts| ts.to_string());
                    let size = parsed
                        .get("message_size")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let status = parsed
                        .get("queue_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let reason = parsed
                        .get("recipients")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|r| r.get("delay_reason"))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    entries.push(PostfixQueueEntry {
                        queue_id,
                        sender,
                        recipients,
                        arrival_time,
                        size,
                        status,
                        reason,
                    });
                }
            }
        }
        // Fallback: parse classic mailq output
        if entries.is_empty() {
            let mut current_id = String::new();
            let mut current_sender = String::new();
            let mut current_size: u64 = 0;
            let mut current_time = String::new();
            let mut current_recipients = Vec::new();
            let mut current_reason = None;
            for line in out.stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('-')
                    || trimmed.is_empty()
                    || trimmed.starts_with("Mail queue")
                {
                    if !current_id.is_empty() {
                        entries.push(PostfixQueueEntry {
                            queue_id: current_id.clone(),
                            sender: current_sender.clone(),
                            recipients: current_recipients.clone(),
                            arrival_time: if current_time.is_empty() {
                                None
                            } else {
                                Some(current_time.clone())
                            },
                            size: current_size,
                            status: "queued".to_string(),
                            reason: current_reason.clone(),
                        });
                        current_id.clear();
                        current_recipients.clear();
                        current_reason = None;
                    }
                    continue;
                }
                // Queue ID line: "A1B2C3D4E5*  1234 Mon Jan  1 00:00:00  sender@example.com"
                if trimmed.len() > 10
                    && trimmed
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_hexdigit())
                {
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() >= 2 {
                        current_id = parts[0]
                            .trim_end_matches('*')
                            .trim_end_matches('!')
                            .to_string();
                        current_size = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
                        current_sender = parts.last().unwrap_or(&"").to_string();
                        current_time = parts
                            .get(2..parts.len() - 1)
                            .map(|p| p.join(" "))
                            .unwrap_or_default();
                    }
                } else if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    current_reason = Some(trimmed[1..trimmed.len() - 1].to_string());
                } else if trimmed.contains('@') {
                    current_recipients.push(trimmed.to_string());
                }
            }
            if !current_id.is_empty() {
                entries.push(PostfixQueueEntry {
                    queue_id: current_id,
                    sender: current_sender,
                    recipients: current_recipients,
                    arrival_time: if current_time.is_empty() {
                        None
                    } else {
                        Some(current_time)
                    },
                    size: current_size,
                    status: "queued".to_string(),
                    reason: current_reason,
                });
            }
        }
        Ok(entries)
    }

    pub async fn postsuper_delete(&self, queue_id: &str) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!("sudo postsuper -d {}", shell_escape(queue_id)))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "postsuper -d failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn postsuper_hold(&self, queue_id: &str) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!("sudo postsuper -h {}", shell_escape(queue_id)))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "postsuper -h failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn postsuper_release(&self, queue_id: &str) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!("sudo postsuper -H {}", shell_escape(queue_id)))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::queue_error(format!(
                "postsuper -H failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn reload(&self) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!("sudo {} reload", self.postfix_bin()))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::reload_failed(format!(
                "reload failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn start(&self) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!("sudo {} start", self.postfix_bin()))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::process_error(format!(
                "start failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn stop(&self) -> PostfixResult<()> {
        let out = self
            .exec_ssh(&format!("sudo {} stop", self.postfix_bin()))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::process_error(format!(
                "stop failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    pub async fn status(&self) -> PostfixResult<String> {
        let out = self
            .exec_ssh(&format!("sudo {} status 2>&1", self.postfix_bin()))
            .await?;
        Ok(out.stdout.trim().to_string())
    }

    pub async fn check_config(&self) -> PostfixResult<ConfigTestResult> {
        let out = self.exec_ssh("sudo postfix check 2>&1").await;
        match out {
            Ok(o) => {
                let errors: Vec<String> = o
                    .stderr
                    .lines()
                    .chain(o.stdout.lines())
                    .filter(|l| {
                        let lower = l.to_lowercase();
                        lower.contains("error")
                            || lower.contains("fatal")
                            || lower.contains("warning")
                    })
                    .map(String::from)
                    .collect();
                Ok(ConfigTestResult {
                    success: o.exit_code == 0 && errors.is_empty(),
                    output: format!("{}{}", o.stdout, o.stderr),
                    errors,
                })
            }
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute postfix check".into()],
            }),
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
