//! Shared SSH transports for integrations.
//!
//! [`IntegrationSshSession`] is the actor-backed, retained integration
//! transport. All integrations use it rather than spawning one-shot clients.

use secrecy::SecretString;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::process::{Output, Stdio};
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Mutex;

use super::{service::SshService, types::SshConnectionConfig};

/// Compatibility capture budget used by [`IntegrationSshSession::execute`].
///
/// The budget is shared by stdout and stderr so a remote process cannot force
/// two independent maximum-sized allocations.
pub const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES: usize = 8 * 1024 * 1024;

/// Absolute capture ceiling accepted by the shared integration transport.
pub const MAX_COMMAND_OUTPUT_LIMIT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_COMMAND_INPUT_LIMIT_BYTES: usize = 8 * 1024 * 1024;

const MAX_COMMAND_ERROR_BYTES: usize = 64 * 1024;
const LOCAL_COMMAND_TIMEOUT_MS: u64 = 300_000;
const LOCAL_COMMAND_STDOUT_LIMIT_BYTES: usize = 8 * 1024 * 1024;
const LOCAL_COMMAND_STDERR_LIMIT_BYTES: usize = 64 * 1024;
const LOCAL_COMMAND_STDIN_LIMIT_BYTES: usize = 8 * 1024 * 1024;

/// Adds a bounded, timed replacement for Tokio's allocation-unbounded
/// `Command::output`.
pub trait BoundedCommandExt {
    fn output_bounded(&mut self) -> Pin<Box<dyn Future<Output = io::Result<Output>> + Send + '_>>;
}

impl BoundedCommandExt for Command {
    fn output_bounded(&mut self) -> Pin<Box<dyn Future<Output = io::Result<Output>> + Send + '_>> {
        Box::pin(run_local_command_bounded(self, None))
    }
}

/// Run a local command with bounded output, a finite deadline, and bounded
/// stdin. This is the safe counterpart used by integrations that need to pipe
/// configuration data into a child process.
pub async fn output_bounded_with_input(command: &mut Command, input: &[u8]) -> io::Result<Output> {
    run_local_command_bounded(command, Some(input)).await
}

async fn run_local_command_bounded(
    command: &mut Command,
    input: Option<&[u8]>,
) -> io::Result<Output> {
    if input.map_or(false, |data| data.len() > LOCAL_COMMAND_STDIN_LIMIT_BYTES) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Local command input exceeds the 8 MiB limit",
        ));
    }

    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::Other,
            "Failed to capture local command stdout",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::Other,
            "Failed to capture local command stderr",
        )
    })?;
    let child_stdin = child.stdin.take();

    let write_input = async move {
        if let (Some(mut stdin), Some(data)) = (child_stdin, input) {
            stdin.write_all(data).await?;
            stdin.shutdown().await?;
        }
        Ok::<(), io::Error>(())
    };

    let outcome = tokio::time::timeout(
        std::time::Duration::from_millis(LOCAL_COMMAND_TIMEOUT_MS),
        async {
            let (status, stdout, stderr, input_result) = tokio::join!(
                child.wait(),
                read_local_output_bounded(stdout, LOCAL_COMMAND_STDOUT_LIMIT_BYTES),
                read_local_output_bounded(stderr, LOCAL_COMMAND_STDERR_LIMIT_BYTES),
                write_input
            );
            let status = status?;
            let (stdout, stdout_truncated) = stdout?;
            let (stderr, stderr_truncated) = stderr?;
            input_result?;
            Ok::<_, io::Error>((status, stdout, stderr, stdout_truncated, stderr_truncated))
        },
    )
    .await;

    match outcome {
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Local command timed out after 300 seconds",
            ))
        }
        Ok(Err(error)) => Err(error),
        Ok(Ok((status, stdout, stderr, stdout_truncated, stderr_truncated))) => {
            if stdout_truncated || stderr_truncated {
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    "Local command output exceeded the capture limit",
                ));
            }
            Ok(Output {
                status,
                stdout,
                stderr,
            })
        }
    }
}

