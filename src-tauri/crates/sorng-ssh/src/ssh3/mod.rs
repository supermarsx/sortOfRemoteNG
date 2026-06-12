//! # SSH3 — SSH semantics over HTTP/3 (QUIC)
//!
//! SSH3 is a modern SSH protocol that uses HTTP/3 (QUIC) as its transport:
//! faster connection establishment (0-RTT), no head-of-line blocking, built-in
//! connection migration, TLS 1.3 throughout, and in-band HTTP `Authorization`
//! auth.
//!
//! ## Implementation strategy (plan `.orchestration/plans/t23-ssh3-real.md`)
//! Built **natively** on the workspace's existing `quinn` (0.11) + `rustls`
//! (0.23) stack plus `h3` / `h3-quinn` for HTTP/3 — NOT by embedding the
//! upstream Go `ssh3` client. SSH3 and OPKSSH are orthogonal and stay
//! decoupled.
//!
//! ## Module layout (foundation seams for t23-e2…e6)
//! - [`transport`] — QUIC/H3 connection setup + rustls config (`e2`, `e6`).
//! - [`auth`] — HTTP `Authorization` auth dispatch (`e2` password/bearer,
//!   `e6` pubkey/cert/OIDC).
//! - [`session`] — interactive shell (PTY) + one-shot exec (`e3` exec,
//!   `e4` shell).
//! - [`forward`] — local/remote/dynamic port forwarding (`e5`).
//!
//! **Foundation status (e1):** this scaffold compiles, the QUIC/H3 deps
//! resolve, and the building blocks that are genuinely correct without a live
//! server (rustls config builder, QUIC endpoint factory, auth-method
//! selection, channel bookkeeping) are real. Everything that needs the live
//! wire protocol returns an explicit "not yet implemented" error so the 12
//! commands stay honest — they never report fake success — until their owning
//! executor lands.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

pub mod auth;
pub mod forward;
pub mod session;
pub mod transport;

pub use transport::Ssh3Transport;

/// SSH3 connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ssh3ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    /// QUIC-specific options
    pub quic_config: Option<Ssh3QuicConfig>,
    /// Certificate for client authentication
    pub client_cert_path: Option<String>,
    /// Optional **separate** private-key file for mTLS client authentication
    /// (additive, t26-fuA).
    ///
    /// By default (`None`) the client certificate chain AND its private key are
    /// expected in ONE PEM bundle at [`Self::client_cert_path`] (the original
    /// t23-e7 behaviour). When this is `Some`, the certificate chain is read
    /// from `client_cert_path` and the private key is read from this separate
    /// file instead — the common deployment shape where the key lives in its own
    /// (often more tightly permissioned) file. `#[serde(default)]` keeps the
    /// field additive: existing callers that omit it get the bundle behaviour.
    /// The key material is read into a buffer that is zeroized after parsing and
    /// is never logged.
    #[serde(default)]
    pub client_key_path: Option<String>,
    /// Server certificate verification
    pub verify_server_cert: bool,
    /// Custom CA certificate path
    pub ca_cert_path: Option<String>,
    /// Connection timeout in seconds
    pub connect_timeout: Option<u64>,
    /// Enable 0-RTT early data
    pub enable_0rtt: bool,
    /// Keep-alive interval in seconds
    pub keep_alive_interval: Option<u64>,
    /// OIDC / OAuth2 / raw-JWT bearer token (additive, t23-e6).
    ///
    /// When set, SSH3 authenticates with `Authorization: Bearer <token>` —
    /// the standard HTTP Bearer scheme (RFC 6750). The token is acquired out
    /// of band by an OIDC/OAuth2 flow (e.g. Google/Microsoft/GitHub login) and
    /// passed in here; SSH3's bearer path is deliberately **decoupled** from
    /// the OPKSSH dylib (we reuse only the OIDC *concept*, not its transport).
    /// Carried as a plain `Option<String>` on the serde surface to keep the
    /// IPC contract additive; copied into a [`secrecy::SecretString`] the
    /// moment it is used so it is never logged.
    #[serde(default)]
    pub bearer_token: Option<String>,
    /// Auth-method override (additive, t23-e6).
    ///
    /// When `None`, the method is inferred from which credential field is set
    /// (the historical precedence: pubkey > cert > bearer > password). When
    /// `Some`, it forces a specific method label (`"password"`, `"publickey"`,
    /// `"bearer"`/`"oidc"`, `"certificate"`) so a caller can disambiguate when
    /// several credentials are present (e.g. a key file AND a bearer token).
    #[serde(default)]
    pub auth_method: Option<String>,
}

