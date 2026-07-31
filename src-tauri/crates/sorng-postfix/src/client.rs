// ── sorng-postfix – SSH/CLI client ────────────────────────────────────────────
//! Executes Postfix commands on a remote host via SSH.
//! Handles config file reading/writing, queue management, and process control.

use crate::error::{PostfixError, PostfixResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
#[cfg(test)]
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

const MISSING_FILE_MARKER: &str = "__SORNG_REMOTE_FILE_ABSENT_7D9360E9__";

/// Postfix management client – connects via SSH to manage Postfix remotely.
pub struct PostfixClient {
    pub config: PostfixConnectionConfig,
    ssh: IntegrationSshSession,
    #[cfg(test)]
    scripted_ssh: Option<Arc<ScriptedSsh>>,
}

impl PostfixClient {
    pub fn new(config: PostfixConnectionConfig) -> PostfixResult<Self> {
        let ssh = IntegrationSshSession::new(ExternalSshConfig {
            host: &config.host,
            username: config.ssh_user.as_deref().unwrap_or("root"),
            port: config.port.unwrap_or(22),
            private_key: config.ssh_key.as_deref(),
            password: config.ssh_password.as_deref(),
            connect_timeout_secs: config.timeout_secs.unwrap_or(30),
        });
        Ok(Self {
            config,
            ssh,
            #[cfg(test)]
            scripted_ssh: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn scripted(
        config: PostfixConnectionConfig,
        responses: Vec<Result<String, String>>,
    ) -> (Self, Arc<ScriptedSsh>) {
        let scripted_ssh = Arc::new(ScriptedSsh::new(responses));
        let mut client = Self::new(config).expect("scripted Postfix client");
        client.scripted_ssh = Some(Arc::clone(&scripted_ssh));
        (client, scripted_ssh)
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
        debug!("Executing Postfix SSH command on {}", self.config.host);
        #[cfg(test)]
        if let Some(scripted_ssh) = &self.scripted_ssh {
            let stdout = scripted_ssh.execute(command).map_err(PostfixError::ssh)?;
            return Ok(SshOutput {
                stdout,
                stderr: String::new(),
                exit_code: 0,
            });
        }
        let stdout = self
            .ssh
            .execute(
                command,
                Some(self.config.timeout_secs.unwrap_or(30) * 1_000),
            )
            .await
            .map_err(PostfixError::ssh)?;
        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn probe(&self) -> PostfixResult<()> {
        #[cfg(test)]
        if let Some(scripted_ssh) = &self.scripted_ssh {
            scripted_ssh.execute("true").map_err(PostfixError::ssh)?;
            return Ok(());
        }
        self.ssh.probe().await.map_err(PostfixError::ssh)
    }

    pub async fn disconnect(&self) -> PostfixResult<()> {
        #[cfg(test)]
        if self.scripted_ssh.is_some() {
            return Ok(());
        }
        self.ssh.disconnect().await.map_err(PostfixError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> PostfixResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    /// Read a regular file while treating only a confirmed absent path as optional.
    pub async fn read_remote_file_optional(&self, path: &str) -> PostfixResult<Option<String>> {
        let escaped_path = shell_escape(path);
        let command = format!(
            "stat_error=$(LC_ALL=C stat {escaped_path} 2>&1); stat_code=$?; \
             if [ \"$stat_code\" -ne 0 ]; then \
               if printf '%s' \"$stat_error\" | grep -Fq 'No such file or directory'; \
               then printf '%s' '{MISSING_FILE_MARKER}'; \
               else printf '%s\\n' \"$stat_error\" >&2; exit \"$stat_code\"; fi; \
             elif [ ! -f {escaped_path} ]; then printf '%s\\n' {} >&2; exit 65; \
             elif [ ! -r {escaped_path} ]; then printf '%s\\n' {} >&2; exit 66; \
             else cat {escaped_path}; fi",
            shell_escape(&format!("Remote path is not a regular file: {path}")),
            shell_escape(&format!("Remote file is not readable: {path}")),
        );
        let output = self.exec_ssh(&command).await?.stdout;
        if output == MISSING_FILE_MARKER {
            Ok(None)
        } else {
            Ok(Some(output))
        }
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
        if version.is_empty() {
            return Err(PostfixError::parse(
                "postconf returned an empty mail_version",
            ));
        }
        Ok(version)
    }

    pub async fn postconf(&self, param: &str) -> PostfixResult<String> {
        let out = self
            .exec_ssh(&format!("postconf {}", shell_escape(param)))
            .await?;
        let raw = out.stdout.trim().to_string();
        let value = raw
            .split_once('=')
            .map(|(_, value)| value.trim().to_string())
            .ok_or_else(|| {
                PostfixError::parse(format!(
                    "postconf returned malformed output for '{param}': {raw:?}"
                ))
            })?;
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
        let default_out = self.exec_ssh("postconf -d").await?;
        let mut defaults = std::collections::HashMap::new();
        for line in default_out.stdout.lines() {
            if let Some((k, v)) = line.split_once('=') {
                defaults.insert(k.trim().to_string(), v.trim().to_string());
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
            .exec_ssh(
                "queue_output=$(postqueue -j 2>&1); queue_code=$?; \
                 if [ \"$queue_code\" -eq 0 ]; then printf '%s\\n' \"$queue_output\"; \
                 elif printf '%s' \"$queue_output\" | grep -Eqi 'invalid option|unknown option|usage:'; \
                 then postqueue -p; else printf '%s\\n' \"$queue_output\" >&2; exit \"$queue_code\"; fi",
            )
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
            Err(error) => Ok(ConfigTestResult {
                success: false,
                output: error.to_string(),
                errors: vec![format!("Failed to execute postfix check: {error}")],
            }),
        }
    }
}

#[cfg(test)]
pub(crate) struct ScriptedSsh {
    responses: Mutex<VecDeque<Result<String, String>>>,
    commands: Mutex<Vec<String>>,
}

#[cfg(test)]
impl ScriptedSsh {
    fn new(responses: Vec<Result<String, String>>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            commands: Mutex::new(Vec::new()),
        }
    }

    fn execute(&self, command: &str) -> Result<String, String> {
        self.commands
            .lock()
            .expect("scripted SSH command lock")
            .push(command.to_string());
        self.responses
            .lock()
            .expect("scripted SSH response lock")
            .pop_front()
            .unwrap_or_else(|| Err(format!("No scripted SSH response for command: {command}")))
    }

    pub(crate) fn commands(&self) -> Vec<String> {
        self.commands
            .lock()
            .expect("scripted SSH command lock")
            .clone()
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
pub(crate) fn test_connection_config() -> PostfixConnectionConfig {
    PostfixConnectionConfig {
        host: "mail.example.test".into(),
        port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key: None,
        postfix_bin: None,
        config_dir: None,
        queue_dir: None,
        timeout_secs: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> PostfixConnectionConfig {
        test_connection_config()
    }

    #[tokio::test]
    async fn optional_file_only_swallows_the_explicit_absent_marker() {
        let (client, scripted) = PostfixClient::scripted(
            config(),
            vec![
                Ok(MISSING_FILE_MARKER.into()),
                Err("Command failed with exit code 66: permission denied".into()),
            ],
        );

        assert_eq!(
            client
                .read_remote_file_optional("/etc/postfix/virtual")
                .await
                .unwrap(),
            None
        );
        let error = client
            .read_remote_file_optional("/etc/postfix/virtual")
            .await
            .unwrap_err();
        assert!(error.message.contains("permission denied"));
        assert!(scripted.commands()[0].contains("Remote file is not readable"));
    }

    #[tokio::test]
    async fn malformed_postconf_output_is_not_an_empty_setting() {
        let (client, _) = PostfixClient::scripted(config(), vec![Ok("unexpected output".into())]);

        let error = client.postconf("mydomain").await.unwrap_err();
        assert!(matches!(
            error.kind,
            crate::error::PostfixErrorKind::ParseError
        ));
        assert!(error.message.contains("mydomain"));
    }

    #[tokio::test]
    async fn config_check_preserves_transport_failure_details() {
        let (client, _) = PostfixClient::scripted(
            config(),
            vec![Err("transport read: connection reset by peer".into())],
        );

        let result = client.check_config().await.unwrap();
        assert!(!result.success);
        assert!(result.output.contains("connection reset by peer"));
        assert!(result.errors[0].contains("connection reset by peer"));
    }
}