async fn read_local_output_bounded<R>(mut reader: R, limit: usize) -> io::Result<(Vec<u8>, bool)>
where
    R: AsyncRead + Unpin,
{
    let mut captured = Vec::with_capacity(limit.min(16 * 1024));
    let mut truncated = false;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let bytes_read = reader.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(captured.len());
        let retained = remaining.min(bytes_read);
        captured.extend_from_slice(&buffer[..retained]);
        truncated |= retained < bytes_read;
    }
    Ok((captured, truncated))
}

/// Bounded output returned by an integration SSH command.
///
/// Both streams are drained through EOF even after the capture budget is
/// exhausted. `stdout_truncated` and `stderr_truncated` identify which stream
/// produced discarded bytes, and `exit_status` remains available even when the
/// command failed or output was truncated.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SshCommandOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_status: i32,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub capture_limit_bytes: usize,
}

impl SshCommandOutput {
    pub fn was_truncated(&self) -> bool {
        self.stdout_truncated || self.stderr_truncated
    }
}

/// Credentials and transport policy for a retained integration SSH session.
#[derive(Clone, Copy, Debug)]
pub struct ExternalSshConfig<'a> {
    pub host: &'a str,
    pub username: &'a str,
    pub port: u16,
    pub private_key: Option<&'a str>,
    pub password: Option<&'a str>,
    pub connect_timeout_secs: u64,
}

/// A reusable actor-backed SSH transport for integrations.
///
/// It owns the same [`SshService`] session used by interactive SSH, preserving
/// a live authenticated transport while the integration client remains in its
/// service map. Commands are never replayed after a transport failure: the
/// session is invalidated and the next operation (or an explicit probe) opens a
/// fresh connection, avoiding duplicate writes for non-idempotent commands.
pub struct IntegrationSshSession {
    config: SshConnectionConfig,
    service: Arc<Mutex<SshService>>,
    session_id: Mutex<Option<String>>,
}

impl IntegrationSshSession {
    pub fn new(config: ExternalSshConfig<'_>) -> Self {
        Self {
            config: actor_config(config),
            service: SshService::new(),
            session_id: Mutex::new(None),
        }
    }

    /// Execute through the retained actor session, connecting once on first
    /// use. A failed transport is discarded so the following call reconnects.
    pub async fn execute(&self, command: &str, timeout_ms: Option<u64>) -> Result<String, String> {
        let mut service = self.service.lock().await;
        let mut session_id = self.session_id.lock().await;
        let id = match session_id.as_ref() {
            Some(id) => id.clone(),
            None => {
                let id = service
                    .connect_ssh(self.config.clone())
                    .await
                    .map_err(cap_command_error)?;
                *session_id = Some(id.clone());
                id
            }
        };

        match service
            .execute_command(&id, command.to_string(), timeout_ms)
            .await
        {
            Ok(output) => Ok(output),
            Err(error) => {
                if is_recoverable_transport_error(&error) {
                    if let Err(teardown_error) =
                        apply_teardown_result(&mut session_id, service.disconnect_ssh(&id).await)
                    {
                        return Err(cap_command_error(format!(
                            "{error}; failed to tear down retained SSH session {id}: {teardown_error}"
                        )));
                    }
                }
                Err(cap_command_error(error))
            }
        }
    }

