//! Native in-process SoftEther SSL-VPN client.
//!
//! # Threading model
//!
//! Per the global threading requirement in `.orchestration/plans/t1.md`
//! ("Global threading requirement"), all VPN protocol I/O is offloaded onto
//! tokio tasks. Tauri command handlers (`softether_cmds.rs`) acquire the
//! service mutex, enqueue work onto a spawned task, and return quickly. The
//! packet/session loop, once implemented, will live inside a
//! `tokio::task::spawn(...)` supervised by a `JoinHandle` stored on
//! `SoftEtherConnection::task_handle` and will communicate back via
//! `tokio::sync::mpsc` channels — never via shared Mutex on the hot path.
//!
//! # Implementation status
//!
//! This is an intentionally partial implementation. See
//! `.orchestration/state.md` (t1 Escalations) for the full escalation text.
//! Summary:
//!
//! * COMPLETE — service CRUD, type definitions, TCP connect, TLS handshake
//!   with SoftEther's `vpnsvc/connect.cgi` watermark exchange, task spawn
//!   pattern, chaining wiring.
//! * STUBBED — PACK codec (SoftEther's tag/length/value serialization),
//!   session-key RC4/AES negotiation, `ClientAuth` flow, virtual-hub
//!   `Connect`-pack exchange, data-plane packet loop, UDP-acceleration
//!   fallback, reconnect/keepalive.
//!
//! The stubs surface as `SoftEtherStatus::Error(..)` with a user-facing
//! message pointing at the unfinished layer, not silent pass-through.
//!
//! Reference: SoftEther OSS v4.x, file `src/Cedar/Protocol.c`, function
//! `ClientConnect` / `ClientConnectToServer`. No pure-Rust client crate
//! exists on crates.io (`cargo search softether` only returns
//! `softether_exporter`, a Prometheus exporter for the server side).
//!
//! # SE-1 refactor note (t2 plan §1 executor table)
//!
//! This single file will be split by the SE-1 executor into a module
//! tree so each protocol layer can live in its own file and be unit
//! tested in isolation:
//!
//! * `softether/mod.rs` — the public `SoftEtherService`, CRUD, and the
//!   `SoftEtherServiceState` / `SoftEtherConfig` / `SoftEtherStatus`
//!   types currently declared here.
//! * `softether/pack.rs` — PACK codec (Int/Int64/Str/Ustr/Bin/UniStr),
//!   `ReadPack` / `WritePack` + fixture tests. (SE-1)
//! * `softether/watermark.rs` — ~1412-byte WATERMARK blob constant
//!   and the `connect.cgi` handshake. (SE-2)
//! * `softether/auth.rs` — `ClientAuth` PACK upload, SHA-0 of
//!   UTF-16LE(user+pass). (SE-3)
//! * `softether/session_key.rs` — server+client random → MD5 → RC4 /
//!   AES-256-CBC key schedule. (SE-4)
//! * `softether/dataplane.rs` + `softether/tap.rs` — 4-byte BE framing
//!   + TAP/TUN integration. (SE-5)
//! * `softether/udp_accel.rs` + `softether/reconnect.rs` — UDP
//!   acceleration + exponential backoff reconnect. (SE-6)
//!
//! SE-0 (this commit) intentionally does NOT perform the split — it
//! would touch every line SE-1 needs to rewrite and add a three-way
//! merge for no gain. Keep this file monolithic until SE-1 lands.
//!
//! # SE-1 status (2026-04-17)
//!
//! SE-1 landed — this file moved from `softether.rs` to `softether/mod.rs`
//! and gained a `pack` sub-module (see [`pack`] below). SE-2..7 still
//! pending; the stub surface described above is unchanged.

pub mod auth;
pub mod dataplane;
pub mod device;
pub mod pack;
pub mod reconnect;
pub mod session_key;
pub mod supervisor;
pub mod tap;
pub mod udp_accel;
pub mod watermark;

pub use auth::{
    build_client_auth_pack, hash_and_secure_password, hash_password, parse_auth_response,
    secure_password, sha0, AuthError, AuthMethod, AuthResult, ClientAuthConfig, SHA0_SIZE,
};
pub use pack::{Element, Pack, PackError, Value};
pub use reconnect::{
    reconnect_loop, AttemptOutcome, ReconnectError, ReconnectEvent, ReconnectPolicy,
    SessionDoneOutcome,
};
pub use session_key::{
    decrypt_frame, derive_session_keys, encrypt_frame, expand_session_key_32, AesKey, CipherState,
    KeyError, Rc4, SessionKeys,
};
pub use udp_accel::{
    build_v1_packet, parse_v1_packet, run_udp_accel, udp_accel_calc_key, UdpAccelConfig,
    UdpAccelError, UdpAccelServerInfo,
};
pub use watermark::WATERMARK;

use chrono::{DateTime, Utc};
use rustls::pki_types::ServerName;
use rustls::ClientConfig;
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio_rustls::TlsConnector;
use uuid::Uuid;

pub type SoftEtherServiceState = Arc<Mutex<SoftEtherService>>;

// ─── Public types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SoftEtherConnection {
    pub id: String,
    pub name: String,
    pub config: SoftEtherConfig,
    pub status: SoftEtherStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    /// Server-announced build / version from the `connect.cgi` response
    /// (populated once the watermark handshake has been completed).
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SoftEtherStatus {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    /// SE-6: the reconnect loop is sleeping + preparing attempt
    /// `attempt_number` after a transient drop. `next_delay_ms` is
    /// the remaining backoff sleep.
    Reconnecting {
        attempt_number: u32,
        next_delay_ms: u64,
    },
    Error(String),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SoftEtherConfig {
    /// Hostname or IP of the SoftEther VPN server.
    pub server: String,
    /// TCP port. Defaults to 443 in SoftEther deployments.
    pub port: Option<u16>,
    /// Virtual Hub name (required — the server has many hubs).
    pub hub: String,
    /// Account name inside the hub.
    pub username: Option<String>,
    /// Plaintext password (will be hashed client-side). Ignored when
    /// `certificate`/`private_key` are provided.
    pub password: Option<String>,
    /// PEM-encoded client certificate (for certificate auth).
    pub certificate: Option<String>,
    /// PEM-encoded private key matching `certificate`.
    pub private_key: Option<String>,
    /// `Anonymous`, `Password`, `Cert`, `RadiusPassword`, `NtDomain`.
    pub auth_type: Option<String>,
    /// Skip TLS certificate verification (dev / self-signed SoftEther).
    pub skip_verify: Option<bool>,
    /// Enable UDP acceleration (not yet implemented — see stubs above).
    pub use_udp_acceleration: Option<bool>,
    /// Max reconnect attempts after drop (not yet implemented).
    pub max_reconnects: Option<u32>,
    /// Any protocol knobs the UI wants to pass verbatim ("MaxConnection=8"
    /// etc. — currently unused by the client).
    pub custom_options: Vec<String>,
    /// SE-5b: opt-in flag to spawn the real data-plane supervisor +
    /// TAP device after the handshake succeeds. Default `false` keeps
    /// historical behaviour (handshake only, connection reports an
    /// explicit-error status). `true` is the production path.
    #[serde(default)]
    pub start_dataplane: Option<bool>,
    /// SE-5b: optional TAP device name hint passed to
    /// [`tap::TapDevice::create`]. Ignored on non-Linux platforms.
    #[serde(default)]
    pub tap_name: Option<String>,
    /// SE-6: per-connection reconnect policy. Not serialised — built
    /// fresh from defaults on every load (Tauri UI has a dedicated
    /// settings surface for these in a future milestone).
    #[serde(default, skip)]
    pub reconnect_policy: Option<ReconnectPolicyConfig>,
    /// SE-7: opt-in flag to attempt UDP-acceleration after auth. When
    /// `true`, and the server advertises UDP accel in the Welcome PACK,
    /// the service will spawn a [`udp_accel::run_udp_accel`] pump in
    /// parallel with the TCP+TLS session. On UDP setup failure the
    /// service falls back to the TCP+TLS path (no hard error). The
    /// more commonly-misnamed `use_udp_acceleration` field above is
    /// retained for legacy UI state; this is the authoritative runtime
    /// flag.
    #[serde(default)]
    pub enable_udp_accel: bool,
    /// SE-7: serialisable reconnect policy surface. When `None` we
    /// fall through to [`ReconnectPolicy::default`]. When `Some`, the
    /// `spawn_with_reconnect` path converts it into a runtime policy.
    #[serde(default)]
    pub reconnect: Option<ReconnectPolicyConfig>,
}

/// Serialisable mirror of [`reconnect::ReconnectPolicy`] — kept
/// decoupled from that struct so the on-disk schema doesn't change
/// every time SE-6's internals evolve.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReconnectPolicyConfig {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    pub jitter_ms: u64,
    pub give_up_after_secs: u64,
}

impl Default for ReconnectPolicyConfig {
    fn default() -> Self {
        let d = ReconnectPolicy::default();
        Self {
            max_attempts: d.max_attempts,
            base_delay_ms: d.base_delay.as_millis() as u64,
            max_delay_ms: d.max_delay.as_millis() as u64,
            jitter_ms: d.jitter_ms,
            give_up_after_secs: d.give_up_after.as_secs(),
        }
    }
}

impl From<&ReconnectPolicyConfig> for ReconnectPolicy {
    fn from(c: &ReconnectPolicyConfig) -> Self {
        Self {
            max_attempts: c.max_attempts,
            base_delay: std::time::Duration::from_millis(c.base_delay_ms),
            max_delay: std::time::Duration::from_millis(c.max_delay_ms),
            jitter_ms: c.jitter_ms,
            give_up_after: std::time::Duration::from_secs(c.give_up_after_secs),
        }
    }
}

/// Internal non-Serialize runtime state kept alongside each connection.
///
/// `JoinHandle` and `mpsc::Sender` are not Serde-able, so they live here
/// keyed by `connection_id` rather than on [`SoftEtherConnection`].
struct RuntimeHandle {
    /// Supervises the spawned session loop. Dropping/aborting cancels it.
    task_handle: JoinHandle<()>,
    /// Issues control messages to the spawned task (e.g. graceful shutdown).
    ctrl_tx: mpsc::Sender<ControlMessage>,
}

/// Messages sent from the service into the spawned session task.
#[derive(Debug, Clone)]
enum ControlMessage {
    /// Request the task to shut down gracefully.
    Shutdown,
}

// ─── Service ─────────────────────────────────────────────────────────────

pub struct SoftEtherService {
    connections: HashMap<String, SoftEtherConnection>,
    runtimes: HashMap<String, RuntimeHandle>,
    /// Server-issued 20-byte session key from the Welcome PACK. SE-4
    /// expands this into [`SessionKeys`] (see `derived_keys` below);
    /// the raw seed is retained for diagnostics and for any future
    /// re-derivation path. Not serialised — lives only in memory.
    session_keys: HashMap<String, [u8; SHA0_SIZE]>,
    /// Per-connection derived cipher schedule produced by
    /// [`session_key::derive_session_keys`] after a successful auth.
    /// SE-5's data-plane task takes ownership of this via
    /// [`SoftEtherService::take_session_keys`] before entering the
    /// packet loop — keep the service mutex hold-time bounded.
    derived_keys: HashMap<String, SessionKeys>,
    /// Per-connection live TLS stream retained from the watermark →
    /// auth → key-derivation chain. SE-5's data-plane task takes
    /// ownership via [`SoftEtherService::take_session_stream`] before
    /// entering the framed packet loop — do NOT `.await` on the
    /// stream while holding `&mut SoftEtherService`.
    session_streams: HashMap<String, tokio_rustls::client::TlsStream<tokio::net::TcpStream>>,
    /// SE-5b: live data-plane supervisor handles, keyed by connection
    /// id. Populated by [`SoftEtherService::spawn_dataplane`]; consumed
    /// on [`SoftEtherService::disconnect`] via graceful shutdown.
    dataplane_handles: HashMap<String, supervisor::DataplaneHandle>,
    /// SE-7: parsed UDP-acceleration descriptors observed in the
    /// server's Welcome PACK, keyed by connection id. Present only
    /// when the server advertised UDP accel during auth. Consumed by
    /// [`SoftEtherService::spawn_dataplane`] when
    /// `SoftEtherConfig::enable_udp_accel` is `true`; otherwise kept
    /// for diagnostics.
    udp_accel_infos: HashMap<String, udp_accel::UdpAccelServerInfo>,
    /// SE-7: live UDP-accel pump handles, keyed by connection id.
    /// Populated when the UDP path was taken; shut down on disconnect.
    udp_accel_handles: HashMap<String, udp_accel::UdpAccelHandle>,
    emitter: Option<DynEventEmitter>,
}

