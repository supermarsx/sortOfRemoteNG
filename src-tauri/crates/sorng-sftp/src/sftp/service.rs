// ── SftpService – session lifecycle management ──────────────────────────────

use crate::sftp::types::*;
use crate::sftp::upload_chunked::UploadHandle;
use chrono::Utc;
use log::{info, warn};
use secrecy::ExposeSecret;
use ssh2::Session;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
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

static KNOWN_HOSTS_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
const MAX_SESSIONS: usize = 32;
const MAX_HOST_CHARS: usize = 253;
const MAX_USERNAME_CHARS: usize = 256;
const MAX_CONNECTION_TIMEOUT_SECS: u64 = 120;
const MAX_RESOLVED_ADDRESSES: usize = 16;

async fn connect_tcp_with_timeout(
    host: &str,
    port: u16,
    timeout: std::time::Duration,
) -> Result<TcpStream, String> {
    let network_host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    let endpoint = if network_host.contains(':') {
        format!("[{network_host}]:{port}")
    } else {
        format!("{network_host}:{port}")
    };
    let deadline = tokio::time::Instant::now()
        .checked_add(timeout)
        .ok_or_else(|| "SFTP connection timeout is too large".to_string())?;
    let resolved = tokio::time::timeout_at(deadline, tokio::net::lookup_host((network_host, port)))
        .await
        .map_err(|_| format!("SFTP address resolution for {endpoint} timed out"))?
        .map_err(|error| format!("SFTP address resolution for {endpoint} failed: {error}"))?;
    let addresses: Vec<_> = resolved.take(MAX_RESOLVED_ADDRESSES).collect();
    if addresses.is_empty() {
        return Err(format!(
            "SFTP address resolution for {endpoint} returned no addresses"
        ));
    }

    let address_count = addresses.len();
    let mut last_error = None;
    for (index, address) in addresses.into_iter().enumerate() {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        let attempts_left = (address_count - index) as u32;
        let attempt_budget = deadline.duration_since(now) / attempts_left;
        match tokio::time::timeout(attempt_budget, tokio::net::TcpStream::connect(address)).await {
            Ok(Ok(stream)) => {
                return stream
                    .into_std()
                    .map_err(|error| format!("SFTP socket setup for {endpoint} failed: {error}"));
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

struct EphemeralPrivateKey {
    path: PathBuf,
}

impl EphemeralPrivateKey {
    fn create(key_data: &str) -> Result<Self, String> {
        for _ in 0..4 {
            let path = std::env::temp_dir().join(format!("sorng-sftp-key-{}", Uuid::new_v4()));
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
                        "Cannot create secure temporary private-key file: {error}"
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
                    "Cannot write secure temporary private-key file: {error}"
                ));
            }
            return Ok(Self { path });
        }
        Err("Cannot allocate secure temporary private-key file".to_string())
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
            // AcceptNew is the explicit trust-on-first-use policy. Ask must fail
            // closed until SFTP has an interactive host-key confirmation channel.
            // Neither policy accepts a changed key (Mismatch above).
            KnownHostsPolicy::AcceptNew => Ok(HostKeyAction::AcceptAndPersist),
            KnownHostsPolicy::Ask => Err(
                "host is unknown and Ask requires interactive confirmation, but SFTP has no host-key confirmation channel"
                    .to_string(),
            ),
            // Reached only if a caller forgets to short-circuit Ignore.
            KnownHostsPolicy::Ignore => Ok(HostKeyAction::Accept),
        },
    }
}

// ── Trust Center integration for SFTP host keys (t62) ───────────────────────
//
// SFTP shares the SSH host-key namespace: records are `ssh` records keyed by
// `host:port`, so a key accepted in a terminal session is already trusted for
// file transfer and vice versa. SFTP has no interactive prompt channel, so the
// Trust Center answer is resolved against `known_hosts_policy` rather than a
// user dialog, and anything short of an exact live match fails closed.
pub(crate) mod host_key_trust {
    use chrono::Utc;
    use sorng_storage::trust_store::{
        Identity, SshHostKeyIdentity, SyncTrustStore, TrustVerifyResult,
    };

    /// Trust Center record type, shared with core SSH and SCP.
    pub(crate) const RECORD_TYPE: &str = "ssh";

