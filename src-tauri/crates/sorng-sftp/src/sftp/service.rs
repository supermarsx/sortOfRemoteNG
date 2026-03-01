// ── SftpService – session lifecycle management ──────────────────────────────

use crate::sftp::types::*;
use chrono::Utc;
use log::{info, warn};
use ssh2::Session;
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Internal session handle (not serialised to the frontend) ─────────────────

pub(crate) struct SftpSessionHandle {
    pub info: SftpSessionInfo,
    pub session: Session,
    #[allow(dead_code)] // held to keep the TCP connection alive
    pub tcp: TcpStream,
    pub keepalive_tx: Option<tokio::sync::mpsc::Sender<()>>,
}

// ── Service struct ───────────────────────────────────────────────────────────

pub struct SftpService {
    pub(crate) sessions: HashMap<String, SftpSessionHandle>,
    pub(crate) bookmarks: Vec<SftpBookmark>,
    pub(crate) queue: Vec<QueueEntry>,
    pub(crate) queue_running: bool,
}

impl SftpService {
    /// Create a new service wrapped in the managed state type.
    pub fn new() -> SftpServiceState {
        Arc::new(Mutex::new(SftpService {
            sessions: HashMap::new(),
            bookmarks: Vec::new(),
            queue: Vec::new(),
            queue_running: false,
        }))
    }

    // ── Connect ──────────────────────────────────────────────────────────────