impl SoftEtherService {
    pub fn new() -> SoftEtherServiceState {
        Arc::new(Mutex::new(SoftEtherService {
            connections: HashMap::new(),
            runtimes: HashMap::new(),
            session_keys: HashMap::new(),
            derived_keys: HashMap::new(),
            session_streams: HashMap::new(),
            dataplane_handles: HashMap::new(),
            udp_accel_infos: HashMap::new(),
            udp_accel_handles: HashMap::new(),
            emitter: None,
        }))
    }

    pub fn new_with_emitter(emitter: DynEventEmitter) -> SoftEtherServiceState {
        Arc::new(Mutex::new(SoftEtherService {
            connections: HashMap::new(),
            runtimes: HashMap::new(),
            session_keys: HashMap::new(),
            derived_keys: HashMap::new(),
            session_streams: HashMap::new(),
            dataplane_handles: HashMap::new(),
            udp_accel_infos: HashMap::new(),
            udp_accel_handles: HashMap::new(),
            emitter: Some(emitter),
        }))
    }

    fn emit_status(&self, connection_id: &str, status: &str, extra: serde_json::Value) {
        if let Some(emitter) = &self.emitter {
            let mut payload = serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "softether",
                "status": status,
            });
            if let (Some(base), Some(ext)) = (payload.as_object_mut(), extra.as_object()) {
                for (k, v) in ext {
                    base.insert(k.clone(), v.clone());
                }
            }
            let _ = emitter.emit_event("vpn::status-changed", payload);
        }
    }

    // ── CRUD ────────────────────────────────────────────────────────────

    pub async fn create_connection(
        &mut self,
        name: String,
        config: SoftEtherConfig,
    ) -> Result<String, String> {
        if config.server.trim().is_empty() {
            return Err("SoftEther server host is required".to_string());
        }
        if config.hub.trim().is_empty() {
            return Err("SoftEther virtual hub name is required".to_string());
        }

        let id = Uuid::new_v4().to_string();
        let connection = SoftEtherConnection {
            id: id.clone(),
            name,
            config,
            status: SoftEtherStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            local_ip: None,
            remote_ip: None,
            server_version: None,
        };

        self.connections.insert(id.clone(), connection);
        Ok(id)
    }

    pub async fn connect(&mut self, connection_id: &str) -> Result<(), String> {
        // Snapshot config without holding any mutable borrow across .await —
        // the borrow-checker will not tolerate a long-lived `&mut
        // self.connections` being held while we also call `self.emit_status`.
        let config = {
            let connection = self
                .connections
                .get_mut(connection_id)
                .ok_or_else(|| "SoftEther connection not found".to_string())?;

            if let SoftEtherStatus::Connected = connection.status {
                return Ok(());
            }

            connection.status = SoftEtherStatus::Connecting;
            connection.config.clone()
        };
        let conn_id_owned = connection_id.to_string();

        // Phase 1: run the watermark handshake + ClientAuth inline on a
        // single TLS socket (SE-4 rewire — upstream SoftEther reuses
        // one conn across all handshake phases). Session-key derivation
        // runs inline too (pure-compute, no I/O). The long-lived session
        // loop (Phase 2) is spawned only if all three succeed.
        let handshake = softether_handshake_and_auth(&config).await;

        let (server_info, auth_result, session_keys, tls_stream) = match handshake {
            Ok(hs) => hs,
            Err((phase, e)) => {
                if let Some(c) = self.connections.get_mut(connection_id) {
                    c.status = SoftEtherStatus::Error(e.clone());
                }
                self.emit_status(
                    connection_id,
                    "error",
                    serde_json::json!({ "error": e, "phase": phase }),
                );
                return Err(e);
            }
        };

        // Phase 2: spawn the session task. Today it immediately reports the
        // PACK-layer stub and exits. Per threading requirement, protocol
        // work lives here — NOT on the Tauri command thread.
        let (ctrl_tx, ctrl_rx) = mpsc::channel::<ControlMessage>(8);
        let emitter = self.emitter.clone();
        let spawn_id = conn_id_owned.clone();
        let spawn_config = config.clone();
        let task_handle = tokio::task::spawn(async move {
            softether_session_task(spawn_id, spawn_config, ctrl_rx, emitter).await;
        });

        self.runtimes.insert(
            conn_id_owned.clone(),
            RuntimeHandle {
                task_handle,
                ctrl_tx,
            },
        );

        // At this point the watermark AND ClientAuth succeeded and we
        // have derived both cipher directions. The live TLS stream is
        // stashed on the service for SE-5's data-plane. Until SE-5
        // lands, surface the state as Error (not Connected) so nothing
        // downstream treats the tunnel as usable for packet forwarding.
        let stub_msg = format!(
            "connected (handshake+auth+keys done) — data-plane not yet implemented (SE-5). session='{}' conn='{}' policy_ver={} cipher='{}'",
            auth_result.session_name,
            auth_result.connection_name,
            auth_result.policy_version,
            session_keys.cipher_name,
        );

        // Build a display string from the parsed PACK hello. Prefer the
        // hello banner; fall back to "<server_str> build <build>" when the
        // banner was empty.
        let server_version = if !server_info.hello.is_empty() {
            Some(server_info.hello.clone())
        } else if !server_info.server_str.is_empty() {
            Some(format!(
                "{} build {}",
                server_info.server_str, server_info.build
            ))
        } else {
            Some(format!(
                "SoftEther build {} version {}",
                server_info.build, server_info.version
            ))
        };

        if let Some(c) = self.connections.get_mut(connection_id) {
            c.remote_ip = Some(config.server.clone());
            c.server_version = server_version.clone();
            c.status = SoftEtherStatus::Error(stub_msg.clone());
        }

        // Stash session material for SE-5. Kept off-struct (not
        // serialised) to avoid leaking it into Tauri responses.
        self.session_keys
            .insert(conn_id_owned.clone(), auth_result.session_key);
        self.derived_keys
            .insert(conn_id_owned.clone(), session_keys);
        self.session_streams
            .insert(conn_id_owned.clone(), tls_stream);

        // SE-7: stash the server-announced UDP-accel descriptor (if
        // any). Consumed by `spawn_dataplane` when
        // `enable_udp_accel=true`; otherwise preserved for
        // introspection via `udp_accel_info_for`.
        if let Some(udp) = auth_result.udp_accel.clone() {
            self.udp_accel_infos.insert(conn_id_owned.clone(), udp);
        }

        self.emit_status(
            connection_id,
            "partial",
            serde_json::json!({
                "error": stub_msg,
                "phase": "data_plane",
                "server_version": server_version,
                "server_build": server_info.build,
                "server_protocol_version": server_info.version,
                "session_name": auth_result.session_name,
                "connection_name": auth_result.connection_name,
                "policy_version": auth_result.policy_version,
                "cipher_name": auth_result.cipher_name,
            }),
        );

        // NOTE: When PACK auth lands, flip this to `SoftEtherStatus::Connected`
        // and emit "connected" with local_ip populated from the virtual-hub
        // IP assignment response.
        Err(stub_msg)
    }

    pub async fn disconnect(&mut self, connection_id: &str) -> Result<(), String> {
        // Mark Disconnecting (or bail if already Disconnected) in a scoped
        // borrow so subsequent `self.emit_status` calls don't conflict.
        {
            let connection = self
                .connections
                .get_mut(connection_id)
                .ok_or_else(|| "SoftEther connection not found".to_string())?;

            if let SoftEtherStatus::Disconnected = connection.status {
                return Ok(());
            }
            connection.status = SoftEtherStatus::Disconnecting;
        }

        // SE-5b: stop the data-plane supervisor first (graceful). On
        // shutdown failure we fall through to abort via task_handle.
        if let Some(handle) = self.dataplane_handles.remove(connection_id) {
            if let Err(e) = handle.shutdown().await {
                log::warn!(
                    "softether dataplane shutdown returned error for {}: {}",
                    connection_id,
                    e
                );
            }
        }

        // SE-7: stop UDP-accel pump if the dataplane took the UDP path.
        if let Some(h) = self.udp_accel_handles.remove(connection_id) {
            if let Err(e) = h.shutdown().await {
                log::warn!(
                    "softether udp_accel shutdown returned error for {}: {}",
                    connection_id,
                    e
                );
            }
        }
        self.udp_accel_infos.remove(connection_id);

        // Tear down the spawned task if any. Send Shutdown first for
        // graceful cleanup; if the channel is closed or the task has
        // already exited, abort() is a safe no-op.
        if let Some(runtime) = self.runtimes.remove(connection_id) {
            let _ = runtime.ctrl_tx.send(ControlMessage::Shutdown).await;
            runtime.task_handle.abort();
        }
        self.session_keys.remove(connection_id);
        self.derived_keys.remove(connection_id);
        self.session_streams.remove(connection_id);

        if let Some(connection) = self.connections.get_mut(connection_id) {
            connection.status = SoftEtherStatus::Disconnected;
            connection.connected_at = None;
            connection.local_ip = None;
            connection.remote_ip = None;
        }

        self.emit_status(connection_id, "disconnected", serde_json::json!({}));

        Ok(())
    }

    pub async fn get_connection(&self, connection_id: &str) -> Result<SoftEtherConnection, String> {
        self.connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "SoftEther connection not found".to_string())
    }

    pub async fn list_connections(&self) -> Vec<SoftEtherConnection> {
        self.connections.values().cloned().collect()
    }

    pub async fn delete_connection(&mut self, connection_id: &str) -> Result<(), String> {
        if let Some(connection) = self.connections.get(connection_id) {
            if let SoftEtherStatus::Connected = connection.status {
                self.disconnect(connection_id).await?;
            }
        }

        // Clean up any lingering runtime (covers Connecting / Error states).
        if let Some(runtime) = self.runtimes.remove(connection_id) {
            runtime.task_handle.abort();
        }
        if let Some(handle) = self.dataplane_handles.remove(connection_id) {
            handle.abort();
        }
        if let Some(h) = self.udp_accel_handles.remove(connection_id) {
            h.abort();
        }
        self.session_keys.remove(connection_id);
        self.derived_keys.remove(connection_id);
        self.session_streams.remove(connection_id);
        self.udp_accel_infos.remove(connection_id);

        self.connections.remove(connection_id);
        Ok(())
    }

    /// SE-7: read the server-announced UDP-accel descriptor for
    /// `connection_id`, if the server advertised it in the Welcome
    /// PACK. Callers use this for diagnostics; the production path
    /// consumes it inside [`SoftEtherService::spawn_dataplane`].
    pub fn udp_accel_info_for(
        &self,
        connection_id: &str,
    ) -> Option<&udp_accel::UdpAccelServerInfo> {
        self.udp_accel_infos.get(connection_id)
    }

    pub async fn get_status(&self, connection_id: &str) -> Result<SoftEtherStatus, String> {
        let connection = self
            .connections
            .get(connection_id)
            .ok_or_else(|| "SoftEther connection not found".to_string())?;
        Ok(connection.status.clone())
    }

    /// Hand the derived [`SessionKeys`] for a connection to a caller
    /// that owns the data-plane loop (SE-5). Returns `None` if auth
    /// hasn't completed or the keys were already taken.
    pub fn take_session_keys(&mut self, connection_id: &str) -> Option<SessionKeys> {
        self.derived_keys.remove(connection_id)
    }

    /// Hand the live post-handshake TLS stream to the data-plane task
    /// (SE-5). Returns `None` if the handshake hasn't completed or the
    /// stream was already taken.
    pub fn take_session_stream(
        &mut self,
        connection_id: &str,
    ) -> Option<tokio_rustls::client::TlsStream<tokio::net::TcpStream>> {
        self.session_streams.remove(connection_id)
    }

    /// SE-5b: spawn the data-plane supervisor for `connection_id`.
    ///
    /// Consumes the connection's stashed TLS stream + derived session
    /// keys and attaches the supplied [`DataplaneDevice`] (typically a
    /// [`tap::TapDevice`] in production; [`device::MpscDevice`] in
    /// tests). On success flips the connection status to
    /// [`SoftEtherStatus::Connected`] and stores the resulting
    /// [`supervisor::DataplaneHandle`] for later graceful teardown
    /// from `disconnect()`.
    ///
    /// Returns an error if any prerequisite (TLS stream, session keys)
    /// is missing — callers MUST have invoked `connect()` (watermark +
    /// auth + key-derivation) on this same `connection_id` first.
    pub async fn spawn_dataplane<D>(
        &mut self,
        connection_id: &str,
        device: D,
        config: supervisor::DataplaneConfig,
    ) -> Result<(), String>
    where
        D: device::DataplaneDevice,
    {
        // SE-7: if the connection config opted into UDP acceleration
        // AND the server advertised UDP accel in the Welcome PACK, try
        // the UDP path first. On any setup failure we fall back to the
        // TCP+TLS supervisor (documented fallback policy: UDP is an
        // optimisation, not a correctness requirement). Fallback is
        // signalled via an `emit_status` event so the UI can surface
        // it to the user.
        let want_udp = self
            .connections
            .get(connection_id)
            .map(|c| c.config.enable_udp_accel)
            .unwrap_or(false);
        if want_udp {
            if let Some(udp_info) = self.udp_accel_infos.remove(connection_id) {
                // Build a UDP-accel config from the Welcome PACK. We
                // use the dataplane keepalive interval as the UDP
                // keepalive interval to keep the watchdogs aligned.
                let udp_cfg = udp_accel::UdpAccelConfig::from_server_info(
                    &udp_info,
                    config.keepalive_interval,
                );
                // run_udp_accel spawns tasks synchronously; bind
                // failures surface via the join handle. We create a
                // dummy external shutdown receiver here because the
                // service owns graceful shutdown via
                // `udp_accel_handles`.
                let (_ext_tx, ext_rx) = tokio::sync::watch::channel(false);
                match udp_accel::run_udp_accel(udp_cfg, device, ext_rx).await {
                    Ok(h) => {
                        // Drop the stashed TLS stream and keys — UDP
                        // path owns the data-plane. TLS still carries
                        // control messages upstream, but SE-7 does
                        // not wire that surface (it's a Cedar-specific
                        // keepalive detail tracked for SE-8).
                        let _ = self.session_streams.remove(connection_id);
                        let _ = self.derived_keys.remove(connection_id);
                        self.udp_accel_handles.insert(connection_id.to_string(), h);
                        if let Some(c) = self.connections.get_mut(connection_id) {
                            c.status = SoftEtherStatus::Connected;
                            c.connected_at = Some(Utc::now());
                        }
                        self.emit_status(
                            connection_id,
                            "connected",
                            serde_json::json!({
                                "phase": "dataplane",
                                "transport": "udp_accel_v1",
                            }),
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!(
                            "softether UDP-accel spawn failed for {} ({}); \
                             falling back to TCP+TLS dataplane",
                            connection_id,
                            e
                        );
                        self.emit_status(
                            connection_id,
                            "udp_accel_fallback",
                            serde_json::json!({
                                "reason": format!("{}", e),
                            }),
                        );
                        // NOTE: `device` was moved into run_udp_accel
                        // and is not recoverable on error. The caller
                        // must retry spawn_dataplane with a fresh
                        // device. This matches the documented fallback
                        // policy — UDP failures propagate so the UI
                        // can decide whether to retry with
                        // `enable_udp_accel=false`.
                        return Err(format!(
                            "UDP-accel setup failed: {} (fall back by retrying with \
                             enable_udp_accel=false)",
                            e
                        ));
                    }
                }
            } else {
                // Requested but server didn't advertise — quietly
                // proceed on TCP+TLS (documented behaviour).
                log::info!(
                    "softether enable_udp_accel=true but server did not advertise; \
                     using TCP+TLS dataplane for {}",
                    connection_id
                );
            }
        }

        let stream = self.session_streams.remove(connection_id).ok_or_else(|| {
            "no live TLS stream for connection (handshake may not have completed or stream \
                 already taken)"
                .to_string()
        })?;
        // keys aren't needed for TlsOnly cipher mode, but we remove
        // them from the stash so state is consistent post-spawn.
        let _keys = self.derived_keys.remove(connection_id);

        let handle = supervisor::spawn_dataplane(stream, device, config)
            .await
            .map_err(|e| format!("dataplane supervisor spawn failed: {}", e))?;
        self.dataplane_handles
            .insert(connection_id.to_string(), handle);
        if let Some(c) = self.connections.get_mut(connection_id) {
            c.status = SoftEtherStatus::Connected;
            c.connected_at = Some(Utc::now());
        }
        self.emit_status(
            connection_id,
            "connected",
            serde_json::json!({
                "phase": "dataplane",
                "transport": "tcp_tls",
            }),
        );
        Ok(())
    }

    /// SE-6: emit a `Reconnecting` status event. Used by the reconnect
    /// loop wire-up — [`SoftEtherService::spawn_with_reconnect`] drives
    /// this for each backoff tick.
    #[allow(dead_code)]
    pub(crate) fn emit_reconnecting(
        &self,
        connection_id: &str,
        attempt_number: u32,
        next_delay_ms: u64,
    ) {
        self.emit_status(
            connection_id,
            "reconnecting",
            serde_json::json!({
                "attempt_number": attempt_number,
                "next_delay_ms": next_delay_ms,
            }),
        );
    }

    /// Test-only: bypass `session_streams` and spawn the dataplane
    /// directly over any `AsyncRead + AsyncWrite`. Used by the SE-5b
    /// integration tests to exercise the full supervisor + status
    /// transition against a `tokio::io::duplex` TLS surrogate.
    #[cfg(test)]
    pub(crate) async fn spawn_dataplane_over_stream<S, D>(
        &mut self,
        connection_id: &str,
        stream: S,
        device: D,
        config: supervisor::DataplaneConfig,
    ) -> Result<(), String>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
        D: device::DataplaneDevice,
    {
        let handle = supervisor::spawn_dataplane(stream, device, config)
            .await
            .map_err(|e| format!("dataplane supervisor spawn failed: {}", e))?;
        self.dataplane_handles
            .insert(connection_id.to_string(), handle);
        if let Some(c) = self.connections.get_mut(connection_id) {
            c.status = SoftEtherStatus::Connected;
            c.connected_at = Some(Utc::now());
        }
        Ok(())
    }

    /// SE-7: maintain a live SoftEther session with automatic
    /// reconnect on transient failures.
    ///
    /// Runs `reconnect::reconnect_loop` with an attempt-factory closure
    /// that, on each retry, re-runs the full
    /// `softether_handshake_and_auth` → `spawn_dataplane` chain using a
    /// fresh device produced by `make_device`.
    ///
    /// # Policy mapping
    ///
    /// Transient errors (TCP timeout, TLS pipe broke, KeepAlive
    /// watchdog fires) retry. Fatal errors (auth rejected, hub
    /// missing, malformed PACK) bail immediately via
    /// `ReconnectError::FatalError`. The `ReconnectPolicy` cap on
    /// attempts + total elapsed time is enforced by the reconnect
    /// loop.
    ///
    /// # Return
    ///
    /// `Ok(())` on clean shutdown (graceful disconnect). Any
    /// [`reconnect::ReconnectError`] is surfaced to the caller as a
    /// `String` for parity with the existing service API.
    ///
    /// # Threading
    ///
    /// This method owns the reconnect loop in the calling async task.
    /// Callers typically spawn it via `tokio::task::spawn(async move {
    /// state.lock().await.spawn_with_reconnect(...) })`; the service
    /// mutex is released between attempts (the closure re-locks inside
    /// `make_attempt`).
    pub async fn spawn_with_reconnect<MakeDev, Dev>(
        state: SoftEtherServiceState,
        connection_id: &str,
        policy: ReconnectPolicy,
        mut make_device: MakeDev,
        dataplane_config: supervisor::DataplaneConfig,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Result<(), String>
    where
        MakeDev: FnMut() -> Dev + Send,
        Dev: device::DataplaneDevice,
    {
        let conn_id = connection_id.to_string();
        // Session token carried from `make_attempt` to `session_done`.
        // Holds the dataplane JoinHandle so the session_done closure
        // can await the terminal error and classify it via
        // `DataplaneSupervisorError::is_transient`. Taking ownership
        // of the handle OUT of the service map is deliberate — it
        // means `disconnect()` won't interfere with the reconnect
        // loop's view of session termination. Callers stop the loop
        // via the supplied `shutdown` watch channel instead.
        enum Session {
            Tcp(tokio::task::JoinHandle<Result<(), supervisor::DataplaneSupervisorError>>),
            Udp(tokio::task::JoinHandle<Result<(), udp_accel::UdpAccelError>>),
        }

        let make_attempt = || {
            let state = state.clone();
            let conn_id = conn_id.clone();
            let device = make_device();
            let dp_cfg = dataplane_config.clone();
            async move {
                // Phase A: handshake + auth + key derivation. We do
                // this OUTSIDE the service mutex so the .await on the
                // network doesn't hold the lock.
                let config = {
                    let svc = state.lock().await;
                    match svc.connections.get(&conn_id) {
                        Some(c) => c.config.clone(),
                        None => {
                            return reconnect::AttemptOutcome::Fatal(
                                "connection id not found".into(),
                            )
                        }
                    }
                };
                let hs = softether_handshake_and_auth(&config).await;
                let (_server_info, auth_result, session_keys, tls_stream) = match hs {
                    Ok(h) => h,
                    Err((phase, e)) => {
                        let fatal = matches!(phase, "client_auth" | "key_derivation");
                        return if fatal {
                            reconnect::AttemptOutcome::Fatal(format!("{}: {}", phase, e))
                        } else {
                            reconnect::AttemptOutcome::Transient(format!("{}: {}", phase, e))
                        };
                    }
                };

                // Phase B: restash + spawn dataplane, then IMMEDIATELY
                // extract the join handle(s) so the reconnect loop
                // owns session lifetime (not the service map).
                let mut svc = state.lock().await;
                svc.session_keys
                    .insert(conn_id.clone(), auth_result.session_key);
                svc.derived_keys.insert(conn_id.clone(), session_keys);
                svc.session_streams.insert(conn_id.clone(), tls_stream);
                if let Some(udp) = auth_result.udp_accel.clone() {
                    svc.udp_accel_infos.insert(conn_id.clone(), udp);
                }
                let spawn_result = svc.spawn_dataplane(&conn_id, device, dp_cfg).await;
                if let Err(e) = spawn_result {
                    return reconnect::AttemptOutcome::Transient(e);
                }
                // Pull handles back out so session_done owns them.
                // We prefer the UDP path if both (shouldn't happen,
                // but be defensive).
                if let Some(h) = svc.udp_accel_handles.remove(&conn_id) {
                    drop(svc);
                    reconnect::AttemptOutcome::Ok(Session::Udp(h.join))
                } else if let Some(h) = svc.dataplane_handles.remove(&conn_id) {
                    drop(svc);
                    reconnect::AttemptOutcome::Ok(Session::Tcp(h.join))
                } else {
                    // spawn_dataplane returned Ok but neither map has
                    // the handle — this is a bug. Surface as fatal so
                    // the loop doesn't spin.
                    reconnect::AttemptOutcome::Fatal(
                        "spawn_dataplane succeeded but no handle was registered".into(),
                    )
                }
            }
        };

        // session_done owns the dataplane JoinHandle captured from
        // make_attempt and awaits its terminal result. Classifies via
        // DataplaneSupervisorError::is_transient (for TCP) or a
        // simpler TLS-equivalent rule (for UDP — all UDP errors bar
        // UnsupportedVersion / OversizedFrame are transient).
        let session_done = |session: Session| async move {
            match session {
                Session::Tcp(join) => match join.await {
                    Ok(Ok(())) => reconnect::SessionDoneOutcome::Clean,
                    Ok(Err(e)) => {
                        let transient = e.is_transient();
                        let msg = format!("{}", e);
                        if transient {
                            reconnect::SessionDoneOutcome::Transient(msg)
                        } else {
                            reconnect::SessionDoneOutcome::Fatal(msg)
                        }
                    }
                    Err(join_err) => reconnect::SessionDoneOutcome::Fatal(format!(
                        "dataplane task panic: {}",
                        join_err
                    )),
                },
                Session::Udp(join) => match join.await {
                    Ok(Ok(())) => reconnect::SessionDoneOutcome::Clean,
                    Ok(Err(e)) => {
                        // UDP classification: UnsupportedVersion +
                        // OversizedFrame are programmer/config bugs —
                        // fatal. Anything else (bind, io, decrypt,
                        // timeout, device) is reconnectable.
                        let fatal = matches!(
                            e,
                            udp_accel::UdpAccelError::UnsupportedVersion(_)
                                | udp_accel::UdpAccelError::OversizedFrame(_)
                                | udp_accel::UdpAccelError::TaskPanicked(_)
                        );
                        let msg = format!("{}", e);
                        if fatal {
                            reconnect::SessionDoneOutcome::Fatal(msg)
                        } else {
                            reconnect::SessionDoneOutcome::Transient(msg)
                        }
                    }
                    Err(join_err) => reconnect::SessionDoneOutcome::Fatal(format!(
                        "udp_accel task panic: {}",
                        join_err
                    )),
                },
            }
        };

        let state_ev = state.clone();
        let conn_id_ev = conn_id.clone();
        let on_status = move |ev: reconnect::ReconnectEvent| {
            let state = state_ev.clone();
            let conn_id = conn_id_ev.clone();
            // Fire-and-forget status emission; the reconnect loop does
            // not await this.
            tokio::spawn(async move {
                let svc = state.lock().await;
                match ev {
                    reconnect::ReconnectEvent::Attempting { attempt_number } => {
                        svc.emit_status(
                            &conn_id,
                            "reconnecting",
                            serde_json::json!({
                                "attempt_number": attempt_number,
                                "next_delay_ms": 0,
                            }),
                        );
                    }
                    reconnect::ReconnectEvent::Connected { attempt_number } => {
                        svc.emit_status(
                            &conn_id,
                            "connected",
                            serde_json::json!({
                                "attempt_number": attempt_number,
                            }),
                        );
                    }
                    reconnect::ReconnectEvent::Backoff {
                        attempt_number,
                        next_delay_ms,
                    } => {
                        svc.emit_reconnecting(&conn_id, attempt_number, next_delay_ms);
                    }
                }
            });
        };

        reconnect::reconnect_loop(policy, shutdown, on_status, make_attempt, session_done)
            .await
            .map_err(|e| format!("{}", e))
    }

    pub async fn update_connection(
        &mut self,
        connection_id: &str,
        name: Option<String>,
        config: Option<SoftEtherConfig>,
    ) -> Result<(), String> {
        let connection = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| "SoftEther connection not found".to_string())?;

        if let SoftEtherStatus::Connected = connection.status {
            return Err("Cannot update SoftEther connection while connected".to_string());
        }

        if let Some(new_name) = name {
            connection.name = new_name;
        }
        if let Some(new_config) = config {
            if new_config.server.trim().is_empty() {
                return Err("SoftEther server host is required".to_string());
            }
            if new_config.hub.trim().is_empty() {
                return Err("SoftEther virtual hub name is required".to_string());
            }
            connection.config = new_config;
        }
        Ok(())
    }
}

