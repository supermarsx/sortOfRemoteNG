// ── SftpService – session lifecycle management ──────────────────────────────

use crate::sftp::types::*;
use crate::sftp::upload_chunked::UploadHandle;
use chrono::Utc;
use log::{info, warn};
use secrecy::ExposeSecret;
use ssh2::Session;
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Host-key helpers ─────────────────────────────────────────────────────────

/// Outcome of checking a presented host key against the local known_hosts
/// store. Mirror of `ssh2::CheckResult`, decoupled so the policy decision is
/// pure and unit-testable without a live SSH session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostKeyCheck {
    Match,
    Mismatch,
    NotFound,
    Failure,
}

impl From<ssh2::CheckResult> for HostKeyCheck {
    fn from(r: ssh2::CheckResult) -> Self {
        match r {
            ssh2::CheckResult::Match => HostKeyCheck::Match,
            ssh2::CheckResult::Mismatch => HostKeyCheck::Mismatch,
            ssh2::CheckResult::NotFound => HostKeyCheck::NotFound,
            ssh2::CheckResult::Failure => HostKeyCheck::Failure,
        }
    }
}

/// What to do once the host key has passed the policy gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostKeyAction {
    /// Key is already trusted — proceed.
    Accept,
    /// Trust-on-first-use: record the key, then proceed.
    AcceptAndPersist,
}

/// Pure host-key policy decision. Returns the action to take, or an actionable
/// rejection reason. `Ignore` is handled by the caller before this is reached.
///
/// * `Match`     → always accept.
/// * `Failure`   → always reject (internal known_hosts error).
/// * `Mismatch`  → always reject under every non-`Ignore` policy (possible MITM).
/// * `NotFound`  → `Strict` rejects; `AcceptNew`/`Ask` trust-on-first-use.
fn decide_host_key_action(
    check: HostKeyCheck,
    policy: KnownHostsPolicy,
) -> Result<HostKeyAction, String> {
    match check {
        HostKeyCheck::Match => Ok(HostKeyAction::Accept),
        HostKeyCheck::Failure => {
            Err("internal error checking known_hosts.".to_string())
        }
        HostKeyCheck::Mismatch => Err(
            "the server key does not match the key recorded in known_hosts. \
             This may indicate a man-in-the-middle attack."
                .to_string(),
        ),
        HostKeyCheck::NotFound => match policy {
            KnownHostsPolicy::Strict => {
                Err("host is not in known_hosts and the policy is Strict.".to_string())
            }
            // AcceptNew and Ask both trust-on-first-use for unknown hosts;
            // neither ever silently accepts a *changed* key (Mismatch above).
            KnownHostsPolicy::AcceptNew | KnownHostsPolicy::Ask => {
                Ok(HostKeyAction::AcceptAndPersist)
            }
            // Reached only if a caller forgets to short-circuit Ignore.
            KnownHostsPolicy::Ignore => Ok(HostKeyAction::Accept),
        },
    }
}

/// Human-readable label for a host-key type (for logging only).
fn host_key_type_label(host_key_type: ssh2::HostKeyType) -> &'static str {
    match host_key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    }
}

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
    /// Active chunked uploads keyed by upload id (see `upload_chunked`).
    pub(crate) uploads: HashMap<String, UploadHandle>,
    /// Guards single-spawn of the idle-upload sweeper task.
    pub(crate) upload_sweeper_started: bool,
}

impl SftpService {
    /// Create a new service wrapped in the managed state type.
    pub fn new() -> SftpServiceState {
        Arc::new(Mutex::new(SftpService {
            sessions: HashMap::new(),
            bookmarks: Vec::new(),
            queue: Vec::new(),
            queue_running: false,
            uploads: HashMap::new(),
            upload_sweeper_started: false,
        }))
    }

    // ── Connect ──────────────────────────────────────────────────────────────