    /// Execute with an explicit combined stdout/stderr capture budget.
    ///
    /// The remote streams are always drained through EOF. Command exit status
    /// and truncation are returned to the caller rather than converted into an
    /// error, while transport/protocol failures remain errors. Limits above
    /// [`MAX_COMMAND_OUTPUT_LIMIT_BYTES`] are rejected before execution.
    pub async fn execute_capped(
        &self,
        command: &str,
        timeout_ms: Option<u64>,
        max_output_bytes: usize,
    ) -> Result<SshCommandOutput, String> {
        let mut service = self.service.lock().await;
        let mut session_id = self.session_id.lock().await;
        let id = match session_id.as_ref() {
            Some(id) => id.clone(),
            None => {
                let id = service
                    .connect_ssh(self.config.clone())
                    .await
                    .map_err(cap_command_error)?;
                *session_id = Some(id.clone());
                id
            }
        };

        match service
            .execute_command_capped(&id, command.to_string(), timeout_ms, max_output_bytes)
            .await
        {
            Ok(output) => Ok(output),
            Err(error) => {
                if is_recoverable_transport_error(&error) {
                    if let Err(teardown_error) =
                        apply_teardown_result(&mut session_id, service.disconnect_ssh(&id).await)
                    {
                        return Err(cap_command_error(format!(
                            "{error}; failed to tear down retained SSH session {id}: {teardown_error}"
                        )));
                    }
                }
                Err(cap_command_error(error))
            }
        }
    }

    /// Execute with bounded data written directly to the SSH channel's stdin.
    /// The owned input is overwritten before its allocation is released.
    pub async fn execute_with_input(
        &self,
        command: &str,
        mut input: Vec<u8>,
        timeout_ms: Option<u64>,
    ) -> Result<String, String> {
        if input.len() > MAX_COMMAND_INPUT_LIMIT_BYTES {
            input.fill(0);
            return Err(format!(
                "SSH command input exceeds the {} byte limit",
                MAX_COMMAND_INPUT_LIMIT_BYTES
            ));
        }

        let mut service = self.service.lock().await;
        let mut session_id = self.session_id.lock().await;
        let id = match session_id.as_ref() {
            Some(id) => id.clone(),
            None => match service.connect_ssh(self.config.clone()).await {
                Ok(id) => {
                    *session_id = Some(id.clone());
                    id
                }
                Err(error) => {
                    input.fill(0);
                    return Err(cap_command_error(error));
                }
            },
        };

        match service
            .execute_command_capped_with_input(
                &id,
                command.to_string(),
                timeout_ms,
                DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES,
                Some(input),
            )
            .await
        {
            Ok(output) if output.exit_status != 0 => Err(format!(
                "Command failed with exit code {}",
                output.exit_status
            )),
            Ok(output) if output.was_truncated() => Err(format!(
                "Command output exceeded the {} byte capture limit",
                output.capture_limit_bytes
            )),
            Ok(output) => String::from_utf8(output.stdout)
                .map_err(|_| "SSH command returned non-UTF-8 output".to_string()),
            Err(error) => {
                if is_recoverable_transport_error(&error) {
                    if let Err(teardown_error) =
                        apply_teardown_result(&mut session_id, service.disconnect_ssh(&id).await)
                    {
                        return Err(cap_command_error(format!(
                            "{error}; failed to tear down retained SSH session {id}: {teardown_error}"
                        )));
                    }
                }
                Err(cap_command_error(error))
            }
        }
    }

    /// A safe, idempotent liveness probe. It reconnects and retries once when
    /// an old transport has been dropped by the peer or network.
    pub async fn probe(&self) -> Result<(), String> {
        match self.execute("true", Some(15_000)).await {
            Ok(_) => Ok(()),
            Err(first_error) if is_recoverable_transport_error(&first_error) => {
                self.execute("true", Some(15_000)).await.map(|_| ())
            }
            Err(error) => Err(error),
        }
    }

    pub async fn is_connected(&self) -> bool {
        self.session_id.lock().await.is_some()
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        let mut service = self.service.lock().await;
        let mut session_id = self.session_id.lock().await;
        if let Some(id) = session_id.as_ref().cloned() {
            apply_teardown_result(&mut session_id, service.disconnect_ssh(&id).await)?;
        }
        Ok(())
    }
}

