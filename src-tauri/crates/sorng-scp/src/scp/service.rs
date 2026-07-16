// ── ScpService – session lifecycle management ───────────────────────────────

use crate::scp::types::*;
use chrono::Utc;
use log::{info, warn};
use sha2::{Digest, Sha256};
use ssh2::Session;
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Host-key verification ───────────────────────────────────────────────────

/// Serialises in-process trust-on-first-use updates. Persistence uses an
/// append-only, flushed write so accepting one SCP host can never truncate or
/// replace unrelated entries in the user's OpenSSH known_hosts file.
static KNOWN_HOSTS_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Outcome of comparing the server key with the local OpenSSH known_hosts
/// store. Kept independent from libssh2 so policy is exhaustively unit tested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostKeyCheck {
    Match,
    Mismatch,
    NotFound,
    Failure,
}

impl From<ssh2::CheckResult> for HostKeyCheck {
    fn from(value: ssh2::CheckResult) -> Self {
        match value {
            ssh2::CheckResult::Match => Self::Match,
            ssh2::CheckResult::Mismatch => Self::Mismatch,
            ssh2::CheckResult::NotFound => Self::NotFound,
            ssh2::CheckResult::Failure => Self::Failure,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostKeyAction {
    Accept,
    AcceptAndPersist,
}

/// Decide a trust action without touching credentials or the network.
///
/// `Ask` deliberately rejects an unknown key. SCP currently has no host-key
/// challenge/response command, so silently treating Ask as AcceptNew would be
/// a security-policy bypass. A changed key is rejected by every policy except
/// the explicit dangerous opt-out (`Ignore`).
fn decide_host_key_action(
    check: HostKeyCheck,
    policy: ScpKnownHostsPolicy,
) -> Result<HostKeyAction, String> {
    if matches!(policy, ScpKnownHostsPolicy::Ignore) {
        return Ok(HostKeyAction::Accept);
    }

    match check {
        HostKeyCheck::Match => Ok(HostKeyAction::Accept),
        HostKeyCheck::Mismatch => Err(
            "the server key does not match the key recorded in known_hosts; this may indicate a man-in-the-middle attack"
                .to_string(),
        ),
        HostKeyCheck::Failure => {
            Err("the known_hosts store could not verify the server key".to_string())
        }
        HostKeyCheck::NotFound => match policy {
            ScpKnownHostsPolicy::AcceptNew => Ok(HostKeyAction::AcceptAndPersist),
            ScpKnownHostsPolicy::Strict => {
                Err("the host is unknown and Strict policy requires a pre-existing known_hosts entry".to_string())
            }
            ScpKnownHostsPolicy::Ask => Err(
                "the host is unknown and Ask policy requires interactive confirmation, but SCP has no host-key challenge/response channel"
                    .to_string(),
            ),
            ScpKnownHostsPolicy::Ignore => unreachable!("Ignore was handled above"),
        },
    }
}

/// Single security gate used by every code path that authenticates an SCP SSH
/// transport. Authentication cannot run when verification rejects.
pub(crate) fn verify_before_auth<T, R>(
    transport: &mut T,
    verify: impl FnOnce(&T) -> Result<(), String>,
    authenticate: impl FnOnce(&mut T) -> Result<R, String>,
) -> Result<R, String> {
    verify(transport)?;
    authenticate(transport)
}

fn normalized_network_host(host: &str) -> Result<&str, String> {
    validate_known_hosts_host(host)?;
    if host.starts_with('[') || host.ends_with(']') {
        return host
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "SCP host has invalid bracket notation; connection was not attempted".to_string()
            });
    }
    Ok(host)
}

fn literal_socket_address(host: &str, port: u16) -> Result<Option<SocketAddr>, String> {
    let host = normalized_network_host(host)?;
    Ok(host
        .parse::<IpAddr>()
        .ok()
        .map(|address| SocketAddr::new(address, port)))
}

pub(crate) fn display_endpoint(host: &str, port: u16) -> String {
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    if unbracketed.contains(':') {
        format!("[{unbracketed}]:{port}")
    } else {
        format!("{unbracketed}:{port}")
    }
}

fn unique_addresses(addresses: impl IntoIterator<Item = SocketAddr>) -> Vec<SocketAddr> {
    let mut seen = HashSet::new();
    addresses
        .into_iter()
        .filter(|address| seen.insert(*address))
        .collect()
}

/// Resolve and connect using one total deadline covering DNS and every
/// candidate address. Tokio owns the non-blocking DNS/connect work; the socket
/// is returned to blocking mode only after connection for synchronous libssh2.
pub(crate) async fn connect_tcp_with_timeout(
    host: &str,
    port: u16,
    timeout: std::time::Duration,
) -> Result<TcpStream, String> {
    let normalized = normalized_network_host(host)?;
    let endpoint = display_endpoint(host, port);
    let deadline = tokio::time::Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| format!("SCP connection timeout for {endpoint} is too large"))?;

    let addresses = if let Some(address) = literal_socket_address(host, port)? {
        vec![address]
    } else {
        let resolved =
            tokio::time::timeout_at(deadline, tokio::net::lookup_host((normalized, port)))
                .await
                .map_err(|_| format!("SCP address resolution for {endpoint} timed out"))?
                .map_err(|error| {
                    format!("SCP address resolution for {endpoint} failed: {error}")
                })?;
        unique_addresses(resolved)
    };

    if addresses.is_empty() {
        return Err(format!(
            "SCP address resolution for {endpoint} returned no addresses"
        ));
    }

    let address_count = addresses.len();
    let mut last_error = None;
    for (index, address) in addresses.into_iter().enumerate() {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Err(format!(
                "TCP connection to {endpoint} timed out before all resolved addresses could be tried"
            ));
        }