    pub async fn connect(&mut self, config: SftpConnectionConfig) -> Result<SftpSessionInfo, String> {
        let addr = format!("{}:{}", config.host, config.port);
        info!("SFTP connecting to {}", addr);

        // TCP connection with timeout
        let tcp = TcpStream::connect_timeout(
            &addr
                .parse()
                .map_err(|e| format!("Invalid address '{}': {}", addr, e))?,
            std::time::Duration::from_secs(config.timeout_secs),
        )
        .map_err(|e| format!("TCP connection to {} failed: {}", addr, e))?;

        tcp.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;

        // SSH handshake
        let mut session = Session::new()
            .map_err(|e| format!("Failed to create SSH session: {}", e))?;

        if config.compress {
            session.set_compress(true);
        }

        session.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Banner
        let banner = session.banner().map(|b| b.to_string());

        // ── Authentication ───────────────────────────────────────────────────

        let auth_method = self
            .authenticate(&mut session, &config)
            .map_err(|e| format!("Authentication failed: {}", e))?;

        if !session.authenticated() {
            return Err("Authentication failed – not authenticated after auth attempt".into());
        }

        info!("SFTP authenticated to {} via {}", addr, auth_method);

        // Probe the remote home directory
        let remote_home = self.probe_remote_home(&session);

        let initial_dir = config
            .initial_directory
            .clone()
            .or_else(|| remote_home.clone())
            .unwrap_or_else(|| "/".to_string());

        // Keep-alive
        let keepalive_interval = config.keepalive_interval_secs;
        session
            .set_keepalive(keepalive_interval > 0, keepalive_interval as u32);

        let session_id = Uuid::new_v4().to_string();
        let now = Utc::now();

        let info = SftpSessionInfo {
            id: session_id.clone(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            auth_method: auth_method.clone(),
            connected: true,
            label: config.label.clone(),
            color_tag: config.color_tag.clone(),
            server_banner: banner,
            remote_home: remote_home.clone(),
            current_directory: initial_dir,
            connected_at: now,
            last_activity: now,
            bytes_uploaded: 0,
            bytes_downloaded: 0,
            operations_count: 0,
        };

        self.sessions.insert(
            session_id.clone(),
            SftpSessionHandle {
                info: info.clone(),
                session,
                tcp,
                keepalive_tx: None,
            },
        );

        Ok(info)
    }

    // ── Authentication helpers ───────────────────────────────────────────────

    fn authenticate(
        &self,
        session: &mut Session,
        config: &SftpConnectionConfig,
    ) -> Result<String, String> {
        // 1. Agent-based auth
        if config.use_agent {
            if let Ok(mut agent) = session.agent() {
                if agent.connect().is_ok() {
                    let _ = agent.list_identities();
                    let identities = agent.identities().unwrap_or_default();
                    for identity in identities {
                        if agent.userauth(&config.username, &identity).is_ok() {
                            return Ok("agent".to_string());
                        }
                    }
                }
            }
        }

        // 2. Private-key data (PEM in memory) — write to a temp file and use pubkey_file
        if let Some(ref key_data) = config.private_key_data {
            let passphrase = config.private_key_passphrase.as_deref();
            // ssh2 doesn't expose userauth_pubkey_memory; write to temp file
            let tmp_dir = std::env::temp_dir();
            let tmp_key = tmp_dir.join(format!("sorng_sftp_key_{}", uuid::Uuid::new_v4()));
            if std::fs::write(&tmp_key, key_data.as_bytes()).is_ok() {
                let result = session.userauth_pubkey_file(&config.username, None, &tmp_key, passphrase);
                let _ = std::fs::remove_file(&tmp_key);
                result.map_err(|e| format!("Public-key (memory) auth failed: {}", e))?;
                if session.authenticated() {
                    return Ok("publickey-memory".to_string());
                }
            }
        }

        // 3. Private-key file
        if let Some(ref key_path) = config.private_key_path {
            let passphrase = config.private_key_passphrase.as_deref();
            session
                .userauth_pubkey_file(&config.username, None, Path::new(key_path), passphrase)
                .map_err(|e| format!("Public-key (file) auth failed: {}", e))?;
            if session.authenticated() {
                return Ok("publickey".to_string());
            }
        }

        // 4. Default key paths (~/.ssh/id_rsa, id_ed25519, …)
        if config.password.is_none() {
            if let Some(ssh_dir) = dirs::home_dir().map(|h| h.join(".ssh")) {
                for name in &["id_ed25519", "id_rsa", "id_ecdsa"] {
                    let path = ssh_dir.join(name);
                    if path.exists() {
                        let passphrase = config.private_key_passphrase.as_deref();
                        if session
                            .userauth_pubkey_file(&config.username, None, &path, passphrase)
                            .is_ok()
                            && session.authenticated()
                        {
                            return Ok(format!("publickey-default({})", name));
                        }
                    }
                }
            }
        }

        // 5. Password / keyboard-interactive
        if let Some(ref password) = config.password {
            // Try password auth first
            if session
                .userauth_password(&config.username, password)
                .is_ok()
                && session.authenticated()
            {
                return Ok("password".to_string());
            }

            // Keyboard-interactive fallback
            let pw = password.clone();

            struct SimpleKbdHandler {
                password: String,
            }

            impl ssh2::KeyboardInteractivePrompt for SimpleKbdHandler {
                fn prompt(
                    &mut self,
                    _username: &str,
                    _instructions: &str,
                    prompts: &[ssh2::Prompt],
                ) -> Vec<String> {
                    prompts.iter().map(|_| self.password.clone()).collect()
                }
            }

            let mut handler = SimpleKbdHandler { password: pw };
            if session
                .userauth_keyboard_interactive(&config.username, &mut handler)
                .is_ok()
                && session.authenticated()
            {
                return Ok("keyboard-interactive".to_string());
            }
        }

        Err("No authentication method succeeded".to_string())
    }

    /// Try to detect the remote home directory via SFTP realpath(".")
    fn probe_remote_home(&self, session: &Session) -> Option<String> {
        session
            .sftp()
            .ok()
            .and_then(|sftp| sftp.realpath(Path::new(".")).ok())
            .map(|p| p.to_string_lossy().to_string())
    }

    // ── Disconnect ───────────────────────────────────────────────────────────

    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), String> {
        let handle = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        // Signal keepalive task to stop
        if let Some(tx) = &handle.keepalive_tx {
            let _ = tx.send(()).await;
        }

        // Graceful SSH disconnect
        let _ = handle
            .session
            .disconnect(None, "Client disconnecting", None);

        info!("SFTP session {} disconnected", session_id);
        Ok(())
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    pub async fn get_session_info(&self, session_id: &str) -> Result<SftpSessionInfo, String> {
        self.sessions
            .get(session_id)
            .map(|h| h.info.clone())
            .ok_or_else(|| format!("Session '{}' not found", session_id))
    }

    pub async fn list_sessions(&self) -> Vec<SftpSessionInfo> {
        self.sessions.values().map(|h| h.info.clone()).collect()
    }

    pub async fn set_current_directory(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<String, String> {
        let handle = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        // Resolve the path through the server
        let sftp = handle
            .session
            .sftp()
            .map_err(|e| format!("SFTP channel error: {}", e))?;

        let resolved = sftp
            .realpath(Path::new(path))
            .map_err(|e| format!("Path resolution failed for '{}': {}", path, e))?;

        let resolved_str = resolved.to_string_lossy().to_string();
        handle.info.current_directory = resolved_str.clone();
        handle.info.last_activity = Utc::now();
        handle.info.operations_count += 1;

        Ok(resolved_str)
    }

    pub async fn realpath(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<String, String> {
        let handle = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        let sftp = handle
            .session
            .sftp()
            .map_err(|e| format!("SFTP channel error: {}", e))?;

        let resolved = sftp
            .realpath(Path::new(path))
            .map_err(|e| format!("realpath failed for '{}': {}", path, e))?;

        handle.info.last_activity = Utc::now();
        handle.info.operations_count += 1;

        Ok(resolved.to_string_lossy().to_string())
    }

    /// Convenience: get an ssh2::Sftp handle for an active session.
    pub(crate) fn sftp_channel(
        &mut self,
        session_id: &str,
    ) -> Result<(ssh2::Sftp, &mut SftpSessionHandle), String> {
        let handle = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        let sftp = handle
            .session
            .sftp()
            .map_err(|e| format!("SFTP channel error: {}", e))?;

        handle.info.last_activity = Utc::now();
        handle.info.operations_count += 1;

        Ok((sftp, handle))
    }

    /// Check whether a session is still alive (send a keepalive).
    pub async fn ping(&mut self, session_id: &str) -> Result<bool, String> {
        let handle = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        match handle.session.keepalive_send() {
            Ok(_) => {
                handle.info.last_activity = Utc::now();
                Ok(true)
            }
            Err(e) => {
                warn!("Keepalive failed for {}: {}", session_id, e);
                handle.info.connected = false;
                Ok(false)
            }
        }
    }
}