    pub async fn connect(
        &mut self,
        config: SftpConnectionConfig,
    ) -> Result<SftpSessionInfo, String> {
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
        let mut session =
            Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;

        if config.compress {
            session.set_compress(true);
        }

        session.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // ── Host-key verification (BEFORE any credential is sent) ─────────────
        // A MITM must be detected before authenticate() so that no password,
        // passphrase, or key material is ever transmitted to an unverified
        // server. Honors `config.known_hosts_policy`.
        Self::verify_host_key(&session, &config)?;

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
        session.set_keepalive(keepalive_interval > 0, keepalive_interval as u32);

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

    // ── Host-key verification ──────────────────────────────────────────────

    /// Verify the server host key against the configured `known_hosts_policy`
    /// BEFORE authentication, mirroring core SSH's host-key trust model.
    ///
    /// Policies:
    /// - `Strict` — reject if the host is unknown OR the key mismatches.
    ///   Only an exact match in `known_hosts` is accepted.
    /// - `AcceptNew` — trust-on-first-use: a previously unknown host is
    ///   recorded in `known_hosts` and accepted; a *mismatch* with a recorded
    ///   key is always rejected.
    /// - `Ask` — (default) behaves like `AcceptNew` for unknown hosts (records
    ///   and accepts on first use) but rejects on mismatch. The SFTP service has
    ///   no interactive prompt channel, so this is the safe non-interactive
    ///   analogue of core SSH's `Ask` — it never silently accepts a changed
    ///   key.
    /// - `Ignore` — explicit, dangerous opt-out: skip verification entirely
    ///   (e.g. throwaway/e2e hosts). Logged as a warning.
    ///
    /// On any rejection the connection is aborted with an actionable error
    /// before authenticate() runs, so no credential is sent to an unverified
    /// server.
    fn verify_host_key(session: &Session, config: &SftpConnectionConfig) -> Result<(), String> {
        if matches!(config.known_hosts_policy, KnownHostsPolicy::Ignore) {
            warn!(
                "SFTP host-key verification DISABLED (policy=Ignore) for {}:{} — connection is not protected against MITM",
                config.host, config.port
            );
            return Ok(());
        }

        let known_hosts_path = Self::known_hosts_path();

        let (host_key, key_type) = session
            .host_key()
            .ok_or_else(|| "Host-key verification failed: server presented no host key".to_string())?;
        let host_key = host_key.to_vec();

        let check_result = {
            let mut known_hosts = session
                .known_hosts()
                .map_err(|e| format!("Failed to create known_hosts handle: {}", e))?;
            // A missing/unreadable known_hosts file is fine — every host is
            // then "NotFound" and handled per-policy below.
            let _ = known_hosts
                .read_file(Path::new(&known_hosts_path), ssh2::KnownHostFileKind::OpenSSH);
            known_hosts.check_port(&config.host, config.port, &host_key)
        };

        let check = HostKeyCheck::from(check_result);
        match decide_host_key_action(check, config.known_hosts_policy)
            .map_err(|reason| format!(
                "Host-key verification FAILED for {}:{}: {} Connection aborted; no credentials were sent.{}",
                config.host,
                config.port,
                reason,
                match check {
                    HostKeyCheck::Mismatch => format!(
                        " Server key fingerprint {}. If the host key legitimately changed, remove \
                         the stale entry from {} and reconnect.",
                        Self::host_key_fingerprint(&host_key),
                        known_hosts_path
                    ),
                    HostKeyCheck::NotFound => format!(
                        " Add the host to {} or use a less strict known-hosts policy to connect.",
                        known_hosts_path
                    ),
                    _ => String::new(),
                }
            ))? {
            HostKeyAction::Accept => {
                info!("SFTP host key verified for {}:{}", config.host, config.port);
                Ok(())
            }
            HostKeyAction::AcceptAndPersist => {
                Self::persist_host_key(
                    session,
                    &known_hosts_path,
                    &config.host,
                    config.port,
                    &host_key,
                    key_type,
                )?;
                info!(
                    "SFTP host key for {}:{} accepted on first use and saved to known_hosts ({})",
                    config.host,
                    config.port,
                    host_key_type_label(key_type)
                );
                Ok(())
            }
        }
    }

    /// Default known_hosts path: `~/.ssh/known_hosts` (shared with core SSH so
    /// trust is consistent across the app).
    fn known_hosts_path() -> String {
        dirs::home_dir()
            .map(|p| p.join(".ssh").join("known_hosts"))
            .unwrap_or_else(|| Path::new("known_hosts").to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    /// SHA-256 hex fingerprint for actionable error messages.
    fn host_key_fingerprint(host_key: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(host_key);
        format!("SHA256:{}", hex::encode(hasher.finalize()))
    }

    /// Append a newly trusted host key to the known_hosts file (TOFU).
    fn persist_host_key(
        session: &Session,
        known_hosts_path: &str,
        host: &str,
        port: u16,
        host_key: &[u8],
        key_type: ssh2::HostKeyType,
    ) -> Result<(), String> {
        let mut known_hosts = session
            .known_hosts()
            .map_err(|e| format!("Failed to create known_hosts handle: {}", e))?;

        let _ = known_hosts.read_file(Path::new(known_hosts_path), ssh2::KnownHostFileKind::OpenSSH);

        let entry_name = if port == 22 {
            host.to_string()
        } else {
            format!("[{}]:{}", host, port)
        };

        known_hosts
            .add(
                &entry_name,
                host_key,
                "Added by SortOfRemoteNG (SFTP)",
                key_type.into(),
            )
            .map_err(|e| format!("Failed to add host key to known_hosts: {}", e))?;

        if let Some(parent) = Path::new(known_hosts_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create known_hosts directory: {}", e))?;
        }

        known_hosts
            .write_file(Path::new(known_hosts_path), ssh2::KnownHostFileKind::OpenSSH)
            .map_err(|e| format!("Failed to write known_hosts file: {}", e))?;

        Ok(())
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
            let passphrase = config
                .private_key_passphrase
                .as_ref()
                .map(|p| p.expose_secret().as_str());
            // ssh2 doesn't expose userauth_pubkey_memory; write to temp file
            let tmp_dir = std::env::temp_dir();
            let tmp_key = tmp_dir.join(format!("sorng_sftp_key_{}", uuid::Uuid::new_v4()));
            if std::fs::write(&tmp_key, key_data.expose_secret().as_bytes()).is_ok() {
                // Restrict permissions on the temp key file (Unix only)
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &tmp_key,
                        std::fs::Permissions::from_mode(0o600),
                    );
                }
                let result =
                    session.userauth_pubkey_file(&config.username, None, &tmp_key, passphrase);
                let _ = std::fs::remove_file(&tmp_key);
                result.map_err(|e| format!("Public-key (memory) auth failed: {}", e))?;
                if session.authenticated() {
                    return Ok("publickey-memory".to_string());
                }
            }
        }

        // 3. Private-key file
        if let Some(ref key_path) = config.private_key_path {
            let passphrase = config
                .private_key_passphrase
                .as_ref()
                .map(|p| p.expose_secret().as_str());
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
                        let passphrase = config
                            .private_key_passphrase
                            .as_ref()
                            .map(|p| p.expose_secret().as_str());
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
            let password = password.expose_secret();
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

    pub async fn realpath(&mut self, session_id: &str, path: &str) -> Result<String, String> {
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

#[cfg(test)]
mod host_key_tests {
    use super::{decide_host_key_action, HostKeyAction, HostKeyCheck};
    use crate::sftp::types::KnownHostsPolicy;

    #[test]
    fn matching_key_is_always_accepted() {
        for policy in [
            KnownHostsPolicy::Strict,
            KnownHostsPolicy::AcceptNew,
            KnownHostsPolicy::Ask,
            KnownHostsPolicy::Ignore,
        ] {
            assert_eq!(
                decide_host_key_action(HostKeyCheck::Match, policy),
                Ok(HostKeyAction::Accept),
                "Match must be accepted under {:?}",
                policy
            );
        }
    }

    #[test]
    fn mismatch_is_rejected_under_every_verifying_policy() {
        // Mismatch (possible MITM) is never accepted, regardless of policy.
        for policy in [
            KnownHostsPolicy::Strict,
            KnownHostsPolicy::AcceptNew,
            KnownHostsPolicy::Ask,
        ] {
            let result = decide_host_key_action(HostKeyCheck::Mismatch, policy);
            assert!(
                result.is_err(),
                "Mismatch must be rejected under {:?}, got {:?}",
                policy,
                result
            );
            assert!(
                result.unwrap_err().contains("man-in-the-middle"),
                "rejection reason should flag MITM"
            );
        }
    }

    #[test]
    fn unknown_host_is_rejected_under_strict() {
        let result = decide_host_key_action(HostKeyCheck::NotFound, KnownHostsPolicy::Strict);
        assert!(result.is_err(), "Strict must reject an unknown host");
        assert!(result.unwrap_err().contains("Strict"));
    }

    #[test]
    fn unknown_host_is_tofu_under_accept_new_and_ask() {
        for policy in [KnownHostsPolicy::AcceptNew, KnownHostsPolicy::Ask] {
            assert_eq!(
                decide_host_key_action(HostKeyCheck::NotFound, policy),
                Ok(HostKeyAction::AcceptAndPersist),
                "{:?} should trust-on-first-use and persist",
                policy
            );
        }
    }

    #[test]
    fn internal_failure_is_always_rejected() {
        for policy in [
            KnownHostsPolicy::Strict,
            KnownHostsPolicy::AcceptNew,
            KnownHostsPolicy::Ask,
        ] {
            assert!(
                decide_host_key_action(HostKeyCheck::Failure, policy).is_err(),
                "Failure must be rejected under {:?}",
                policy
            );
        }
    }
}