        // A black-holed first address (commonly IPv6 on an IPv4-only host)
        // must not consume the entire global deadline. Give every remaining
        // candidate an equal share of the remaining budget.
        let attempts_left = (address_count - index) as u32;
        let remaining = deadline.duration_since(now);
        let attempt_budget = remaining / attempts_left;
        let attempt_deadline = now
            .checked_add(attempt_budget)
            .map(|candidate| candidate.min(deadline))
            .unwrap_or(deadline);

        match tokio::time::timeout_at(attempt_deadline, tokio::net::TcpStream::connect(address))
            .await
        {
            Ok(Ok(stream)) => {
                let stream = stream.into_std().map_err(|error| {
                    format!("TCP connection to {endpoint} could not be handed to SSH: {error}")
                })?;
                stream.set_nonblocking(false).map_err(|error| {
                    format!("TCP connection to {endpoint} could not enter blocking mode: {error}")
                })?;
                return Ok(stream);
            }
            Ok(Err(error)) => last_error = Some(format!("{address}: {error}")),
            Err(_) => last_error = Some(format!("{address}: timed out")),
        }
    }

    Err(format!(
        "TCP connection to {endpoint} failed for every resolved address{}",
        last_error
            .map(|error| format!(" (last error: {error})"))
            .unwrap_or_default()
    ))
}

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

fn known_hosts_entry_name(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        let unbracketed = host
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .unwrap_or(host);
        format!("[{unbracketed}]:{port}")
    }
}

fn validate_known_hosts_host(host: &str) -> Result<(), String> {
    if host.is_empty() || host.chars().any(|character| character.is_control()) {
        return Err(
            "Host-key verification failed: host is empty or contains a control character; no credentials were sent"
                .to_string(),
        );
    }
    if host.chars().any(char::is_whitespace) {
        return Err(
            "Host-key verification failed: host contains whitespace; no credentials were sent"
                .to_string(),
        );
    }
    Ok(())
}

/// Append exactly one complete OpenSSH entry and flush it to disk. Existing
/// bytes are never rewritten, which makes TOFU persistence crash-safe with
/// respect to the user's existing trust records.
fn append_known_host_line(path: &Path, line: &[u8]) -> Result<(), String> {
    if line.is_empty() || line.contains(&0) {
        return Err(
            "Refusing to persist an invalid known_hosts entry; no credentials were sent"
                .to_string(),
        );
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create known_hosts directory {}: {e}; no credentials were sent",
                    parent.display()
                )
            })?;
        }
    }

    let mut options = OpenOptions::new();
    options.create(true).read(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options.open(path).map_err(|e| {
        format!(
            "Failed to open {} for a known_hosts append: {e}; no credentials were sent",
            path.display()
        )
    })?;

    let length = file
        .metadata()
        .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?
        .len();
    let needs_separator = if length == 0 {
        false
    } else {
        file.seek(SeekFrom::End(-1))
            .map_err(|e| format!("Failed to inspect the end of {}: {e}", path.display()))?;
        let mut last = [0_u8; 1];
        file.read_exact(&mut last)
            .map_err(|e| format!("Failed to read the end of {}: {e}", path.display()))?;
        last[0] != b'\n'
    };

    let mut record = Vec::with_capacity(line.len() + 2);
    if needs_separator {
        record.push(b'\n');
    }
    record.extend_from_slice(line);
    if !record.ends_with(b"\n") {
        record.push(b'\n');
    }

    file.write_all(&record).map_err(|e| {
        format!(
            "Failed to append a host key to {}: {e}; no credentials were sent",
            path.display()
        )
    })?;
    file.sync_all().map_err(|e| {
        format!(
            "Failed to flush the host key appended to {}: {e}; no credentials were sent",
            path.display()
        )
    })?;
    Ok(())
}

// ── Internal session handle ──────────────────────────────────────────────────

/// A private key materialised only when this libssh2 build cannot authenticate
/// directly from memory. Creation is exclusive and owner-only on Unix; Drop
/// truncates and removes the file on every normal return path.
struct EphemeralPrivateKey {
    path: PathBuf,
}