    /// What the Trust Center says about a presented host key.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum TrustState {
        Trusted,
        Unknown,
        NeedsConfirmation,
        Changed,
        Revoked,
    }

    pub(crate) fn trust_host(host: &str, port: u16) -> String {
        format!("{host}:{port}")
    }

    /// SHA-256 of the raw key in hex — the same fingerprint core SSH stores,
    /// so both protocols recognise each other's records.
    pub(crate) fn fingerprint(host_key: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(host_key);
        hex::encode(hasher.finalize())
    }

    pub(crate) fn identity(host_key: &[u8], key_type: Option<&str>) -> Identity {
        use base64::Engine;
        let now = Utc::now().to_rfc3339();
        Identity::Ssh(SshHostKeyIdentity {
            fingerprint: fingerprint(host_key),
            key_type: key_type.map(str::to_string),
            key_bits: None,
            first_seen: now.clone(),
            last_seen: now,
            public_key: Some(base64::engine::general_purpose::STANDARD.encode(host_key)),
            algorithms_offered: Vec::new(),
        })
    }

    pub(crate) fn classify(result: &TrustVerifyResult) -> TrustState {
        match result {
            TrustVerifyResult::Trusted => TrustState::Trusted,
            TrustVerifyResult::FirstUse { .. } => TrustState::Unknown,
            TrustVerifyResult::Revoked { .. } => TrustState::Revoked,
            TrustVerifyResult::Mismatch { .. }
            | TrustVerifyResult::ChainMismatch { .. }
            | TrustVerifyResult::RotationGrace { .. } => TrustState::Changed,
            TrustVerifyResult::Expired { .. }
            | TrustVerifyResult::PendingThreshold { .. }
            | TrustVerifyResult::PendingVerification { .. } => TrustState::NeedsConfirmation,
        }
    }

    pub(crate) fn verify(
        host: &str,
        port: u16,
        host_key: &[u8],
        key_type: Option<&str>,
    ) -> Result<TrustState, String> {
        SyncTrustStore::shared()
            .verify_identity_blocking(
                &trust_host(host, port),
                RECORD_TYPE,
                identity(host_key, key_type),
            )
            .map(|result| classify(&result))
            .map_err(|error| unavailable_error(host, port, &error))
    }

    pub(crate) fn record(
        host: &str,
        port: u16,
        host_key: &[u8],
        key_type: Option<&str>,
        user_approved: bool,
    ) -> Result<(), String> {
        SyncTrustStore::shared()
            .trust_identity_blocking(
                trust_host(host, port),
                RECORD_TYPE.to_string(),
                identity(host_key, key_type),
                user_approved,
            )
            .map_err(|error| unavailable_error(host, port, &error))
    }

    pub(crate) fn unavailable_error(host: &str, port: u16, error: &str) -> String {
        format!(
            "Host-key verification FAILED for {host}:{port}: the Trust Center is unavailable \
             ({error}). Open a database so host-key decisions can be recorded. Connection \
             aborted; no credentials were sent."
        )
    }
}