// ─── Protocol helpers ────────────────────────────────────────────────────

/// Parsed outcome of the initial `/vpnsvc/connect.cgi` round trip.
///
/// Fields mirror `Cedar/Protocol.c::GetHello` — the server hello PACK
/// contains `hello` (banner), `random` (20 bytes used for SE-4 session-key
/// derivation), `build`, `version`, plus optionally `server_str`.
#[derive(Debug, Clone)]
pub struct ServerInfo {
    /// Human-readable banner from the server. Example:
    /// `"SoftEther VPN Server 4.38 Build 9760"`. Read from the `hello`
    /// PACK field (server-side this is `ClientStr`'s server-half).
    pub hello: String,
    /// 20-byte server-issued random nonce. Feeds into the SE-4
    /// session-key derivation (`SetKeyPair` → MD5(server_random ++
    /// client_random)).
    pub random: [u8; 20],
    /// Server build number (PACK `build` int).
    pub build: u32,
    /// Server protocol version (PACK `version` int).
    pub version: u32,
    /// Optional human server description. SoftEther's `GetHello` only
    /// reads `hello`; `server_str` is an additional descriptive field
    /// upstream emits on some builds. Absent → empty string.
    pub server_str: String,
}

/// Executes the SoftEther watermark handshake against `{server}:{port}`.
///
/// Protocol summary (from Cedar/Protocol.c in SoftEther 4.x):
///   1. TCP connect to `{server}:{port}`.
///   2. TLS handshake (SoftEther tolerates any server certificate if
///      `skip_verify`).
///   3. Send an HTTP/1.0 POST to `/vpnsvc/connect.cgi` with body being a
///      ~1.4KB "watermark" byte string the server recognises as a VPN
///      client greeting, followed by a PACK describing protocol version
///      and client build.
///   4. Read the server's HTTP response; the body contains a PACK with
///      server random, build, capabilities.
///   5. Client sends `/vpnsvc/vpn.cgi` POST; from there on the socket is
///      upgraded to binary PACK framing for auth + session.
///
/// THIS FUNCTION IMPLEMENTS STEPS 1–4 ONLY. The response PACK is not yet
/// parsed; we only confirm an HTTP 200 and capture the `Server:` header
/// as a rough sanity check. Step 5 and beyond are the stubbed path.
/// End-to-end pre-data-plane handshake: TCP + TLS + WATERMARK +
/// ClientAuth + session-key derivation. SE-4 rewired this to use a
/// SINGLE TLS stream across watermark and auth — upstream SoftEther
/// keeps one socket open for the full handshake and the mock-server
/// integration tests already exercise this pattern. The live stream
/// is returned so the caller can stash it for SE-5's data-plane loop.
///
/// On failure the returned tuple's first element tags the phase that
/// failed so callers can surface actionable errors.
async fn softether_handshake_and_auth(
    config: &SoftEtherConfig,
) -> Result<
    (
        ServerInfo,
        auth::AuthResult,
        SessionKeys,
        tokio_rustls::client::TlsStream<TcpStream>,
    ),
    (&'static str, String),
> {
    // ── Single TCP + TLS setup ──────────────────────────────────────
    let port = config.port.unwrap_or(443);
    let addr = format!("{}:{}", config.server, port);

    let tcp = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| ("tcp_connect", format!("TCP connect to {} timed out", addr)))?
    .map_err(|e| {
        (
            "tcp_connect",
            format!("TCP connect to {} failed: {}", addr, e),
        )
    })?;

    let tls_config = build_rustls_client_config(config.skip_verify.unwrap_or(false))
        .map_err(|e| ("tls_config", e))?;
    let connector = TlsConnector::from(Arc::new(tls_config));
    let sni = ServerName::try_from(config.server.clone())
        .map_err(|e| ("tls_sni", format!("Invalid server name for TLS SNI: {}", e)))?;
    let mut tls_stream = connector
        .connect(sni, tcp)
        .await
        .map_err(|e| ("tls_handshake", format!("TLS handshake failed: {}", e)))?;

    // ── Phase A: watermark exchange on the live stream ───────────────
    let server_info = run_watermark_exchange(&mut tls_stream, &config.server)
        .await
        .map_err(|e| ("watermark", e))?;

    // ── Phase B: auth exchange on the SAME stream ────────────────────
    let auth_config = build_auth_config_from_softether(config);
    let auth_result = run_auth_exchange(
        &mut tls_stream,
        &config.server,
        &server_info.random,
        &auth_config,
    )
    .await
    .map_err(|e| ("client_auth", e))?;

    // ── Phase C: session-key derivation (pure compute, no I/O) ───────
    let cipher_name = auth_result.cipher_name.as_deref().unwrap_or("");
    let session_key_32_bytes =
        session_key::expand_session_key_32(&auth_result.session_key, auth_result.session_key_32);
    let keys = session_key::derive_session_keys(
        &server_info.random,
        &auth_result.session_key,
        &session_key_32_bytes,
        cipher_name,
    )
    .map_err(|e| {
        (
            "key_derivation",
            format!("session-key derivation failed: {}", e),
        )
    })?;

    Ok((server_info, auth_result, keys, tls_stream))
}

