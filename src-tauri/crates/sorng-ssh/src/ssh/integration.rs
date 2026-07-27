//! Shared SSH transports for integrations.
//!
//! [`IntegrationSshSession`] is the actor-backed, retained integration
//! transport. All integrations use it rather than spawning one-shot clients.

use secrecy::SecretString;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::{service::SshService, types::SshConnectionConfig};

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
                let id = service.connect_ssh(self.config.clone()).await?;
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
                        return Err(format!(
                            "{error}; failed to tear down retained SSH session {id}: {teardown_error}"
                        ));
                    }
                }
                Err(error)
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
    [
        "session not found",
        "channel",
        "socket",
        "transport",
        "connection reset",
        "broken pipe",
        "failed to execute command",
        "failed to read output",
    ]
    .iter()
    .any(|needle| error.contains(needle))
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