/// Resolve the Trust Center's answer without touching the network.
///
/// `Ok(None)` means the store has nothing on this endpoint and `known_hosts`
/// decides. Every other state is terminal: SFTP cannot ask the user, so a
/// changed, revoked or re-confirmation-pending key is a rejection rather than
/// something `known_hosts` could talk it out of.
fn decide_trusted_host_key_action(
    state: host_key_trust::TrustState,
    policy: KnownHostsPolicy,
) -> Result<Option<HostKeyAction>, String> {
    if matches!(policy, KnownHostsPolicy::Ignore) {
        return Ok(Some(HostKeyAction::Accept));
    }
    match state {
        host_key_trust::TrustState::Trusted => Ok(Some(HostKeyAction::Accept)),
        host_key_trust::TrustState::Unknown => Ok(None),
        host_key_trust::TrustState::Changed => Err(
            "the server key does not match the key recorded in the Trust Center. \
             This may indicate a man-in-the-middle attack."
                .to_string(),
        ),
        host_key_trust::TrustState::Revoked => Err(
            "this host key is revoked in the Trust Center. Reinstate it in \
             Settings → Security if the revocation no longer applies."
                .to_string(),
        ),
        host_key_trust::TrustState::NeedsConfirmation => Err(
            "the trust policy requires this host key to be confirmed again, but SFTP has no \
             host-key confirmation channel. Confirm it in Settings → Security, or open a \
             terminal session to this host."
                .to_string(),
        ),
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
        if self.sessions.len() >= MAX_SESSIONS {
            return Err("SFTP session limit reached; disconnect an existing session".to_string());
        }
        if config.host.is_empty()
            || config.host.chars().count() > MAX_HOST_CHARS
            || config
                .host
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
            || config.username.is_empty()
            || config.username.chars().count() > MAX_USERNAME_CHARS
            || config.username.chars().any(char::is_control)
        {
            return Err("SFTP host or username is invalid".to_string());
        }
        if !(1..=MAX_CONNECTION_TIMEOUT_SECS).contains(&config.timeout_secs) {
            return Err(format!(
                "SFTP timeout must be between 1 and {} seconds",
                MAX_CONNECTION_TIMEOUT_SECS
            ));
        }
        let addr = format!("{}:{}", config.host, config.port);
        info!("SFTP connecting to {}", addr);

        // TCP connection with timeout
        let tcp = connect_tcp_with_timeout(
            &config.host,
            config.port,
            std::time::Duration::from_secs(config.timeout_secs),
        )
        .await?;

        tcp.set_nonblocking(false)
            .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
        let io_timeout = Some(std::time::Duration::from_secs(config.timeout_secs));
        tcp.set_read_timeout(io_timeout)
            .map_err(|e| format!("Failed to set SFTP read timeout: {e}"))?;
        tcp.set_write_timeout(io_timeout)
            .map_err(|e| format!("Failed to set SFTP write timeout: {e}"))?;

        // SSH handshake
        let mut session =
            Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
        session.set_timeout(
            u32::try_from(config.timeout_secs.saturating_mul(1000)).unwrap_or(u32::MAX),
        );

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

        let (host_key, key_type) = session.host_key().ok_or_else(|| {
            "Host-key verification failed: server presented no host key".to_string()
        })?;
        let host_key = host_key.to_vec();
        let key_type_label = host_key_type_label(key_type);

        // The Trust Center is consulted first and outranks known_hosts: it is
        // the app's own per-database decision, and a mismatch there is not
        // cleared by the shared system file happening to agree.
        let trust_state =
            host_key_trust::verify(&config.host, config.port, &host_key, Some(key_type_label))?;
        if let Some(action) = decide_trusted_host_key_action(trust_state, config.known_hosts_policy)
            .map_err(|reason| {
                format!(
                    "Host-key verification FAILED for {}:{}: {} Connection aborted; no credentials \
                     were sent. Server key fingerprint SHA256:{}.",
                    config.host,
                    config.port,
                    reason,
                    host_key_trust::fingerprint(&host_key)
                )
            })?
        {
            debug_assert_eq!(action, HostKeyAction::Accept);
            info!(
                "SFTP host key verified for {}:{} against the Trust Center",
                config.host, config.port
            );
            return Ok(());
        }

        let check_result = {
            let mut known_hosts = session
                .known_hosts()
                .map_err(|e| format!("Failed to create known_hosts handle: {}", e))?;
            // A missing/unreadable known_hosts file is fine — every host is
            // then "NotFound" and handled per-policy below.
            let _ = known_hosts.read_file(
                Path::new(&known_hosts_path),
                ssh2::KnownHostFileKind::OpenSSH,
            );
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
                // Reached only via a known_hosts match (the Trust Center said
                // Unknown). Adopt the entry the user already trusts in OpenSSH
                // so the decision lives in the database from now on.
                host_key_trust::record(
                    &config.host,
                    config.port,
                    &host_key,
                    Some(key_type_label),
                    false,
                )?;
                info!(
                    "SFTP host key verified for {}:{} from known_hosts and imported into the Trust Center",
                    config.host, config.port
                );
                Ok(())
            }
            HostKeyAction::AcceptAndPersist => {
                // known_hosts first, then the Trust Center: if the shared
                // system file cannot be written the connection still aborts
                // with nothing memorized, exactly as it did before t62.
                if config.also_write_known_hosts {
                    Self::persist_host_key(
                        session,
                        &known_hosts_path,
                        &config.host,
                        config.port,
                        &host_key,
                        key_type,
                    )?;
                }
                host_key_trust::record(
                    &config.host,
                    config.port,
                    &host_key,
                    Some(key_type_label),
                    false,
                )?;
                info!(
                    "SFTP host key for {}:{} accepted on first use and saved to the Trust Center{} ({})",
                    config.host,
                    config.port,
                    if config.also_write_known_hosts {
                        " and known_hosts"
                    } else {
                        ""
                    },
                    key_type_label
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
        let _write_guard = KNOWN_HOSTS_WRITE_LOCK
            .lock()
            .map_err(|_| "known_hosts write lock is unavailable".to_string())?;
        if matches!(
            std::fs::symlink_metadata(known_hosts_path),
            Ok(metadata) if metadata.file_type().is_symlink()
        ) {
            return Err("Refusing to update a symlinked known_hosts file".to_string());
        }
        let mut known_hosts = session
            .known_hosts()
            .map_err(|e| format!("Failed to create known_hosts handle: {}", e))?;

        let _ = known_hosts.read_file(
            Path::new(known_hosts_path),
            ssh2::KnownHostFileKind::OpenSSH,
        );

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
            .write_file(
                Path::new(known_hosts_path),
                ssh2::KnownHostFileKind::OpenSSH,
            )
            .map_err(|e| format!("Failed to write known_hosts file: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(known_hosts_path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Failed to protect known_hosts permissions: {e}"))?;
        }

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
                .map(|p| p.expose_secret());
            let tmp_key = EphemeralPrivateKey::create(key_data.expose_secret())?;
            session
                .userauth_pubkey_file(&config.username, None, tmp_key.path(), passphrase)
                .map_err(|e| format!("Public-key (memory) auth failed: {}", e))?;
            if session.authenticated() {
                return Ok("publickey-memory".to_string());
            }
        }

        // 3. Private-key file
        if let Some(ref key_path) = config.private_key_path {
            let passphrase = config
                .private_key_passphrase
                .as_ref()
                .map(|p| p.expose_secret());
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
                            .map(|p| p.expose_secret());
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

            // secrecy 0.10's expose_secret yields &str, so own it for the
            // handler's String field.
            let mut handler = SimpleKbdHandler {
                password: password.to_string(),
            };
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
        let upload_ids: Vec<String> = self
            .uploads
            .iter()
            .filter(|(_, upload)| upload.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        let mut upload_cleanup_error = None;
        for upload_id in upload_ids {
            if let Err(error) = self.upload_abort(&upload_id).await {
                upload_cleanup_error = Some(error);
            }
        }
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
        match upload_cleanup_error {
            Some(error) => Err(format!(
                "SFTP session disconnected, but a partial upload could not be removed: {error}"
            )),
            None => Ok(()),
        }
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
    fn unknown_host_is_tofu_under_accept_new() {
        assert_eq!(
            decide_host_key_action(HostKeyCheck::NotFound, KnownHostsPolicy::AcceptNew),
            Ok(HostKeyAction::AcceptAndPersist),
        );
    }

    #[test]
    fn unknown_host_ask_fails_without_confirmation_channel() {
        let error = decide_host_key_action(HostKeyCheck::NotFound, KnownHostsPolicy::Ask)
            .expect_err("Ask must not silently trust an unknown host");
        assert!(error.contains("interactive confirmation"));
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

// ── Trust Center host keys (t62) ────────────────────────────────────────────

#[cfg(test)]
mod trust_center_tests {
    use super::{decide_trusted_host_key_action, host_key_trust, HostKeyAction};
    use crate::sftp::types::{KnownHostsPolicy, SftpConnectionConfig};
    use sorng_storage::trust_store::test_support::{
        install_active_runtime_for_tests, install_runtime_for_tests,
    };
    use sorng_storage::trust_store::{SyncTrustStore, TrustVerifyResult};

    const POLICIES: [KnownHostsPolicy; 3] = [
        KnownHostsPolicy::Strict,
        KnownHostsPolicy::AcceptNew,
        KnownHostsPolicy::Ask,
    ];

    #[test]
    fn a_trusted_record_is_accepted_under_every_policy() {
        for policy in POLICIES {
            assert_eq!(
                decide_trusted_host_key_action(host_key_trust::TrustState::Trusted, policy)
                    .unwrap(),
                Some(HostKeyAction::Accept),
                "a memorized key must connect under {policy:?}"
            );
        }
    }

    #[test]
    fn an_unknown_record_defers_to_known_hosts() {
        for policy in POLICIES {
            assert_eq!(
                decide_trusted_host_key_action(host_key_trust::TrustState::Unknown, policy)
                    .unwrap(),
                None,
                "an endpoint the Trust Center has never seen must fall through under {policy:?}"
            );
        }
    }

    #[test]
    fn changed_revoked_and_unconfirmed_records_are_rejected_without_consulting_known_hosts() {
        for policy in POLICIES {
            let changed =
                decide_trusted_host_key_action(host_key_trust::TrustState::Changed, policy)
                    .expect_err("a changed key must never connect");
            assert!(changed.contains("man-in-the-middle"), "{changed}");

            let revoked =
                decide_trusted_host_key_action(host_key_trust::TrustState::Revoked, policy)
                    .expect_err("a revoked key must never connect");
            assert!(revoked.contains("revoked"), "{revoked}");

            let pending = decide_trusted_host_key_action(
                host_key_trust::TrustState::NeedsConfirmation,
                policy,
            )
            .expect_err("SFTP cannot confirm a key interactively");
            assert!(pending.contains("confirmation channel"), "{pending}");
        }
    }

    #[test]
    fn ignore_still_bypasses_every_trust_state() {
        // `Ignore` is the documented dangerous opt-out and is short-circuited
        // before verification even runs; the mapping agrees so no future caller
        // can reintroduce a rejection the policy says to skip.
        for state in [
            host_key_trust::TrustState::Trusted,
            host_key_trust::TrustState::Unknown,
            host_key_trust::TrustState::Changed,
            host_key_trust::TrustState::Revoked,
            host_key_trust::TrustState::NeedsConfirmation,
        ] {
            assert_eq!(
                decide_trusted_host_key_action(state, KnownHostsPolicy::Ignore).unwrap(),
                Some(HostKeyAction::Accept)
            );
        }
    }

    #[test]
    fn a_recorded_host_key_verifies_and_a_changed_one_does_not() {
        let temp = tempfile::tempdir().unwrap();
        let _guard = install_active_runtime_for_tests(temp.path().join("databases"), "db-sftp");

        assert_eq!(
            host_key_trust::verify("files.example.test", 2222, b"sftp-host-key", None).unwrap(),
            host_key_trust::TrustState::Unknown
        );

        host_key_trust::record(
            "files.example.test",
            2222,
            b"sftp-host-key",
            Some("ssh-ed25519"),
            false,
        )
        .unwrap();

        assert_eq!(
            host_key_trust::verify("files.example.test", 2222, b"sftp-host-key", None).unwrap(),
            host_key_trust::TrustState::Trusted
        );
        assert_eq!(
            host_key_trust::verify("files.example.test", 2222, b"rotated-host-key", None).unwrap(),
            host_key_trust::TrustState::Changed
        );
        // Port is part of the identity of an endpoint.
        assert_eq!(
            host_key_trust::verify("files.example.test", 22, b"sftp-host-key", None).unwrap(),
            host_key_trust::TrustState::Unknown
        );
    }

    #[test]
    fn sftp_and_core_ssh_share_one_record_per_endpoint() {
        let temp = tempfile::tempdir().unwrap();
        let _guard = install_active_runtime_for_tests(temp.path().join("databases"), "db-shared");
        let host_key = b"shared-with-core-ssh";

        host_key_trust::record(
            "shell.example.test",
            22,
            host_key,
            Some("ssh-ed25519"),
            true,
        )
        .unwrap();

        // Core SSH keys its records the same way: type `ssh`, host `host:port`,
        // SHA-256 hex fingerprint. Reading through the shared façade proves the
        // two protocols cannot end up with divergent decisions.
        let result = SyncTrustStore::shared()
            .verify_identity_blocking(
                "shell.example.test:22",
                host_key_trust::RECORD_TYPE,
                host_key_trust::identity(host_key, Some("ssh-ed25519")),
            )
            .unwrap();
        assert!(matches!(result, TrustVerifyResult::Trusted));
        assert_eq!(host_key_trust::fingerprint(host_key).len(), 64);
    }

    #[test]
    fn host_key_verification_fails_closed_with_no_active_database() {
        let temp = tempfile::tempdir().unwrap();
        let guard = install_runtime_for_tests(temp.path().join("databases"), None);
        guard.runtime.set_active(None, None).unwrap();

        let error = host_key_trust::verify("locked.example.test", 22, b"any-key", None)
            .expect_err("with no database open there is nothing to decide against");
        assert!(error.contains("Trust Center is unavailable"), "{error}");
        assert!(error.contains("no credentials were sent"), "{error}");
    }

    #[test]
    fn also_write_known_hosts_defaults_to_true_for_connections_saved_before_t62() {
        let payload = serde_json::json!({
            "host": "legacy.example.test",
            "port": 22,
            "username": "operator",
        });

        let config: SftpConnectionConfig = serde_json::from_value(payload)
            .expect("a config saved before t62 must still deserialize");
        assert!(
            config.also_write_known_hosts,
            "existing connections must keep updating ~/.ssh/known_hosts"
        );
    }
}