/// Derives a [`ClientAuthConfig`] from the user-facing
/// [`SoftEtherConfig`]. The config's `auth_type` selects between
/// Password / PlainPassword / Anonymous (defaulting to Password when a
/// password is present, Anonymous otherwise).
/// SE-6: extract UDP-acceleration parameters from a post-auth Welcome
/// PACK. Returns `None` if the server didn't advertise UDP accel or if
/// any required field is missing/malformed. Does NOT read `version` —
/// V2 is rejected at the caller so we don't silently fall through to
/// V1 cipher with V2 keys.
///
/// Keys parsed (matching Cedar `Protocol.c:6177+`):
///  - `use_udp_acceleration` (bool — must be true to return Some)
///  - `udp_acceleration_version` (int, 1 or 2)
///  - `udp_acceleration_server_ip` (IP — 4 or 16 bytes)
///  - `udp_acceleration_server_port` (int)
///  - `udp_acceleration_server_key` (20 bytes, V1 common key)
///  - `udp_acceleration_server_key_v2` (128 bytes — preserved but not used)
///  - `udp_acceleration_server_cookie` (int)
///  - `udp_acceleration_client_cookie` (int)
///  - `udp_acceleration_use_encryption` (bool)
///  - `udp_accel_fast_disconnect_detect` (bool)
pub fn parse_udp_accel_from_pack(p: &pack::Pack) -> Option<UdpAccelServerInfo> {
    // Bool-as-int convention (Cedar PackAddBool stores 0/1 as int).
    let use_udp = p.get_int("use_udp_acceleration").unwrap_or(0) != 0;
    if !use_udp {
        return None;
    }

    let version = p.get_int("udp_acceleration_version").unwrap_or(1);
    let server_port = p.get_int("udp_acceleration_server_port")?;
    if server_port == 0 || server_port > u16::MAX as u32 {
        return None;
    }

    let ip_bytes = p.get_data("udp_acceleration_server_ip")?;
    let server_ip = match ip_bytes.len() {
        4 => std::net::IpAddr::V4(std::net::Ipv4Addr::new(
            ip_bytes[0],
            ip_bytes[1],
            ip_bytes[2],
            ip_bytes[3],
        )),
        16 => {
            let mut a = [0u8; 16];
            a.copy_from_slice(ip_bytes);
            std::net::IpAddr::V6(std::net::Ipv6Addr::from(a))
        }
        _ => return None,
    };

    let key_v1_bytes = p.get_data("udp_acceleration_server_key")?;
    if key_v1_bytes.len() != udp_accel::UDP_ACCEL_COMMON_KEY_SIZE_V1 {
        return None;
    }
    let mut server_key_v1 = [0u8; udp_accel::UDP_ACCEL_COMMON_KEY_SIZE_V1];
    server_key_v1.copy_from_slice(key_v1_bytes);

    let server_key_v2 = p
        .get_data("udp_acceleration_server_key_v2")
        .unwrap_or(&[])
        .to_vec();

    let server_cookie = p.get_int("udp_acceleration_server_cookie").unwrap_or(0);
    let client_cookie = p.get_int("udp_acceleration_client_cookie").unwrap_or(0);
    let use_encryption = p.get_int("udp_acceleration_use_encryption").unwrap_or(1) != 0;
    let fast_disconnect = p.get_int("udp_accel_fast_disconnect_detect").unwrap_or(0) != 0;

    Some(UdpAccelServerInfo {
        server_ip,
        server_port: server_port as u16,
        server_key_v1,
        server_key_v2,
        server_cookie,
        client_cookie,
        use_encryption,
        version,
        fast_disconnect,
    })
}