impl EphemeralPrivateKey {
    fn create(key_data: &str) -> Result<Self, String> {
        for _ in 0..4 {
            let path = std::env::temp_dir().join(format!("sorng-scp-key-{}", Uuid::new_v4()));
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }

            let mut file = match options.open(&path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "cannot create a secure temporary private-key file: {error}"
                    ));
                }
            };

            if let Err(error) = file
                .write_all(key_data.as_bytes())
                .and_then(|_| file.sync_all())
            {
                drop(file);
                let _ = std::fs::remove_file(&path);
                return Err(format!(
                    "cannot write the secure temporary private-key file: {error}"
                ));
            }

            return Ok(Self { path });
        }

        Err("cannot allocate a unique secure temporary private-key file".to_string())
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for EphemeralPrivateKey {
    fn drop(&mut self) {
        if let Ok(file) = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&self.path)
        {
            let _ = file.sync_all();
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

pub struct ScpSessionHandle {
    pub info: ScpSessionInfo,
    pub session: Session,
    #[allow(dead_code)]
    pub tcp: TcpStream,
    pub keepalive_tx: Option<tokio::sync::mpsc::Sender<()>>,
}

// ── Service struct ───────────────────────────────────────────────────────────

pub struct ScpService {
    pub sessions: HashMap<String, ScpSessionHandle>,
    pub queue: Vec<ScpQueueEntry>,
    pub queue_running: bool,
}

impl ScpService {
    /// Create a new ScpService wrapped in the managed state type.
    pub fn new() -> ScpServiceState {
        Arc::new(Mutex::new(ScpService {
            sessions: HashMap::new(),
            queue: Vec::new(),
            queue_running: false,
        }))
    }

    // ── Connect ──────────────────────────────────────────────────────────────

    /// Establish an SSH session for SCP transfers.
    pub async fn connect(&mut self, config: ScpConnectionConfig) -> Result<ScpSessionInfo, String> {
        normalized_network_host(&config.host)?;
        let addr = display_endpoint(&config.host, config.port);
        info!("SCP connecting to {}", addr);

        let tcp = connect_tcp_with_timeout(
            &config.host,
            config.port,
            std::time::Duration::from_secs(config.timeout_secs),
        )
        .await?;

        // SSH handshake
        let mut session =
            Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;

        if config.compress {
            session.set_compress(true);
        }

        // Set cipher/kex/mac preferences if provided
        if let Some(ref ciphers) = config.preferred_ciphers {
            let _ = session.method_pref(ssh2::MethodType::CryptCs, ciphers);
            let _ = session.method_pref(ssh2::MethodType::CryptSc, ciphers);
        }
        if let Some(ref macs) = config.preferred_macs {
            let _ = session.method_pref(ssh2::MethodType::MacCs, macs);
            let _ = session.method_pref(ssh2::MethodType::MacSc, macs);
        }
        if let Some(ref kex) = config.preferred_kex {
            let _ = session.method_pref(ssh2::MethodType::Kex, kex);
        }

        session.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Host identity MUST be accepted before agent, key, or password auth.
        // Keeping this and diagnostics on the same gate prevents a future
        // secondary connection path from accidentally sending credentials
        // before trust verification.
        let auth_method = verify_before_auth(
            &mut session,
            |session| Self::verify_host_key(session, &config),
            |session| {
                self.authenticate(session, &config)
                    .map_err(|e| format!("Authentication failed: {}", e))
            },
        )?;

        // Server banner
        let banner = session.banner().map(|b| b.to_string());

        // Host key fingerprint
        let fingerprint = session.host_key_hash(ssh2::HashType::Sha256).map(|bytes| {
            let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
            format!("SHA256:{}", encoded)
        });

        if !session.authenticated() {
            return Err("Authentication failed – not authenticated after auth attempt".into());
        }

        info!("SCP authenticated to {} via {}", addr, auth_method);

        // Probe remote home directory
        let remote_home = self.probe_remote_home(&session);

        // Keep-alive
        let keepalive_interval = config.keepalive_interval_secs;
        session.set_keepalive(keepalive_interval > 0, keepalive_interval as u32);

        let session_id = Uuid::new_v4().to_string();
        let now = Utc::now();

        let info = ScpSessionInfo {
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
            connected_at: now,
            last_activity: now,
            bytes_uploaded: 0,
            bytes_downloaded: 0,
            transfers_count: 0,
            server_fingerprint: fingerprint,
        };

        self.sessions.insert(
            session_id.clone(),
            ScpSessionHandle {
                info: info.clone(),
                session,
                tcp,
                keepalive_tx: None,
            },
        );

        Ok(info)
    }

    // ── Disconnect ───────────────────────────────────────────────────────────

    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(mut handle) = self.sessions.remove(session_id) {
            info!("SCP disconnecting session {}", session_id);
            if let Some(tx) = handle.keepalive_tx.take() {
                let _ = tx.send(()).await;
            }
            let _ = handle
                .session
                .disconnect(None, "Client disconnecting", None);
            Ok(())
        } else {
            Err(format!("Session '{}' not found", session_id))
        }
    }

    /// Disconnect all active sessions.
    pub async fn disconnect_all(&mut self) -> Result<u32, String> {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        let count = ids.len() as u32;
        for id in ids {
            let _ = self.disconnect(&id).await;
        }
        Ok(count)
    }

    // ── Session queries ──────────────────────────────────────────────────────

    pub async fn get_session_info(&self, session_id: &str) -> Result<ScpSessionInfo, String> {
        self.sessions
            .get(session_id)
            .map(|h| h.info.clone())
            .ok_or_else(|| format!("Session '{}' not found", session_id))
    }

    pub async fn list_sessions(&self) -> Vec<ScpSessionInfo> {
        self.sessions.values().map(|h| h.info.clone()).collect()
    }

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
            Err(_) => {
                handle.info.connected = false;
                Ok(false)
            }
        }
    }

    // ── Authentication ───────────────────────────────────────────────────────

    /// Verify the negotiated server key before any authentication request.
    /// Strict accepts only an existing match; AcceptNew persists an unknown
    /// key and rejects changes; Ask fails closed for unknown keys until SCP
    /// has a real prompt-response API; Ignore is the explicit bypass.
    pub(crate) fn verify_host_key(
        session: &Session,
        config: &ScpConnectionConfig,
    ) -> Result<(), String> {
        let trust_host = normalized_network_host(&config.host)?;

        if matches!(config.known_hosts_policy, ScpKnownHostsPolicy::Ignore) {
            warn!(
                "SCP host-key verification DISABLED (policy=Ignore) for {}:{}; the connection is not protected against MITM",
                config.host, config.port
            );
            return Ok(());
        }

        let (host_key, key_type) = session.host_key().ok_or_else(|| {
            "Host-key verification failed: server presented no host key; no credentials were sent"
                .to_string()
        })?;
        let host_key = host_key.to_vec();
        let known_hosts_path = Self::known_hosts_path(config)?;
        let check = Self::check_known_host(
            session,
            &known_hosts_path,
            trust_host,
            config.port,
            &host_key,
        )?;

        let action =
            decide_host_key_action(check, config.known_hosts_policy).map_err(|reason| {
                Self::host_key_rejection(config, check, &known_hosts_path, &host_key, &reason)
            })?;

        match action {
            HostKeyAction::Accept => {
                info!(
                    "SCP host key verified for {}:{} ({})",
                    config.host,
                    config.port,
                    host_key_type_label(key_type)
                );
                Ok(())
            }
            HostKeyAction::AcceptAndPersist => {
                Self::persist_new_host_key(
                    session,
                    config,
                    &known_hosts_path,
                    &host_key,
                    key_type,
                )?;
                info!(
                    "SCP host key for {}:{} accepted on first use and appended to {} ({})",
                    config.host,
                    config.port,
                    known_hosts_path.display(),
                    host_key_type_label(key_type)
                );
                Ok(())
            }
        }
    }

    fn known_hosts_path(config: &ScpConnectionConfig) -> Result<PathBuf, String> {
        if let Some(configured) = config.known_hosts_path.as_deref() {
            let configured = configured.trim();
            if configured.is_empty() {
                return Err(
                    "Host-key verification failed: configured known_hosts path is empty; no credentials were sent"
                        .to_string(),
                );
            }
            if configured.chars().any(char::is_control) {
                return Err(
                    "Host-key verification failed: configured known_hosts path contains a control character; no credentials were sent"
                        .to_string(),
                );
            }

            if configured == "~" || configured.starts_with("~/") || configured.starts_with("~\\") {
                let home = dirs::home_dir().ok_or_else(|| {
                    "Host-key verification failed: cannot expand the configured known_hosts home path; no credentials were sent"
                        .to_string()
                })?;
                let suffix = configured
                    .strip_prefix('~')
                    .unwrap_or(configured)
                    .trim_start_matches(['/', '\\']);
                return Ok(home.join(suffix));
            }

            return Ok(PathBuf::from(configured));
        }

        dirs::home_dir()
            .map(|home| home.join(".ssh").join("known_hosts"))
            .ok_or_else(|| {
                "Host-key verification failed: cannot resolve the home directory for known_hosts; no credentials were sent"
                    .to_string()
            })
    }

    fn check_known_host(
        session: &Session,
        path: &Path,
        host: &str,
        port: u16,
        host_key: &[u8],
    ) -> Result<HostKeyCheck, String> {
        let mut known_hosts = session.known_hosts().map_err(|e| {
            format!("Host-key verification failed: cannot initialise known_hosts: {e}")
        })?;

        match std::fs::metadata(path) {
            Ok(metadata) => {
                if !metadata.is_file() {
                    return Err(format!(
                        "Host-key verification failed: {} is not a regular file; no credentials were sent",
                        path.display()
                    ));
                }
                known_hosts
                    .read_file(path, ssh2::KnownHostFileKind::OpenSSH)
                    .map_err(|e| {
                        format!(
                            "Host-key verification failed: cannot read {}: {e}; no credentials were sent",
                            path.display()
                        )
                    })?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Host-key verification failed: cannot inspect {}: {error}; no credentials were sent",
                    path.display()
                ));
            }
        }

        Ok(known_hosts.check_port(host, port, host_key).into())
    }

    fn host_key_rejection(
        config: &ScpConnectionConfig,
        check: HostKeyCheck,
        path: &Path,
        host_key: &[u8],
        reason: &str,
    ) -> String {
        let remediation = match check {
            HostKeyCheck::Mismatch => format!(
                "; observed fingerprint {}. If the server was intentionally re-keyed, remove its stale entry from {} only after independently confirming the new fingerprint",
                Self::host_key_fingerprint(host_key),
                path.display()
            ),
            HostKeyCheck::NotFound => match config.known_hosts_policy {
                ScpKnownHostsPolicy::Strict => format!(
                    "; observed fingerprint {}. Add a verified key for this host to {} before reconnecting",
                    Self::host_key_fingerprint(host_key),
                    path.display()
                ),
                ScpKnownHostsPolicy::Ask => format!(
                    "; observed fingerprint {}. Select AcceptNew only after independently confirming it, or add the verified key to {}",
                    Self::host_key_fingerprint(host_key),
                    path.display()
                ),
                _ => String::new(),
            },
            _ => String::new(),
        };

        format!(
            "Host-key verification failed for {}:{}: {}{}. Connection aborted; no credentials were sent",
            config.host, config.port, reason, remediation
        )
    }

    fn host_key_fingerprint(host_key: &[u8]) -> String {
        let digest = Sha256::digest(host_key);
        let encoded =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD_NO_PAD, digest);
        format!("SHA256:{encoded}")
    }

    /// Persist one unknown key without rewriting the user's trust database.
    /// Re-checking under the process-wide writer lock prevents simultaneous
    /// SCP connects from racing a changed key past AcceptNew.
    fn persist_new_host_key(
        session: &Session,
        config: &ScpConnectionConfig,
        path: &Path,
        host_key: &[u8],
        key_type: ssh2::HostKeyType,
    ) -> Result<(), String> {
        let _write_guard = KNOWN_HOSTS_WRITE_LOCK.lock().map_err(|_| {
            "Host-key verification failed: known_hosts writer lock is poisoned; no credentials were sent"
                .to_string()
        })?;

        let trust_host = normalized_network_host(&config.host)?;
        let recheck = Self::check_known_host(session, path, trust_host, config.port, host_key)?;
        match decide_host_key_action(recheck, config.known_hosts_policy)
            .map_err(|reason| Self::host_key_rejection(config, recheck, path, host_key, &reason))?
        {
            HostKeyAction::Accept => return Ok(()),
            HostKeyAction::AcceptAndPersist => {}
        }

        let entry_name = known_hosts_entry_name(trust_host, config.port);
        let line = Self::render_known_host_line(session, &entry_name, host_key, key_type)?;
        append_known_host_line(path, line.as_bytes())?;

        let persisted = Self::check_known_host(session, path, trust_host, config.port, host_key)?;
        if persisted != HostKeyCheck::Match {
            return Err(format!(
                "Host-key verification failed: the newly trusted key could not be verified in {}; connection aborted and no credentials were sent",
                path.display()
            ));
        }
        Ok(())
    }

    fn render_known_host_line(
        session: &Session,
        entry_name: &str,
        host_key: &[u8],
        key_type: ssh2::HostKeyType,
    ) -> Result<String, String> {
        let mut isolated = session
            .known_hosts()
            .map_err(|e| format!("Failed to initialise known_hosts entry encoder: {e}"))?;
        isolated
            .add(
                entry_name,
                host_key,
                "Added by SortOfRemoteNG (SCP)",
                key_type.into(),
            )
            .map_err(|e| format!("Failed to encode server host key: {e}"))?;
        let host = isolated
            .iter()
            .map_err(|e| format!("Failed to enumerate encoded host key: {e}"))?
            .into_iter()
            .next()
            .ok_or_else(|| "Failed to encode server host key".to_string())?;
        isolated
            .write_string(&host, ssh2::KnownHostFileKind::OpenSSH)
            .map_err(|e| format!("Failed to serialise server host key: {e}"))
    }

    pub(crate) fn authenticate(
        &self,
        session: &mut Session,
        config: &ScpConnectionConfig,
    ) -> Result<String, String> {
        // 1. Agent auth
        if config.use_agent {
            if session.userauth_agent(&config.username).is_ok() && session.authenticated() {
                return Ok("agent".into());
            }
            warn!(
                "SCP agent auth failed for {}, trying other methods",
                config.username
            );
        }

        // 2. Private key supplied inline. This libssh2 build cannot always
        // authenticate directly from memory on Windows, so use an exclusive,
        // owner-only temporary file that is scrubbed by Drop.
        if let Some(ref key_data) = config.private_key_data {
            let passphrase = config.private_key_passphrase.as_deref();
            match EphemeralPrivateKey::create(key_data) {
                Ok(tmp_key) => {
                    if session
                        .userauth_pubkey_file(&config.username, None, tmp_key.path(), passphrase)
                        .is_ok()
                        && session.authenticated()
                    {
                        return Ok("publickey-memory".into());
                    }
                }
                Err(error) => warn!(
                    "SCP could not prepare inline private-key authentication for {}: {}",
                    config.username, error
                ),
            }
            warn!("SCP publickey-memory auth failed for {}", config.username);
        }

        // 3. Private key from file
        if let Some(ref key_path) = config.private_key_path {
            let path = Path::new(key_path);
            if path.exists() {
                let passphrase = config.private_key_passphrase.as_deref();
                if session
                    .userauth_pubkey_file(&config.username, None, path, passphrase)
                    .is_ok()
                    && session.authenticated()
                {
                    return Ok("publickey-file".into());
                }
                warn!("SCP publickey-file auth failed for {}", config.username);
            }
        }

        // 4. Try default key files (~/.ssh/id_rsa, id_ed25519, etc.)
        if let Some(home) = dirs::home_dir() {
            let ssh_dir = home.join(".ssh");
            for key_name in &["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"] {
                let key_path = ssh_dir.join(key_name);
                if key_path.exists() {
                    let passphrase = config.private_key_passphrase.as_deref();
                    if session
                        .userauth_pubkey_file(&config.username, None, &key_path, passphrase)
                        .is_ok()
                        && session.authenticated()
                    {
                        return Ok(format!("publickey-default({})", key_name));
                    }
                }
            }
        }

        // 5. Password auth
        if let Some(ref password) = config.password {
            if session
                .userauth_password(&config.username, password)
                .is_ok()
                && session.authenticated()
            {
                return Ok("password".into());
            }
            warn!("SCP password auth failed for {}", config.username);
        }

        Err(format!(
            "All authentication methods exhausted for user '{}'",
            config.username
        ))
    }

    // ── Remote home probe ────────────────────────────────────────────────────

    fn probe_remote_home(&self, session: &Session) -> Option<String> {
        let mut channel = session.channel_session().ok()?;
        channel.exec("echo $HOME").ok()?;
        let mut output = String::new();
        std::io::Read::read_to_string(&mut channel, &mut output).ok()?;
        channel.wait_close().ok()?;
        let trimmed = output.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }

    // ── Execute remote command (helper) ──────────────────────────────────────

    pub fn exec_remote(&self, session_id: &str, command: &str) -> Result<String, String> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        let mut channel = handle
            .session
            .channel_session()
            .map_err(|e| format!("Failed to open channel: {}", e))?;

        channel
            .exec(command)
            .map_err(|e| format!("Failed to execute command '{}': {}", command, e))?;

        let mut output = String::new();
        std::io::Read::read_to_string(&mut channel, &mut output)
            .map_err(|e| format!("Failed to read command output: {}", e))?;
        channel.wait_close().ok();

        Ok(output.trim().to_string())
    }

    // ── Remote file helpers ──────────────────────────────────────────────────

    /// Check if a remote path exists.
    pub fn remote_exists(&self, session_id: &str, path: &str) -> Result<bool, String> {
        let result = self.exec_remote(
            session_id,
            &format!("test -e {} && echo yes || echo no", shell_escape(path)),
        );
        match result {
            Ok(output) => Ok(output.trim() == "yes"),
            Err(_) => Ok(false),
        }
    }

    /// Check if a remote path is a directory.
    pub fn remote_is_dir(&self, session_id: &str, path: &str) -> Result<bool, String> {
        let result = self.exec_remote(
            session_id,
            &format!("test -d {} && echo yes || echo no", shell_escape(path)),
        );
        match result {
            Ok(output) => Ok(output.trim() == "yes"),
            Err(_) => Ok(false),
        }
    }

    /// Get the size of a remote file.
    pub fn remote_file_size(&self, session_id: &str, path: &str) -> Result<u64, String> {
        let output = self.exec_remote(
            session_id,
            &format!(
                "stat -c %s {} 2>/dev/null || stat -f %z {} 2>/dev/null",
                shell_escape(path),
                shell_escape(path)
            ),
        )?;
        output
            .trim()
            .parse::<u64>()
            .map_err(|e| format!("Failed to parse file size '{}': {}", output.trim(), e))
    }

    /// Create remote directories recursively.
    pub fn remote_mkdir_p(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.exec_remote(session_id, &format!("mkdir -p {}", shell_escape(path)))?;
        Ok(())
    }

    /// Delete a remote file.
    pub fn remote_rm(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.exec_remote(session_id, &format!("rm -f {}", shell_escape(path)))?;
        Ok(())
    }

    /// Delete a remote directory recursively.
    pub fn remote_rm_rf(&self, session_id: &str, path: &str) -> Result<(), String> {
        self.exec_remote(session_id, &format!("rm -rf {}", shell_escape(path)))?;
        Ok(())
    }

    /// List a remote directory.
    pub fn remote_ls(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<ScpRemoteDirEntry>, String> {
        let output = self.exec_remote(
            session_id,
            &format!(
                "ls -la --time-style=long-iso {} 2>/dev/null || ls -la {}",
                shell_escape(path),
                shell_escape(path)
            ),
        )?;

        let mut entries = Vec::new();
        for line in output.lines().skip(1) {
            // skip "total ..." line
            if line.starts_with("total ") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 8 {
                continue;
            }

            let mode_str = parts[0].to_string();
            let is_dir = mode_str.starts_with('d');
            let is_symlink = mode_str.starts_with('l');
            let is_file = mode_str.starts_with('-');
            let owner = Some(parts[2].to_string());
            let group = Some(parts[3].to_string());
            let size: u64 = parts[4].parse().unwrap_or(0);

            // Name is everything after the date/time columns
            let name = if parts.len() >= 9 {
                parts[8..].join(" ")
            } else {
                parts[7..].join(" ")
            };

            // Strip symlink target
            let display_name = if is_symlink {
                name.split(" -> ").next().unwrap_or(&name).to_string()
            } else {
                name.clone()
            };

            if display_name == "." || display_name == ".." {
                continue;
            }

            let entry_path = if path.ends_with('/') {
                format!("{}{}", path, display_name)
            } else {
                format!("{}/{}", path, display_name)
            };

            // Try to extract mtime from date columns
            let mtime = if parts.len() >= 8 {
                Some(format!("{} {}", parts[5], parts[6]))
            } else {
                None
            };

            entries.push(ScpRemoteDirEntry {
                name: display_name,
                path: entry_path,
                size,
                is_dir,
                is_file,
                is_symlink,
                mode: Some(mode_str),
                mtime,
                owner,
                group,
            });
        }

        Ok(entries)
    }

    /// Get detailed info about a remote file.
    pub fn remote_stat(&self, session_id: &str, path: &str) -> Result<ScpRemoteFileInfo, String> {
        let escaped = shell_escape(path);
        // Use stat with format specifiers; fallback for macOS stat syntax
        let output = self.exec_remote(
            session_id,
            &format!(
                "stat -c '%s %f %Y %X %U %G' {} 2>/dev/null || stat -f '%z %Xp %m %a %Su %Sg' {}",
                escaped, escaped
            ),
        )?;

        let parts: Vec<&str> = output.split_whitespace().collect();
        if parts.len() < 4 {
            return Err(format!("Unexpected stat output: {}", output));
        }

        let size: u64 = parts[0].parse().unwrap_or(0);
        let raw_mode = u32::from_str_radix(parts[1], 16).unwrap_or(0o100644);
        let mode = (raw_mode & 0o777) as i32;
        let is_dir = (raw_mode & 0o40000) != 0;
        let is_symlink = (raw_mode & 0o120000) == 0o120000;
        let is_file = !is_dir && !is_symlink;
        let mtime_ts: i64 = parts[2].parse().unwrap_or(0);
        let atime_ts: i64 = parts[3].parse().unwrap_or(0);
        let owner = parts.get(4).map(|s| s.to_string());
        let group = parts.get(5).map(|s| s.to_string());

        let mtime = chrono::DateTime::from_timestamp(mtime_ts, 0);
        let atime = chrono::DateTime::from_timestamp(atime_ts, 0);

        Ok(ScpRemoteFileInfo {
            path: path.to_string(),
            size,
            mode,
            is_dir,
            is_file,
            is_symlink,
            mtime,
            atime,
            owner,
            group,
        })
    }

    /// Compute SHA-256 checksum of a remote file.
    pub fn remote_checksum(&self, session_id: &str, path: &str) -> Result<String, String> {
        let output = self.exec_remote(
            session_id,
            &format!(
                "sha256sum {} 2>/dev/null || shasum -a 256 {} 2>/dev/null",
                shell_escape(path),
                shell_escape(path)
            ),
        )?;

        output
            .split_whitespace()
            .next()
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Failed to parse checksum output: {}", output))
    }

    /// Compute SHA-256 checksum of a local file.
    pub fn local_checksum(path: &str) -> Result<String, String> {
        let mut file =
            std::fs::File::open(path).map_err(|e| format!("Cannot open '{}': {}", path, e))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 1_048_576];
        loop {
            let n = std::io::Read::read(&mut file, &mut buffer)
                .map_err(|e| format!("Read error: {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    }

    // ── Update session activity stats ────────────────────────────────────────

    pub fn update_activity(&mut self, session_id: &str, uploaded: u64, downloaded: u64) {
        if let Some(handle) = self.sessions.get_mut(session_id) {
            handle.info.last_activity = Utc::now();
            handle.info.bytes_uploaded += uploaded;
            handle.info.bytes_downloaded += downloaded;
            handle.info.transfers_count += 1;
        }
    }

    // ── Get raw SSH session (for transfer engine) ────────────────────────────

    pub fn get_session(&self, session_id: &str) -> Result<&Session, String> {
        self.sessions
            .get(session_id)
            .map(|h| &h.session)
            .ok_or_else(|| format!("Session '{}' not found", session_id))
    }
}

// ── Utility: shell-escape a path for remote commands ─────────────────────────

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn test_shell_escape_simple() {
        assert_eq!(shell_escape("/home/user/file.txt"), "'/home/user/file.txt'");
    }

    #[test]
    fn test_shell_escape_single_quotes() {
        assert_eq!(shell_escape("it's a file"), "'it'\\''s a file'");
    }

    #[test]
    fn test_shell_escape_spaces() {
        assert_eq!(
            shell_escape("/path/to/my file.txt"),
            "'/path/to/my file.txt'"
        );
    }

    #[test]
    fn test_shell_escape_special_chars() {
        assert_eq!(shell_escape("/path/$HOME/file"), "'/path/$HOME/file'");
    }

    #[tokio::test]
    async fn test_new_service_creates_empty_state() {
        let state = ScpService::new();
        let svc = state.lock().await;
        assert!(svc.sessions.is_empty());
        assert!(svc.queue.is_empty());
        assert!(!svc.queue_running);
    }

    #[tokio::test]
    async fn test_list_sessions_empty() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let sessions = svc.list_sessions().await;
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_get_session_not_found() {
        let state = ScpService::new();
        let svc = state.lock().await;
        let result = svc.get_session_info("nonexistent").await;
        assert!(result.is_err());
    }

    #[test]
    fn strict_accepts_only_a_matching_known_key() {
        assert_eq!(
            decide_host_key_action(HostKeyCheck::Match, ScpKnownHostsPolicy::Strict),
            Ok(HostKeyAction::Accept)
        );
        assert!(
            decide_host_key_action(HostKeyCheck::NotFound, ScpKnownHostsPolicy::Strict).is_err()
        );
        assert!(
            decide_host_key_action(HostKeyCheck::Mismatch, ScpKnownHostsPolicy::Strict).is_err()
        );
    }

    #[test]
    fn accept_new_persists_unknown_but_rejects_changed_keys() {
        assert_eq!(
            decide_host_key_action(HostKeyCheck::NotFound, ScpKnownHostsPolicy::AcceptNew),
            Ok(HostKeyAction::AcceptAndPersist)
        );
        assert!(
            decide_host_key_action(HostKeyCheck::Mismatch, ScpKnownHostsPolicy::AcceptNew).is_err()
        );
    }

    #[test]
    fn ask_fails_closed_without_a_challenge_response_contract() {
        assert_eq!(
            decide_host_key_action(HostKeyCheck::Match, ScpKnownHostsPolicy::Ask),
            Ok(HostKeyAction::Accept)
        );
        let error =
            decide_host_key_action(HostKeyCheck::NotFound, ScpKnownHostsPolicy::Ask).unwrap_err();
        assert!(error.contains("interactive confirmation"));
        assert!(decide_host_key_action(HostKeyCheck::Mismatch, ScpKnownHostsPolicy::Ask).is_err());
    }

    #[test]
    fn ignore_is_the_only_policy_that_bypasses_all_check_results() {
        for check in [
            HostKeyCheck::Match,
            HostKeyCheck::NotFound,
            HostKeyCheck::Mismatch,
            HostKeyCheck::Failure,
        ] {
            assert_eq!(
                decide_host_key_action(check, ScpKnownHostsPolicy::Ignore),
                Ok(HostKeyAction::Accept)
            );
        }

        for policy in [
            ScpKnownHostsPolicy::Strict,
            ScpKnownHostsPolicy::AcceptNew,
            ScpKnownHostsPolicy::Ask,
        ] {
            assert!(decide_host_key_action(HostKeyCheck::Failure, policy).is_err());
        }
    }

    #[test]
    fn rejected_host_key_prevents_authentication_from_running() {
        let trace = RefCell::new(Vec::new());
        let mut transport = ();

        let result = verify_before_auth(
            &mut transport,
            |_| {
                trace.borrow_mut().push("verify");
                Err("untrusted server".to_string())
            },
            |_| {
                trace.borrow_mut().push("authenticate");
                Ok("password")
            },
        );

        assert_eq!(result, Err("untrusted server".to_string()));
        assert_eq!(&*trace.borrow(), &["verify"]);
    }

    #[test]
    fn accepted_host_key_runs_authentication_after_verification() {
        let trace = RefCell::new(Vec::new());
        let mut transport = ();

        let result = verify_before_auth(
            &mut transport,
            |_| {
                trace.borrow_mut().push("verify");
                Ok(())
            },
            |_| {
                trace.borrow_mut().push("authenticate");
                Ok("publickey")
            },
        );

        assert_eq!(result, Ok("publickey"));
        assert_eq!(&*trace.borrow(), &["verify", "authenticate"]);
    }

    #[test]
    fn known_hosts_append_preserves_existing_entries_and_flushes_one_line() {
        let root = std::env::temp_dir().join(format!("sorng-scp-known-hosts-{}", Uuid::new_v4()));
        let path = root.join(".ssh").join("known_hosts");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"old.example ssh-ed25519 AAAA").unwrap();

        append_known_host_line(&path, b"new.example ssh-ed25519 BBBB").unwrap();

        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"old.example ssh-ed25519 AAAA\nnew.example ssh-ed25519 BBBB\n"
        );
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rendered_host_key_round_trips_through_openssh_persistence() {
        let session = Session::new().expect("SSH session");
        let key = [9_u8; 32];
        let line = ScpService::render_known_host_line(
            &session,
            "[roundtrip.example]:2222",
            &key,
            ssh2::HostKeyType::Ed25519,
        )
        .unwrap();
        assert!(!line.as_bytes().contains(&0));

        let root = std::env::temp_dir().join(format!("sorng-scp-roundtrip-{}", Uuid::new_v4()));
        let path = root.join("known_hosts");
        append_known_host_line(&path, line.as_bytes()).unwrap();

        let mut loaded = session.known_hosts().unwrap();
        loaded
            .read_file(&path, ssh2::KnownHostFileKind::OpenSSH)
            .unwrap();
        assert!(matches!(
            loaded.check_port("roundtrip.example", 2222, &key),
            ssh2::CheckResult::Match
        ));
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn inline_private_key_temp_file_is_removed_on_drop() {
        let temp_key = EphemeralPrivateKey::create("test-private-key-material").unwrap();
        let path = temp_key.path().to_path_buf();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "test-private-key-material"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        drop(temp_key);
        assert!(!path.exists());
    }

    #[test]
    fn non_default_ports_use_openssh_bracket_notation() {
        assert_eq!(known_hosts_entry_name("example.test", 22), "example.test");
        assert_eq!(
            known_hosts_entry_name("example.test", 2222),
            "[example.test]:2222"
        );
        assert_eq!(known_hosts_entry_name("[::1]", 2222), "[::1]:2222");
    }

    #[test]
    fn socket_address_policy_preserves_hostnames_and_literal_ip_families() {
        assert_eq!(
            normalized_network_host("server.example").unwrap(),
            "server.example"
        );
        assert_eq!(normalized_network_host("[::1]").unwrap(), "::1");
        assert_eq!(
            literal_socket_address("192.0.2.10", 22).unwrap(),
            Some("192.0.2.10:22".parse().unwrap())
        );
        assert_eq!(
            literal_socket_address("[2001:db8::10]", 2222).unwrap(),
            Some("[2001:db8::10]:2222".parse().unwrap())
        );
        assert_eq!(literal_socket_address("server.example", 22).unwrap(), None);
        assert_eq!(display_endpoint("server.example", 22), "server.example:22");
        assert_eq!(display_endpoint("::1", 22), "[::1]:22");
        assert_eq!(display_endpoint("[::1]", 2222), "[::1]:2222");
    }

    #[test]
    fn socket_address_policy_rejects_malformed_or_injectable_hosts() {
        for host in ["[::1", "::1]", "[]", "host\nname", "host name"] {
            assert!(
                literal_socket_address(host, 22).is_err(),
                "host should be rejected: {host:?}"
            );
        }
    }

    #[test]
    fn resolved_addresses_are_deduplicated_without_reordering() {
        let first: SocketAddr = "127.0.0.1:22".parse().unwrap();
        let second: SocketAddr = "[::1]:22".parse().unwrap();
        assert_eq!(
            unique_addresses([first, second, first]),
            vec![first, second]
        );
    }

    #[tokio::test]
    async fn connector_supports_literal_ipv4_with_a_total_timeout() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let stream = connect_tcp_with_timeout("127.0.0.1", port, std::time::Duration::from_secs(1))
            .await
            .unwrap();
        assert_eq!(stream.peer_addr().unwrap().port(), port);
    }

    #[tokio::test]
    async fn connector_resolves_localhost_without_external_dns() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let stream = connect_tcp_with_timeout("localhost", port, std::time::Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(stream.peer_addr().unwrap().port(), port);
    }

    #[tokio::test]
    async fn connector_rejects_an_exhausted_total_timeout() {
        let error = connect_tcp_with_timeout("127.0.0.1", 9, std::time::Duration::ZERO)
            .await
            .unwrap_err();
        assert!(error.contains("timed out"));
    }

    #[test]
    fn known_hosts_host_validation_rejects_record_injection() {
        for invalid in [
            "",
            "evil.example\ntrusted.example ssh-ed25519 AAAA",
            "evil.example\rtrusted.example",
            "evil\0.example",
            "two hosts.example",
            "tab\thost.example",
        ] {
            assert!(
                validate_known_hosts_host(invalid).is_err(),
                "host should be rejected: {invalid:?}"
            );
        }
        for valid in ["example.test", "192.0.2.4", "2001:db8::4", "[::1]"] {
            assert!(
                validate_known_hosts_host(valid).is_ok(),
                "host should be accepted: {valid:?}"
            );
        }
    }

    #[test]
    fn connection_dto_accepts_camel_case_known_hosts_path() {
        let config: ScpConnectionConfig = serde_json::from_value(serde_json::json!({
            "host": "example.test",
            "username": "operator",
            "knownHostsPolicy": "strict",
            "knownHostsPath": "C:\\Users\\operator\\.ssh\\known_hosts"
        }))
        .unwrap();

        assert_eq!(config.known_hosts_policy, ScpKnownHostsPolicy::Strict);
        assert_eq!(
            config.known_hosts_path.as_deref(),
            Some("C:\\Users\\operator\\.ssh\\known_hosts")
        );
        assert_eq!(
            ScpService::known_hosts_path(&config).unwrap(),
            PathBuf::from("C:\\Users\\operator\\.ssh\\known_hosts")
        );
    }

    #[test]
    fn configured_known_hosts_path_rejects_empty_or_control_characters() {
        for path in ["", "   ", "known\nhosts", "known\0hosts"] {
            let mut config: ScpConnectionConfig = serde_json::from_value(serde_json::json!({
                "host": "example.test",
                "username": "operator"
            }))
            .unwrap();
            config.known_hosts_path = Some(path.to_string());
            assert!(
                ScpService::known_hosts_path(&config).is_err(),
                "path should be rejected: {path:?}"
            );
        }
    }

    #[test]
    fn libssh_check_port_matches_default_and_non_default_entries() {
        let session = Session::new().expect("SSH session");
        let key = [7_u8; 32];
        let mut known_hosts = session.known_hosts().expect("known_hosts handle");
        known_hosts
            .add(
                &known_hosts_entry_name("default.example", 22),
                &key,
                "test",
                ssh2::KnownHostKeyFormat::Ed25519,
            )
            .unwrap();
        known_hosts
            .add(
                &known_hosts_entry_name("alternate.example", 2222),
                &key,
                "test",
                ssh2::KnownHostKeyFormat::Ed25519,
            )
            .unwrap();

        assert!(matches!(
            known_hosts.check_port("default.example", 22, &key),
            ssh2::CheckResult::Match
        ));
        assert!(matches!(
            known_hosts.check_port("alternate.example", 2222, &key),
            ssh2::CheckResult::Match
        ));
        assert!(matches!(
            known_hosts.check_port("alternate.example", 22, &key),
            ssh2::CheckResult::NotFound
        ));
    }

    #[test]
    fn test_local_checksum_missing_file() {
        let result = ScpService::local_checksum("/nonexistent/file.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_local_checksum_valid() {
        let tmp = std::env::temp_dir().join("sorng_scp_test_checksum.txt");
        std::fs::write(&tmp, b"hello world").unwrap();
        let result = ScpService::local_checksum(tmp.to_str().unwrap());
        assert!(result.is_ok());
        let hash = result.unwrap();
        // SHA-256 of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
        std::fs::remove_file(&tmp).ok();
    }
}