fn apply_teardown_result(
    session_id: &mut Option<String>,
    result: Result<(), String>,
) -> Result<(), String> {
    match result {
        Ok(()) => {
            *session_id = None;
            Ok(())
        }
        Err(error) if error == "Session not found" => {
            *session_id = None;
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn actor_config(config: ExternalSshConfig<'_>) -> SshConnectionConfig {
    SshConnectionConfig {
        host: config.host.to_string(),
        port: config.port,
        username: config.username.to_string(),
        password: config
            .password
            .map(|value| SecretString::new(value.to_string())),
        private_key_path: config.private_key.map(str::to_string),
        private_key_passphrase: None,
        jump_hosts: vec![],
        proxy_config: None,
        proxy_chain: None,
        mixed_chain: None,
        openvpn_config: None,
        connect_timeout: Some(config.connect_timeout_secs),
        keep_alive_interval: Some(15),
        // Preserve OpenSSH's previous `accept-new` semantics: TOFU keys are
        // persisted, while a known-host mismatch remains a hard error.
        strict_host_key_checking: true,
        accept_new_host_keys: true,
        known_hosts_path: None,
        totp_secret: None,
        keyboard_interactive_responses: vec![],
        agent_forwarding: false,
        tcp_no_delay: true,
        tcp_keepalive: true,
        keepalive_probes: 3,
        ip_protocol: "auto".to_string(),
        compression: false,
        compression_level: 6,
        compression_config: Default::default(),
        ssh_version: "auto".to_string(),
        preferred_ciphers: vec![],
        preferred_macs: vec![],
        preferred_kex: vec![],
        preferred_host_key_algorithms: vec![],
        x11_forwarding: None,
        proxy_command: None,
        pty_type: None,
        environment: Default::default(),
        sk_auth: false,
        sk_device_path: None,
        sk_pin: None,
        sk_application: None,
    }
}

fn is_recoverable_transport_error(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error == "session not found"
        || error.starts_with("failed to create channel:")
        || error.starts_with("failed to execute command:")
        || error.starts_with("failed to read ssh command stdout:")
        || error.starts_with("failed to read ssh command stderr:")
        || error.starts_with("failed to write ssh command input:")
        || error.starts_with("failed to close ssh command input:")
        || error.starts_with("failed to close ssh command channel:")
        || error.contains("connection reset")
        || error.contains("broken pipe")
        || error.starts_with("ssh command timed out")
}

fn cap_command_error(mut error: String) -> String {
    if error.len() <= MAX_COMMAND_ERROR_BYTES {
        return error;
    }

    let mut boundary = MAX_COMMAND_ERROR_BYTES;
    while !error.is_char_boundary(boundary) {
        boundary -= 1;
    }
    error.truncate(boundary);
    error.push_str(" [error truncated]");
    error
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retained_transport_uses_tofu_and_actor_keepalives() {
        let config = actor_config(ExternalSshConfig {
            host: "mail.example.test",
            username: "admin",
            port: 2222,
            private_key: None,
            password: None,
            connect_timeout_secs: 12,
        });

        assert!(config.strict_host_key_checking);
        assert!(config.accept_new_host_keys);
        assert_eq!(config.keep_alive_interval, Some(15));
        assert_eq!(config.keepalive_probes, 3);
    }

    #[tokio::test]
    async fn retained_transport_disconnect_is_idempotent_before_connection() {
        let session = IntegrationSshSession::new(ExternalSshConfig {
            host: "mail.example.test",
            username: "admin",
            port: 2222,
            private_key: None,
            password: None,
            connect_timeout_secs: 12,
        });

        assert!(!session.is_connected().await);
        session.disconnect().await.unwrap();
        session.disconnect().await.unwrap();
        assert!(!session.is_connected().await);
    }

    #[test]
    fn retained_actor_id_is_cleared_only_after_confirmed_absence() {
        let mut session_id = Some("retained-1".to_string());

        let error = apply_teardown_result(&mut session_id, Err("shell actor did not stop".into()))
            .unwrap_err();
        assert!(error.contains("did not stop"));
        assert_eq!(session_id.as_deref(), Some("retained-1"));

        apply_teardown_result(&mut session_id, Err("Session not found".into())).unwrap();
        assert!(session_id.is_none());

        session_id = Some("retained-2".to_string());
        apply_teardown_result(&mut session_id, Ok(())).unwrap();
        assert!(session_id.is_none());
    }
}