fn build_auth_config_from_softether(config: &SoftEtherConfig) -> auth::ClientAuthConfig {
    let password = config.password.clone().unwrap_or_default();
    let username = config.username.clone().unwrap_or_default();
    let method = match config.auth_type.as_deref() {
        Some("Anonymous") | Some("anonymous") => auth::AuthMethod::Anonymous,
        Some("Plain") | Some("plain") | Some("PlainPassword") | Some("plain_password") => {
            auth::AuthMethod::PlainPassword
        }
        Some("Cert") | Some("cert") | Some("Certificate") => auth::AuthMethod::Certificate,
        Some("Password") | Some("password") => auth::AuthMethod::Password,
        _ if !password.is_empty() => auth::AuthMethod::Password,
        _ => auth::AuthMethod::Anonymous,
    };

    // Version / build are cosmetic to the server — pick values that
    // match a recent upstream client release so hub operators don't
    // flag us as ancient.
    auth::ClientAuthConfig {
        method,
        hub: config.hub.clone(),
        username,
        password,
        max_connection: 1,
        use_encrypt: true,
        use_compress: false,
        half_connection: false,
        client_str: "sortOfRemoteNG VPN Client".to_string(),
        client_version: 438,
        client_build: 9760,
        // Not machine-bound — Cedar's GenerateMachineUniqueHash() is
        // an opaque SHA-0 of a platform-specific identifier, and the
        // field is free-form on the server side. A stable per-install
        // value is ideal but is out of SE-3 scope.
        unique_id: [0u8; SHA0_SIZE],
        client_id: 0,
    }
}

// SE-4 note: `softether_auth_handshake` (which opened a SECOND TCP+TLS
// socket for the ClientAuth POST) has been deleted — the post-watermark
// stream is now retained through auth and key-derivation by
// `softether_handshake_and_auth` above. See SE-3's log §"Known
// limitations #1" for the original socket-reuse issue this closed.

/// Stream-generic core of the ClientAuth exchange (matches
/// `run_watermark_exchange`'s pattern). Split out so the mock-server
/// test can drive it over an in-process TLS stream.
///
/// Protocol (per `Cedar/Protocol.c::ClientUploadAuth` +
/// `HttpClientRecv`):
/// 1. POST `/vpnsvc/vpn.cgi` with PACK body (encoded ClientAuth).
/// 2. Read the HTTP response; body is a PACK.
/// 3. Parse Welcome PACK → (session_name, connection_name,
///    session_key, session_key_32, policy_version).
async fn run_auth_exchange<S>(
    stream: &mut S,
    host: &str,
    server_random: &[u8; SHA0_SIZE],
    config: &auth::ClientAuthConfig,
) -> Result<auth::AuthResult, String>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let pack = auth::build_client_auth_pack(config, server_random)
        .map_err(|e| format!("Failed to build ClientAuth PACK: {}", e))?;
    let body = pack
        .to_bytes()
        .map_err(|e| format!("Failed to encode ClientAuth PACK: {}", e))?;

    let mut request = format!(
        "POST /vpnsvc/vpn.cgi HTTP/1.1\r\n\
         Host: {}\r\n\
         Content-Type: application/octet-stream\r\n\
         Connection: Keep-Alive\r\n\
         Content-Length: {}\r\n\
         \r\n",
        host,
        body.len()
    )
    .into_bytes();
    request.extend_from_slice(&body);

    stream
        .write_all(&request)
        .await
        .map_err(|e| format!("Failed to send ClientAuth request: {}", e))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("Failed to flush ClientAuth request: {}", e))?;

    let (status, _headers, reply_body) = read_http_response(stream).await?;
    if status != 200 {
        return Err(format!(
            "SoftEther server returned HTTP {} to ClientAuth POST",
            status
        ));
    }

    let reply = Pack::from_bytes(&reply_body)
        .map_err(|e| format!("Failed to decode Welcome PACK: {}", e))?;

    auth::parse_auth_response(&reply).map_err(|e| format!("auth failed: {}", e))
}

// SE-4 note: `softether_watermark_handshake` (the TCP+TLS setup wrapper)
// has been inlined into `softether_handshake_and_auth` so the stream is
// retained for the subsequent auth + key-derivation phases.

/// The stream-generic core of the watermark exchange. Split out from the
/// TLS setup so the mock-server unit test can exercise it directly on a
/// plain `TlsStream` wired to a local loopback server.
///
/// Protocol (per `Cedar/Protocol.c::ClientUploadSignature` +
/// `ClientDownloadHello`):
/// 1. POST `/vpnsvc/connect.cgi` HTTP/1.1, `Content-Type: image/jpeg`,
///    body = [`WATERMARK`] (1411 bytes — padding tail is optional).
/// 2. Read the HTTP response. Body is a PACK.
/// 3. PACK fields: `hello` (Str), `random` (Data, 20 bytes),
///    `build` (Int), `version` (Int), optional `server_str` (Str).
async fn run_watermark_exchange<S>(stream: &mut S, host: &str) -> Result<ServerInfo, String>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    // Assemble the POST. SoftEther's upstream client uses HTTP/1.1 with
    // `Connection: Keep-Alive` — we mirror that. Content-Length is the
    // exact WATERMARK size; we do NOT append the random padding that
    // upstream's `ClientUploadSignature` adds (the server's
    // `CompareWaterMark` ignores anything past `SizeOfWaterMark()`, and
    // a deterministic body eases the mock test).
    let mut request = format!(
        "POST /vpnsvc/connect.cgi HTTP/1.1\r\n\
         Host: {}\r\n\
         Content-Type: image/jpeg\r\n\
         Connection: Keep-Alive\r\n\
         Content-Length: {}\r\n\
         \r\n",
        host,
        WATERMARK.len()
    )
    .into_bytes();
    request.extend_from_slice(WATERMARK);

    stream
        .write_all(&request)
        .await
        .map_err(|e| format!("Failed to send watermark request: {}", e))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("Failed to flush watermark request: {}", e))?;

    // Read the response. We need a proper HTTP framing read so we can
    // deliver the exact body bytes to the PACK decoder — a fixed 100ms
    // tail heuristic (what the earlier scaffold used) would truncate the
    // PACK if the server is slow.
    let (status, _headers, body) = read_http_response(stream).await?;

    if status != 200 {
        return Err(format!(
            "SoftEther server returned HTTP {} to watermark POST",
            status
        ));
    }

    let pack = Pack::from_bytes(&body)
        .map_err(|e| format!("Failed to decode server hello PACK: {}", e))?;

    // `GetHello` in Protocol.c calls `PackGetStr(p, "hello", ...)` and
    // hard-fails if missing. We do the same, with a descriptive error.
    let hello = pack
        .get_str("hello")
        .ok_or_else(|| "server hello PACK missing 'hello' field".to_string())?
        .to_string();

    // `random` must be exactly 20 bytes (SHA1_SIZE). The C code uses
    // this as the client-side nonce for SE-4 session-key derivation.
    let random_raw = pack
        .get_data("random")
        .ok_or_else(|| "server hello PACK missing 'random' field".to_string())?;
    if random_raw.len() != 20 {
        return Err(format!(
            "server hello PACK 'random' has {} bytes, expected 20",
            random_raw.len()
        ));
    }
    let mut random = [0u8; 20];
    random.copy_from_slice(random_raw);

    let build = pack.get_int("build").unwrap_or(0);
    let version = pack.get_int("version").unwrap_or(0);
    let server_str = pack
        .get_str("server_str")
        .map(|s| s.to_string())
        .unwrap_or_default();

    Ok(ServerInfo {
        hello,
        random,
        build,
        version,
        server_str,
    })
}

/// Minimal HTTP/1.x response parser sized for SoftEther's
/// `connect.cgi` replies. Returns `(status_code, header_text,
/// body_bytes)`.
///
/// Supports `Content-Length`-framed bodies (always used by
/// `connect.cgi`). Rejects chunked framing and connection-close framing
/// — the server never uses those on this path.
async fn read_http_response<S>(stream: &mut S) -> Result<(u16, String, Vec<u8>), String>
where
    S: AsyncReadExt + Unpin,
{
    // Read until we have the "\r\n\r\n" header terminator, bounded.
    const MAX_HEADER_BYTES: usize = 16 * 1024;
    const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
    let mut buf = Vec::with_capacity(4096);
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    let header_end = loop {
        if buf.len() > MAX_HEADER_BYTES {
            return Err("HTTP response headers exceeded 16 KiB limit".into());
        }
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("Timed out reading HTTP response header".into());
        }
        let mut chunk = [0u8; 4096];
        let n = tokio::time::timeout(remaining, stream.read(&mut chunk))
            .await
            .map_err(|_| "Timed out reading HTTP response header".to_string())?
            .map_err(|e| format!("Failed to read HTTP response: {}", e))?;
        if n == 0 {
            return Err("Connection closed before HTTP headers completed".into());
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let header_bytes = &buf[..header_end];
    let header_text = String::from_utf8_lossy(header_bytes).to_string();

    let status_line = header_text.lines().next().unwrap_or("");
    if !status_line.starts_with("HTTP/1.") {
        return Err(format!(
            "non-HTTP response (status line: {:?})",
            status_line
        ));
    }
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| format!("malformed HTTP status line: {:?}", status_line))?;

    // Case-insensitive Content-Length lookup. SoftEther always sets it
    // on `connect.cgi` replies (see `PostHttpResponse` in
    // Cedar/Protocol.c).
    let content_length: usize = header_text
        .lines()
        .take_while(|l| !l.is_empty())
        .find_map(|l| {
            let mut parts = l.splitn(2, ':');
            match (parts.next(), parts.next()) {
                (Some(n), Some(v)) if n.eq_ignore_ascii_case("content-length") => {
                    v.trim().parse::<usize>().ok()
                }
                _ => None,
            }
        })
        .ok_or_else(|| "HTTP response missing Content-Length".to_string())?;

    if content_length > MAX_BODY_BYTES {
        return Err(format!(
            "HTTP response body too large: {} bytes",
            content_length
        ));
    }

    // Pull any body bytes already read into the header buffer.
    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("Timed out reading HTTP response body".into());
        }
        let mut chunk = [0u8; 4096];
        let to_read = (content_length - body.len()).min(chunk.len());
        let n = tokio::time::timeout(remaining, stream.read(&mut chunk[..to_read]))
            .await
            .map_err(|_| "Timed out reading HTTP response body".to_string())?
            .map_err(|e| format!("Failed to read HTTP response body: {}", e))?;
        if n == 0 {
            return Err(format!(
                "Connection closed with {} of {} body bytes",
                body.len(),
                content_length
            ));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);

    Ok((status, header_text, body))
}

