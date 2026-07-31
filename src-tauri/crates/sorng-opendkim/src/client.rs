// ── sorng-opendkim – SSH/CLI client ──────────────────────────────────────────
//! Executes opendkim commands on a remote host via SSH.
//! Handles config file reading/writing, key management, and process control.

use crate::error::{OpendkimError, OpendkimResult};
use crate::types::*;
use log::debug;
use sorng_ssh::ssh::integration::{ExternalSshConfig, IntegrationSshSession};
#[cfg(test)]
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

const MISSING_FILE_MARKER: &str = "__SORNG_REMOTE_FILE_ABSENT_7D9360E9__";

/// OpenDKIM management client – connects via SSH to manage opendkim remotely.
pub struct OpendkimClient {
    pub config: OpendkimConnectionConfig,
    ssh: IntegrationSshSession,
    #[cfg(test)]
    scripted_ssh: Option<Arc<ScriptedSsh>>,
}

impl OpendkimClient {
    pub fn new(config: OpendkimConnectionConfig) -> OpendkimResult<Self> {
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
        config: OpendkimConnectionConfig,
        responses: Vec<Result<String, String>>,
    ) -> (Self, Arc<ScriptedSsh>) {
        let scripted_ssh = Arc::new(ScriptedSsh::new(responses));
        let mut client = Self::new(config).expect("scripted OpenDKIM client");
        client.scripted_ssh = Some(Arc::clone(&scripted_ssh));
        (client, scripted_ssh)
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
        debug!("Executing OpenDKIM SSH command on {}", self.config.host);
        #[cfg(test)]
        if let Some(scripted_ssh) = &self.scripted_ssh {
            let stdout = scripted_ssh.execute(command).map_err(OpendkimError::ssh)?;
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
            .map_err(OpendkimError::ssh)?;
        Ok(SshOutput {
            stdout,
            stderr: String::new(),
            exit_code: 0,
        })
    }

    pub async fn probe(&self) -> OpendkimResult<()> {
        #[cfg(test)]
        if let Some(scripted_ssh) = &self.scripted_ssh {
            scripted_ssh.execute("true").map_err(OpendkimError::ssh)?;
            return Ok(());
        }
        self.ssh.probe().await.map_err(OpendkimError::ssh)
    }

    pub async fn disconnect(&self) -> OpendkimResult<()> {
        #[cfg(test)]
        if self.scripted_ssh.is_some() {
            return Ok(());
        }
        self.ssh.disconnect().await.map_err(OpendkimError::ssh)
    }

    pub async fn read_remote_file(&self, path: &str) -> OpendkimResult<String> {
        let out = self
            .exec_ssh(&format!("cat {}", shell_escape(path)))
            .await?;
        Ok(out.stdout)
    }

    /// Read a regular file while treating only a confirmed absent path as optional.
    pub async fn read_remote_file_optional(&self, path: &str) -> OpendkimResult<Option<String>> {
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
        self.list_remote_dir_optional(path)
            .await?
            .ok_or_else(|| OpendkimError::io(format!("Remote directory does not exist: {path}")))
    }

    /// List a directory while treating only a confirmed absent path as optional.
    pub async fn list_remote_dir_optional(
        &self,
        path: &str,
    ) -> OpendkimResult<Option<Vec<String>>> {
        let escaped_path = shell_escape(path);
        let command = format!(
            "stat_error=$(LC_ALL=C stat {escaped_path} 2>&1); stat_code=$?; \
             if [ \"$stat_code\" -ne 0 ]; then \
               if printf '%s' \"$stat_error\" | grep -Fq 'No such file or directory'; \
               then printf '%s' '{MISSING_FILE_MARKER}'; \
               else printf '%s\\n' \"$stat_error\" >&2; exit \"$stat_code\"; fi; \
             elif [ ! -d {escaped_path} ]; then printf '%s\\n' {} >&2; exit 65; \
             elif [ ! -r {escaped_path} ]; then printf '%s\\n' {} >&2; exit 66; \
             else ls -1 {escaped_path}; fi",
            shell_escape(&format!("Remote path is not a directory: {path}")),
            shell_escape(&format!("Remote directory is not readable: {path}")),
        );
        let output = self.exec_ssh(&command).await?.stdout;
        if output == MISSING_FILE_MARKER {
            Ok(None)
        } else {
            Ok(Some(
                output
                    .lines()
                    .filter(|line| !line.is_empty())
                    .map(String::from)
                    .collect(),
            ))
        }
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
        if version.is_empty() {
            return Err(OpendkimError::parse(
                "opendkim returned an empty version string",
            ));
        }
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
        let out = self
            .exec_ssh(
                "state=$(systemctl is-active opendkim 2>&1); code=$?; \
                 if [ \"$code\" -eq 0 ] || [ \"$code\" -eq 3 ]; then printf '%s\\n' \"$state\"; \
                 else printf '%s\\n' \"$state\" >&2; exit \"$code\"; fi",
            )
            .await?;
        Ok(out.stdout.trim().to_string())
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
pub(crate) fn test_connection_config() -> OpendkimConnectionConfig {
    OpendkimConnectionConfig {
        host: "mail.example.test".into(),
        port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key: None,
        opendkim_bin: None,
        config_path: None,
        key_dir: None,
        timeout_secs: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> OpendkimConnectionConfig {
        test_connection_config()
    }

    #[tokio::test]
    async fn optional_file_propagates_permission_failure() {
        let (client, _) = OpendkimClient::scripted(
            config(),
            vec![Err(
                "Command failed with exit code 66: private key is not readable".into(),
            )],
        );

        let error = client
            .read_remote_file_optional("/etc/opendkim/keys/example/default.private")
            .await
            .unwrap_err();
        assert!(error.message.contains("not readable"));
    }

    #[tokio::test]
    async fn empty_version_is_rejected() {
        let (client, _) = OpendkimClient::scripted(config(), vec![Ok(String::new())]);

        let error = client.version().await.unwrap_err();
        assert!(matches!(
            error.kind,
            crate::error::OpendkimErrorKind::ParseError
        ));
    }

    #[tokio::test]
    async fn inactive_is_a_valid_status_but_transport_errors_are_not() {
        let (client, scripted) = OpendkimClient::scripted(
            config(),
            vec![
                Ok("inactive\n".into()),
                Err("transport read: broken pipe".into()),
            ],
        );

        assert_eq!(client.status().await.unwrap(), "inactive");
        assert!(client
            .status()
            .await
            .unwrap_err()
            .message
            .contains("broken pipe"));
        assert!(scripted.commands()[0].contains("\"$code\" -eq 3"));
    }
}