impl Default for Ssh3ConnectionConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 443, // SSH3 defaults to HTTPS port
            username: String::new(),
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
            quic_config: None,
            client_cert_path: None,
            client_key_path: None,
            verify_server_cert: true,
            ca_cert_path: None,
            connect_timeout: Some(30),
            enable_0rtt: false,
            keep_alive_interval: Some(60),
            bearer_token: None,
            auth_method: None,
        }
    }
}

/// QUIC-specific configuration for SSH3.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ssh3QuicConfig {
    /// Maximum idle timeout in milliseconds
    pub max_idle_timeout: u64,
    /// Maximum UDP payload size
    pub max_udp_payload_size: u16,
    /// Initial max data on connection
    pub initial_max_data: u64,
    /// Initial max stream data for bidirectional streams
    pub initial_max_stream_data_bidi: u64,
    /// Maximum concurrent bidirectional streams
    pub max_concurrent_streams_bidi: u64,
    /// Enable congestion control
    pub congestion_control: String,
}

impl Default for Ssh3QuicConfig {
    fn default() -> Self {
        Self {
            max_idle_timeout: 60_000,
            max_udp_payload_size: 1350,
            initial_max_data: 10_000_000,
            initial_max_stream_data_bidi: 1_000_000,
            max_concurrent_streams_bidi: 100,
            congestion_control: "cubic".to_string(),
        }
    }
}

/// SSH3 session state.
///
/// `transport` holds the live QUIC/H3 handle once e2 connects (runtime handle,
/// intentionally NOT part of the serde surface).
pub struct Ssh3Session {
    pub id: String,
    pub config: Ssh3ConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub connection_state: Ssh3ConnectionState,
    pub channels: HashMap<String, Ssh3Channel>,
    pub keep_alive_handle: Option<tokio::task::JoinHandle<()>>,
    /// Live QUIC/H3 transport — populated by e2's `connect`. `None` until then.
    pub transport: Option<Ssh3Transport>,
}

/// SSH3 connection states.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Ssh3ConnectionState {
    Disconnected,
    Connecting,
    Authenticating,
    Connected,
    Reconnecting,
}

/// SSH3 channel (maps to a QUIC bidirectional stream).
#[derive(Debug, Clone)]
pub struct Ssh3Channel {
    pub id: String,
    pub channel_type: Ssh3ChannelType,
    pub stream_id: u64,
    pub created_at: DateTime<Utc>,
    pub sender: mpsc::UnboundedSender<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Ssh3ChannelType {
    Session,
    DirectTcpIp { host: String, port: u16 },
    ForwardedTcpIp { host: String, port: u16 },
}

/// SSH3 session info for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ssh3SessionInfo {
    pub id: String,
    pub config: Ssh3ConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub state: Ssh3ConnectionState,
    pub is_alive: bool,
}

/// SSH3 shell output event payload.
#[derive(Debug, Clone, Serialize)]
pub struct Ssh3ShellOutput {
    pub session_id: String,
    pub channel_id: String,
    pub data: String,
}

/// SSH3 shell error event payload.
#[derive(Debug, Clone, Serialize)]
pub struct Ssh3ShellError {
    pub session_id: String,
    pub channel_id: String,
    pub message: String,
}