/// Builds a rustls `ClientConfig` for SoftEther's TLS layer. When
/// `skip_verify` is true, installs a no-op certificate verifier suitable
/// only for development / self-signed servers.
fn build_rustls_client_config(skip_verify: bool) -> Result<ClientConfig, String> {
    // Ensure a crypto provider is installed. The app installs one in
    // `run()`, but this crate may be exercised in isolation (tests,
    // cargo check --bin). Treat "already installed" as success.
    let _ = rustls::crypto::ring::default_provider().install_default();

    if skip_verify {
        let dangerous = Arc::new(DangerousNoVerify {
            provider: Arc::new(rustls::crypto::ring::default_provider()),
        });
        let builder = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(dangerous)
            .with_no_client_auth();
        Ok(builder)
    } else {
        let mut roots = rustls::RootCertStore::empty();
        let native = rustls_native_certs::load_native_certs();
        // On some platforms (Linux containers w/o ca-certificates) this can
        // produce partial errors; we treat as non-fatal if at least one cert
        // loaded successfully.
        for cert in native.certs {
            let _ = roots.add(cert);
        }
        if roots.is_empty() {
            return Err(
                "No native TLS root certificates available; set skip_verify=true or install ca-certificates"
                    .to_string(),
            );
        }
        Ok(ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth())
    }
}

/// rustls verifier that accepts any server certificate. Used only when
/// the caller explicitly opts in via `SoftEtherConfig::skip_verify`.
#[derive(Debug)]
struct DangerousNoVerify {
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl rustls::client::danger::ServerCertVerifier for DangerousNoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Long-running per-connection task spawned on `connect()`. At present it
/// immediately returns, marking the PACK layer as unimplemented; the
/// scaffolding is in place so that when PACK lands we can run the auth
/// exchange and enter the data-plane loop without touching the command
/// handler or service CRUD.
async fn softether_session_task(
    connection_id: String,
    _config: SoftEtherConfig,
    mut ctrl_rx: mpsc::Receiver<ControlMessage>,
    emitter: Option<DynEventEmitter>,
) {
    // Historical stub (superseded in SE-4..SE-7): the PACK codec,
    // ClientAuth handshake, session-key derivation, dataplane packet
    // loop, and UDP-acceleration cut-over are all implemented now —
    // see `softether_handshake_and_auth`, `supervisor::spawn_dataplane`,
    // and `udp_accel::run_udp_accel`. That path is driven from
    // `SoftEtherService::connect` and `spawn_with_reconnect`. This
    // per-connection task is retained as a compatibility shim for
    // call-sites that still spawn it; its sole job is to drain control
    // messages and exit promptly on `disconnect()`. Previously this
    // block carried a TODO(e04 escalation) checklist; it has been
    // resolved by SE-4..SE-7 and is preserved here as documentation.
    if let Some(emitter) = &emitter {
        let _ = emitter.emit_event(
            "vpn::status-changed",
            serde_json::json!({
                "connection_id": connection_id,
                "vpn_type": "softether",
                "status": "session_task_stub",
                "note": "PACK negotiation pending — see e04 escalation",
            }),
        );
    }

    while let Some(msg) = ctrl_rx.recv().await {
        match msg {
            ControlMessage::Shutdown => return,
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_connection_requires_server_and_hub() {
        let state = SoftEtherService::new();
        let mut svc = state.lock().await;

        let missing_server = svc
            .create_connection(
                "demo".into(),
                SoftEtherConfig {
                    server: "".into(),
                    port: None,
                    hub: "VPN".into(),
                    username: None,
                    password: None,
                    certificate: None,
                    private_key: None,
                    auth_type: None,
                    skip_verify: None,
                    use_udp_acceleration: None,
                    max_reconnects: None,
                    custom_options: Vec::new(),
                    start_dataplane: None,
                    tap_name: None,
                    reconnect_policy: None,
                    enable_udp_accel: false,
                    reconnect: None,
                },
            )
            .await;
        assert!(missing_server.is_err());

        let missing_hub = svc
            .create_connection(
                "demo".into(),
                SoftEtherConfig {
                    server: "vpn.example.com".into(),
                    port: None,
                    hub: "".into(),
                    username: None,
                    password: None,
                    certificate: None,
                    private_key: None,
                    auth_type: None,
                    skip_verify: None,
                    use_udp_acceleration: None,
                    max_reconnects: None,
                    custom_options: Vec::new(),
                    start_dataplane: None,
                    tap_name: None,
                    reconnect_policy: None,
                    enable_udp_accel: false,
                    reconnect: None,
                },
            )
            .await;
        assert!(missing_hub.is_err());
    }

    #[tokio::test]
    async fn connection_crud_roundtrip() {
        let state = SoftEtherService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection(
                "test".into(),
                SoftEtherConfig {
                    server: "vpn.example.com".into(),
                    port: Some(443),
                    hub: "VPN".into(),
                    username: Some("alice".into()),
                    password: Some("hunter2".into()),
                    certificate: None,
                    private_key: None,
                    auth_type: Some("Password".into()),
                    skip_verify: Some(true),
                    use_udp_acceleration: Some(false),
                    max_reconnects: Some(3),
                    custom_options: Vec::new(),
                    start_dataplane: None,
                    tap_name: None,
                    reconnect_policy: None,
                    enable_udp_accel: false,
                    reconnect: None,
                },
            )
            .await
            .expect("create");
        assert!(!id.is_empty());

        let fetched = svc.get_connection(&id).await.expect("get");
        assert_eq!(fetched.name, "test");
        assert_eq!(fetched.config.hub, "VPN");

        let listed = svc.list_connections().await;
        assert_eq!(listed.len(), 1);

        svc.update_connection(&id, Some("renamed".into()), None)
            .await
            .expect("update");
        assert_eq!(svc.get_connection(&id).await.unwrap().name, "renamed");

        svc.delete_connection(&id).await.expect("delete");
        assert!(svc.get_connection(&id).await.is_err());
    }

    // ── Mock-server watermark/hello test ────────────────────────────────
    //
    // Spins a local TLS server (self-signed cert via `rcgen`), feeds our
    // client the WATERMARK POST, replies with an HTTP response whose body
    // is a PACK-encoded hello matching `Cedar/Protocol.c::GetHello`, and
    // asserts the parsed [`ServerInfo`].
    //
    // This is the SE-2 acceptance test: it exercises the full
    // `run_watermark_exchange` path (WATERMARK send → HTTP response parse
    // → PACK decode → field extraction) against a deterministic server.

    use rustls::pki_types::{CertificateDer, PrivateKeyDer};
    use std::net::SocketAddr;
    use tokio::net::TcpListener;
    use tokio_rustls::rustls::ServerConfig;
    use tokio_rustls::TlsAcceptor;

    fn build_test_cert() -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
            .expect("self-signed cert");
        let der = cert.serialize_der().expect("serialize cert");
        let key = cert.serialize_private_key_der();
        (CertificateDer::from(der), PrivateKeyDer::Pkcs8(key.into()))
    }

    fn build_hello_pack(
        hello: &str,
        random: &[u8; 20],
        build: u32,
        version: u32,
        server_str: &str,
    ) -> Vec<u8> {
        let mut p = Pack::new();
        p.add_str("hello", hello).unwrap();
        p.add_data("random", random.to_vec()).unwrap();
        p.add_int("build", build).unwrap();
        p.add_int("version", version).unwrap();
        p.add_str("server_str", server_str).unwrap();
        p.to_bytes().unwrap()
    }

    /// Spawn a local TLS "SoftEther" that returns a canned hello PACK.
    /// Returns (bound_addr, server_task_join).
    async fn spawn_mock_server(
        pack_body: Vec<u8>,
    ) -> (SocketAddr, tokio::task::JoinHandle<Result<Vec<u8>, String>>) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (cert, key) = build_test_cert();
        let cfg = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)
            .expect("server config");
        let acceptor = TlsAcceptor::from(Arc::new(cfg));

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local_addr");

        let task = tokio::spawn(async move {
            let (tcp, _peer) = listener
                .accept()
                .await
                .map_err(|e| format!("accept: {}", e))?;
            let mut tls = acceptor
                .accept(tcp)
                .await
                .map_err(|e| format!("tls accept: {}", e))?;

            // Read the request headers up to \r\n\r\n, then the exact
            // body bytes per Content-Length, to let us assert on the
            // WATERMARK bytes the client actually sent.
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            let header_end = loop {
                let n = tls.read(&mut chunk).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    return Err("mock: EOF before headers".into());
                }
                buf.extend_from_slice(&chunk[..n]);
                if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break pos + 4;
                }
                if buf.len() > 32 * 1024 {
                    return Err("mock: header too big".into());
                }
            };
            let header_text = String::from_utf8_lossy(&buf[..header_end]).to_string();
            let content_length: usize = header_text
                .lines()
                .find_map(|l| {
                    let mut p = l.splitn(2, ':');
                    match (p.next(), p.next()) {
                        (Some(n), Some(v)) if n.eq_ignore_ascii_case("content-length") => {
                            v.trim().parse().ok()
                        }
                        _ => None,
                    }
                })
                .ok_or_else(|| "mock: no content-length".to_string())?;
            let mut body = buf[header_end..].to_vec();
            while body.len() < content_length {
                let n = tls.read(&mut chunk).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    return Err("mock: EOF before body complete".into());
                }
                body.extend_from_slice(&chunk[..n]);
            }
            body.truncate(content_length);

