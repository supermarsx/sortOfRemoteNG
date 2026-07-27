// ── sorng-procmail – SSH/CLI client ──────────────────────────────────────────
//! Executes procmail commands on a remote host via SSH.
//! Handles procmailrc reading/writing, recipe management, and log queries.

use crate::error::{ProcmailError, ProcmailResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
#[cfg(test)]
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

const MISSING_FILE_MARKER: &str = "__SORNG_REMOTE_FILE_ABSENT_7D9360E9__";
const DIAGNOSTIC_EXIT_MARKER: &str = "__SORNG_REMOTE_EXIT_69A3E10C__:";

/// Procmail management client – connects via SSH to manage procmail remotely.
pub struct ProcmailClient {
    pub config: ProcmailConnectionConfig,
    ssh: IntegrationSshSession,
    #[cfg(test)]
    scripted_ssh: Option<Arc<ScriptedSsh>>,
}

impl ProcmailClient {
    pub fn new(config: ProcmailConnectionConfig) -> ProcmailResult<Self> {
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
        config: ProcmailConnectionConfig,
        responses: Vec<Result<String, String>>,
    ) -> (Self, Arc<ScriptedSsh>) {
        let scripted_ssh = Arc::new(ScriptedSsh::new(responses));
        let mut client = Self::new(config).expect("scripted Procmail client");
        client.scripted_ssh = Some(Arc::clone(&scripted_ssh));
        (client, scripted_ssh)
    }

    // ── Paths ────────────────────────────────────────────────────────

    pub fn procmail_bin(&self) -> &str {
        self.config
            .procmail_bin
            .as_deref()
            .unwrap_or("/usr/bin/procmail")
    }

    pub fn procmailrc_path(&self) -> &str {
        self.config
            .procmailrc_path
            .as_deref()
            .unwrap_or("/etc/procmailrc")
    }

    pub fn log_path(&self) -> &str {
        self.config
            .log_path
            .as_deref()
            .unwrap_or("/var/log/procmail.log")
    }

    /// Return the per-user procmailrc path (~user/.procmailrc).
    pub fn user_rc_path(&self, user: &str) -> String {
        if user == "root" {
            "/root/.procmailrc".to_string()
        } else {
            format!("/home/{}/.procmailrc", user)
        }
    }

    // ── SSH command execution stub ───────────────────────────────────
    //
    // In practice these would call through the app's SSH infrastructure.
    // We model them as async methods returning structured types.

    pub async fn exec_ssh(&self, command: &str) -> ProcmailResult<SshOutput> {
        debug!("PROCMAIL SSH [{}]: {}", self.config.host, command);
        #[cfg(test)]
        if let Some(scripted_ssh) = &self.scripted_ssh {
            let stdout = scripted_ssh.execute(command).map_err(ProcmailError::ssh)?;
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
            .map_err(ProcmailError::ssh)?;
        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn probe(&self) -> ProcmailResult<()> {
        #[cfg(test)]
        if let Some(scripted_ssh) = &self.scripted_ssh {
            scripted_ssh.execute("true").map_err(ProcmailError::ssh)?;
            return Ok(());
        }
        self.ssh.probe().await.map_err(ProcmailError::ssh)
    }

    /// Run a diagnostic command without turning its domain exit status into an
    /// SSH transport error. The wrapper itself still fails closed.
    pub async fn exec_ssh_diagnostic(&self, command: &str) -> ProcmailResult<(String, i32)> {
        let wrapped = format!(
            "{{ {command}; }}; sorng_exit=$?; printf '\\n{DIAGNOSTIC_EXIT_MARKER}%s\\n' \
             \"$sorng_exit\"; exit 0"
        );
        let stdout = self.exec_ssh(&wrapped).await?.stdout;
        let (output, exit_text) = stdout.rsplit_once(DIAGNOSTIC_EXIT_MARKER).ok_or_else(|| {
            ProcmailError::parse("Diagnostic command did not report its exit status")
        })?;
        let exit_code = exit_text.trim().parse::<i32>().map_err(|error| {
            ProcmailError::parse(&format!(
                "Invalid diagnostic exit status {exit_text:?}: {error}"
            ))
        })?;
        Ok((output.trim_end_matches('\n').to_string(), exit_code))
    }

    pub async fn disconnect(&self) -> ProcmailResult<()> {
        #[cfg(test)]
        if self.scripted_ssh.is_some() {
            return Ok(());
        }
        self.ssh.disconnect().await.map_err(ProcmailError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> ProcmailResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    /// Read a regular file while treating only a confirmed absent path as optional.
    pub async fn read_remote_file_optional(&self, path: &str) -> ProcmailResult<Option<String>> {
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

    pub async fn write_remote_file(&self, path: &str, content: &str) -> ProcmailResult<()> {
        let escaped = content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | sudo tee {} > /dev/null",
            escaped,
            shell_escape(path)
        );
        self.exec_ssh(&cmd).await?;
        Ok(())
    }

    pub async fn file_exists(&self, path: &str) -> ProcmailResult<bool> {
        let out = self
            .exec_ssh(&format!(
                "test -f {} && echo yes || echo no",
                shell_escape(path)
            ))
            .await?;
        Ok(out.stdout.trim() == "yes")
    }

    // ── Procmail core commands ───────────────────────────────────────

    pub async fn version(&self) -> ProcmailResult<String> {
        let out = self
            .exec_ssh(&format!("{} -v 2>&1", self.procmail_bin()))
            .await?;
        // procmail -v outputs version on the first line
        let ver = out.stdout.lines().next().unwrap_or("").trim().to_string();
        if ver.is_empty() {
            return Err(ProcmailError::parse(
                "procmail returned an empty version string",
            ));
        }
        Ok(ver)
    }

    /// Read the procmailrc file for a specific user (or global if user is empty).
    pub async fn get_procmailrc(&self, user: &str) -> ProcmailResult<String> {
        let path = if user.is_empty() {
            self.procmailrc_path().to_string()
        } else {
            self.user_rc_path(user)
        };
        Ok(self
            .read_remote_file_optional(&path)
            .await?
            .unwrap_or_default())
    }

    /// Write the procmailrc file for a specific user (or global if user is empty).
    pub async fn write_procmailrc(&self, user: &str, content: &str) -> ProcmailResult<()> {
        let path = if user.is_empty() {
            self.procmailrc_path().to_string()
        } else {
            self.user_rc_path(user)
        };
        self.write_remote_file(&path, content).await?;
        // Ensure correct permissions (0644 for procmailrc)
        self.exec_ssh(&format!("chmod 0644 {}", shell_escape(&path)))
            .await?;
        Ok(())
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
pub(crate) fn test_connection_config() -> ProcmailConnectionConfig {
    ProcmailConnectionConfig {
        host: "mail.example.test".into(),
        port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key: None,
        procmail_bin: None,
        procmailrc_path: None,
        log_path: None,
        timeout_secs: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ProcmailConnectionConfig {
        test_connection_config()
    }

    #[tokio::test]
    async fn missing_procmailrc_is_empty_but_permission_failure_is_not() {
        let (client, _) = ProcmailClient::scripted(
            config(),
            vec![
                Ok(MISSING_FILE_MARKER.into()),
                Err("Command failed with exit code 66: permission denied".into()),
            ],
        );

        assert_eq!(client.get_procmailrc("").await.unwrap(), "");
        let error = client.get_procmailrc("").await.unwrap_err();
        assert!(error.message.contains("permission denied"));
    }

    #[tokio::test]
    async fn empty_version_is_rejected() {
        let (client, _) = ProcmailClient::scripted(config(), vec![Ok(String::new())]);

        let error = client.version().await.unwrap_err();
        assert!(matches!(
            error.kind,
            crate::error::ProcmailErrorKind::ParseError
        ));
    }

    #[tokio::test]
    async fn diagnostic_exit_status_is_parsed_without_hiding_transport_errors() {
        let (client, _) = ProcmailClient::scripted(
            config(),
            vec![
                Ok(format!("syntax error\n{DIAGNOSTIC_EXIT_MARKER}78\n")),
                Err("transport read: connection reset".into()),
            ],
        );

        let (output, exit_code) = client.exec_ssh_diagnostic("procmail -m rc").await.unwrap();
        assert_eq!(output, "syntax error");
        assert_eq!(exit_code, 78);
        assert!(client
            .exec_ssh_diagnostic("procmail -m rc")
            .await
            .unwrap_err()
            .message
            .contains("connection reset"));
    }

    #[test]
    fn root_procmailrc_uses_roots_home() {
        let client = ProcmailClient::new(config()).unwrap();
        assert_eq!(client.user_rc_path("root"), "/root/.procmailrc");
    }
}