/// SSH3 shell closed event payload.
#[derive(Debug, Clone, Serialize)]
pub struct Ssh3ShellClosed {
    pub session_id: String,
    pub channel_id: String,
}

/// SSH3 authentication result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ssh3AuthResult {
    pub success: bool,
    pub method_used: String,
    pub message: Option<String>,
}

/// Port forward configuration for SSH3.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ssh3PortForwardConfig {
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub direction: Ssh3PortForwardDirection,
    /// Opt-in to binding the local listener to a non-loopback (e.g. `0.0.0.0`
    /// or a LAN/public interface) address.
    ///
    /// Security parity with the classic SSH path (t6 finding #10 / t22-A8,
    /// `PortForwardConfig::allow_non_loopback_bind`): SSH3 local/dynamic
    /// forwards default to loopback (`127.0.0.1`) so the tunnel is only
    /// reachable from this machine. When `false` (the default), requesting a
    /// non-loopback `local_host` is rejected. `#[serde(default)]` keeps the
    /// field additive — existing callers that omit it get the secure default.
    #[serde(default)]
    pub allow_non_loopback_bind: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Ssh3PortForwardDirection {
    Local,   // Local listen, forward to remote
    Remote,  // Remote listen, forward to local
    Dynamic, // SOCKS5 proxy
}

/// SSH3 port forward handle.
#[derive(Debug)]
pub struct Ssh3PortForwardHandle {
    pub id: String,
    pub config: Ssh3PortForwardConfig,
    pub handle: tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>,
}

/// A control message sent from a Tauri command to a running SSH3 shell pump.
///
/// Mirrors the classic SSH path's `SshShellCommand` (an enum threaded over an
/// mpsc to the I/O loop) so input / resize / close all flow through one channel
/// rather than racing on the stream from multiple call sites.
#[derive(Debug, Clone)]
pub(crate) enum Ssh3ShellCommand {
    /// Raw terminal bytes to write to the shell's QUIC send stream.
    Input(Vec<u8>),
    /// Window-change (cols, rows). Sent to the server as a framed control
    /// message on the shell stream (see `session.rs::shell_resize_frame`).
    Resize(u32, u32),
    /// Close the shell: finish the send side and stop the pump.
    Close,
}

/// Live interactive-shell handle stored on the service while a shell is open.
///
/// The actual bidi QUIC stream (send + recv halves) is owned by the spawned
/// pump task; the service keeps only the mpsc sender used to drive it and the
/// pump's `JoinHandle` (aborted on close / disconnect). This keeps the handle
/// `Send`-clean and avoids storing the non-`Clone` h3 stream types on the
/// service map.
pub struct Ssh3ShellHandle {
    /// The shell channel id (returned to the frontend; used in event payloads).
    pub id: String,
    /// Drives input / resize / close into the pump task.
    pub(crate) sender: mpsc::UnboundedSender<Ssh3ShellCommand>,
    /// The pump task. Aborted when the shell is closed or the session drops.
    pub pump: tokio::task::JoinHandle<()>,
}

/// SSH3 Service — manages all SSH3 connections.
pub struct Ssh3Service {
    pub sessions: HashMap<String, Ssh3Session>,
    pub port_forwards: HashMap<String, Ssh3PortForwardHandle>,
    /// Active interactive shells, keyed by session id (one shell per session,
    /// matching the classic SSH path). The pump task owns the QUIC stream; this
    /// map holds the driver handle + abort handle. (t23-e4)
    pub shells: HashMap<String, Ssh3ShellHandle>,
    /// Event emitter for shell output/error/closed events.
    ///
    /// Mirrors `SshService::event_emitter`. Wired via [`Ssh3Service::new_with_emitter`]
    /// (the app layer switches `security_data.rs` to it in t23-e4). `None`
    /// falls back to no emission; commands read this off the service rather
    /// than constructing a `NoopEventEmitter` inline.
    pub event_emitter: Option<sorng_core::events::DynEventEmitter>,
}