            // Write a canonical `200 OK` response with the PACK body.
            let response_header = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: image/jpeg\r\n\
                 Content-Length: {}\r\n\
                 Connection: Keep-Alive\r\n\
                 \r\n",
                pack_body.len()
            );
            tls.write_all(response_header.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            tls.write_all(&pack_body).await.map_err(|e| e.to_string())?;
            tls.flush().await.map_err(|e| e.to_string())?;

            Ok(body) // body = what the client POSTed
        });

        (addr, task)
    }

    #[tokio::test]
    async fn handshake_mock_server_parses_hello_pack() {
        let hello = "SoftEther VPN Server (test)";
        let random = [
            0x01u8, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E,
            0x0F, 0x10, 0x11, 0x12, 0x13, 0x14,
        ];
        let build = 9760u32;
        let version = 438u32;
        let server_str = "test-mock";

        let pack = build_hello_pack(hello, &random, build, version, server_str);
        let (addr, task) = spawn_mock_server(pack).await;

        // Client side: TCP+TLS to the mock, then run the watermark
        // exchange. We use `skip_verify=true` because the mock ships a
        // self-signed cert.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let tls_config = build_rustls_client_config(true).expect("client config");
        let connector = TlsConnector::from(Arc::new(tls_config));
        let tcp = TcpStream::connect(addr).await.expect("connect");
        let sni = ServerName::try_from("localhost").expect("sni");
        let mut tls = connector.connect(sni, tcp).await.expect("tls");

        let info = run_watermark_exchange(&mut tls, "localhost")
            .await
            .expect("handshake succeeds");

        assert_eq!(info.hello, hello);
        assert_eq!(info.random, random);
        assert_eq!(info.build, build);
        assert_eq!(info.version, version);
        assert_eq!(info.server_str, server_str);

        // And verify the server saw exactly the WATERMARK we expect —
        // any corruption here would be caught by the unit test in
        // `watermark::tests`, but we belt-and-braces it end-to-end too.
        let posted_body = task.await.expect("server task").expect("server result");
        assert_eq!(posted_body.len(), WATERMARK.len());
        assert_eq!(&posted_body[..], WATERMARK);
    }

    // ── SE-3 ClientAuth mock-server test ────────────────────────────────
    //
    // Builds on the SE-2 mock pattern: one server accepts the WATERMARK
    // POST + replies with hello, then accepts the auth PACK POST on the
    // same TLS session (SoftEther clients reuse the socket — we do too
    // via HTTP keep-alive). Asserts the parsed [`AuthResult`] matches
    // what the server sent, AND that the `secure_password` on the wire
    // matches the locally-computed `hash_and_secure_password(...)` for
    // the advertised server random.

    fn build_welcome_pack_bytes(
        session_name: &str,
        connection_name: &str,
        session_key: &[u8; 20],
        session_key_32: u32,
        policy_ver: u32,
    ) -> Vec<u8> {
        let mut p = Pack::new();
        p.add_str("session_name", session_name).unwrap();
        p.add_str("connection_name", connection_name).unwrap();
        p.add_data("session_key", session_key.to_vec()).unwrap();
        p.add_int("session_key_32", session_key_32).unwrap();
        p.add_int("policy:Ver", policy_ver).unwrap();
        p.add_int("max_connection", 1).unwrap();
        p.to_bytes().unwrap()
    }

    fn build_welcome_pack_bytes_with_cipher(
        session_name: &str,
        connection_name: &str,
        session_key: &[u8; 20],
        session_key_32: u32,
        policy_ver: u32,
        cipher_name: &str,
    ) -> Vec<u8> {
        let mut p = Pack::new();
        p.add_str("session_name", session_name).unwrap();
        p.add_str("connection_name", connection_name).unwrap();
        p.add_data("session_key", session_key.to_vec()).unwrap();
        p.add_int("session_key_32", session_key_32).unwrap();
        p.add_int("policy:Ver", policy_ver).unwrap();
        p.add_int("max_connection", 1).unwrap();
        p.add_str("cipher_name", cipher_name).unwrap();
        p.to_bytes().unwrap()
    }

    /// Like `spawn_mock_server` but serves TWO POSTs on the same TLS
    /// conversation: first the WATERMARK → reply with `hello_body`,
    /// then the ClientAuth PACK → reply with `welcome_body`. Returns
    /// the accepted second body (auth PACK) so the test can assert
    /// on its contents.
    #[allow(clippy::too_many_arguments)]
    async fn spawn_mock_server_two_posts(
        hello_body: Vec<u8>,
        welcome_body: Vec<u8>,
    ) -> (
        SocketAddr,
        tokio::task::JoinHandle<Result<(Vec<u8>, Vec<u8>), String>>,
    ) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (cert, key) = build_test_cert();
        let cfg = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)
            .expect("server config");
        let acceptor = TlsAcceptor::from(Arc::new(cfg));

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local_addr");

        let task = tokio::spawn(async move {
            let (tcp, _peer) = listener
                .accept()
                .await
                .map_err(|e| format!("accept: {}", e))?;
            let mut tls = acceptor
                .accept(tcp)
                .await
                .map_err(|e| format!("tls accept: {}", e))?;

            async fn read_one_request<T: AsyncReadExt + Unpin>(
                tls: &mut T,
                carry: &mut Vec<u8>,
            ) -> Result<Vec<u8>, String> {
                let mut chunk = [0u8; 4096];
                let header_end = loop {
                    if let Some(pos) = carry.windows(4).position(|w| w == b"\r\n\r\n") {
                        break pos + 4;
                    }
                    let n = tls.read(&mut chunk).await.map_err(|e| e.to_string())?;
                    if n == 0 {
                        return Err("mock: EOF before headers".into());
                    }
                    carry.extend_from_slice(&chunk[..n]);
                    if carry.len() > 32 * 1024 {
                        return Err("mock: header too big".into());
                    }
                };
                let header_text = String::from_utf8_lossy(&carry[..header_end]).to_string();
                let content_length: usize = header_text
                    .lines()
                    .find_map(|l| {
                        let mut p = l.splitn(2, ':');
                        match (p.next(), p.next()) {
                            (Some(n), Some(v)) if n.eq_ignore_ascii_case("content-length") => {
                                v.trim().parse().ok()
                            }
                            _ => None,
                        }
                    })
                    .ok_or_else(|| "mock: no content-length".to_string())?;
                let mut body: Vec<u8> = carry[header_end..].to_vec();
                *carry = Vec::new();
                while body.len() < content_length {
                    let n = tls.read(&mut chunk).await.map_err(|e| e.to_string())?;
                    if n == 0 {
                        return Err("mock: EOF before body complete".into());
                    }
                    body.extend_from_slice(&chunk[..n]);
                }
                // Excess bytes past the body length belong to the next
                // request — push them back into carry.
                if body.len() > content_length {
                    let excess = body.split_off(content_length);
                    *carry = excess;
                }
                Ok(body)
            }

            async fn write_response<T: AsyncWriteExt + Unpin>(
                tls: &mut T,
                body: &[u8],
            ) -> Result<(), String> {
                let header = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Content-Type: application/octet-stream\r\n\
                     Content-Length: {}\r\n\
                     Connection: Keep-Alive\r\n\
                     \r\n",
                    body.len()
                );
                tls.write_all(header.as_bytes())
                    .await
                    .map_err(|e| e.to_string())?;
                tls.write_all(body).await.map_err(|e| e.to_string())?;
                tls.flush().await.map_err(|e| e.to_string())?;
                Ok(())
            }

            let mut carry = Vec::new();
            let wm_body = read_one_request(&mut tls, &mut carry).await?;
            write_response(&mut tls, &hello_body).await?;
            let auth_body = read_one_request(&mut tls, &mut carry).await?;
            write_response(&mut tls, &welcome_body).await?;

            Ok((wm_body, auth_body))
        });

        (addr, task)
    }

    #[tokio::test]
    async fn full_handshake_then_auth_mock_server() {
        // Server random drives secure_password derivation; use a
        // non-trivial value so a bogus XOR/zero-buffer impl would
        // diverge from the expected digest.
        let random = [
            0xA1u8, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE,
            0xAF, 0xB0, 0xB1, 0xB2, 0xB3, 0xB4,
        ];
        let hello_pack =
            build_hello_pack("SoftEther VPN Server (test)", &random, 9760, 438, "mock");
        let session_key = [0x5Au8; 20];
        let welcome_pack =
            build_welcome_pack_bytes("SID-alice", "CID-42", &session_key, 0xCAFE_BABE, 3);

        let (addr, task) = spawn_mock_server_two_posts(hello_pack, welcome_pack).await;

        // Drive the client side through the same stream for both POSTs.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let tls_config = build_rustls_client_config(true).expect("client config");
        let connector = TlsConnector::from(Arc::new(tls_config));
        let tcp = TcpStream::connect(addr).await.expect("connect");
        let sni = ServerName::try_from("localhost").expect("sni");
        let mut tls = connector.connect(sni, tcp).await.expect("tls");

        // Step 1: watermark.
        let info = run_watermark_exchange(&mut tls, "localhost")
            .await
            .expect("watermark");
        assert_eq!(info.random, random);

        // Step 2: auth.
        let auth_cfg = auth::ClientAuthConfig {
            method: auth::AuthMethod::Password,
            hub: "VPN".into(),
            username: "alice".into(),
            password: "hunter2".into(),
            max_connection: 1,
            use_encrypt: true,
            use_compress: false,
            half_connection: false,
            client_str: "sortOfRemoteNG".into(),
            client_version: 438,
            client_build: 9760,
            unique_id: [0u8; 20],
            client_id: 0,
        };
        let result = run_auth_exchange(&mut tls, "localhost", &info.random, &auth_cfg)
            .await
            .expect("auth");

        assert_eq!(result.session_name, "SID-alice");
        assert_eq!(result.connection_name, "CID-42");
        assert_eq!(result.session_key, session_key);
        assert_eq!(result.session_key_32, 0xCAFE_BABE);
        assert_eq!(result.policy_version, 3);

        // And verify the auth body on the wire carries the expected
        // secure_password.
        let (_wm, auth_body) = task.await.expect("server").expect("bodies");
        let decoded = Pack::from_bytes(&auth_body).expect("auth pack");
        assert_eq!(decoded.get_str("method"), Some("login"));
        assert_eq!(decoded.get_int("authtype"), Some(1));
        let expected_sp = auth::hash_and_secure_password("hunter2", "alice", &random);
        assert_eq!(
            decoded.get_data("secure_password").expect("sp"),
            &expected_sp[..]
        );
    }

    #[tokio::test]
    async fn auth_mock_server_returns_error_code() {
        // Mock server sends back a Welcome PACK with error=9 (ERR_AUTH_FAILED).
        let random = [0xC0u8; 20];
        let hello_pack = build_hello_pack("mock", &random, 9760, 438, "mock");

        let mut welcome = Pack::new();
        welcome.add_int("error", 9).unwrap();
        let welcome_bytes = welcome.to_bytes().unwrap();

        let (addr, task) = spawn_mock_server_two_posts(hello_pack, welcome_bytes).await;

        let _ = rustls::crypto::ring::default_provider().install_default();
        let tls_config = build_rustls_client_config(true).expect("client config");
        let connector = TlsConnector::from(Arc::new(tls_config));
        let tcp = TcpStream::connect(addr).await.expect("connect");
        let sni = ServerName::try_from("localhost").expect("sni");
        let mut tls = connector.connect(sni, tcp).await.expect("tls");

        let info = run_watermark_exchange(&mut tls, "localhost")
            .await
            .expect("wm");

        let auth_cfg = auth::ClientAuthConfig {
            method: auth::AuthMethod::Password,
            hub: "VPN".into(),
            username: "alice".into(),
            password: "wrong".into(),
            max_connection: 1,
            use_encrypt: true,
            use_compress: false,
            half_connection: false,
            client_str: "sortOfRemoteNG".into(),
            client_version: 438,
            client_build: 9760,
            unique_id: [0u8; 20],
            client_id: 0,
        };
        let err = run_auth_exchange(&mut tls, "localhost", &info.random, &auth_cfg)
            .await
            .expect_err("must fail");
        assert!(
            err.contains("ERR_AUTH_FAILED") || err.contains("code 9"),
            "error string was {:?}",
            err
        );

        let _ = task.await; // drain
    }

    // ── SE-4 cipher_name + key-derivation end-to-end test ───────────────
    //
    // Drives the same two-POST mock server with a Welcome PACK that
    // carries `cipher_name`, then runs `derive_session_keys` on the
    // parsed AuthResult — asserts the full chain (watermark → auth →
    // key schedule) works on a single TLS stream.

    #[tokio::test]
    async fn full_handshake_with_cipher_name_and_key_derivation() {
        let random = [
            0xD0u8, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD,
            0xDE, 0xDF, 0xE0, 0xE1, 0xE2, 0xE3,
        ];
        let hello_pack = build_hello_pack("SE-4 mock", &random, 9760, 438, "mock");
        let session_key = [0x7Eu8; 20];
        let welcome_pack = build_welcome_pack_bytes_with_cipher(
            "SID-se4",
            "CID-se4",
            &session_key,
            0x1234_5678,
            1,
            "AES256-SHA",
        );

        let (addr, task) = spawn_mock_server_two_posts(hello_pack, welcome_pack).await;

        let _ = rustls::crypto::ring::default_provider().install_default();
        let tls_config = build_rustls_client_config(true).expect("client config");
        let connector = TlsConnector::from(Arc::new(tls_config));
        let tcp = TcpStream::connect(addr).await.expect("connect");
        let sni = ServerName::try_from("localhost").expect("sni");
        let mut tls = connector.connect(sni, tcp).await.expect("tls");

        let info = run_watermark_exchange(&mut tls, "localhost")
            .await
            .expect("wm");

        let auth_cfg = auth::ClientAuthConfig {
            method: auth::AuthMethod::Password,
            hub: "VPN".into(),
            username: "alice".into(),
            password: "hunter2".into(),
            max_connection: 1,
            use_encrypt: true,
            use_compress: false,
            half_connection: false,
            client_str: "sortOfRemoteNG".into(),
            client_version: 438,
            client_build: 9760,
            unique_id: [0u8; 20],
            client_id: 0,
        };
        let result = run_auth_exchange(&mut tls, "localhost", &info.random, &auth_cfg)
            .await
            .expect("auth");

        assert_eq!(result.cipher_name.as_deref(), Some("AES256-SHA"));

        // And the client can proceed to key derivation on the result.
        let key32 = session_key::expand_session_key_32(&result.session_key, result.session_key_32);
        let keys = session_key::derive_session_keys(
            &info.random,
            &result.session_key,
            &key32,
            result.cipher_name.as_deref().unwrap_or(""),
        )
        .expect("derive");
        assert_eq!(keys.cipher_name, "AES256-SHA");
        match keys.client_to_server {
            session_key::CipherState::AesCbc(_) => {}
            _ => panic!("expected AES CBC for AES256-SHA"),
        }

        let _ = task.await;
    }

    // ─── SE-5b integration: dataplane spawn + Connected status ──────

    use crate::softether::device::MpscDevice;
    use crate::softether::supervisor::DataplaneConfig;
    use tokio::io::duplex;
    use tokio::io::AsyncReadExt;
    use tokio::io::AsyncWriteExt;

    /// Tiny inline reader for the integration test — read one Cedar
    /// record off the wire and return the parsed frames. Avoids
    /// coupling the mod.rs test to `supervisor`'s private helpers.
    async fn read_one_record_inline<R>(r: &mut R) -> Vec<dataplane::DataFrame>
    where
        R: tokio::io::AsyncRead + Unpin,
    {
        let mut num_buf = [0u8; 4];
        r.read_exact(&mut num_buf).await.expect("num");
        let num = u32::from_be_bytes(num_buf);
        let mut assembled: Vec<u8> = Vec::new();
        assembled.extend_from_slice(&num_buf);
        if num == dataplane::KEEP_ALIVE_MAGIC {
            let mut sz_buf = [0u8; 4];
            r.read_exact(&mut sz_buf).await.expect("ka-sz");
            let sz = u32::from_be_bytes(sz_buf);
            assembled.extend_from_slice(&sz_buf);
            let mut body = vec![0u8; sz as usize];
            r.read_exact(&mut body).await.expect("ka-body");
            assembled.extend_from_slice(&body);
        } else {
            for _ in 0..num {
                let mut sz_buf = [0u8; 4];
                r.read_exact(&mut sz_buf).await.expect("sz");
                let sz = u32::from_be_bytes(sz_buf);
                assembled.extend_from_slice(&sz_buf);
                let mut body = vec![0u8; sz as usize];
                r.read_exact(&mut body).await.expect("body");
                assembled.extend_from_slice(&body);
            }
        }
        dataplane::decode_plain(&assembled).expect("decode")
    }

    fn make_dataplane_config() -> DataplaneConfig {
        DataplaneConfig {
            keepalive_interval: std::time::Duration::from_secs(3600),
            batch_max_frames: 4,
            batch_flush: std::time::Duration::from_millis(5),
            cipher: supervisor::CipherMode::TlsOnly,
            keepalive_timeout_multiplier: 0,
        }
    }

    #[tokio::test]
    async fn spawn_dataplane_flips_status_to_connected_and_rounds_trip_frames() {
        let state = SoftEtherService::new();
        let mut svc = state.lock().await;

        let id = svc
            .create_connection(
                "dp-test".into(),
                SoftEtherConfig {
                    server: "vpn.example.com".into(),
                    port: Some(443),
                    hub: "VPN".into(),
                    username: None,
                    password: None,
                    certificate: None,
                    private_key: None,
                    auth_type: None,
                    skip_verify: Some(true),
                    use_udp_acceleration: None,
                    max_reconnects: None,
                    custom_options: Vec::new(),
                    start_dataplane: Some(true),
                    tap_name: None,
                    reconnect_policy: None,
                    enable_udp_accel: false,
                    reconnect: None,
                },
            )
            .await
            .expect("create");

        // Build an MpscDevice + a mock "server" stream via duplex.
        let (client_side, mut server_side) = duplex(64 * 1024);
        let (mpsc_dev, mut dev_handle) = MpscDevice::new_pair(16, "dp-tap");

        svc.spawn_dataplane_over_stream(&id, client_side, mpsc_dev, make_dataplane_config())
            .await
            .expect("spawn dataplane");

        // Status must be Connected.
        match svc.get_status(&id).await.expect("status") {
            SoftEtherStatus::Connected => {}
            other => panic!("expected Connected, got {:?}", other),
        }

        // Server → "TAP" path: server pushes a batch, client surfaces
        // the frame on the MpscDeviceHandle rx side.
        let wire =
            dataplane::encode_plain(&[dataplane::DataFrame::Ethernet(b"hello-from-hub".to_vec())])
                .unwrap();
        server_side.write_all(&wire).await.unwrap();
        server_side.flush().await.unwrap();
        let got = tokio::time::timeout(std::time::Duration::from_millis(500), dev_handle.rx.recv())
            .await
            .expect("timeout")
            .expect("frame");
        assert_eq!(got, b"hello-from-hub");

        // "TAP" → server path: client pushes a frame; server reads
        // one record and decodes.
        dev_handle.tx.send(b"tap-to-hub".to_vec()).await.unwrap();
        let frames = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            read_one_record_inline(&mut server_side),
        )
        .await
        .expect("timeout");
        assert!(frames.iter().any(|f| matches!(
            f,
            dataplane::DataFrame::Ethernet(b) if b == b"tap-to-hub"
        )));

        // Clean disconnect tears down the supervisor and flips
        // status.
        svc.disconnect(&id).await.expect("disconnect");
        match svc.get_status(&id).await.expect("status") {
            SoftEtherStatus::Disconnected => {}
            other => panic!("expected Disconnected, got {:?}", other),
        }
        // And the handle slot is cleared.
        assert!(svc.dataplane_handles.get(&id).is_none());
    }

    #[tokio::test]
    async fn spawn_dataplane_real_entrypoint_errors_without_stashed_stream() {
        let state = SoftEtherService::new();
        let mut svc = state.lock().await;

        let id = svc
            .create_connection(
                "no-stream".into(),
                SoftEtherConfig {
                    server: "vpn.example.com".into(),
                    port: None,
                    hub: "VPN".into(),
                    username: None,
                    password: None,
                    certificate: None,
                    private_key: None,
                    auth_type: None,
                    skip_verify: None,
                    use_udp_acceleration: None,
                    max_reconnects: None,
                    custom_options: Vec::new(),
                    start_dataplane: None,
                    tap_name: None,
                    reconnect_policy: None,
                    enable_udp_accel: false,
                    reconnect: None,
                },
            )
            .await
            .expect("create");

        // No TLS stream stashed — spawn must fail cleanly.
        let (mpsc_dev, _h) = MpscDevice::new_pair(4, "no-stream");
        let err = svc
            .spawn_dataplane(&id, mpsc_dev, make_dataplane_config())
            .await
            .expect_err("should fail");
        assert!(err.contains("no live TLS stream"), "msg: {}", err);
    }

    #[tokio::test]
    async fn dataplane_handle_is_aborted_on_delete_connection() {
        let state = SoftEtherService::new();
        let mut svc = state.lock().await;
        let id = svc
            .create_connection(
                "del-dp".into(),
                SoftEtherConfig {
                    server: "vpn.example.com".into(),
                    port: None,
                    hub: "VPN".into(),
                    username: None,
                    password: None,
                    certificate: None,
                    private_key: None,
                    auth_type: None,
                    skip_verify: None,
                    use_udp_acceleration: None,
                    max_reconnects: None,
                    custom_options: Vec::new(),
                    start_dataplane: Some(true),
                    tap_name: None,
                    reconnect_policy: None,
                    enable_udp_accel: false,
                    reconnect: None,
                },
            )
            .await
            .expect("create");

        let (client_side, _server_side) = duplex(1024);
        let (mpsc_dev, _h) = MpscDevice::new_pair(4, "del-tap");
        svc.spawn_dataplane_over_stream(&id, client_side, mpsc_dev, make_dataplane_config())
            .await
            .expect("spawn");
        assert!(svc.dataplane_handles.contains_key(&id));

        svc.delete_connection(&id).await.expect("delete");
        assert!(svc.dataplane_handles.get(&id).is_none());
    }

    // ═══════════════ SE-6: UDP accel + reconnect ═══════════════════

    #[test]
    fn parse_udp_accel_from_pack_reads_all_v1_fields() {
        use crate::softether::pack::Pack;
        let mut p = Pack::new();
        p.add_int("use_udp_acceleration", 1).unwrap();
        p.add_int("udp_acceleration_version", 1).unwrap();
        p.add_data("udp_acceleration_server_ip", vec![192u8, 168, 1, 100])
            .unwrap();
        p.add_int("udp_acceleration_server_port", 42000).unwrap();
        p.add_data(
            "udp_acceleration_server_key",
            vec![9u8; udp_accel::UDP_ACCEL_COMMON_KEY_SIZE_V1],
        )
        .unwrap();
        p.add_int("udp_acceleration_server_cookie", 0xDEAD_BEEF)
            .unwrap();
        p.add_int("udp_acceleration_client_cookie", 0xCAFE_BABE)
            .unwrap();
        p.add_int("udp_acceleration_use_encryption", 1).unwrap();
        p.add_int("udp_accel_fast_disconnect_detect", 1).unwrap();

        let info = parse_udp_accel_from_pack(&p).expect("parse");
        assert_eq!(info.version, 1);
        assert_eq!(info.server_port, 42000);
        assert_eq!(info.server_cookie, 0xDEAD_BEEF);
        assert_eq!(info.client_cookie, 0xCAFE_BABE);
        assert!(info.use_encryption);
        assert!(info.fast_disconnect);
        assert_eq!(info.server_key_v1, [9u8; 20]);
        match info.server_ip {
            std::net::IpAddr::V4(v) => assert_eq!(v.octets(), [192, 168, 1, 100]),
            _ => panic!("expected v4"),
        }
    }

    #[test]
    fn parse_udp_accel_returns_none_when_not_enabled() {
        use crate::softether::pack::Pack;
        let mut p = Pack::new();
        p.add_int("use_udp_acceleration", 0).unwrap();
        assert!(parse_udp_accel_from_pack(&p).is_none());
    }

    #[test]
    fn parse_udp_accel_returns_none_on_missing_required_fields() {
        use crate::softether::pack::Pack;
        let mut p = Pack::new();
        p.add_int("use_udp_acceleration", 1).unwrap();
        assert!(parse_udp_accel_from_pack(&p).is_none());
    }

    #[test]
    fn reconnect_policy_config_default_mirrors_internal_default() {
        let c = ReconnectPolicyConfig::default();
        let p: ReconnectPolicy = (&c).into();
        let d = ReconnectPolicy::default();
        assert_eq!(p.max_attempts, d.max_attempts);
        assert_eq!(p.base_delay, d.base_delay);
        assert_eq!(p.max_delay, d.max_delay);
        assert_eq!(p.jitter_ms, d.jitter_ms);
        assert_eq!(p.give_up_after, d.give_up_after);
    }

    #[test]
    fn softether_status_reconnecting_round_trips_serde() {
        let s = SoftEtherStatus::Reconnecting {
            attempt_number: 3,
            next_delay_ms: 2500,
        };
        let j = serde_json::to_string(&s).unwrap();
        let back: SoftEtherStatus = serde_json::from_str(&j).unwrap();
        match back {
            SoftEtherStatus::Reconnecting {
                attempt_number,
                next_delay_ms,
            } => {
                assert_eq!(attempt_number, 3);
                assert_eq!(next_delay_ms, 2500);
            }
            _ => panic!("serde round-trip broken"),
        }
    }
}