pub type Ssh3ServiceState = Arc<Mutex<Ssh3Service>>;

impl Default for Ssh3Service {
    fn default() -> Self {
        Self::new()
    }
}

impl Ssh3Service {
    /// Create a service with no event emitter (events are dropped).
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            port_forwards: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: None,
        }
    }

    /// Create a service wired with a real `DynEventEmitter`.
    ///
    /// Mirrors `SshService::new_with_emitter`. The app layer
    /// (`state_registry/security_data.rs`) switches to this in t23-e4 so the
    /// interactive shell can emit `Ssh3ShellOutput` / `Ssh3ShellError` /
    /// `Ssh3ShellClosed` to the terminal UI.
    pub fn new_with_emitter(emitter: sorng_core::events::DynEventEmitter) -> Ssh3ServiceState {
        Arc::new(Mutex::new(Self {
            sessions: HashMap::new(),
            port_forwards: HashMap::new(),
            shells: HashMap::new(),
            event_emitter: Some(emitter),
        }))
    }

    /// Connect to an SSH3 server.
    ///
    /// **Seam for `t23-e2`.** e1 keeps the session-record lifecycle and calls
    /// the transport/auth seams; because those return honest not-implemented
    /// errors, `connect` fails cleanly (and removes the half-open session
    /// record) rather than flipping to `Connected` on a simulated link. e2
    /// replaces the transport/auth bodies and stores the live
    /// [`Ssh3Transport`] on the session.
    pub async fn connect(&mut self, config: Ssh3ConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();
        log::info!("SSH3: connecting to {}:{}", config.host, config.port);

        let session = Ssh3Session {
            id: session_id.clone(),
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            connection_state: Ssh3ConnectionState::Connecting,
            channels: HashMap::new(),
            keep_alive_handle: None,
            transport: None,
        };
        self.sessions.insert(session_id.clone(), session);

        // Drive the real connect through the transport + auth seams. Until e2
        // fills them these return honest errors; roll back the session record
        // so we don't leak a half-open "Connecting" session on failure.
        if let Err(e) = self.establish_connection(&session_id).await {
            self.sessions.remove(&session_id);
            return Err(e);
        }

        if let Some(session) = self.sessions.get_mut(&session_id) {
            session.connection_state = Ssh3ConnectionState::Connected;
            session.last_activity = Utc::now();
        }
        log::info!("SSH3: connected to {}:{}", config.host, config.port);
        Ok(session_id)
    }

    /// Establish the QUIC/H3 connection and authenticate.
    ///
    /// e2 fills the real sequence: dial the QUIC/H3 transport, then issue the
    /// SSH3 extended-CONNECT auth request over the live h3 `SendRequest`,
    /// mapping the HTTP status to success/failure. On auth failure the transport
    /// is closed and the error propagated (the caller rolls back the session).
    async fn establish_connection(&mut self, session_id: &str) -> Result<(), String> {
        // Pull the config out (clone) so we don't hold a &mut across awaits.
        let config = self
            .sessions
            .get(session_id)
            .ok_or("Session not found")?
            .config
            .clone();

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.connection_state = Ssh3ConnectionState::Connecting;
        }
        // Real QUIC + HTTP/3 dial.
        let transport = Ssh3Transport::connect(&config).await?;

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.connection_state = Ssh3ConnectionState::Authenticating;
        }
        // Real HTTP `Authorization` auth over the live h3 request sender. On
        // failure, tear down the QUIC connection so we don't leak it.
        //
        // The conversation ID (TLS exporter, RFC 5705) is derived from the live
        // QUIC connection and handed to auth: pubkey-JWT auth binds its `jti`
        // claim to it (anti-replay), matching upstream `ssh3`. Deriving it can
        // only fail if the TLS session is somehow unavailable — surface that as
        // a real error rather than silently dropping the binding.
        let conversation_id = match transport.conversation_id() {
            Ok(id) => id,
            Err(e) => {
                transport.close().await;
                return Err(e);
            }
        };
        let mut sender = transport.request_sender();
        if let Err(e) = auth::authenticate(&config, &mut sender, &conversation_id).await {
            transport.close().await;
            return Err(e);
        }

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.transport = Some(transport);
            session.last_activity = Utc::now();
        }
        Ok(())
    }

    /// Disconnect from an SSH3 server (graceful QUIC close).
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), String> {
        // Tear down any interactive shell pump bound to this session first so the
        // QUIC stream is finished/aborted before the connection closes.
        if let Some(shell) = self.shells.remove(session_id) {
            let _ = shell.sender.send(Ssh3ShellCommand::Close);
            shell.pump.abort();
        }
        if let Some(mut session) = self.sessions.remove(session_id) {
            if let Some(handle) = session.keep_alive_handle.take() {
                handle.abort();
            }
            session.channels.clear();
            if let Some(transport) = session.transport.take() {
                transport.close().await;
            }
            log::info!("SSH3: disconnected session {session_id}");
        }
        Ok(())
    }

    /// Get session information.
    pub fn get_session_info(&self, session_id: &str) -> Result<Ssh3SessionInfo, String> {
        let session = self.sessions.get(session_id).ok_or("Session not found")?;
        Ok(Self::session_info(session))
    }

    /// List all sessions.
    pub fn list_sessions(&self) -> Vec<Ssh3SessionInfo> {
        self.sessions.values().map(Self::session_info).collect()
    }

    fn session_info(session: &Ssh3Session) -> Ssh3SessionInfo {
        // `is_alive` reflects a live transport AND Connected state. Until e2
        // populates `transport`, a session can never be Connected (connect
        // fails), so this stays honest.
        let is_alive =
            session.connection_state == Ssh3ConnectionState::Connected && session.transport.is_some();
        Ssh3SessionInfo {
            id: session.id.clone(),
            config: session.config.clone(),
            connected_at: session.connected_at,
            last_activity: session.last_activity,
            state: session.connection_state.clone(),
            is_alive,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ssh3_config_defaults() {
        let config = Ssh3ConnectionConfig::default();
        assert_eq!(config.port, 443);
        assert!(config.verify_server_cert);
        assert!(!config.enable_0rtt);
    }

    #[tokio::test]
    async fn test_ssh3_quic_config_defaults() {
        let config = Ssh3QuicConfig::default();
        assert_eq!(config.max_idle_timeout, 60_000);
        assert_eq!(config.congestion_control, "cubic");
    }

    #[tokio::test]
    async fn test_ssh3_service_creation() {
        let service = Ssh3Service::new();
        assert!(service.sessions.is_empty());
        assert!(service.port_forwards.is_empty());
        assert!(service.event_emitter.is_none());
    }

    #[tokio::test]
    async fn new_with_emitter_sets_emitter() {
        let emitter: sorng_core::events::DynEventEmitter =
            Arc::new(sorng_core::events::NoopEventEmitter);
        let state = Ssh3Service::new_with_emitter(emitter);
        let service = state.lock().await;
        assert!(service.event_emitter.is_some());
    }

    #[tokio::test]
    async fn connect_is_real_and_fails_honestly_on_bad_config() {
        // e2: connect performs a REAL QUIC/H3 dial. With the default config
        // (empty host) it fails honestly at the transport seam and leaves no
        // leaked half-open session — it must NOT report fake success.
        let mut service = Ssh3Service::new();
        let err = service
            .connect(Ssh3ConnectionConfig::default())
            .await
            .unwrap_err();
        assert!(err.contains("host is empty"), "got: {err}");
        assert!(service.sessions.is_empty(), "no half-open session leaked");
    }
}
